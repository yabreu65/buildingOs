#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly PREFLIGHT="$ROOT_DIR/scripts/production-backup-preflight.sh"
readonly WORKFLOW="$ROOT_DIR/.github/workflows/production-backup-preflight.yml"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-backup-preflight.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok - %s\n' "$1" >&2; }

assert_contains() {
  local name="$1" value="$2" text="$3"
  if [[ "$text" == *"$value"* ]]; then pass "$name"; else fail_test "$name"; fi
}

assert_absent() {
  local name="$1" value="$2" text="$3"
  if [[ "$text" != *"$value"* ]]; then pass "$name"; else fail_test "$name"; fi
}

assert_success() {
  local name="$1"
  if [[ "$RUN_RC" -eq 0 ]]; then pass "$name"; else fail_test "$name"; fi
}

assert_failure() {
  local name="$1"
  if [[ "$RUN_RC" -ne 0 ]]; then pass "$name"; else fail_test "$name"; fi
}

readonly APP_DIR="$TEST_ROOT/app"
readonly ENV_FILE="$TEST_ROOT/buildingos-backup.env"
readonly SSE_FILE="$TEST_ROOT/contabo-sse-s3-capability.json"
readonly STATE_DIR="$TEST_ROOT/state"
readonly BIN_DIR="$TEST_ROOT/bin"
mkdir -p "$APP_DIR/.git" "$APP_DIR/scripts" "$STATE_DIR" "$BIN_DIR"
chmod 0700 "$STATE_DIR"

for script_name in \
  backup-buildingos-production.sh \
  backup-postgres-paired.sh \
  backup-minio.sh \
  verify-minio-backup.sh \
  validate-sse-capability.sh \
  resolve-production-app-sha.sh \
  check-production-backup-freshness.sh; do
  printf '# isolated fixture\n' > "$APP_DIR/scripts/$script_name"
  chmod 0755 "$APP_DIR/scripts/$script_name"
done

link_command() {
  local command_name="$1"
  ln -s "$(command -v "$command_name")" "$BIN_DIR/$command_name"
}

for command_name in awk bash cat date df id jq sha256sum stat; do link_command "$command_name"; done

cat > "$BIN_DIR/git" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$*" in
  *'rev-parse HEAD'*) printf '%s\n' "${MOCK_RUNTIME_SHA:-db82d3d37fc6184a6d4063709b9a15b923371695}" ;;
  *'status --porcelain'*) [[ "${MOCK_DIRTY:-NO}" == NO ]] || printf ' M application.env\n' ;;
  *) exit 1 ;;
esac
MOCK

