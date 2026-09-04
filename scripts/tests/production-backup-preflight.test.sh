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
cat > "$BIN_DIR/runuser" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "${MOCK_RUNUSER_LOG:?}"
[[ "${1:-}" == -u && "${2:-}" == yoryi && "${3:-}" == -- ]] || exit 1
shift 3
exec "$@"
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
chmod 0755 "$BIN_DIR/runuser"

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

run_production_override_rejection() {
  local variable_name="$1"
  set +e
  RUN_OUTPUT="$(env "$variable_name=attacker" /bin/bash "$PREFLIGHT" "$CANDIDATE_SHA" 2>&1)"
  RUN_RC=$?
  set -e
}

state_metadata() {
  stat -c '%u:%g:%a' -- "$1" 2>/dev/null || stat -f '%u:%g:%Lp' "$1"
}

state_install() {
  printf '%s\n' "$*" >> "$STATE_INSTALL_LOG"
  command install "$@"
}

ensure_state_directory_contract() {
  local state_dir="$1" expected_uid="$2" expected_gid="$3" installer="$4"

  if [[ -e "$state_dir" || -L "$state_dir" ]]; then
    [[ -d "$state_dir" && ! -L "$state_dir" ]] || return 1
    [[ "$(state_metadata "$state_dir")" == "$expected_uid:$expected_gid:700" ]] || return 1
    return 0
  fi
  [[ ! -e "$state_dir" && ! -L "$state_dir" ]] || return 1
  "$installer" -d -o "$(id -un)" -g "$(id -gn)" -m 0700 "$state_dir"
  [[ -d "$state_dir" && ! -L "$state_dir" ]]
  [[ "$(state_metadata "$state_dir")" == "$expected_uid:$expected_gid:700" ]]
}

run_state_directory_contract() {
  set +e
  ensure_state_directory_contract "$@"
  RUN_RC=$?
  set -e
}

