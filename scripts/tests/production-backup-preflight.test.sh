#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly PREFLIGHT="$ROOT_DIR/scripts/production-backup-preflight.sh"
readonly WORKFLOW="$ROOT_DIR/.github/workflows/production-backup-preflight.yml"
readonly PRIVILEGED_LAUNCHER="$ROOT_DIR/infra/production/launchers/buildingos-production-backup-preflight"
readonly SUDOERS_POLICY="$ROOT_DIR/infra/production/sudoers/buildingos-production-backup-preflight"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-backup-preflight.XXXXXX")"
readonly BIN_DIR="$TEST_ROOT/bin"
readonly ENV_FILE="$TEST_ROOT/object-backup.env"
readonly APP_DIR="$TEST_ROOT/app"
readonly RCLONE_CONFIG_FILE="$TEST_ROOT/object-backup-rclone.conf"
trap 'rm -rf "$TEST_ROOT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok %s - %s\n' "$FAIL_COUNT" "$1" >&2; }

assert_contains() {
  local name="$1" value="$2" text="$3"
  if [[ "$text" == *"$value"* ]]; then pass "$name"; else fail_test "$name"; fi
}

assert_absent() {
  local name="$1" value="$2" text="$3"
  if [[ "$text" != *"$value"* ]]; then pass "$name"; else fail_test "$name"; fi
}

assert_success() { local name="$1"; [[ "$RUN_RC" -eq 0 ]] && pass "$name" || fail_test "$name"; }
assert_failure() { local name="$1"; [[ "$RUN_RC" -ne 0 ]] && pass "$name" || fail_test "$name"; }

mkdir -p "$BIN_DIR" "$APP_DIR/.git"
for command_name in awk bash date; do
  ln -s "$(command -v "$command_name")" "$BIN_DIR/$command_name"
done

cat > "$BIN_DIR/stat" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$*" in
  *'%U'*) printf '%s\n' "${MOCK_CONFIG_OWNER:-yoryi}" ;;
  *'%G'*) printf '%s\n' "${MOCK_CONFIG_GROUP:-yoryi}" ;;
  *'%a'*) printf '%s\n' "${MOCK_CONFIG_MODE:-600}" ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$BIN_DIR/stat"

cat > "$BIN_DIR/git" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$*" in
  *'rev-parse HEAD'*) printf '%s\n' "${MOCK_CHECKOUT_SHA:-2ac603be8018ffc3df67fb4e84149aea4f780cea}" ;;
  *'status --porcelain'*) [[ "${MOCK_DIRTY:-NO}" == NO ]] || printf ' M application.env\n' ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$BIN_DIR/git"

cat > "$BIN_DIR/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1 ${2:-}" == 'inspect --type' ]]; then
  [[ "${@: -1}" == buildingos-api ]] && printf 'sha256:%064d\n' 1 || printf 'sha256:%064d\n' 2
elif [[ "$1 ${2:-}" == 'image inspect' ]]; then
  [[ "$3" == sha256:$(printf '%064d' 1) ]] && printf '%s\n' "${MOCK_API_REVISION:-2ac603be8018ffc3df67fb4e84149aea4f780cea}" || printf '%s\n' "${MOCK_WEB_REVISION:-2ac603be8018ffc3df67fb4e84149aea4f780cea}"
else
  exit 1
fi
MOCK
chmod +x "$BIN_DIR/docker"

cat > "$BIN_DIR/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
unit="${2:-}"
property=''
for argument in "$@"; do
  [[ "$argument" == --property=* ]] && property="${argument#--property=}"
done

is_missing() {
  case "$1" in
    pawtech-postgres-backup.service) [[ "${MOCK_MISSING_POSTGRES_SERVICE:-NO}" == YES ]] ;;
    pawtech-postgres-backup.timer) [[ "${MOCK_MISSING_POSTGRES_TIMER:-NO}" == YES ]] ;;
    pawtech-buildingos-object-backup.service) [[ "${MOCK_MISSING_OBJECT_SERVICE:-NO}" == YES ]] ;;
    pawtech-buildingos-object-backup.timer) [[ "${MOCK_MISSING_OBJECT_TIMER:-NO}" == YES ]] ;;
    *) return 1 ;;
  esac
}