cat > "$BIN_DIR/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1 ${2:-}" == 'inspect --type' ]]; then
  target="${@: -1}"
  format=''
  args=("$@")
  for ((index = 0; index < ${#args[@]}; index++)); do
    if [[ "${args[index]}" == --format=* ]]; then
      format="${args[index]#--format=}"
    elif [[ "${args[index]}" == --format && $((index + 1)) -lt ${#args[@]} ]]; then
      format="${args[index + 1]}"
    fi
  done
  if [[ "$target" == buildingos-api || "$target" == buildingos-web ]]; then
    printf 'sha256:%064d\n' "$([[ "$target" == buildingos-api ]] && printf 1 || printf 2)"
  elif [[ "$format" == *'.State.Status'* ]]; then
    printf 'running\n'
  elif [[ "$format" == *'.State.Health'* ]]; then
    printf '%s\n' "${MOCK_PG_HEALTH:-healthy}"
  fi
elif [[ "$1 ${2:-}" == 'image inspect' ]]; then
  printf '%s\n' "${MOCK_RUNTIME_SHA:-db82d3d37fc6184a6d4063709b9a15b923371695}"
else
  exit 1
fi
MOCK

cat > "$BIN_DIR/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
command_name="$1"
unit="${2:-}"
if [[ "$command_name" == cat ]]; then
  [[ "$unit" == pawtech-buildingos-backup.service && "${MOCK_BACKUP_UNIT_MISSING:-NO}" == YES ]] && exit 1
  [[ "$unit" == pawtech-buildingos-backup-verify.service && "${MOCK_VERIFY_UNIT_MISSING:-NO}" == YES ]] && exit 1
  exit 0
fi
if [[ "$command_name" == is-active ]]; then
  if [[ "$unit" == pawtech-buildingos-backup.service && "${MOCK_BACKUP_ACTIVE:-NO}" == YES ]] ||
    [[ "$unit" == pawtech-buildingos-backup-verify.service && "${MOCK_VERIFY_ACTIVE:-NO}" == YES ]]; then
    printf 'active\n'; exit 0
  fi
  if [[ "$unit" == pawtech-buildingos-backup.timer && "${MOCK_TIMER_ACTIVE:-NO}" == YES ]]; then
    printf 'active\n'; exit 0
  fi
  printf 'inactive\n'; exit 3
fi
if [[ "$command_name" == show ]]; then
  property=''
  for arg in "$@"; do [[ "$arg" == --property=* ]] && property="${arg#--property=}"; done
  case "$property:$unit" in
    LoadState:*) printf 'loaded\n' ;;
    ActiveState:*) if [[ "$unit" == pawtech-buildingos-backup.service && "${MOCK_BACKUP_ACTIVE:-NO}" == YES ]] || [[ "$unit" == pawtech-buildingos-backup-verify.service && "${MOCK_VERIFY_ACTIVE:-NO}" == YES ]]; then printf 'active\n'; else printf 'inactive\n'; fi ;;
    User:*) printf 'yoryi\n' ;;
    Type:*) printf 'oneshot\n' ;;
    Restart:*) printf 'no\n' ;;
    WorkingDirectory:*) printf '%s\n' "${PREFLIGHT_APP_DIR:?}" ;;
    EnvironmentFiles:*) [[ "${MOCK_BAD_ENV_FILE:-NO}" == YES && "$unit" == pawtech-buildingos-backup.service ]] && printf '/etc/buildingos/wrong.env\n' || printf '/etc/buildingos/buildingos-backup.env\n' ;;
    ExecStart:*)
      if [[ "$unit" == pawtech-buildingos-backup.service && "${MOCK_BAD_EXECSTART:-NO}" == YES ]]; then
        printf '/opt/pawtech/apps/buildingos/buildingos-app/scripts/not-the-backup.sh\n'
      elif [[ "$unit" == pawtech-buildingos-backup-verify.service ]]; then
        if [[ "${MOCK_SERIALIZED_EXECSTART:-NO}" == YES ]]; then
          printf 'path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh --verify-latest ;\n'
        else
          printf '/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh --verify-latest\n'
        fi
      else
        printf '/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh\n'
      fi
      ;;
    *) exit 1 ;;
  esac
  exit 0
fi
exit 1
MOCK

for command_name in mc pg_restore rclone; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN_DIR/$command_name"
  chmod 0755 "$BIN_DIR/$command_name"
done
chmod 0755 "$BIN_DIR/git" "$BIN_DIR/docker" "$BIN_DIR/systemctl"

