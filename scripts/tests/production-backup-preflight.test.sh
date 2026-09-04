#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly PREFLIGHT="$ROOT_DIR/scripts/production-backup-preflight.sh"
readonly WORKFLOW="$ROOT_DIR/.github/workflows/production-backup-preflight.yml"
readonly PRIVILEGED_LAUNCHER="$ROOT_DIR/infra/production/launchers/buildingos-production-backup-preflight"
readonly SUDOERS_POLICY="$ROOT_DIR/infra/production/sudoers/buildingos-production-backup-preflight"
readonly ACTIVATION_RUNBOOK="$ROOT_DIR/docs/runbooks/PRODUCTION_BACKUP_ACTIVATION.md"
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

assert_order() {
  local name="$1" first="$2" second="$3" text="$4" line first_line=0 second_line=0 line_number=0
  while IFS= read -r line; do
    line_number=$((line_number + 1))
    [[ "$first_line" -ne 0 || "$line" != *"$first"* ]] || first_line=$line_number
    [[ "$second_line" -ne 0 || "$line" != *"$second"* ]] || second_line=$line_number
  done <<< "$text"
  if [[ "$first_line" -gt 0 && "$second_line" -gt "$first_line" ]]; then pass "$name"; else fail_test "$name"; fi
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
if [[ -e "$APP_DIR/scripts/lib/endpoint-identity.sh" ]]; then
  fail_test 'db82 fixture does not deploy the new shared endpoint helper'
else
  pass 'db82 fixture does not deploy the new shared endpoint helper'
fi

link_command() {
  local command_name="$1"
  ln -s "$(command -v "$command_name")" "$BIN_DIR/$command_name"
}

for command_name in awk bash cat date id jq sha256sum stat tr; do link_command "$command_name"; done

cat > "$BIN_DIR/df" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
path="${@: -1}"
if [[ "$path" == *pg-root* ]]; then
  available="${MOCK_ROOT_FREE_KIB:-1000000}"
else
  available="${MOCK_TMP_FREE_KIB:-1000000}"
fi
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\nmock 1000000 0 %s 0%% /\n' "$available"
MOCK
chmod 0755 "$BIN_DIR/df"

cat > "$BIN_DIR/git" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$*" in
  *'rev-parse HEAD'*) printf '%s\n' "${MOCK_CHECKOUT_SHA:-${MOCK_RUNTIME_SHA:-2ac603be8018ffc3df67fb4e84149aea4f780cea}}" ;;
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
  image="$3"
  if [[ "$image" == "sha256:$(printf '%064d' 1)" ]]; then
    printf '%s\n' "${MOCK_API_REVISION:-${MOCK_RUNTIME_SHA:-2ac603be8018ffc3df67fb4e84149aea4f780cea}}"
  else
    printf '%s\n' "${MOCK_WEB_REVISION:-${MOCK_RUNTIME_SHA:-2ac603be8018ffc3df67fb4e84149aea4f780cea}}"
  fi
elif [[ "$1" == exec ]]; then
  [[ "${MOCK_DB_SIZE_UNAVAILABLE:-NO}" == YES ]] && exit 1
  printf '%s\n' "${MOCK_DB_SIZE_BYTES:-104857600}"
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
  [[ "$unit" == pawtech-postgres-backup.service && "${MOCK_LEGACY_SERVICE_MISSING:-NO}" == YES ]] && exit 1
  [[ "$unit" == pawtech-postgres-backup.timer && "${MOCK_LEGACY_TIMER_MISSING:-NO}" == YES ]] && exit 1
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
  if [[ "$unit" == pawtech-postgres-backup.service && "${MOCK_LEGACY_SERVICE_ACTIVE:-NO}" == YES ]]; then
    printf 'active\n'; exit 0
  fi
  if [[ "$unit" == pawtech-postgres-backup.timer && "${MOCK_LEGACY_TIMER_ACTIVE:-NO}" == YES ]]; then
    printf 'active\n'; exit 0
  fi
  if [[ "$unit" == pawtech-postgres-backup.timer && "${MOCK_LEGACY_TIMER_AMBIGUOUS:-NO}" == YES ]]; then
    printf 'unknown\n'; exit 3
  fi
  printf 'inactive\n'; exit 3