run_control_update_fixture() {
  local scenario="$1"
  local fixture="$TEST_ROOT/control-update-$scenario"
  mkdir -p "$fixture/control/lib" "$fixture/control-stage/lib"
  printf 'old-control\n' > "$fixture/control/production-backup-preflight.sh"
  printf 'old-helper\n' > "$fixture/control/lib/endpoint-identity.sh"
  printf 'new-control\n' > "$fixture/control-stage/production-backup-preflight.sh"
  printf 'new-helper\n' > "$fixture/control-stage/lib/endpoint-identity.sh"
  printf 'old-launcher\n' > "$fixture/launcher"
  printf 'new-launcher\n' > "$fixture/launcher-stage"
  printf 'old-sudoers\n' > "$fixture/sudoers"
  printf 'new-sudoers\n' > "$fixture/sudoers-stage"
  (
    set -Eeuo pipefail
    local_control_dir="$fixture/control"
    local_rollback_control_dir="$fixture/rollback-control"
    local_failed_control_dir="$fixture/failed-control"
    local_launcher="$fixture/launcher"
    local_launcher_rollback="$fixture/launcher-rollback"
    local_failed_launcher="$fixture/failed-launcher"
    local_sudoers="$fixture/sudoers"
    local_sudoers_rollback="$fixture/sudoers-rollback"
    local_failed_sudoers="$fixture/failed-sudoers"
    local_control_stage="$fixture/control-stage"
    local_launcher_stage="$fixture/launcher-stage"
    local_sudoers_stage="$fixture/sudoers-stage"
    control_old_preserved=false
    control_new_published=false
    launcher_old_preserved=false
    launcher_new_published=false
    sudoers_old_preserved=false
    sudoers_new_published=false
    activation_complete=false
    publication_started=false

    rollback_update_fixture() {
      local rollback_status=0 control_relocate_status=0
      set +e
      if [[ "$sudoers_new_published" == true ]]; then mv "$local_sudoers" "$local_failed_sudoers" || rollback_status=$?; fi
      if [[ "$sudoers_old_preserved" == true ]]; then mv "$local_sudoers_rollback" "$local_sudoers" || rollback_status=$?; fi
      if [[ "$launcher_new_published" == true ]]; then mv "$local_launcher" "$local_failed_launcher" || rollback_status=$?; fi
      if [[ "$launcher_old_preserved" == true ]]; then mv "$local_launcher_rollback" "$local_launcher" || rollback_status=$?; fi
      if [[ "$control_old_preserved" == true ]]; then
        if [[ "$control_new_published" == true ]]; then
          if [[ "$scenario" == evidence-relocation || "$scenario" == impossible ]]; then
            false || control_relocate_status=$?
          else
            mv "$local_control_dir" "$local_failed_control_dir" || control_relocate_status=$?
          fi
          if (( control_relocate_status != 0 )); then
            if [[ "$scenario" == evidence-relocation &&
              "$(< "$local_control_dir/production-backup-preflight.sh")" == new-control &&
              "$(< "$local_control_dir/lib/endpoint-identity.sh")" == new-helper ]]; then
              cp -a "$local_control_dir" "$local_failed_control_dir" || rollback_status=$?
              rm -f "$local_control_dir/production-backup-preflight.sh" "$local_control_dir/lib/endpoint-identity.sh" || rollback_status=$?
              rmdir "$local_control_dir/lib" "$local_control_dir" || rollback_status=$?
              [[ ! -e "$local_control_dir" && ! -L "$local_control_dir" ]] || rollback_status=1
            else
              rollback_status=1
            fi
          else
            [[ ! -e "$local_control_dir" && ! -L "$local_control_dir" ]] || rollback_status=1
          fi
        fi
        if [[ ! -e "$local_control_dir" && ! -L "$local_control_dir" ]]; then
          mv "$local_rollback_control_dir" "$local_control_dir" || rollback_status=$?
        else
          rollback_status=1
        fi
      fi
      if (( rollback_status != 0 )); then printf 'RECOVERY_REQUIRED\n' > "$fixture/recovery-required"; fi
      if [[ "$publication_started" == true ]]; then
        [[ "$(< "$local_control_dir/production-backup-preflight.sh")" == old-control ]] || rollback_status=1
        [[ "$(< "$local_control_dir/lib/endpoint-identity.sh")" == old-helper ]] || rollback_status=1
        [[ "$(< "$local_launcher")" == old-launcher ]] || rollback_status=1
        [[ "$(< "$local_sudoers")" == old-sudoers ]] || rollback_status=1
      fi
      return "$rollback_status"
    }

    cleanup_fixture() {
      local status=$? rollback_status=0
      trap - EXIT
      set +e
      if [[ "$activation_complete" != true && "$publication_started" == true ]]; then
        rollback_update_fixture || rollback_status=$?
      fi
      [[ -z "$local_control_stage" ]] || rm -rf "$local_control_stage"
      [[ -z "$local_launcher_stage" ]] || rm -f "$local_launcher_stage"
      [[ -z "$local_sudoers_stage" ]] || rm -f "$local_sudoers_stage"
      if (( status == 0 && rollback_status != 0 )); then status=$rollback_status; fi
      exit "$status"
    }
    trap cleanup_fixture EXIT

    publication_started=true
    mv "$local_control_dir" "$local_rollback_control_dir"
    control_old_preserved=true
    [[ "$scenario" != after-control-old-preservation ]] || false
    mv "$local_control_stage" "$local_control_dir"
    local_control_stage=''
    control_new_published=true
    [[ "$scenario" != after-control-new-publication ]] || false
    if [[ "$scenario" == impossible ]]; then printf 'unexpected\n' > "$local_control_dir/unexpected"; fi
    [[ "$scenario" != evidence-relocation && "$scenario" != impossible ]] || false
    [[ -d "$local_rollback_control_dir" && ! -L "$local_rollback_control_dir" ]]
    [[ -d "$local_control_dir" && ! -L "$local_control_dir" ]]
    cp "$local_launcher" "$local_launcher_rollback"
    launcher_old_preserved=true
    [[ "$scenario" != after-launcher-old-preservation ]] || false
    [[ -f "$local_launcher_rollback" && ! -L "$local_launcher_rollback" ]]
    mv "$local_launcher_stage" "$local_launcher"
    local_launcher_stage=''
    launcher_new_published=true
    [[ "$scenario" != after-launcher-new-publication ]] || false
    cp "$local_sudoers" "$local_sudoers_rollback"
    sudoers_old_preserved=true
    [[ "$scenario" != after-sudoers-old-preservation ]] || false
    [[ -f "$local_sudoers_rollback" && ! -L "$local_sudoers_rollback" ]]
    mv "$local_sudoers_stage" "$local_sudoers"
    local_sudoers_stage=''
    sudoers_new_published=true
    [[ "$scenario" != after-sudoers-new-publication && "$scenario" != checkout && "$scenario" != visudo ]] || false
    [[ "$(< "$local_control_dir/production-backup-preflight.sh")" == new-control ]]
    [[ "$(< "$local_launcher")" == new-launcher ]]
    [[ "$(< "$local_sudoers")" == new-sudoers ]]
    activation_complete=true
  )
}