if [[ "${1:-}" != show ]]; then exit 1; fi
if is_missing "$unit"; then
  [[ "$property" == LoadState ]] && printf 'not-found\n'
  exit 0
fi

case "$property:$unit" in
  LoadState:*) printf 'loaded\n' ;;
  UnitFileState:pawtech-postgres-backup.timer|UnitFileState:pawtech-buildingos-object-backup.timer) printf '%s\n' "${MOCK_TIMER_ENABLED:-enabled}" ;;
  ActiveState:pawtech-postgres-backup.service) printf '%s\n' "${MOCK_POSTGRES_SERVICE_STATE:-inactive}" ;;
  ActiveState:pawtech-buildingos-object-backup.service) printf '%s\n' "${MOCK_OBJECT_SERVICE_STATE:-inactive}" ;;
  ActiveState:pawtech-postgres-backup.timer|ActiveState:pawtech-buildingos-object-backup.timer) printf '%s\n' "${MOCK_TIMER_STATE:-active}" ;;
  Unit:pawtech-postgres-backup.timer) printf 'pawtech-postgres-backup.service\n' ;;
  Unit:pawtech-buildingos-object-backup.timer) printf 'pawtech-buildingos-object-backup.service\n' ;;
  NextElapseUSecRealtime:*)
    if [[ -n "${MOCK_NEXT_TRIGGER:-}" ]]; then printf '%s\n' "$MOCK_NEXT_TRIGGER"; else date -u -v+12H '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null || date -u -d '+12 hours' '+%Y-%m-%d %H:%M:%S UTC'; fi
    ;;
  OnCalendar:pawtech-postgres-backup.timer) printf '%s\n' "${MOCK_POSTGRES_CALENDAR:-daily}" ;;
  OnCalendar:pawtech-buildingos-object-backup.timer) printf '%s\n' "${MOCK_OBJECT_CALENDAR:-*-*-* 02:15:00}" ;;
  Persistent:pawtech-buildingos-object-backup.timer) printf '%s\n' "${MOCK_OBJECT_PERSISTENT:-true}" ;;
  RandomizedDelayUSec:pawtech-buildingos-object-backup.timer) printf '%s\n' "${MOCK_OBJECT_RANDOMIZED_DELAY:-900000000}" ;;
  User:pawtech-buildingos-object-backup.service|Group:pawtech-buildingos-object-backup.service) printf 'yoryi\n' ;;
  EnvironmentFiles:pawtech-buildingos-object-backup.service) printf '%s\n' "${PREFLIGHT_ENV_FILE:-/etc/buildingos/object-backup.env}" ;;
  WorkingDirectory:pawtech-buildingos-object-backup.service) printf '%s\n' "${PREFLIGHT_APP_DIR:-/opt/pawtech/apps/buildingos/buildingos-app}" ;;
  Type:pawtech-postgres-backup.service|Type:pawtech-buildingos-object-backup.service) printf 'oneshot\n' ;;
  ExecStart:pawtech-postgres-backup.service) printf '%s\n' '{ path=/opt/pawtech/backups/scripts/backup-postgres.sh ; argv[]=/opt/pawtech/backups/scripts/backup-postgres.sh ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=0 ; status=0 }' ;;
  ExecStart:pawtech-buildingos-object-backup.service)
    case "${MOCK_OBJECT_EXECSTART_MODE:-NORMAL}" in
      WRONG) printf '%s\n' '{ path=/opt/wrong/backup.sh ; argv[]=/opt/wrong/backup.sh ; ignore_errors=no }' ;;
      SECOND) printf '%s\n' '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; ignore_errors=no } { path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; ignore_errors=no }' ;;
      IGNORE) printf '%s\n' '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; ignore_errors=yes }' ;;
      MALFORMED) printf '%s\n' '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh' ;;
      *) printf '%s\n' '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=0 ; status=0 }' ;;
    esac
    ;;
  TimeoutStartUSec:pawtech-buildingos-object-backup.service)
    case "${MOCK_TIMEOUT_MODE:-EXACT}" in
      SIX_HOURS) printf '6h\n' ;;
      SIX_HOURS_VERBOSE) printf '6h 0min 0s\n' ;;
      SHORTER) printf '1000000\n' ;;
      MALFORMED) printf 'not-a-timeout\n' ;;
      MISSING) exit 1 ;;
      *) printf '21600000000\n' ;;
    esac
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$BIN_DIR/systemctl"