fi
if [[ "$command_name" == show ]]; then
  property=''
  for arg in "$@"; do [[ "$arg" == --property=* ]] && property="${arg#--property=}"; done
  case "$property:$unit" in
    LoadState:*)
      if [[ "$unit" == pawtech-postgres-backup.service && "${MOCK_LEGACY_SERVICE_MISSING:-NO}" == YES ]] || [[ "$unit" == pawtech-postgres-backup.timer && "${MOCK_LEGACY_TIMER_MISSING:-NO}" == YES ]]; then printf 'not-found\n'; else printf 'loaded\n'; fi
      ;;
    ActiveState:*)
      if [[ "$unit" == pawtech-buildingos-backup.service && "${MOCK_BACKUP_ACTIVE:-NO}" == YES ]] || [[ "$unit" == pawtech-buildingos-backup-verify.service && "${MOCK_VERIFY_ACTIVE:-NO}" == YES ]] || [[ "$unit" == pawtech-postgres-backup.service && "${MOCK_LEGACY_SERVICE_ACTIVE:-NO}" == YES ]] || [[ "$unit" == pawtech-postgres-backup.timer && "${MOCK_LEGACY_TIMER_ACTIVE:-NO}" == YES ]]; then
        printf 'active\n'
      elif [[ "$unit" == pawtech-postgres-backup.service && "${MOCK_LEGACY_SERVICE_AMBIGUOUS:-NO}" == YES ]] || [[ "$unit" == pawtech-postgres-backup.timer && "${MOCK_LEGACY_TIMER_AMBIGUOUS:-NO}" == YES ]]; then
        printf 'unknown\n'
      else
        printf 'inactive\n'
      fi
      ;;
    UnitFileState:pawtech-postgres-backup.timer) [[ "${MOCK_LEGACY_TIMER_AMBIGUOUS:-NO}" == YES ]] && printf 'unknown\n' || printf '%s\n' "${MOCK_LEGACY_TIMER_STATE:-disabled}" ;;
    NextElapseUSecRealtime:pawtech-postgres-backup.timer) [[ "${MOCK_LEGACY_TIMER_AMBIGUOUS:-NO}" == YES ]] && printf 'unknown\n' || printf '%s\n' "${MOCK_LEGACY_TIMER_NEXT_TRIGGER:-n/a}" ;;
    User:*) printf 'yoryi\n' ;;
    Type:*) printf 'oneshot\n' ;;
    Restart:*) printf 'no\n' ;;
    WorkingDirectory:*) printf '%s\n' "${PREFLIGHT_APP_DIR:?}" ;;
    EnvironmentFiles:*) [[ "${MOCK_BAD_ENV_FILE:-NO}" == YES && "$unit" == pawtech-buildingos-backup.service ]] && printf '/etc/buildingos/wrong.env\n' || printf '/etc/buildingos/buildingos-backup.env\n' ;;
    ExecCondition:*)
      case "${MOCK_EXEC_CONDITION_MODE:-EMPTY}" in
        ONE) printf '{ path=/bin/true ; argv[]=/bin/true ; ignore_errors=no }\n' ;;
        MALFORMED) printf '{ path=/bin/true ; argv[]=/bin/true\n' ;;
        *) printf '\n' ;;
      esac
      ;;
    ExecStart:*)
      if [[ "$unit" == pawtech-buildingos-backup.service && "${MOCK_BAD_EXECSTART:-NO}" == YES ]]; then
        printf '/opt/pawtech/apps/buildingos/buildingos-app/scripts/not-the-backup.sh\n'
      elif [[ "${MOCK_MALFORMED_EXECSTART:-NO}" == YES ]]; then
        printf '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh\n'
      elif [[ "${MOCK_SECOND_EXECSTART:-NO}" == YES && "$unit" == pawtech-buildingos-backup.service ]]; then
        printf '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; ignore_errors=no } { path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; ignore_errors=no }\n'
      elif [[ "$unit" == pawtech-buildingos-backup-verify.service ]]; then
        if [[ "${MOCK_SERIALIZED_EXECSTART:-NO}" == YES ]]; then
          ignore_errors_field=' ; ignore_errors=no'
          case "${MOCK_IGNORE_ERRORS_MODE:-NO}" in
            YES) ignore_errors_field=' ; ignore_errors=yes' ;;
            MISSING) ignore_errors_field='' ;;
            MALFORMED) ignore_errors_field=' ; ignore_errors=maybe' ;;
          esac
          printf '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh --verify-latest%s }\n' "$ignore_errors_field"
        else
          printf '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh --verify-latest ; ignore_errors=no }\n'
        fi
      else
        printf '{ path=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; argv[]=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh ; ignore_errors=no }\n'
      fi
      ;;
    ExecStartPre:*) [[ "${MOCK_BAD_EXECSTARTPRE:-NO}" == YES ]] && printf '{ path=/bin/true ; argv[]=/bin/true ; ignore_errors=no }\n' || printf '\n' ;;
    ExecStartPost:*) [[ "${MOCK_BAD_EXECSTARTPOST:-NO}" == YES ]] && printf '{ path=/bin/true ; argv[]=/bin/true ; ignore_errors=no }\n' || printf '\n' ;;
    TimeoutStartUSec:*)
      case "${MOCK_TIMEOUT_MODE:-EXACT}" in
        SHORTER) printf '1000000\n' ;;
        MALFORMED) printf 'not-a-timeout\n' ;;
        MISSING) exit 1 ;;
        *) [[ "$unit" == pawtech-buildingos-backup-verify.service ]] && printf '14400000000\n' || printf '21600000000\n' ;;
      esac
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
  local backup_prefix="${8-__ABSENT__}"
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
    [[ "$backup_prefix" == __ABSENT__ ]] || printf 'BACKUP_PREFIX=%s\n' "$backup_prefix"
  } > "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  mkdir -p "$TEST_ROOT/pg-root"
}