runtime_fixture_dir="$TEST_ROOT/runtime-fixture"
mkdir -p "$runtime_fixture_dir/lib"
cp "$ROOT_DIR/scripts/lib/endpoint-identity.sh" "$runtime_fixture_dir/lib/endpoint-identity.sh"
runtime_fixture="$runtime_fixture_dir/production-backup-preflight.sh"
sed \
  -e "s|readonly EXPECTED_GIT='/usr/bin/git'|readonly EXPECTED_GIT='$BIN_DIR/git'|" \
  -e "s|readonly EXPECTED_RUNUSER='/usr/sbin/runuser'|readonly EXPECTED_RUNUSER='$BIN_DIR/runuser'|" \
  "$PREFLIGHT" > "$runtime_fixture"
chmod 0755 "$runtime_fixture"

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

MOCK_RUNUSER_LOG="$TEST_ROOT/runuser.log"
export MOCK_RUNUSER_LOG
set +e
RUNTIME_OUTPUT="$(PATH="$BIN_DIR" /bin/bash -c '
  set -Eeuo pipefail
  source "$1"
  test_mode=false
  EXPECTED_APP_DIR="$2"
  CANDIDATE_SHA='2ac603be8018ffc3df67fb4e84149aea4f780cea'
  inspect_runtime
' -- "$runtime_fixture" "$APP_DIR" 2>&1)"
RUN_RC=$?
set -e
assert_success 'production-mode inspection reads clean checkout through fixed yoryi runuser'
assert_contains 'production-mode inspection reports clean checkout' 'PRODUCTION_CHECKOUT_STATUS=CLEAN' "$RUNTIME_OUTPUT"
assert_contains 'production-mode inspection reports checkout SHA' 'PRODUCTION_RUNTIME_SHA=2ac603be8018ffc3df67fb4e84149aea4f780cea' "$RUNTIME_OUTPUT"
assert_contains 'production-mode inspection invokes fixed checkout owner' '-u yoryi --' "$(< "$MOCK_RUNUSER_LOG")"

set +e
RUNTIME_OUTPUT="$(MOCK_DIRTY=YES PATH="$BIN_DIR" /bin/bash -c '
  set -Eeuo pipefail
  source "$1"
  test_mode=false
  EXPECTED_APP_DIR="$2"
  CANDIDATE_SHA='2ac603be8018ffc3df67fb4e84149aea4f780cea'
  inspect_runtime
' -- "$runtime_fixture" "$APP_DIR" 2>&1)"
RUN_RC=$?
set -e
assert_success 'production-mode inspection completes for dirty checkout'
assert_contains 'production-mode inspection reports dirty checkout' 'PRODUCTION_CHECKOUT_STATUS=DIRTY' "$RUNTIME_OUTPUT"

state_contract_root="$TEST_ROOT/state-directory-contract"
state_target="$state_contract_root/state"
state_link="$state_contract_root/state-link"
state_file="$state_contract_root/state-file"
state_fifo="$state_contract_root/state-fifo"
STATE_INSTALL_LOG="$state_contract_root/install.log"
mkdir -p "$state_contract_root"
: > "$STATE_INSTALL_LOG"
state_uid="$(id -u)"
state_gid="$(id -g)"
run_state_directory_contract "$state_target" "$state_uid" "$state_gid" state_install
assert_success 'absent state directory is created safely'
assert_contains 'absent state directory uses install only after absence check' '-d' "$(< "$STATE_INSTALL_LOG")"
if [[ "$(state_metadata "$state_target")" == "$state_uid:$state_gid:700" ]]; then pass 'created state directory has exact metadata'; else fail_test 'created state directory has exact metadata'; fi

: > "$STATE_INSTALL_LOG"
run_state_directory_contract "$state_target" "$state_uid" "$state_gid" state_install
assert_success 'valid existing state directory is accepted'
if [[ ! -s "$STATE_INSTALL_LOG" ]]; then pass 'valid existing state directory is reused without mutation'; else fail_test 'valid existing state directory is reused without mutation'; fi

