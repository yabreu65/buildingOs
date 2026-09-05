#!/usr/bin/env bash
set -Eeuo pipefail
set +x

readonly DEFAULT_APP_DIR='/opt/pawtech/apps/buildingos/buildingos-app'
readonly POSTGRES_BACKUP_SERVICE='pawtech-postgres-backup.service'
readonly POSTGRES_BACKUP_TIMER='pawtech-postgres-backup.timer'
readonly OBJECT_BACKUP_SERVICE='pawtech-buildingos-object-backup.service'
readonly OBJECT_BACKUP_TIMER='pawtech-buildingos-object-backup.timer'
readonly OBJECT_BACKUP_EXEC='/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh'
readonly DEFAULT_OBJECT_BACKUP_ENV_FILE='/etc/buildingos/object-backup.env'
readonly OBJECT_BACKUP_RECEIPT='/var/lib/buildingos-object-backup/object-backup-receipt.json'
readonly OBJECT_BACKUP_RCLONE_CONFIG='/etc/buildingos/object-backup-rclone.conf'
readonly EXPECTED_TIMEOUT_USEC=21600000000

failures=0
POSTGRES_BACKUP_SERVICE_STATE='UNKNOWN'
OBJECT_BACKUP_SERVICE_STATE='UNKNOWN'

if ! declare -F endpoint_identity >/dev/null 2>&1; then
  helper_dir="${BASH_SOURCE[0]%/*}"
  [[ "$helper_dir" == "${BASH_SOURCE[0]}" ]] && helper_dir='.'
  source "$helper_dir/lib/endpoint-identity.sh"
fi

fail_check() {
  failures=$((failures + 1))
  printf 'ERROR: %s\n' "$1" >&2
}

safe_output() {
  local value="${1:-UNKNOWN}"
  if [[ "$value" =~ ^[A-Za-z0-9._:/+=?@%,-]+$ ]]; then
    printf '%s' "$value"
  else
    printf 'UNKNOWN'
  fi
}

file_is_regular_non_symlink() {
  [[ -f "$1" && ! -L "$1" ]]
}

env_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ {
      assignment=$0
      sub(/^[[:space:]]*/, "", assignment)
      name=assignment
      sub(/=.*/, "", name)
      if (name == key) {
        count++
        value=substr(assignment, length(name) + 2)
      }
      next
    }
    { invalid=1 }
    END {
      if (count != 1 || invalid || value !~ /[^[:space:]]/) exit 1
      print value
    }
  ' "$file"
}

systemctl_value() {
  local unit="$1"
  local property="$2"
  systemctl show "$unit" --property="$property" --value 2>/dev/null
}

unit_active_state() {
  local unit="$1"
  systemctl_value "$unit" ActiveState || true
}

systemd_exec_matches() {
  local actual="$1"
  local expected="$2"
  [[ "$actual" == "$expected" || "$actual" == "{ path=$expected ; argv[]=$expected ; ignore_errors=no }" ]]
}

systemd_timeout_matches() {
  local actual="$1"
  [[ "$actual" =~ ^[0-9]+$ && "$actual" == "$EXPECTED_TIMEOUT_USEC" ]]
}

inspect_service() {
  local label="$1"
  local unit="$2"
  local expected_exec="$3"
  local expected_env="$4"
  local state load_state user group env_files workdir exec_start timeout unit_type
  local exists='NO' contract='NO' running='NO' before
  before=$failures

  load_state="$(systemctl_value "$unit" LoadState || true)"
  state="$(unit_active_state "$unit")"
  [[ "$load_state" == loaded ]] && exists='YES' || fail_check "$unit is not loaded"

  case "$state" in
    inactive) ;;
    active|activating)
      running='YES'
      fail_check "$unit is active or activating"
      ;;
    failed|unknown|'')
      fail_check "$unit active state is unavailable or failed"
      ;;
    *)
      fail_check "$unit active state is ambiguous"
      ;;
  esac

  user="$(systemctl_value "$unit" User || true)"
  group="$(systemctl_value "$unit" Group || true)"
  env_files="$(systemctl_value "$unit" EnvironmentFiles || true)"
  workdir="$(systemctl_value "$unit" WorkingDirectory || true)"
  exec_start="$(systemctl_value "$unit" ExecStart || true)"
  timeout="$(systemctl_value "$unit" TimeoutStartUSec || true)"
  unit_type="$(systemctl_value "$unit" Type || true)"
  [[ "$user" == yoryi ]] || fail_check "$unit User is not yoryi"
  [[ "$group" == yoryi ]] || fail_check "$unit Group is not yoryi"
  [[ "$unit_type" == oneshot ]] || fail_check "$unit Type is not oneshot"
  [[ "$env_files" == "$expected_env" || "$env_files" == "-$expected_env" || "$env_files" == "$expected_env (ignore_errors=no)" || "$env_files" == "-$expected_env (ignore_errors=no)" ]] || fail_check "$unit EnvironmentFile is unexpected"
  [[ "$workdir" == "$DEFAULT_APP_DIR" ]] || fail_check "$unit WorkingDirectory is unexpected"
  systemd_exec_matches "$exec_start" "$expected_exec" || fail_check "$unit ExecStart is unexpected"
  systemd_timeout_matches "$timeout" || fail_check "$unit TimeoutStartSec is not 6h"

  if (( failures == before )); then contract='YES'; fi
  printf '%s_EXISTS=%s\n' "$label" "$exists"
  printf '%s_STATE=%s\n' "$label" "$(safe_output "$state")"
  printf '%s_CONTRACT=%s\n' "$label" "$contract"
  printf '%s_RUNNING=%s\n' "$label" "$running"
  if [[ "$unit" == "$POSTGRES_BACKUP_SERVICE" ]]; then
    POSTGRES_BACKUP_SERVICE_STATE="$state"
  else
    OBJECT_BACKUP_SERVICE_STATE="$state"
  fi
}