set_env_line() {
  local key="$1" value="$2" replacement_file="$ENV_FILE.replacement"
  awk -v key="$key" -v value="$value" '$0 ~ "^[[:space:]]*" key "=" { print key "=" value; replaced=1; next } { print } END { exit replaced ? 0 : 1 }' "$ENV_FILE" > "$replacement_file"
  mv "$replacement_file" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
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
    PREFLIGHT_EXPECTED_SSE_OWNER="${PREFLIGHT_EXPECTED_SSE_OWNER_OVERRIDE:-$(id -un)}" PREFLIGHT_EXPECTED_SSE_GROUP="${PREFLIGHT_EXPECTED_SSE_GROUP_OVERRIDE:-$(id -gn)}" \
    PREFLIGHT_APP_DIR="$APP_DIR" \
    /bin/bash "$PREFLIGHT" 2>&1 "$CANDIDATE_SHA"
  )"
  RUN_RC=$?
  set -e
}

CANDIDATE_SHA='2ac603be8018ffc3df67fb4e84149aea4f780cea'
write_env buildingos-backup production
write_sse
run_preflight
assert_success 'happy path passes'
assert_contains 'happy path emits PASS' 'PREFLIGHT_STATUS=PASS' "$RUN_OUTPUT"
assert_contains 'happy path reports authoritative source endpoint' 'SOURCE_ENDPOINT_HOSTNAME=usc1.contabostorage.com' "$RUN_OUTPUT"
assert_contains 'happy path reports authoritative source bucket' 'SOURCE_BUCKET=buildingos-production' "$RUN_OUTPUT"
assert_contains 'happy path reports separate destinations' 'SOURCE_AND_BACKUP_SEPARATE=YES' "$RUN_OUTPUT"
assert_contains 'happy path reports db82 destination compatibility' 'DEPLOYED_RUNTIME_SOURCE_AND_BACKUP_SEPARATE=YES' "$RUN_OUTPUT"
assert_contains 'happy path reports db82 SSE compatibility' 'DEPLOYED_RUNTIME_SSE_ENDPOINT_MATCH=YES' "$RUN_OUTPUT"
assert_contains 'happy path reports inactive backup' 'BACKUP_ALREADY_RUNNING=NO' "$RUN_OUTPUT"
for sentinel in VERIFY_ACCESS_SENTINEL VERIFY_SECRET_SENTINEL WRITE_ACCESS_SENTINEL WRITE_SECRET_SENTINEL SOURCE_ACCESS_SENTINEL SOURCE_SECRET_SENTINEL; do
  assert_absent "secret $sentinel is not emitted" "$sentinel" "$RUN_OUTPUT"
done

CANDIDATE_SHA='db82d3d37fc6184a6d4063709b9a15b923371695' run_preflight
assert_failure 'candidate mismatch fails runtime identity gate'
assert_contains 'candidate mismatch reports inconsistent identity' 'RUNTIME_IDENTITY=INCONSISTENT' "$RUN_OUTPUT"
assert_contains 'candidate mismatch reports failed preflight' 'PREFLIGHT_STATUS=FAIL' "$RUN_OUTPUT"
CANDIDATE_SHA='2ac603be8018ffc3df67fb4e84149aea4f780cea'

MOCK_API_REVISION='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' run_preflight
assert_failure 'API revision mismatch fails runtime identity gate'
assert_contains 'API mismatch reports inconsistent identity' 'RUNTIME_IDENTITY=INCONSISTENT' "$RUN_OUTPUT"
unset MOCK_API_REVISION

MOCK_WEB_REVISION='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' run_preflight
assert_failure 'Web revision mismatch fails runtime identity gate'
assert_contains 'Web mismatch reports inconsistent identity' 'RUNTIME_IDENTITY=INCONSISTENT' "$RUN_OUTPUT"
unset MOCK_WEB_REVISION

MOCK_CHECKOUT_SHA='cccccccccccccccccccccccccccccccccccccccc' run_preflight
assert_failure 'checkout revision mismatch fails runtime identity gate'
assert_contains 'checkout mismatch reports inconsistent identity' 'RUNTIME_IDENTITY=INCONSISTENT' "$RUN_OUTPUT"
unset MOCK_CHECKOUT_SHA

MOCK_DIRTY=YES run_preflight
assert_failure 'dirty checkout fails runtime identity gate'
assert_contains 'dirty checkout reports inconsistent identity' 'RUNTIME_IDENTITY=INCONSISTENT' "$RUN_OUTPUT"
unset MOCK_DIRTY