write_env() {
  local source="${1-prod:buildingos-production}"
  local destination="${2-backup:buildingos-production-backup}"
  {
    printf '# protected fixture\n'
    printf 'OBJECT_BACKUP_SOURCE=%s\n' "$source"
    printf 'OBJECT_BACKUP_DESTINATION=%s\n' "$destination"
    printf 'OBJECT_BACKUP_RECEIPT=/var/lib/buildingos-object-backup/object-backup-receipt.json\n'
    printf 'RCLONE_CONFIG=%s\n' "$RCLONE_CONFIG_FILE"
  } > "$ENV_FILE"
}

printf '[prod]\ntype = s3\n' > "$RCLONE_CONFIG_FILE"
chmod 0600 "$RCLONE_CONFIG_FILE"

run_preflight() {
  local candidate="${1-2ac603be8018ffc3df67fb4e84149aea4f780cea}"
  set +e
  RUN_OUTPUT="$(PATH="$BIN_DIR" BUILDINGOS_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY PREFLIGHT_APP_DIR="$APP_DIR" PREFLIGHT_ENV_FILE="$ENV_FILE" PREFLIGHT_RCLONE_CONFIG_FILE="$RCLONE_CONFIG_FILE" /bin/bash "$PREFLIGHT" 2>&1 "$candidate")"
  RUN_RC=$?
  set -e
}

write_env
run_preflight
assert_success 'current topology passes with active timers and inactive services'
assert_contains 'PostgreSQL timer enabled is accepted' 'POSTGRES_BACKUP_TIMER_ENABLED=YES' "$RUN_OUTPUT"
assert_contains 'PostgreSQL timer active is accepted' 'POSTGRES_BACKUP_TIMER_ACTIVE=YES' "$RUN_OUTPUT"
assert_contains 'PostgreSQL timer future trigger is accepted' 'POSTGRES_BACKUP_TIMER_FUTURE_TRIGGER=YES' "$RUN_OUTPUT"
assert_contains 'PostgreSQL service inactive is accepted' 'POSTGRES_BACKUP_SERVICE_STATE=inactive' "$RUN_OUTPUT"
assert_contains 'runtime checkout is clean' 'PRODUCTION_CHECKOUT_STATUS=CLEAN' "$RUN_OUTPUT"
assert_contains 'runtime identity is consistent' 'RUNTIME_IDENTITY=CONSISTENT' "$RUN_OUTPUT"
assert_contains 'PostgreSQL service type is validated' 'POSTGRES_BACKUP_SERVICE_TYPE=oneshot' "$RUN_OUTPUT"
assert_contains 'PostgreSQL ExecStart is validated' 'POSTGRES_BACKUP_SERVICE_EXECSTART_MATCH=YES' "$RUN_OUTPUT"
assert_contains 'Object timer enabled is accepted' 'OBJECT_BACKUP_TIMER_ENABLED=YES' "$RUN_OUTPUT"
assert_contains 'Object timer active is accepted' 'OBJECT_BACKUP_TIMER_ACTIVE=YES' "$RUN_OUTPUT"
assert_contains 'Object timer future trigger is accepted' 'OBJECT_BACKUP_TIMER_FUTURE_TRIGGER=YES' "$RUN_OUTPUT"
assert_contains 'Object timer calendar is accepted' 'OBJECT_BACKUP_TIMER_CALENDAR_MATCH=YES' "$RUN_OUTPUT"
assert_contains 'Object timer persistence is accepted' 'OBJECT_BACKUP_TIMER_PERSISTENT=YES' "$RUN_OUTPUT"
assert_contains 'Object timer randomized delay is accepted' 'OBJECT_BACKUP_TIMER_RANDOMIZED_DELAY_MATCH=YES' "$RUN_OUTPUT"
assert_contains 'Object service contract is accepted' 'OBJECT_BACKUP_SERVICE_CONTRACT=YES' "$RUN_OUTPUT"
assert_contains 'Object environment contract is accepted' 'OBJECT_BACKUP_ENV=YES' "$RUN_OUTPUT"
assert_contains 'backup concurrency is safe' 'BACKUP_CONCURRENCY_SAFE=YES' "$RUN_OUTPUT"