ln -s "$state_target" "$state_link"
: > "$STATE_INSTALL_LOG"
run_state_directory_contract "$state_link" "$state_uid" "$state_gid" state_install
assert_failure 'state directory symlink is rejected before install'
if [[ ! -s "$STATE_INSTALL_LOG" ]]; then pass 'state directory symlink triggers no install chmod or chown'; else fail_test 'state directory symlink triggers no install chmod or chown'; fi

: > "$STATE_INSTALL_LOG"
run_state_directory_contract "$state_target" 99999 "$state_gid" state_install
assert_failure 'existing state directory with wrong owner fails'
if [[ ! -s "$STATE_INSTALL_LOG" ]]; then pass 'wrong state directory owner is not remediated automatically'; else fail_test 'wrong state directory owner is not remediated automatically'; fi

: > "$STATE_INSTALL_LOG"
run_state_directory_contract "$state_target" "$state_uid" 99999 state_install
assert_failure 'existing state directory with wrong group fails'
if [[ ! -s "$STATE_INSTALL_LOG" ]]; then pass 'wrong state directory group is not remediated automatically'; else fail_test 'wrong state directory group is not remediated automatically'; fi

chmod 0750 "$state_target"
: > "$STATE_INSTALL_LOG"
run_state_directory_contract "$state_target" "$state_uid" "$state_gid" state_install
assert_failure 'existing state directory with wrong mode fails'
if [[ ! -s "$STATE_INSTALL_LOG" ]]; then pass 'wrong state directory mode is not remediated automatically'; else fail_test 'wrong state directory mode is not remediated automatically'; fi
chmod 0700 "$state_target"

printf 'not a directory\n' > "$state_file"
: > "$STATE_INSTALL_LOG"
run_state_directory_contract "$state_file" "$state_uid" "$state_gid" state_install
assert_failure 'regular file cannot replace state directory'
if [[ ! -s "$STATE_INSTALL_LOG" && -f "$state_file" ]]; then pass 'regular file is never replaced'; else fail_test 'regular file is never replaced'; fi

mkfifo "$state_fifo"
: > "$STATE_INSTALL_LOG"
run_state_directory_contract "$state_fifo" "$state_uid" "$state_gid" state_install
assert_failure 'unexpected state object fails'
if [[ ! -s "$STATE_INSTALL_LOG" && -p "$state_fifo" ]]; then pass 'unexpected state object is never replaced'; else fail_test 'unexpected state object is never replaced'; fi

parent_contract_root="$TEST_ROOT/privileged-parent-contract"
parent_target="$parent_contract_root/parent"
parent_link="$parent_contract_root/parent-link"
parent_file="$parent_contract_root/parent-file"
parent_fifo="$parent_contract_root/parent-fifo"
mkdir -p "$parent_target"
: > "$STATE_INSTALL_LOG"

validate_privileged_parent_fixture() {
  local parent="$1" expected_uid="$2" expected_gid="$3"
  [[ -d "$parent" && ! -L "$parent" ]] || return 1
  [[ "$(state_metadata "$parent")" == "$expected_uid:$expected_gid:755" ]]
}

run_parent_contract() {
  set +e
  validate_privileged_parent_fixture "$@"
  RUN_RC=$?
  set -e
}

run_parent_contract "$parent_target" "$state_uid" "$state_gid"
assert_success 'valid privileged staging parent is accepted without mutation'
if [[ ! -s "$STATE_INSTALL_LOG" ]]; then pass 'valid privileged staging parent triggers no install'; else fail_test 'valid privileged staging parent triggers no install'; fi

ln -s "$parent_target" "$parent_link"
run_parent_contract "$parent_link" "$state_uid" "$state_gid"
assert_failure 'symlink privileged staging parent is rejected before mutation'
if [[ ! -s "$STATE_INSTALL_LOG" ]]; then pass 'symlink privileged staging parent triggers no install'; else fail_test 'symlink privileged staging parent triggers no install'; fi

run_parent_contract "$parent_target" 99999 "$state_gid"
assert_failure 'wrong privileged staging parent owner fails'
run_parent_contract "$parent_target" "$state_uid" 99999
assert_failure 'wrong privileged staging parent group fails'
chmod 0750 "$parent_target"
run_parent_contract "$parent_target" "$state_uid" "$state_gid"
assert_failure 'wrong privileged staging parent mode fails'
chmod 0755 "$parent_target"