rm "$ENV_FILE"
run_preflight
assert_failure 'missing environment fails closed'
assert_contains 'missing environment reports unavailable names' 'REQUIRED_ENV_NAMES_PRESENT=NO' "$RUN_OUTPUT"
assert_contains 'missing environment reaches final failure summary' 'PREFLIGHT_STATUS=FAIL' "$RUN_OUTPUT"
assert_contains 'missing environment reports no writes' 'PRODUCTION_WRITES=0' "$RUN_OUTPUT"
assert_contains 'missing environment reports no backup' 'BACKUP_STARTED=NO' "$RUN_OUTPUT"
assert_contains 'missing environment reports unknown source endpoint' 'SOURCE_ENDPOINT_HOSTNAME=UNKNOWN' "$RUN_OUTPUT"
assert_contains 'missing environment reports unknown SSE evidence' 'SSE_EVIDENCE_VALID=UNKNOWN' "$RUN_OUTPUT"
assert_contains 'missing environment reports unknown database state' 'POSTGRES_CONTAINER_STATE=UNKNOWN' "$RUN_OUTPUT"
assert_absent 'missing environment has no awk fatal' 'awk: fatal' "$RUN_OUTPUT"
assert_absent 'missing environment has no awk open error' 'cannot open file' "$RUN_OUTPUT"
write_env buildingos-backup production

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

MOCK_EXEC_CONDITION_MODE=ONE run_preflight
assert_failure 'unexpected ExecCondition fails closed'
unset MOCK_EXEC_CONDITION_MODE

MOCK_EXEC_CONDITION_MODE=MALFORMED run_preflight
assert_failure 'malformed ExecCondition fails closed'
unset MOCK_EXEC_CONDITION_MODE

MOCK_TIMEOUT_MODE=SHORTER run_preflight
assert_failure 'shortened systemd timeout fails closed'
unset MOCK_TIMEOUT_MODE

MOCK_TIMEOUT_MODE=MALFORMED run_preflight
assert_failure 'malformed systemd timeout fails closed'
unset MOCK_TIMEOUT_MODE

MOCK_TIMEOUT_MODE=MISSING run_preflight
assert_failure 'missing systemd timeout fails closed'
unset MOCK_TIMEOUT_MODE

MOCK_SERIALIZED_EXECSTART=YES MOCK_IGNORE_ERRORS_MODE=YES run_preflight
assert_failure 'ignored ExecStart failure fails closed'
unset MOCK_SERIALIZED_EXECSTART MOCK_IGNORE_ERRORS_MODE

MOCK_SERIALIZED_EXECSTART=YES MOCK_IGNORE_ERRORS_MODE=MISSING run_preflight
assert_failure 'missing ExecStart ignore_errors fails closed'
unset MOCK_SERIALIZED_EXECSTART MOCK_IGNORE_ERRORS_MODE

MOCK_SERIALIZED_EXECSTART=YES MOCK_IGNORE_ERRORS_MODE=MALFORMED run_preflight
assert_failure 'malformed ExecStart ignore_errors fails closed'
unset MOCK_SERIALIZED_EXECSTART MOCK_IGNORE_ERRORS_MODE

MOCK_SECOND_EXECSTART=YES run_preflight
assert_failure 'additional ExecStart fails closed'
unset MOCK_SECOND_EXECSTART

MOCK_BAD_EXECSTARTPRE=YES run_preflight
assert_failure 'unexpected ExecStartPre fails closed'
unset MOCK_BAD_EXECSTARTPRE

MOCK_BAD_EXECSTARTPOST=YES run_preflight
assert_failure 'unexpected ExecStartPost fails closed'
unset MOCK_BAD_EXECSTARTPOST

MOCK_MALFORMED_EXECSTART=YES run_preflight
assert_failure 'malformed serialized command list fails closed'
unset MOCK_MALFORMED_EXECSTART

MOCK_BAD_ENV_FILE=YES run_preflight
assert_failure 'unexpected EnvironmentFile fails closed'
unset MOCK_BAD_ENV_FILE

MOCK_BACKUP_ACTIVE=YES run_preflight
assert_failure 'active backup service fails closed'
unset MOCK_BACKUP_ACTIVE

MOCK_VERIFY_ACTIVE=YES run_preflight
assert_failure 'active verification service fails closed'
unset MOCK_VERIFY_ACTIVE

run_preflight
assert_contains 'happy path reports legacy overlap safety' 'LEGACY_BACKUP_OVERLAP_SAFE=YES' "$RUN_OUTPUT"
MOCK_LEGACY_SERVICE_ACTIVE=YES run_preflight
assert_failure 'active legacy PostgreSQL service fails closed'
unset MOCK_LEGACY_SERVICE_ACTIVE

MOCK_LEGACY_TIMER_ACTIVE=YES run_preflight
assert_failure 'active legacy PostgreSQL timer fails closed'
unset MOCK_LEGACY_TIMER_ACTIVE

MOCK_LEGACY_TIMER_NEXT_TRIGGER='2026-09-03 00:00:01 UTC' run_preflight
assert_failure 'scheduled legacy PostgreSQL timer fails closed'
unset MOCK_LEGACY_TIMER_NEXT_TRIGGER

MOCK_LEGACY_TIMER_AMBIGUOUS=YES run_preflight
assert_failure 'ambiguous legacy PostgreSQL timer fails closed'
unset MOCK_LEGACY_TIMER_AMBIGUOUS

MOCK_LEGACY_SERVICE_MISSING=YES MOCK_LEGACY_TIMER_MISSING=YES run_preflight
assert_success 'absent legacy PostgreSQL units are safe'
unset MOCK_LEGACY_SERVICE_MISSING MOCK_LEGACY_TIMER_MISSING