inspect_current_service_state() {
  local label="$1"
  local unit="$2"
  local load_state state exists='NO'

  load_state="$(systemctl_value "$unit" LoadState || true)"
  state="$(unit_active_state "$unit")"
  [[ "$load_state" == loaded ]] && exists='YES' || fail_check "$unit is not loaded"
  case "$state" in
    inactive) ;;
    active|activating) fail_check "$unit is active or activating" ;;
    failed|unknown|'') fail_check "$unit active state is unavailable or failed" ;;
    *) fail_check "$unit active state is ambiguous" ;;
  esac
  printf '%s_EXISTS=%s\n' "$label" "$exists"
  printf '%s_STATE=%s\n' "$label" "$(safe_output "$state")"
  if [[ "$unit" == "$POSTGRES_BACKUP_SERVICE" ]]; then
    POSTGRES_BACKUP_SERVICE_STATE="$state"
  else
    OBJECT_BACKUP_SERVICE_STATE="$state"
  fi
}

timer_has_future_trigger() {
  local trigger="$1"
  local trigger_epoch now_epoch
  [[ -n "$trigger" && "$trigger" != n/a && "$trigger" != '-' ]] || return 1
  trigger_epoch="$(date -u -d "$trigger" +%s 2>/dev/null || date -j -u -f '%Y-%m-%d %H:%M:%S %Z' "$trigger" +%s 2>/dev/null || true)"
  now_epoch="$(date -u +%s)"
  [[ "$trigger_epoch" =~ ^[0-9]+$ && "$trigger_epoch" -gt "$now_epoch" ]]
}

inspect_timer() {
  local label="$1"
  local unit="$2"
  local expected_unit="$3"
  local load_state unit_file_state active_state next_trigger
  local exists='NO' contract='NO' before
  before=$failures

  load_state="$(systemctl_value "$unit" LoadState || true)"
  unit_file_state="$(systemctl_value "$unit" UnitFileState || true)"
  active_state="$(unit_active_state "$unit")"
  next_trigger="$(systemctl_value "$unit" NextElapseUSecRealtime || true)"
  [[ "$load_state" == loaded ]] && exists='YES' || fail_check "$unit is not loaded"
  [[ "$unit_file_state" == enabled ]] || fail_check "$unit is not enabled"
  [[ "$active_state" == active ]] || fail_check "$unit is not active or waiting"
  [[ "$(systemctl_value "$unit" Unit || true)" == "$expected_unit" ]] || fail_check "$unit points to an unexpected service"
  timer_has_future_trigger "$next_trigger" || fail_check "$unit has no future trigger"

  if (( failures == before )); then contract='YES'; fi
  printf '%s_EXISTS=%s\n' "$label" "$exists"
  printf '%s_ENABLED=%s\n' "$label" "$([[ "$unit_file_state" == enabled ]] && printf YES || printf NO)"
  printf '%s_ACTIVE=%s\n' "$label" "$([[ "$active_state" == active ]] && printf YES || printf NO)"
  printf '%s_FUTURE_TRIGGER=%s\n' "$label" "$([[ "$next_trigger" != n/a && "$next_trigger" != '-' ]] && timer_has_future_trigger "$next_trigger" && printf YES || printf NO)"
  printf '%s_CONTRACT=%s\n' "$label" "$contract"
}