MOCK_OBJECT_CALENDAR='*-*-* 03:15:00' run_preflight
assert_failure 'wrong Object Storage timer calendar fails closed'
unset MOCK_OBJECT_CALENDAR
MOCK_OBJECT_PERSISTENT=false run_preflight
assert_failure 'non-persistent Object Storage timer fails closed'
unset MOCK_OBJECT_PERSISTENT
MOCK_OBJECT_RANDOMIZED_DELAY=600000000 run_preflight
assert_failure 'wrong Object Storage timer delay fails closed'
unset MOCK_OBJECT_RANDOMIZED_DELAY
MOCK_OBJECT_CALENDAR='calendar=*-*-* 02:15:00 ; next_elapse=2026-09-06T02:15:00Z' MOCK_OBJECT_RANDOMIZED_DELAY=15min run_preflight
assert_success 'serialized calendar and 15min delay representations pass'
unset MOCK_OBJECT_CALENDAR MOCK_OBJECT_RANDOMIZED_DELAY
MOCK_OBJECT_RANDOMIZED_DELAY='15min 0s' run_preflight
assert_success 'verbose 15 minute delay representation passes'
unset MOCK_OBJECT_RANDOMIZED_DELAY
MOCK_POSTGRES_CALENDAR=weekly run_preflight
assert_failure 'non-daily PostgreSQL timer calendar fails closed'
unset MOCK_POSTGRES_CALENDAR
MOCK_NEXT_TRIGGER='2099-01-01 00:00:00 UTC' run_preflight
assert_failure 'absurd future Object Storage trigger fails closed'
unset MOCK_NEXT_TRIGGER

run_preflight deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
assert_failure 'candidate SHA mismatch fails runtime identity gate'
assert_contains 'candidate mismatch reports inconsistent runtime' 'RUNTIME_IDENTITY=INCONSISTENT' "$RUN_OUTPUT"
MOCK_API_REVISION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa run_preflight
assert_failure 'API revision mismatch fails runtime identity gate'
unset MOCK_API_REVISION
MOCK_WEB_REVISION=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb run_preflight
assert_failure 'Web revision mismatch fails runtime identity gate'
unset MOCK_WEB_REVISION
MOCK_CHECKOUT_SHA=cccccccccccccccccccccccccccccccccccccccc run_preflight
assert_failure 'checkout SHA mismatch fails runtime identity gate'
unset MOCK_CHECKOUT_SHA
MOCK_DIRTY=YES run_preflight
assert_failure 'dirty checkout fails runtime identity gate'
unset MOCK_DIRTY

MOCK_POSTGRES_SERVICE_STATE=active run_preflight
assert_failure 'active PostgreSQL backup fails closed'
assert_contains 'active PostgreSQL backup is unsafe' 'BACKUP_CONCURRENCY_SAFE=NO' "$RUN_OUTPUT"
unset MOCK_POSTGRES_SERVICE_STATE

MOCK_POSTGRES_SERVICE_STATE=failed run_preflight
assert_failure 'failed PostgreSQL backup service fails closed'
unset MOCK_POSTGRES_SERVICE_STATE

MOCK_POSTGRES_SERVICE_STATE=unknown run_preflight
assert_failure 'ambiguous PostgreSQL backup service fails closed'
unset MOCK_POSTGRES_SERVICE_STATE

MOCK_OBJECT_SERVICE_STATE=activating run_preflight
assert_failure 'activating Object Storage backup fails closed'
assert_contains 'activating Object Storage backup is unsafe' 'BACKUP_CONCURRENCY_SAFE=NO' "$RUN_OUTPUT"
unset MOCK_OBJECT_SERVICE_STATE

MOCK_MISSING_OBJECT_SERVICE=YES run_preflight
assert_failure 'missing Object Storage service fails closed'
assert_contains 'missing Object Storage service is reported' 'OBJECT_BACKUP_SERVICE_EXISTS=NO' "$RUN_OUTPUT"
unset MOCK_MISSING_OBJECT_SERVICE

MOCK_MISSING_OBJECT_TIMER=YES run_preflight
assert_failure 'missing Object Storage timer fails closed'
assert_contains 'missing Object Storage timer is reported' 'OBJECT_BACKUP_TIMER_EXISTS=NO' "$RUN_OUTPUT"
unset MOCK_MISSING_OBJECT_TIMER