write_env() {
  local backup_bucket="$1"
  local source_environment="$2"
  local omit_secret="${3:-NO}"
  local backup_endpoint="${4:-https://backup.example.invalid}"
  local postgres_destination_bucket="${5:-$backup_bucket}"
  local write_remote="${6:-contabowrite}"
  local verify_remote="${7:-contaboverify}"
  {
    printf 'BACKUP_ENDPOINT=%s\n' "$backup_endpoint"
    printf 'BACKUP_BUCKET=%s\n' "$backup_bucket"
    [[ "$omit_secret" == VERIFY ]] || printf 'BACKUP_VERIFY_ACCESS_KEY=VERIFY_ACCESS_SENTINEL\nBACKUP_VERIFY_SECRET_KEY=VERIFY_SECRET_SENTINEL\n'
    [[ "$omit_secret" == VERIFY ]] && printf 'BACKUP_VERIFY_ACCESS_KEY=VERIFY_ACCESS_SENTINEL\n'
    printf 'BACKUP_SSE_CAPABILITY_FILE=%s\n' "$SSE_FILE"
    printf 'BACKUP_STATE_DIR=%s\n' "$STATE_DIR"
    printf 'BACKUP_WRITE_ACCESS_KEY=WRITE_ACCESS_SENTINEL\nBACKUP_WRITE_SECRET_KEY=WRITE_SECRET_SENTINEL\n'
    printf 'SOURCE_ENVIRONMENT=%s\nEXPECTED_SOURCE_ENVIRONMENT=%s\n' "$source_environment" "$source_environment"
    printf 'SOURCE_ENDPOINT=https://usc1.contabostorage.com\nSOURCE_ACCESS_KEY=SOURCE_ACCESS_SENTINEL\nSOURCE_SECRET_KEY=SOURCE_SECRET_SENTINEL\nSOURCE_BUCKET=buildingos-production\n'
    printf 'POSTGRES_CONTAINER=pawtech-postgres\nPOSTGRES_DATABASE=buildingos_db\nPOSTGRES_USER=buildingos\nPOSTGRES_BACKUP_ROOT=%s\n' "$TEST_ROOT/pg-root"
    printf 'POSTGRES_RCLONE_DESTINATION=%s:%s/postgresql\n' "$write_remote" "$postgres_destination_bucket"
    printf 'POSTGRES_VERIFY_RCLONE_DESTINATION=%s:%s/postgresql\n' "$verify_remote" "$postgres_destination_bucket"
    printf 'POSTGRES_SSE_MODE=SSE-S3\n'
  } > "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  mkdir -p "$TEST_ROOT/pg-root"
}

write_sse() {
  local status="${1:-SSE_S3_SUPPORTED}" algorithm="${2:-AES256}" endpoint="${3:-backup.example.invalid}" bucket="${4:-buildingos-backup}" probed_at="${5:-2026-09-03T00:00:00Z}"
  jq -n --arg status "$status" --arg algorithm "$algorithm" --arg endpoint "$endpoint" --arg bucket "$bucket" --arg probed_at "$probed_at" \
    '{status:$status,algorithm:$algorithm,endpoint_identity:$endpoint,bucket:$bucket,probed_at:$probed_at}' > "$SSE_FILE"
  chmod 0640 "$SSE_FILE"
}

run_preflight() {
  set +e
  RUN_OUTPUT="$(
    PATH="$BIN_DIR" \
    BUILDINGOS_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY \
    PREFLIGHT_APP_DIR="$APP_DIR" PREFLIGHT_ENV_FILE="$ENV_FILE" PREFLIGHT_SSE_FILE="$SSE_FILE" PREFLIGHT_STATE_DIR="${PREFLIGHT_STATE_DIR_OVERRIDE:-$STATE_DIR}" \
    PREFLIGHT_EXPECTED_ENV_OWNER="$(id -un)" PREFLIGHT_EXPECTED_ENV_GROUP="$(id -gn)" \
    PREFLIGHT_EXPECTED_STATE_OWNER="$(id -un)" PREFLIGHT_EXPECTED_STATE_GROUP="$(id -gn)" \
    PREFLIGHT_EXPECTED_SSE_OWNER="$(id -un)" PREFLIGHT_EXPECTED_SSE_GROUP="$(id -gn)" \
    PREFLIGHT_APP_DIR="$APP_DIR" \
    /bin/bash "$PREFLIGHT" 2>&1 "$CANDIDATE_SHA"
  )"
  RUN_RC=$?
  set -e
}