printf 'not a directory\n' > "$parent_file"
run_parent_contract "$parent_file" "$state_uid" "$state_gid"
assert_failure 'regular file privileged staging parent fails'

mkfifo "$parent_fifo"
run_parent_contract "$parent_fifo" "$state_uid" "$state_gid"
assert_failure 'FIFO privileged staging parent fails'

parent_missing="$parent_contract_root/missing-parent"
run_parent_contract "$parent_missing" "$state_uid" "$state_gid"
assert_failure 'absent privileged staging parent fails for separate remediation'
if [[ ! -s "$STATE_INSTALL_LOG" ]]; then pass 'unexpected privileged staging parents trigger no install chmod or chown'; else fail_test 'unexpected privileged staging parents trigger no install chmod or chown'; fi

for rollback_scenario in \
  after-control-old-preservation after-control-new-publication evidence-relocation \
  after-launcher-old-preservation after-launcher-new-publication \
  after-sudoers-old-preservation after-sudoers-new-publication checkout visudo; do
  set +e
  run_control_update_fixture "$rollback_scenario"
  RUN_RC=$?
  set -e
  assert_failure "CONTROL_UPDATE rolls back after $rollback_scenario failure"
  rollback_fixture="$TEST_ROOT/control-update-$rollback_scenario"
  if [[ "$(< "$rollback_fixture/control/production-backup-preflight.sh")" == old-control &&
    "$(< "$rollback_fixture/control/lib/endpoint-identity.sh")" == old-helper &&
    "$(< "$rollback_fixture/launcher")" == old-launcher &&
    "$(< "$rollback_fixture/sudoers")" == old-sudoers ]]; then
    pass "CONTROL_UPDATE restores all previous bytes after $rollback_scenario failure"
  else
    fail_test "CONTROL_UPDATE restores all previous bytes after $rollback_scenario failure"
  fi
  if [[ "$rollback_scenario" == evidence-relocation && -d "$rollback_fixture/control/failed-control" ]]; then
    fail_test 'CONTROL_UPDATE failed-evidence fixture unexpectedly nested its evidence path'
  elif [[ "$rollback_scenario" == evidence-relocation && -d "$rollback_fixture/failed-control" && ! -d "$rollback_fixture/control/rollback-control" ]]; then
    pass 'CONTROL_UPDATE failed-evidence relocation preserves evidence without nesting rollback'
  elif [[ "$rollback_scenario" == evidence-relocation ]]; then
    fail_test 'CONTROL_UPDATE failed-evidence relocation preserves evidence without nesting rollback'
  fi
done

set +e
run_control_update_fixture impossible
RUN_RC=$?
set -e
assert_failure 'CONTROL_UPDATE reports impossible control restoration failure'
impossible_fixture="$TEST_ROOT/control-update-impossible"
if [[ -f "$impossible_fixture/recovery-required" && -d "$impossible_fixture/rollback-control" && -d "$impossible_fixture/control" && ! -d "$impossible_fixture/control/rollback-control" ]]; then
  pass 'CONTROL_UPDATE impossible restoration preserves rollback and avoids nesting'
else
  fail_test 'CONTROL_UPDATE impossible restoration preserves rollback and avoids nesting'
fi

set +e
run_control_update_fixture success
RUN_RC=$?
set -e
assert_success 'CONTROL_UPDATE successful path completes without rollback'
success_fixture="$TEST_ROOT/control-update-success"
if [[ "$(< "$success_fixture/control/production-backup-preflight.sh")" == new-control &&
  "$(< "$success_fixture/launcher")" == new-launcher &&
  "$(< "$success_fixture/sudoers")" == new-sudoers &&
  -d "$success_fixture/rollback-control" && -f "$success_fixture/launcher-rollback" && -f "$success_fixture/sudoers-rollback" ]]; then
  pass 'successful CONTROL_UPDATE keeps new bytes and previous rollback material'
else
  fail_test 'successful CONTROL_UPDATE keeps new bytes and previous rollback material'
fi

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