MOCK_OBJECT_EXECSTART_MODE=WRONG run_preflight
assert_failure 'wrong Object Storage ExecStart fails closed'
unset MOCK_OBJECT_EXECSTART_MODE
MOCK_OBJECT_EXECSTART_MODE=SECOND run_preflight
assert_failure 'second Object Storage ExecStart fails closed'
unset MOCK_OBJECT_EXECSTART_MODE
MOCK_OBJECT_EXECSTART_MODE=IGNORE run_preflight
assert_failure 'ignored Object Storage ExecStart fails closed'
unset MOCK_OBJECT_EXECSTART_MODE
MOCK_OBJECT_EXECSTART_MODE=MALFORMED run_preflight
assert_failure 'malformed Object Storage ExecStart fails closed'
unset MOCK_OBJECT_EXECSTART_MODE

MOCK_TIMEOUT_MODE=SIX_HOURS run_preflight
assert_success 'six hour timeout representation passes'
unset MOCK_TIMEOUT_MODE
MOCK_TIMEOUT_MODE=SIX_HOURS_VERBOSE run_preflight
assert_success 'verbose six hour timeout representation passes'
unset MOCK_TIMEOUT_MODE
MOCK_TIMEOUT_MODE=SHORTER run_preflight
assert_failure 'shorter timeout fails closed'
unset MOCK_TIMEOUT_MODE
MOCK_TIMEOUT_MODE=MALFORMED run_preflight
assert_failure 'malformed timeout fails closed'
unset MOCK_TIMEOUT_MODE
MOCK_TIMEOUT_MODE=MISSING run_preflight
assert_failure 'missing timeout fails closed'
unset MOCK_TIMEOUT_MODE

sed -i.bak 's|OBJECT_BACKUP_RECEIPT=/var/lib/buildingos-object-backup/object-backup-receipt.json|OBJECT_BACKUP_RECEIPT=/tmp/wrong-receipt.json|' "$ENV_FILE"
run_preflight
assert_failure 'wrong Object Storage receipt path fails closed'
mv "$ENV_FILE.bak" "$ENV_FILE"

write_env 'prod:buildingos-production/path' 'backup:buildingos-production-backup'
run_preflight
assert_failure 'bucket prefix fails closed'
write_env 'prod:unrelated' 'backup:another-bucket'
run_preflight
assert_failure 'unrelated source bucket fails closed'
write_env 'prod:buildingos-production' 'backup:buildingos-production'
run_preflight
assert_failure 'same bucket names fail closed'
write_env

MOCK_TIMER_ENABLED=disabled run_preflight
assert_failure 'disabled timer fails closed'
unset MOCK_TIMER_ENABLED
MOCK_TIMER_STATE=inactive run_preflight
assert_failure 'inactive timer fails closed'
unset MOCK_TIMER_STATE
MOCK_TIMER_STATE=failed run_preflight
assert_failure 'failed timer fails closed'
unset MOCK_TIMER_STATE
MOCK_TIMER_STATE=unknown run_preflight
assert_failure 'ambiguous timer fails closed'
unset MOCK_TIMER_STATE
MOCK_NEXT_TRIGGER=n/a run_preflight
assert_failure 'missing future trigger fails closed'
unset MOCK_NEXT_TRIGGER
MOCK_OBJECT_SERVICE_STATE=failed run_preflight
assert_failure 'failed Object Storage service fails closed'
unset MOCK_OBJECT_SERVICE_STATE

rm "$RCLONE_CONFIG_FILE"
run_preflight
assert_failure 'missing rclone config fails closed'
printf '[prod]\ntype = s3\n' > "$RCLONE_CONFIG_FILE"
chmod 0600 "$RCLONE_CONFIG_FILE"