readonly CANDIDATE_SHA='2ac603be8018ffc3df67fb4e84149aea4f780cea'
write_env buildingos-backup production
write_sse
run_preflight
assert_success 'happy path passes' 
assert_contains 'happy path emits PASS' 'PREFLIGHT_STATUS=PASS' "$RUN_OUTPUT"
assert_contains 'happy path reports separate destinations' 'SOURCE_AND_BACKUP_SEPARATE=YES' "$RUN_OUTPUT"
assert_contains 'happy path reports inactive backup' 'BACKUP_ALREADY_RUNNING=NO' "$RUN_OUTPUT"
for sentinel in VERIFY_ACCESS_SENTINEL VERIFY_SECRET_SENTINEL WRITE_ACCESS_SENTINEL WRITE_SECRET_SENTINEL SOURCE_ACCESS_SENTINEL SOURCE_SECRET_SENTINEL; do
  assert_absent "secret $sentinel is not emitted" "$sentinel" "$RUN_OUTPUT"
done

MOCK_BACKUP_UNIT_MISSING=YES run_preflight
assert_failure 'missing backup unit fails closed'
assert_contains 'missing backup unit is reported' 'BACKUP_SERVICE_EXISTS=NO' "$RUN_OUTPUT"
unset MOCK_BACKUP_UNIT_MISSING

MOCK_BAD_EXECSTART=YES run_preflight
assert_failure 'unexpected ExecStart fails closed'
unset MOCK_BAD_EXECSTART

MOCK_SERIALIZED_EXECSTART=YES run_preflight
assert_success 'serialized ExecStart with whitespace passes'
unset MOCK_SERIALIZED_EXECSTART

MOCK_BAD_ENV_FILE=YES run_preflight
assert_failure 'unexpected EnvironmentFile fails closed'
unset MOCK_BAD_ENV_FILE

MOCK_BACKUP_ACTIVE=YES run_preflight
assert_failure 'active backup service fails closed'
unset MOCK_BACKUP_ACTIVE

MOCK_VERIFY_ACTIVE=YES run_preflight
assert_failure 'active verification service fails closed'
unset MOCK_VERIFY_ACTIVE

write_env buildingos-backup production VERIFY
run_preflight
assert_failure 'missing secret name fails closed'
write_env buildingos-backup production

write_env buildingos-production production NO https://usc1.contabostorage.com:443
write_sse SSE_S3_SUPPORTED AES256 usc1.contabostorage.com buildingos-production
run_preflight
assert_failure 'equivalent source and backup endpoints fail closed'
write_env buildingos-backup production

write_env buildingos-backup production NO https://backup.example.invalid buildingos-wrong-destination
run_preflight
assert_failure 'rclone destination prefix mismatch fails closed'
write_env buildingos-backup production

write_env buildingos-backup production NO https://backup.example.invalid buildingos-backup contabowrite contabowrite
run_preflight
assert_failure 'same rclone identities fail closed'
write_env buildingos-backup production

chmod 0644 "$ENV_FILE"
run_preflight
assert_failure 'unsafe environment permissions fail closed'
chmod 0600 "$ENV_FILE"

chmod 0660 "$SSE_FILE"
run_preflight
assert_failure 'unsafe SSE permissions fail closed'
chmod 0640 "$SSE_FILE"

chmod 0750 "$STATE_DIR"
run_preflight
assert_failure 'unsafe state directory permissions fail closed'
chmod 0700 "$STATE_DIR"

write_sse

write_env buildingos-production production
run_preflight
assert_failure 'source and backup bucket collision fails closed'
write_env buildingos-backup production

write_env buildingos-backup staging
run_preflight
assert_failure 'wrong source environment fails closed'
write_env buildingos-backup production

write_sse SSE_S3_UNKNOWN
run_preflight
assert_failure 'invalid SSE evidence fails closed'
write_sse

write_sse SSE_S3_SUPPORTED AES256 wrong.example.invalid
run_preflight
assert_failure 'SSE endpoint mismatch fails closed'
write_sse