write_env buildingos-backup production VERIFY
run_preflight
assert_failure 'missing secret name fails closed'
write_env buildingos-backup production

write_sse SSE_S3_SUPPORTED AES256 backup.example.invalid:443
run_preflight
assert_failure 'db82 rejects SSE evidence with an explicit default port'
assert_contains 'canonical SSE comparison accepts the explicit default port' 'SSE_ENDPOINT_MATCH=YES' "$RUN_OUTPUT"
assert_contains 'db82 SSE mismatch is explicit' 'DEPLOYED_RUNTIME_SSE_ENDPOINT_MATCH=NO' "$RUN_OUTPUT"
write_sse

write_env buildingos-backup production NO https://backup.example.invalid buildingos-backup contabowrite contaboverify ''
run_preflight
assert_success 'empty BACKUP_PREFIX uses runtime default'

write_env buildingos-backup production NO https://backup.example.invalid buildingos-backup contabowrite contaboverify '../archive'
run_preflight
assert_failure 'unsafe BACKUP_PREFIX fails closed'
write_env buildingos-backup production

set_env_line SOURCE_ACCESS_KEY '""'
run_preflight
assert_failure 'double-quoted empty environment value fails closed'
write_env buildingos-backup production

set_env_line SOURCE_ACCESS_KEY "''"
run_preflight
assert_failure 'single-quoted empty environment value fails closed'
write_env buildingos-backup production

set_env_line SOURCE_ACCESS_KEY '   '
run_preflight
assert_failure 'whitespace-only environment value fails closed'
write_env buildingos-backup production

set_env_line SOURCE_ACCESS_KEY 'escaped\ value'
run_preflight
assert_success 'escaped nonempty environment value is parsed safely'
write_env buildingos-backup production

write_env buildingos-production production NO HTTPS://USC1.CONTABOSTORAGE.COM:443/
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

chmod 0600 "$SSE_FILE"
run_preflight
assert_failure 'service-unreadable SSE permissions fail closed'
chmod 0640 "$SSE_FILE"

PREFLIGHT_EXPECTED_SSE_GROUP_OVERRIDE=wrong-group run_preflight
assert_failure 'wrong SSE group fails closed'
unset PREFLIGHT_EXPECTED_SSE_GROUP_OVERRIDE

PREFLIGHT_EXPECTED_SSE_OWNER_OVERRIDE=wrong-owner run_preflight
assert_failure 'wrong SSE owner fails closed'
unset PREFLIGHT_EXPECTED_SSE_OWNER_OVERRIDE

chmod 0750 "$STATE_DIR"
run_preflight
assert_failure 'unsafe state directory permissions fail closed'
chmod 0700 "$STATE_DIR"

write_sse

write_env buildingos-production production
run_preflight
assert_failure 'source and backup bucket collision fails closed'
write_env buildingos-backup production

write_env buildingos-production production NO https://usc1.contabostorage.com buildingos-production
set_env_line SOURCE_ENDPOINT 'http://usc1.contabostorage.com'
write_sse SSE_S3_SUPPORTED AES256 usc1.contabostorage.com buildingos-production
run_preflight
assert_failure 'db82 endpoint compatibility collision fails closed'
assert_contains 'canonical endpoint separation remains visible' 'SOURCE_AND_BACKUP_SEPARATE=YES' "$RUN_OUTPUT"
assert_contains 'db82 endpoint collision is explicit' 'DEPLOYED_RUNTIME_SOURCE_AND_BACKUP_SEPARATE=NO' "$RUN_OUTPUT"
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

run_preflight
assert_contains 'happy path reports PostgreSQL database size' 'POSTGRES_DATABASE_SIZE_BYTES=104857600' "$RUN_OUTPUT"
assert_contains 'happy path reports byte-converted root space' 'POSTGRES_BACKUP_ROOT_FREE_BYTES=1024000000' "$RUN_OUTPUT"
assert_contains 'happy path reports required PostgreSQL space' 'POSTGRES_BACKUP_REQUIRED_BYTES=209715200' "$RUN_OUTPUT"
assert_contains 'happy path reports safe PostgreSQL space' 'POSTGRES_BACKUP_SPACE_SAFE=YES' "$RUN_OUTPUT"
assert_contains 'happy path reports safe temporary space' 'TMP_SPACE_SAFE=YES' "$RUN_OUTPUT"

MOCK_ROOT_FREE_KIB=204800 MOCK_DB_SIZE_BYTES=104857600 run_preflight
assert_success 'exact PostgreSQL capacity boundary passes'
MOCK_ROOT_FREE_KIB=204799 run_preflight
assert_failure 'one KiB below PostgreSQL capacity boundary fails'
unset MOCK_ROOT_FREE_KIB MOCK_DB_SIZE_BYTES