MOCK_CONFIG_OWNER=root MOCK_CONFIG_GROUP=yoryi MOCK_CONFIG_MODE=640 run_preflight
assert_success 'root-owned rclone config is readable through yoryi group'
MOCK_CONFIG_OWNER=root MOCK_CONFIG_GROUP=root MOCK_CONFIG_MODE=600 run_preflight
assert_failure 'root-owned root-group rclone config fails yoryi readability'
MOCK_CONFIG_OWNER=root MOCK_CONFIG_GROUP=root MOCK_CONFIG_MODE=640 run_preflight
assert_failure 'root-owned root-group 0640 rclone config fails yoryi readability'
MOCK_CONFIG_OWNER=yoryi MOCK_CONFIG_GROUP=yoryi MOCK_CONFIG_MODE=644 run_preflight
assert_failure 'world-readable rclone config fails closed'
MOCK_CONFIG_OWNER=yoryi MOCK_CONFIG_GROUP=yoryi MOCK_CONFIG_MODE=660 run_preflight
assert_failure 'group-writable rclone config fails closed'
unset MOCK_CONFIG_OWNER MOCK_CONFIG_GROUP MOCK_CONFIG_MODE
ln -s "$TEST_ROOT/missing-rclone.conf" "$TEST_ROOT/rclone-symlink.conf"
sed -i.bak "s|$RCLONE_CONFIG_FILE|$TEST_ROOT/rclone-symlink.conf|" "$ENV_FILE"
run_preflight
assert_failure 'symlink rclone config fails closed'
mv "$ENV_FILE.bak" "$ENV_FILE"
chmod 0660 "$RCLONE_CONFIG_FILE"
MOCK_CONFIG_MODE=660 run_preflight
assert_failure 'writable rclone config fails closed'
unset MOCK_CONFIG_MODE
chmod 0600 "$RCLONE_CONFIG_FILE"

preflight_text="$(< "$PREFLIGHT")"

launcher_text="$(< "$PRIVILEGED_LAUNCHER")"
assert_contains 'launcher closes caller stdin' '</dev/null' "$launcher_text"
assert_contains 'launcher pins installed control directory' "readonly CONTROL_DIR='/usr/local/libexec/buildingos-backup-preflight'" "$launcher_text"
assert_contains 'launcher clears BASH_ENV' 'unset BASH_ENV ENV' "$launcher_text"
assert_contains 'launcher uses fixed PATH' 'PATH="$SAFE_PATH"' "$launcher_text"
assert_absent 'launcher does not execute mutable checkout scripts' '/opt/pawtech/apps/buildingos/buildingos-app' "$launcher_text"
assert_absent 'launcher does not evaluate caller input' 'eval ' "$launcher_text"

workflow_text="$(< "$WORKFLOW")"
assert_contains 'workflow is manually dispatched' 'workflow_dispatch:' "$workflow_text"
assert_absent 'workflow has no push trigger' 'push:' "$workflow_text"
assert_absent 'workflow has no scheduled trigger' 'schedule:' "$workflow_text"
assert_contains 'workflow uses read-only production environment' 'environment: production' "$workflow_text"
assert_contains 'workflow uses strict host key checking' 'StrictHostKeyChecking=yes' "$workflow_text"
assert_contains 'workflow uses batch mode' 'BatchMode=yes' "$workflow_text"

sudoers_text="$(< "$SUDOERS_POLICY")"
assert_contains 'sudoers grants only fixed launcher' 'yoryi ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/buildingos-production-backup-preflight *' "$sudoers_text"
assert_absent 'sudoers excludes generic shell' '/bin/bash' "$sudoers_text"
assert_absent 'sudoers excludes systemctl' 'systemctl' "$sudoers_text"
assert_absent 'sudoers excludes docker' 'docker' "$sudoers_text"

if printf '%s\n' "$preflight_text" | grep -Eq 'systemctl (start|restart|stop|enable|disable|daemon-reload)|pg_dump|rclone (copy|copyto|delete|move)|(^|[[:space:]])(chmod|chown)[[:space:]]'; then
  fail_test 'preflight implementation contains no write-capable operation'
else
  pass 'preflight implementation contains no write-capable operation'
fi

for forbidden in \
  'pawtech-buildingos-backup.service' \
  'pawtech-buildingos-backup-verify.service' \
  'backup-buildingos-production.sh' \
  'backup-postgres-paired.sh' \
  'backup-minio.sh' \
  'verify-minio-backup.sh' \
  'CONTROL_UPDATE' \
  'BACKUP_READY=YES'; do
  assert_absent "preflight no longer requires $forbidden" "$forbidden" "$preflight_text"
done

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s failed, %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