run_production_override_rejection PREFLIGHT_APP_DIR
assert_failure 'production rejects checkout path override'
assert_contains 'checkout path override requires isolated test mode' 'test path or checkout-owner overrides require LOCAL_ISOLATED_ONLY' "$RUN_OUTPUT"
run_production_override_rejection PREFLIGHT_CHECKOUT_OWNER
assert_failure 'production rejects checkout owner override'
assert_contains 'checkout owner override requires isolated test mode' 'test path or checkout-owner overrides require LOCAL_ISOLATED_ONLY' "$RUN_OUTPUT"

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
MOCK_LEGACY_TIMER_STATE=enabled run_preflight
assert_success 'temporarily stopped enabled legacy timer is safe for the overlap window'
assert_contains 'temporary legacy overlap window preserves enabled timer state' 'LEGACY_BACKUP_TIMER_ENABLED=YES' "$RUN_OUTPUT"
unset MOCK_LEGACY_TIMER_STATE
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
assert_contains 'production checkout inspection uses the fixed checkout owner' "readonly EXPECTED_CHECKOUT_OWNER='yoryi'" "$preflight_text"
assert_contains 'production checkout inspection uses fixed runuser and git paths' '"$EXPECTED_RUNUSER" -u "$EXPECTED_CHECKOUT_OWNER" -- "$EXPECTED_GIT"' "$preflight_text"
assert_absent 'preflight never configures global Git safe directories' 'safe.directory' "$preflight_text"
assert_absent 'preflight never mutates Git configuration' 'git config' "$preflight_text"

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
assert_contains 'runbook names the current runtime as the first backup target' 'CURRENT_RUNTIME_SHA' "$runbook_text"
assert_contains 'runbook names the later deployment identity' 'LATER_DEPLOY_SHA' "$runbook_text"
assert_contains 'runbook installs state directory for the service account' 'sudo install -d -o yoryi -g yoryi -m 0700 "$state_dir"' "$runbook_text"
assert_contains 'runbook validates state directory as non-symlink' 'sudo test ! -L "$state_dir"' "$runbook_text"
assert_contains 'runbook checks existing state directory before installing it' 'if sudo test -e "$state_dir" || sudo test -L "$state_dir"; then' "$runbook_text"
assert_contains 'runbook rejects unexpected existing state directory metadata' 'Never follow a symlink or silently repair an existing directory.' "$runbook_text"
assert_contains 'runbook defines temporary legacy timer stop' 'sudo systemctl stop pawtech-postgres-backup.timer' "$runbook_text"
assert_contains 'runbook restores legacy timer after a failed first backup gate' 'sudo systemctl start pawtech-postgres-backup.timer' "$runbook_text"
assert_absent 'runbook no longer requires an approved SHA deployed before coordinator installation' 'Preconditions: approved SHA is deployed and protected config validates.' "$runbook_text"
assert_contains 'runbook separates installed and new privileged control sources' 'INSTALLED_CONTROL_SOURCE_SHA' "$runbook_text"
assert_contains 'runbook requires an explicit new privileged control source' 'NEW_CONTROL_SOURCE_SHA' "$runbook_text"
assert_contains 'runbook distinguishes initial installation from control update' 'INITIAL_INSTALL' "$runbook_text"
assert_contains 'runbook labels existing-control procedure as control update' 'CONTROL_UPDATE' "$runbook_text"
assert_contains 'runbook states that merging does not update installed privileged control' 'Merging repository code does not update the installed privileged control.' "$runbook_text"
assert_contains 'runbook stages control update outside the live control directory' '.buildingos-backup-preflight.update.XXXXXX' "$runbook_text"
assert_contains 'runbook preserves previous control bytes for rollback' 'rollback_control_dir' "$runbook_text"
assert_contains 'runbook validates staged control update hashes from exact Git objects' 'new_hash["$artifact"]="$(git -C "$app_dir" show "$NEW_CONTROL_SOURCE_SHA:$artifact"' "$runbook_text"
assert_contains 'runbook rejects symbolic links before hashing installed control' 'sudo test -f "$installed_file" && sudo test ! -L "$installed_file"' "$runbook_text"
assert_contains 'runbook conditionally stages a changed launcher' 'APPROVED_LAUNCHER_REPLACEMENT' "$runbook_text"
assert_contains 'runbook conditionally stages a changed sudoers policy' 'APPROVED_SUDOERS_REPLACEMENT' "$runbook_text"
assert_contains 'runbook tracks preserved control state' 'control_old_preserved' "$runbook_text"
assert_contains 'runbook tracks published control state' 'control_new_published' "$runbook_text"
assert_contains 'runbook tracks preserved launcher state' 'launcher_old_preserved' "$runbook_text"
assert_contains 'runbook tracks published launcher state' 'launcher_new_published' "$runbook_text"
assert_contains 'runbook tracks preserved sudoers state' 'sudoers_old_preserved' "$runbook_text"
assert_contains 'runbook tracks published sudoers state' 'sudoers_new_published' "$runbook_text"
assert_contains 'runbook tracks completed activation state' 'activation_complete' "$runbook_text"
assert_contains 'runbook automatically invokes update rollback from cleanup' 'rollback_update || rollback_status=$?' "$runbook_text"
assert_contains 'runbook preserves failed control evidence' 'failed_control_dir' "$runbook_text"
assert_contains 'runbook restores previous control automatically' 'sudo mv -T -- "$rollback_control_dir" "$control_dir"' "$runbook_text"
assert_contains 'runbook restores previous launcher automatically' 'sudo mv -T -- "$launcher_rollback" "$launcher"' "$runbook_text"
assert_contains 'runbook restores previous sudoers automatically' 'sudo mv -T -- "$sudoers_rollback" "$sudoers_policy"' "$runbook_text"
assert_contains 'runbook reports rollback failure explicitly' 'ERROR: CONTROL_UPDATE automatic rollback failed' "$runbook_text"
assert_contains 'runbook validates live control before failed evidence fallback' 'elif verify_new_control; then' "$runbook_text"
assert_contains 'runbook preserves failed control with no-nesting copy' 'sudo cp -a -T -- "$control_dir" "$failed_control_dir"' "$runbook_text"
assert_contains 'runbook tracks live control moved aside' 'control_new_moved_aside' "$runbook_text"
assert_contains 'runbook reports recovery required when control restoration is unsafe' 'RECOVERY_REQUIRED' "$runbook_text"
assert_contains 'runbook validates libexec parent before staging' 'validate_privileged_parent "$libexec_parent"' "$runbook_text"
assert_contains 'runbook validates sbin parent before staging' 'validate_privileged_parent "$sbin_parent"' "$runbook_text"
assert_contains 'runbook validates sudoers parent before staging' 'validate_privileged_parent "$sudoers_parent"' "$runbook_text"
assert_absent 'runbook does not create libexec during control update' 'sudo install -d -o root -g root -m 0755 "$libexec_parent"' "$runbook_text"
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
assert_order 'runbook permanently disables the legacy timer only after verification' 'MINIO_BACKUP_VERIFY_COMPLETE' 'sudo systemctl disable --now pawtech-postgres-backup.timer' "$runbook_text"
assert_order 'runbook checks state directory before installing it' 'if sudo test -e "$state_dir" || sudo test -L "$state_dir"; then' 'sudo install -d -o yoryi -g yoryi -m 0700 "$state_dir"' "$runbook_text"
assert_order 'runbook marks activation complete after final validation' 'sudo visudo -cf /etc/sudoers' 'activation_complete=true' "$runbook_text"
assert_order 'runbook validates parents before creating update staging' 'validate_privileged_parent "$libexec_parent"' 'control_stage="$(sudo mktemp -d /usr/local/libexec/.buildingos-backup-preflight.update.XXXXXX)"' "$runbook_text"
assert_order 'runbook proves control absence before restoration move' 'sudo test ! -e "$control_dir" && sudo test ! -L "$control_dir"' 'sudo mv -T -- "$rollback_control_dir" "$control_dir"' "$runbook_text"
assert_order 'runbook marks control rollback preservation immediately after move' 'sudo mv -T -- "$control_dir" "$rollback_control_dir"' 'control_old_preserved=true' "$runbook_text"
assert_order 'runbook marks control publication immediately after move' 'sudo mv -T -- "$control_stage" "$control_dir"' 'control_new_published=true' "$runbook_text"
assert_order 'runbook marks launcher rollback preservation immediately after install' 'sudo install -o root -g root -m 0755 "$launcher" "$launcher_rollback"' 'launcher_old_preserved=true' "$runbook_text"
assert_order 'runbook marks launcher publication immediately after move' 'sudo mv -T -- "$launcher_stage" "$launcher"' 'launcher_new_published=true' "$runbook_text"
assert_order 'runbook marks sudoers rollback preservation immediately after install' 'sudo install -o root -g root -m 0440 "$sudoers_policy" "$sudoers_rollback"' 'sudoers_old_preserved=true' "$runbook_text"
assert_order 'runbook marks sudoers publication immediately after move' 'sudo mv -T -- "$sudoers_stage" "$sudoers_policy"' 'sudoers_new_published=true' "$runbook_text"

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s test(s) failed; %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
