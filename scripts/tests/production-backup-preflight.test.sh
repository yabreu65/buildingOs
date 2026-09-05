#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly PREFLIGHT="$ROOT_DIR/scripts/production-backup-preflight.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-backup-preflight.XXXXXX")"
readonly BIN_DIR="$TEST_ROOT/bin"
readonly ENV_FILE="$TEST_ROOT/object-backup.env"
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

mkdir -p "$BIN_DIR"
for command_name in awk bash date; do
  ln -s "$(command -v "$command_name")" "$BIN_DIR/$command_name"
done

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
  NextElapseUSecRealtime:*) printf '%s\n' "${MOCK_NEXT_TRIGGER:-2099-01-01 00:00:00 UTC}" ;;
  User:pawtech-buildingos-object-backup.service|Group:pawtech-buildingos-object-backup.service) printf 'yoryi\n' ;;
  EnvironmentFiles:pawtech-buildingos-object-backup.service) printf '%s\n' "${PREFLIGHT_ENV_FILE:-/etc/buildingos/object-backup.env}" ;;
  WorkingDirectory:pawtech-buildingos-object-backup.service) printf '%s\n' '/opt/pawtech/apps/buildingos/buildingos-app' ;;
  Type:pawtech-buildingos-object-backup.service) printf 'oneshot\n' ;;
  ExecStart:pawtech-buildingos-object-backup.service)
    if [[ "${MOCK_BAD_OBJECT_EXECSTART:-NO}" == YES ]]; then printf '%s\n' '/opt/wrong/backup.sh'; else printf '%s\n' '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh ; ignore_errors=no }'; fi
    ;;
  TimeoutStartUSec:pawtech-buildingos-object-backup.service) printf '21600000000\n' ;;
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
    printf 'RCLONE_CONFIG=/etc/buildingos/object-backup-rclone.conf\n'
  } > "$ENV_FILE"
}

run_preflight() {
  set +e
  RUN_OUTPUT="$(PATH="$BIN_DIR" BUILDINGOS_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY PREFLIGHT_ENV_FILE="$ENV_FILE" /bin/bash "$PREFLIGHT" 2>&1 '2ac603be8018ffc3df67fb4e84149aea4f780cea')"
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
assert_contains 'Object timer enabled is accepted' 'OBJECT_BACKUP_TIMER_ENABLED=YES' "$RUN_OUTPUT"
assert_contains 'Object timer active is accepted' 'OBJECT_BACKUP_TIMER_ACTIVE=YES' "$RUN_OUTPUT"
assert_contains 'Object timer future trigger is accepted' 'OBJECT_BACKUP_TIMER_FUTURE_TRIGGER=YES' "$RUN_OUTPUT"
assert_contains 'Object service contract is accepted' 'OBJECT_BACKUP_SERVICE_CONTRACT=YES' "$RUN_OUTPUT"
assert_contains 'Object environment contract is accepted' 'OBJECT_BACKUP_ENV=YES' "$RUN_OUTPUT"
assert_contains 'backup concurrency is safe' 'BACKUP_CONCURRENCY_SAFE=YES' "$RUN_OUTPUT"

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

MOCK_BAD_OBJECT_EXECSTART=YES run_preflight
assert_failure 'wrong Object Storage ExecStart fails closed'
unset MOCK_BAD_OBJECT_EXECSTART

sed -i.bak 's|OBJECT_BACKUP_RECEIPT=/var/lib/buildingos-object-backup/object-backup-receipt.json|OBJECT_BACKUP_RECEIPT=/tmp/wrong-receipt.json|' "$ENV_FILE"
run_preflight
assert_failure 'wrong Object Storage receipt path fails closed'
mv "$ENV_FILE.bak" "$ENV_FILE"

write_env 'prod:buildingos-production/path' 'backup:buildingos-production-backup'
run_preflight
assert_failure 'bucket prefix fails closed'
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

preflight_text="$(< "$PREFLIGHT")"
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