MOCK_ROOT_FREE_KIB=1234 MOCK_DB_SIZE_BYTES=1 run_preflight
assert_failure 'insufficient PostgreSQL capacity fails closed'
assert_contains 'df KiB is converted to bytes' 'POSTGRES_BACKUP_ROOT_FREE_BYTES=1263616' "$RUN_OUTPUT"
unset MOCK_ROOT_FREE_KIB MOCK_DB_SIZE_BYTES

MOCK_DB_SIZE_UNAVAILABLE=YES run_preflight
assert_failure 'unavailable PostgreSQL size estimate fails closed'
assert_contains 'unavailable size estimate is explicit' 'POSTGRES_BACKUP_REQUIRED_BYTES=UNKNOWN' "$RUN_OUTPUT"
unset MOCK_DB_SIZE_UNAVAILABLE

MOCK_TMP_FREE_KIB=1 run_preflight
assert_failure 'insufficient temporary capacity fails closed'
unset MOCK_TMP_FREE_KIB

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

launcher_control="$TEST_ROOT/installed-control"
launcher_path="$TEST_ROOT/installed-launcher"
launcher_stat="$TEST_ROOT/launcher-stat"
mkdir -p "$launcher_control/lib"
cat > "$launcher_control/production-backup-preflight.sh" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if IFS= read -r _; then
  printf '%s\n' 'STDIN=CUSTOM'
  exit 1
fi
printf 'CANDIDATE_SHA=%s\n' "$1"
printf 'PREFLIGHT_APP_DIR=%s\n' "${PREFLIGHT_APP_DIR-UNSET}"
printf 'PREFLIGHT_ENV_FILE=%s\n' "${PREFLIGHT_ENV_FILE-UNSET}"
printf 'PREFLIGHT_SSE_FILE=%s\n' "${PREFLIGHT_SSE_FILE-UNSET}"
printf 'PREFLIGHT_STATE_DIR=%s\n' "${PREFLIGHT_STATE_DIR-UNSET}"
printf 'PREFLIGHT_EXPECTED_ENV_OWNER=%s\n' "${PREFLIGHT_EXPECTED_ENV_OWNER-UNSET}"
printf 'PREFLIGHT_EXPECTED_ENV_GROUP=%s\n' "${PREFLIGHT_EXPECTED_ENV_GROUP-UNSET}"
printf 'PREFLIGHT_EXPECTED_STATE_OWNER=%s\n' "${PREFLIGHT_EXPECTED_STATE_OWNER-UNSET}"
printf 'PREFLIGHT_EXPECTED_STATE_GROUP=%s\n' "${PREFLIGHT_EXPECTED_STATE_GROUP-UNSET}"
printf 'PREFLIGHT_EXPECTED_SSE_OWNER=%s\n' "${PREFLIGHT_EXPECTED_SSE_OWNER-UNSET}"
printf 'PREFLIGHT_EXPECTED_SSE_GROUP=%s\n' "${PREFLIGHT_EXPECTED_SSE_GROUP-UNSET}"
printf 'BUILDINGOS_PREFLIGHT_TEST_MODE=%s\n' "${BUILDINGOS_PREFLIGHT_TEST_MODE-UNSET}"
printf 'PATH=%s\n' "$PATH"
printf '%s\n' 'STDIN=CLOSED'
MOCK
printf '# endpoint fixture\n' > "$launcher_control/lib/endpoint-identity.sh"
cat > "$launcher_stat" <<'MOCK'
#!/bin/sh
set -eu
path=''
for argument do path="$argument"; done
case "$path" in
  */endpoint-identity.sh) mode=644 ;;
  *) mode=755 ;;
esac
printf '0:0:%s\n' "$mode"
MOCK
sed \
  -e "s|/usr/local/libexec/buildingos-backup-preflight|$launcher_control|g" \
  -e "s|/usr/local/sbin/buildingos-production-backup-preflight|$launcher_path|g" \
  -e "s|/usr/bin/stat|$launcher_stat|g" \
  "$PRIVILEGED_LAUNCHER" > "$launcher_path"
chmod 0755 "$launcher_control" "$launcher_control/lib" "$launcher_control/production-backup-preflight.sh" "$launcher_path" "$launcher_stat"
chmod 0644 "$launcher_control/lib/endpoint-identity.sh"

run_launcher() {
  set +e
  LAUNCHER_OUTPUT="$("$launcher_path" "$@" 2>&1)"
  LAUNCHER_RC=$?
  set -e
}

run_launcher "$CANDIDATE_SHA"
RUN_RC=$LAUNCHER_RC
assert_success 'privileged launcher accepts exactly one lowercase SHA'
assert_contains 'privileged launcher passes the exact SHA' "CANDIDATE_SHA=$CANDIDATE_SHA" "$LAUNCHER_OUTPUT"
assert_contains 'privileged launcher closes caller stdin' 'STDIN=CLOSED' "$LAUNCHER_OUTPUT"