write_sse SSE_S3_SUPPORTED AES256 backup.example.invalid another-bucket
run_preflight
assert_failure 'SSE bucket mismatch fails closed'
write_sse

write_sse SSE_S3_SUPPORTED AES256 backup.example.invalid buildingos-backup invalid-timestamp
run_preflight
assert_failure 'malformed SSE timestamp fails closed'
write_sse

PREFLIGHT_STATE_DIR_OVERRIDE="$TEST_ROOT/missing-state" run_preflight
assert_failure 'bad state directory fails closed'
unset PREFLIGHT_STATE_DIR_OVERRIDE

MOCK_PG_HEALTH=unhealthy run_preflight
assert_failure 'unhealthy PostgreSQL fails closed'
unset MOCK_PG_HEALTH

MOCK_RUNTIME_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa run_preflight
assert_failure 'runtime SHA mismatch fails closed'
unset MOCK_RUNTIME_SHA

MOCK_DIRTY=YES run_preflight
assert_failure 'dirty checkout fails closed'
unset MOCK_DIRTY

rm "$BIN_DIR/rclone"
run_preflight
assert_failure 'missing dependency fails closed'
assert_contains 'missing dependency is reported' 'required dependency is missing: rclone' "$RUN_OUTPUT"
ln -s "$(command -v true)" "$BIN_DIR/rclone"

preflight_text="$(< "$PREFLIGHT")"
static_text="$(printf '%s\n' "$preflight_text" | grep -v 'EXPECTED_PROPOSED_COMMAND')"
if printf '%s\n' "$static_text" | grep -Eq 'systemctl (start|restart|stop|enable|disable|daemon-reload)|pg_dump|prisma|(^|[[:space:]])(INSERT|UPDATE|DELETE|CREATE)[[:space:]]|git (switch|pull|reset)|mc (mirror|cp|rm)|rclone (copy|copyto|delete|move)|(^|[[:space:]])(chmod|chown)[[:space:]]'; then
  fail_test 'preflight implementation contains no write-capable operation'
else
  pass 'preflight implementation contains no write-capable operation'
fi

workflow_text="$(< "$WORKFLOW")"
assert_contains 'workflow uses production environment' 'environment: production' "$workflow_text"
assert_contains 'workflow uses operations concurrency group' 'group: production-operations' "$workflow_text"
assert_contains 'workflow uses strict host key checking' 'StrictHostKeyChecking=yes' "$workflow_text"
assert_contains 'workflow uses batch mode' 'BatchMode=yes' "$workflow_text"
assert_contains 'workflow streams script over stdin' 'bash -s --' "$workflow_text"
assert_contains 'workflow runs streamed preflight as root without a password' 'sudo -n -u root bash -s --' "$workflow_text"
assert_contains 'workflow uses protected SSH host secret' 'PRODUCTION_SSH_HOST' "$workflow_text"
assert_contains 'workflow is manually dispatched' 'workflow_dispatch:' "$workflow_text"
assert_absent 'workflow has no push trigger' 'push:' "$workflow_text"
assert_absent 'workflow has no scheduled trigger' 'schedule:' "$workflow_text"
assert_contains 'candidate input is a required string' 'required: true' "$workflow_text"
assert_contains 'candidate input is typed as string' 'type: string' "$workflow_text"
assert_contains 'workflow checks out its triggering SHA' 'ref: ${{ github.sha }}' "$workflow_text"
assert_contains 'checkout does not persist credentials' 'persist-credentials: false' "$workflow_text"
assert_contains 'concurrency does not cancel operations' 'cancel-in-progress: false' "$workflow_text"
assert_absent 'workflow never uses ssh-keyscan' 'ssh-keyscan' "$workflow_text"
assert_absent 'workflow has no automatic retry controls' 'continue-on-error' "$workflow_text"
assert_absent 'workflow has no retry strategy' 'strategy:' "$workflow_text"
assert_contains 'workflow has read-only permissions' 'contents: read' "$workflow_text"

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s test(s) failed; %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