inspect_object_environment() {
  local source destination receipt rclone source_bucket destination_bucket
  local env_ok='NO'
  if ! file_is_regular_non_symlink "$OBJECT_BACKUP_ENV_FILE" || [[ ! -r "$OBJECT_BACKUP_ENV_FILE" ]]; then
    fail_check 'Object Storage environment is not a readable regular non-symlink file'
  else
    source="$(env_value "$OBJECT_BACKUP_ENV_FILE" OBJECT_BACKUP_SOURCE 2>/dev/null || true)"
    destination="$(env_value "$OBJECT_BACKUP_ENV_FILE" OBJECT_BACKUP_DESTINATION 2>/dev/null || true)"
    receipt="$(env_value "$OBJECT_BACKUP_ENV_FILE" OBJECT_BACKUP_RECEIPT 2>/dev/null || true)"
    rclone="$(env_value "$OBJECT_BACKUP_ENV_FILE" RCLONE_CONFIG 2>/dev/null || true)"
    if [[ "$source" =~ ^([A-Za-z0-9][A-Za-z0-9._-]*):([A-Za-z0-9][A-Za-z0-9._-]*)$ ]] &&
      [[ "$destination" =~ ^([A-Za-z0-9][A-Za-z0-9._-]*):([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
      source_bucket="${source#*:}"
      destination_bucket="${destination#*:}"
      [[ "$source_bucket" != "$destination_bucket" ]] || fail_check 'Object Storage source and destination buckets must differ'
    else
      fail_check 'Object Storage source or destination is not a safe remote bucket root'
    fi
    [[ "$receipt" == "$OBJECT_BACKUP_RECEIPT" ]] || fail_check 'Object Storage receipt path is unexpected'
    [[ "$rclone" == "$OBJECT_BACKUP_RCLONE_CONFIG" ]] || fail_check 'Object Storage rclone config path is unexpected'
    if (( failures == 0 )); then env_ok='YES'; fi
  fi
  printf 'OBJECT_BACKUP_ENV=%s\n' "$env_ok"
}

inspect_topology() {
  local before
  before=$failures
  inspect_current_service_state POSTGRES_BACKUP_SERVICE "$POSTGRES_BACKUP_SERVICE"
  inspect_timer POSTGRES_BACKUP_TIMER "$POSTGRES_BACKUP_TIMER" "$POSTGRES_BACKUP_SERVICE"
  [[ "$failures" -eq "$before" ]] && printf 'POSTGRES_BACKUP_TOPOLOGY=PASS\n' || printf 'POSTGRES_BACKUP_TOPOLOGY=FAIL\n'

  before=$failures
  inspect_service OBJECT_BACKUP_SERVICE "$OBJECT_BACKUP_SERVICE" "$OBJECT_BACKUP_EXEC" "$OBJECT_BACKUP_ENV_FILE"
  inspect_timer OBJECT_BACKUP_TIMER "$OBJECT_BACKUP_TIMER" "$OBJECT_BACKUP_SERVICE"
  [[ "$failures" -eq "$before" ]] && printf 'OBJECT_BACKUP_TOPOLOGY=PASS\n' || printf 'OBJECT_BACKUP_TOPOLOGY=FAIL\n'
}

inspect_concurrency() {
  local safe='YES'
  if [[ "$POSTGRES_BACKUP_SERVICE_STATE" == active || "$POSTGRES_BACKUP_SERVICE_STATE" == activating || "$OBJECT_BACKUP_SERVICE_STATE" == active || "$OBJECT_BACKUP_SERVICE_STATE" == activating ]]; then
    safe='NO'
  fi
  [[ "$safe" == YES ]] || fail_check 'a backup service is active or activating'
  printf 'BACKUP_CONCURRENCY_SAFE=%s\n' "$safe"
}

main() {
  local command_name missing_dependency=false
  local required_commands=(awk bash date systemctl)

  [[ $# -eq 1 ]] || { printf 'Usage: %s <candidate_sha>\n' "${0##*/}" >&2; return 64; }
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || { printf 'ERROR: candidate SHA is not exactly 40 lowercase hexadecimal characters\n' >&2; return 1; }
  readonly CANDIDATE_SHA="$1"

  OBJECT_BACKUP_ENV_FILE="$DEFAULT_OBJECT_BACKUP_ENV_FILE"
  if [[ "${BUILDINGOS_PREFLIGHT_TEST_MODE:-}" == LOCAL_ISOLATED_ONLY ]]; then
    OBJECT_BACKUP_ENV_FILE="${PREFLIGHT_ENV_FILE:?}"
  fi

  for command_name in "${required_commands[@]}"; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      missing_dependency=true
      fail_check "required dependency is missing: $command_name"
    fi
  done

  printf 'PRODUCTION_BACKUP_PREFLIGHT\nCANDIDATE_SHA=%s\n' "$CANDIDATE_SHA"
  if [[ "$missing_dependency" == true ]]; then
    printf 'DEPENDENCIES_READY=NO\nPOSTGRES_BACKUP_TOPOLOGY=FAIL\nOBJECT_BACKUP_TOPOLOGY=FAIL\nOBJECT_BACKUP_ENV=FAIL\nBACKUP_CONCURRENCY_SAFE=NO\n'
  else
    printf 'DEPENDENCIES_READY=YES\n'
    inspect_topology
    inspect_object_environment
    inspect_concurrency
  fi
  printf 'PRODUCTION_WRITES=0\nBACKUP_STARTED=NO\n'
  if (( failures == 0 )); then
    printf 'PREFLIGHT_STATUS=PASS\n'
    return 0
  fi
  printf 'PREFLIGHT_STATUS=FAIL\n'
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