run_launcher
RUN_RC=$LAUNCHER_RC
assert_failure 'privileged launcher rejects zero arguments'
run_launcher "$CANDIDATE_SHA" id
RUN_RC=$LAUNCHER_RC
assert_failure 'privileged launcher rejects multiple arguments'
run_launcher AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
RUN_RC=$LAUNCHER_RC
assert_failure 'privileged launcher rejects uppercase SHA'
run_launcher abc123
RUN_RC=$LAUNCHER_RC
assert_failure 'privileged launcher rejects short SHA'
run_launcher 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;'
RUN_RC=$LAUNCHER_RC
assert_failure 'privileged launcher rejects shell metacharacters'
run_launcher /tmp/preflight.sh
RUN_RC=$LAUNCHER_RC
assert_failure 'privileged launcher rejects path arguments'
run_launcher id
RUN_RC=$LAUNCHER_RC
assert_failure 'privileged launcher rejects arbitrary commands'

printf 'printf "BASH_ENV_EXECUTED\\n"; exit 99\n' > "$TEST_ROOT/attacker-bash-env"
set +e
LAUNCHER_OUTPUT="$(env \
  BASH_ENV="$TEST_ROOT/attacker-bash-env" \
  PATH="$TEST_ROOT:$PATH" \
  PREFLIGHT_APP_DIR=/tmp/attacker-app \
  PREFLIGHT_ENV_FILE=/tmp/attacker.env \
  PREFLIGHT_SSE_FILE=/tmp/attacker-sse.json \
  PREFLIGHT_STATE_DIR=/tmp/attacker-state \
  PREFLIGHT_EXPECTED_ENV_OWNER=attacker \
  PREFLIGHT_EXPECTED_ENV_GROUP=attacker \
  PREFLIGHT_EXPECTED_STATE_OWNER=attacker \
  PREFLIGHT_EXPECTED_STATE_GROUP=attacker \
  PREFLIGHT_EXPECTED_SSE_OWNER=attacker \
  PREFLIGHT_EXPECTED_SSE_GROUP=attacker \
  BUILDINGOS_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY \
  "$launcher_path" "$CANDIDATE_SHA" 2>&1)"
LAUNCHER_RC=$?
set -e
RUN_RC=$LAUNCHER_RC
assert_success 'privileged launcher ignores protected path and test-mode overrides'
assert_contains 'app directory override is cleared' 'PREFLIGHT_APP_DIR=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'environment path override is cleared' 'PREFLIGHT_ENV_FILE=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'SSE path override is cleared' 'PREFLIGHT_SSE_FILE=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'state path override is cleared' 'PREFLIGHT_STATE_DIR=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'environment owner override is cleared' 'PREFLIGHT_EXPECTED_ENV_OWNER=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'environment group override is cleared' 'PREFLIGHT_EXPECTED_ENV_GROUP=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'state owner override is cleared' 'PREFLIGHT_EXPECTED_STATE_OWNER=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'state group override is cleared' 'PREFLIGHT_EXPECTED_STATE_GROUP=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'SSE owner override is cleared' 'PREFLIGHT_EXPECTED_SSE_OWNER=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'SSE group override is cleared' 'PREFLIGHT_EXPECTED_SSE_GROUP=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'test mode override is cleared' 'BUILDINGOS_PREFLIGHT_TEST_MODE=UNSET' "$LAUNCHER_OUTPUT"
assert_contains 'launcher replaces caller PATH' 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' "$LAUNCHER_OUTPUT"
assert_absent 'launcher prevents BASH_ENV execution' 'BASH_ENV_EXECUTED' "$LAUNCHER_OUTPUT"

launcher_text="$(< "$PRIVILEGED_LAUNCHER")"
assert_contains 'launcher pins the installed control directory' "readonly CONTROL_DIR='/usr/local/libexec/buildingos-backup-preflight'" "$launcher_text"
assert_contains 'launcher verifies root ownership and exact modes' '"0:0:$expected_mode"' "$launcher_text"
assert_contains 'launcher executes only the installed preflight control' '/bin/bash --noprofile --norc "$PREFLIGHT_SCRIPT" "$candidate_sha" </dev/null' "$launcher_text"
assert_absent 'launcher never executes mutable checkout scripts' '/opt/pawtech/apps/buildingos/buildingos-app' "$launcher_text"
assert_absent 'launcher never evaluates caller input' 'eval ' "$launcher_text"

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
assert_contains 'workflow invokes only the installed privileged launcher' 'sudo -n /usr/local/sbin/buildingos-production-backup-preflight $quoted_candidate' "$workflow_text"
assert_absent 'workflow does not authorize a streamed root bash' 'sudo -n -u root bash -s --' "$workflow_text"
assert_absent 'workflow does not invoke bash over SSH stdin' 'bash -s --' "$workflow_text"
assert_absent 'workflow does not stream executable checkout code' 'cat scripts/lib/endpoint-identity.sh scripts/production-backup-preflight.sh' "$workflow_text"
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

sudoers_text="$(< "$SUDOERS_POLICY")"
assert_contains 'sudoers grants only the fixed launcher to yoryi' 'yoryi ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/buildingos-production-backup-preflight *' "$sudoers_text"
assert_contains 'sudoers resets the launcher environment' 'env_reset' "$sudoers_text"
if printf '%s\n' "$sudoers_text" | grep -Eq '(^|[[:space:]])(/[^[:space:]]*/)?(bash|sh|env|cat)([[:space:]]|$)|(^|[[:space:]])(systemctl|docker)[[:space:]]+\*'; then
  fail_test 'sudoers excludes generic interpreters and privileged commands'
else
  pass 'sudoers excludes generic interpreters and privileged commands'
fi

runbook_text="$(< "$ACTIVATION_RUNBOOK")"
assert_contains 'runbook classifies privilege installation as a one-time mutation' 'one-time approved production mutation' "$runbook_text"
assert_contains 'runbook enables strict installation failure handling' 'set -Eeuo pipefail' "$runbook_text"
assert_contains 'runbook cleans staged artifacts on failure' 'trap cleanup EXIT' "$runbook_text"
assert_contains 'runbook only removes launcher when this execution published it' 'if [[ "$launcher_published" == true ]]; then' "$runbook_text"
assert_contains 'runbook only removes control when this execution published it' 'if [[ "$control_published" == true ]]; then' "$runbook_text"
assert_contains 'runbook only removes sudoers when this execution published it' 'if [[ "$sudoers_published" == true ]]; then' "$runbook_text"
assert_contains 'runbook only removes launcher staging when this execution created it' 'if [[ "$launcher_stage_created" == true ]]; then' "$runbook_text"
assert_contains 'runbook only removes sudoers staging when this execution created it' 'if [[ "$sudoers_stage_created" == true ]]; then' "$runbook_text"
assert_contains 'runbook sets the control staging directory mode to 0755' 'sudo chmod 0755 "$control_stage"' "$runbook_text"
assert_contains 'runbook validates staged control directory metadata as root 0755' 'test "$(sudo stat -c' "$runbook_text"
assert_contains 'runbook requires staged control directory mode 0755' "\"\$control_stage\")\" = '0:0:755'" "$runbook_text"
assert_contains 'runbook validates staged sudoers before activation' 'sudo visudo -cf "$sudoers_stage"' "$runbook_text"
assert_contains 'runbook installs preflight control as root' 'sudo install -o root -g root -m 0755' "$runbook_text"
assert_contains 'runbook documents privilege-boundary rollback' 'sudo rm -- "$sudoers_policy"' "$runbook_text"
assert_contains 'runbook distinguishes the current application runtime SHA' 'CURRENT_RUNTIME_SHA' "$runbook_text"
assert_contains 'runbook requires an explicit control source SHA' 'CONTROL_SOURCE_SHA' "$runbook_text"
assert_contains 'runbook permits control source SHA to differ from runtime' 'It may differ from `CURRENT_RUNTIME_SHA` during this bootstrap.' "$runbook_text"
assert_contains 'runbook binds the first runtime candidate to current runtime' 'readonly RUNTIME_CANDIDATE_SHA="$CURRENT_RUNTIME_SHA"' "$runbook_text"
assert_contains 'runbook fetches control source without updating active checkout' 'git -C "$app_dir" fetch --no-tags origin main' "$runbook_text"
assert_contains 'runbook requires control source reachability from origin main' 'git -C "$app_dir" merge-base --is-ancestor "$CONTROL_SOURCE_SHA" origin/main' "$runbook_text"
assert_contains 'runbook materializes a detached control source worktree' 'git -C "$app_dir" worktree add --detach "$source_tree" "$CONTROL_SOURCE_SHA"' "$runbook_text"
assert_contains 'runbook removes the temporary control worktree' 'git -C "$app_dir" worktree remove --force "$source_tree"' "$runbook_text"
assert_contains 'runbook derives preflight integrity from the exact control source commit' 'git -C "$app_dir" show "$CONTROL_SOURCE_SHA:scripts/production-backup-preflight.sh"' "$runbook_text"
assert_contains 'runbook verifies staged privileged control integrity before publication' 'test "$(sudo sha256sum "$control_stage/production-backup-preflight.sh" | awk' "$runbook_text"
assert_contains 'runbook revalidates active checkout after staged installation' 'active_checkout_end="$(git -C "$app_dir" rev-parse HEAD)"' "$runbook_text"
assert_absent 'runbook never switches the active checkout' 'git -C "$app_dir" switch' "$runbook_text"
assert_absent 'runbook never resets the active checkout' 'git -C "$app_dir" reset' "$runbook_text"
assert_absent 'runbook never pulls the active checkout' 'git -C "$app_dir" pull' "$runbook_text"
assert_order 'runbook fixes stage mode before publishing control directory' 'sudo chmod 0755 "$control_stage"' 'sudo mv -- "$control_stage" "$control_dir"' "$runbook_text"
assert_order 'runbook validates staged sudoers before publishing it' 'sudo visudo -cf "$sudoers_stage"' 'sudo mv -- "$sudoers_stage" "$sudoers_policy"' "$runbook_text"
assert_order 'runbook revalidates active checkout before authorizing launcher' 'active_checkout_end="$(git -C "$app_dir" rev-parse HEAD)"' 'sudo mv -- "$sudoers_stage" "$sudoers_policy"' "$runbook_text"

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s test(s) failed; %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
