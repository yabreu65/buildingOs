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
readonly DEFAULT_OBJECT_BACKUP_RCLONE_CONFIG='/etc/buildingos/object-backup-rclone.conf'
readonly OBJECT_BACKUP_RECEIPT='/var/lib/buildingos-object-backup/object-backup-receipt.json'
readonly EXPECTED_TIMEOUT_USEC=21600000000
readonly TIMER_HORIZON_SECONDS=129600
readonly OBJECT_BACKUP_CALENDAR='*-*-* 02:15:00'
readonly OBJECT_BACKUP_RANDOMIZED_DELAY_USEC=900000000

failures=0
POSTGRES_BACKUP_SERVICE_STATE='UNKNOWN'
OBJECT_BACKUP_SERVICE_STATE='UNKNOWN'
EXPECTED_APP_DIR="$DEFAULT_APP_DIR"
OBJECT_BACKUP_ENV_FILE="$DEFAULT_OBJECT_BACKUP_ENV_FILE"
OBJECT_BACKUP_RCLONE_CONFIG="$DEFAULT_OBJECT_BACKUP_RCLONE_CONFIG"

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

file_mode() {
  stat -L -c '%a' -- "$1" 2>/dev/null || stat -L -f '%Lp' "$1"
}

file_owner() {
  stat -L -c '%U' -- "$1" 2>/dev/null || stat -L -f '%Su' "$1"
}

file_group() {
  stat -L -c '%G' -- "$1" 2>/dev/null || stat -L -f '%Sg' "$1"
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

systemd_timers_calendar() {
  systemctl show "$1" --property=TimersCalendar --value 2>/dev/null
}

unit_active_state() {
  local unit="$1"
  systemctl_value "$unit" ActiveState || true
}

systemd_serialized_entry_matches() {
  local entry="$1"
  local expected_exec="$2"
  local expected_argv="$3"
  local parsed

  parsed="$(printf '%s\n' "$entry" | awk -F ';' '
    function trim(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      return value
    }
    {
      path_count=0
      argv_count=0
      ignore_count=0
      invalid=0
      path=""
      argv=""
      for (i=1; i<=NF; i++) {
        field=trim($i)
        if (field == "") continue
        if (field ~ /^path=/) {
          path_count++
          path=substr(field, 6)
        } else if (field ~ /^argv\[\]=/) {
          argv_count++
          argv=substr(field, 8)
        } else if (field ~ /^ignore_errors=/) {
          ignore_count++
          if (substr(field, 15) != "no") invalid=1
        } else if (field ~ /^(start_time|stop_time|pid|code|status)=/) {
          continue
        } else {
          invalid=1
        }
      }
      if (path_count == 1 && argv_count == 1 && ignore_count == 1 && invalid == 0) {
        printf "%s\034%s\n", path, argv
      } else {
        exit 1
      }
    }
  ' )" || return 1
  [[ "$parsed" == "$expected_exec"$'\034'"$expected_argv" ]]
}

systemd_command_list_matches() {
  local raw="$1"
  local expected_exec="$2"
  local expected_argv="${3:-$expected_exec}"
  local rest entry tail count=0 trimmed

  trimmed="$raw"
  trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
  [[ -n "$trimmed" ]] || { [[ -z "$expected_exec" ]]; return; }
  [[ -n "$expected_exec" ]] || return 1
  [[ "$trimmed" == *'{'* && "$trimmed" == *'}'* && "$trimmed" == *'path='* && "$trimmed" == *'argv[]='* ]] || return 1
  rest="$trimmed"
  while :; do
    rest="${rest#"${rest%%[![:space:]]*}"}"
    [[ "${rest:0:1}" == '{' ]] || return 1
    rest="${rest:1}"
    [[ "$rest" == *'}'* ]] || return 1
    entry="${rest%%\}*}"
    tail="${rest#*\}}"
    systemd_serialized_entry_matches "$entry" "$expected_exec" "$expected_argv" || return 1
    count=$((count + 1))
    rest="$tail"
    trimmed="$rest"
    trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    [[ -z "$trimmed" ]] && break
  done
  [[ "$count" -eq 1 && -n "$expected_exec" ]]
}

systemd_exec_matches() {
  local actual="$1"
  local expected="$2"
  systemd_command_list_matches "$actual" "$expected" "$expected"
}

systemd_no_command_list_matches() {
  systemd_command_list_matches "$1" '' ''
}

systemd_timeout_matches() {
  local actual="$1"
  local microseconds
  [[ -n "$actual" && "$actual" != infinity && "$actual" != inf ]] || return 1
  if [[ "$actual" =~ ^[0-9]+$ ]]; then
    microseconds="$actual"
  elif [[ "$actual" =~ ^([0-9]+)h$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 3600000000))
  elif [[ "$actual" =~ ^([0-9]+)min$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 60000000))
  elif [[ "$actual" =~ ^([0-9]+)s$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 1000000))
  elif [[ "$actual" =~ ^([0-9]+)us$ ]]; then
    microseconds="${BASH_REMATCH[1]}"
  elif [[ "$actual" =~ ^([0-9]+)h[[:space:]]+([0-9]+)min[[:space:]]+([0-9]+)s$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 3600000000 + BASH_REMATCH[2] * 60000000 + BASH_REMATCH[3] * 1000000))
  elif [[ "$actual" =~ ^([0-9]+)h[[:space:]]+([0-9]+)min[[:space:]]+([0-9]+)s[[:space:]]*$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 3600000000 + BASH_REMATCH[2] * 60000000 + BASH_REMATCH[3] * 1000000))
  else
    return 1
  fi
  [[ "$microseconds" == "$EXPECTED_TIMEOUT_USEC" ]]
}

systemd_delay_matches() {
  local actual="$1"
  local microseconds
  [[ -n "$actual" && "$actual" != infinity && "$actual" != inf ]] || return 1
  if [[ "$actual" =~ ^[0-9]+$ ]]; then
    microseconds="$actual"
  elif [[ "$actual" =~ ^([0-9]+)m$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 60000000))
  elif [[ "$actual" =~ ^([0-9]+)min$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 60000000))
  elif [[ "$actual" =~ ^([0-9]+)s$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 1000000))
  elif [[ "$actual" =~ ^([0-9]+)us$ ]]; then
    microseconds="${BASH_REMATCH[1]}"
  elif [[ "$actual" =~ ^([0-9]+)min[[:space:]]+([0-9]+)s$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 60000000 + BASH_REMATCH[2] * 1000000))
  elif [[ "$actual" =~ ^([0-9]+)h[[:space:]]+([0-9]+)min[[:space:]]+([0-9]+)s$ ]]; then
    microseconds=$((BASH_REMATCH[1] * 3600000000 + BASH_REMATCH[2] * 60000000 + BASH_REMATCH[3] * 1000000))
  else
    return 1
  fi
  [[ "$microseconds" == "$OBJECT_BACKUP_RANDOMIZED_DELAY_USEC" ]]
}

systemd_calendar_matches() {
  local actual="$1"
  local expected="$2"
  local calendar
  calendar="$(systemd_timers_calendar_value "$actual")" || return 1
  [[ "$calendar" == "$expected" ]]
}

systemd_timers_calendar_value() {
  local actual="$1"
  local inner calendar
  actual="${actual#"${actual%%[![:space:]]*}"}"
  actual="${actual%"${actual##*[![:space:]]}"}"
  if [[ "$actual" == \{*\} ]]; then
    inner="${actual#\{}"
    inner="${inner%\}}"
    calendar="$(printf '%s\n' "$inner" | awk -F ';' '
      function trim(value) {
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]+$/, "", value)
        return value
      }
      {
        calendar_count=0
        invalid=0
        value=""
        for (i=1; i<=NF; i++) {
          field=trim($i)
          if (field == "") continue
          if (field ~ /^OnCalendar=/) {
            calendar_count++
            value=substr(field, 12)
          } else if (field ~ /^next_elapse(_realtime)?=/) {
            continue
          } else {
            invalid=1
          }
        }
        if (calendar_count != 1 || invalid || value !~ /[^[:space:]]/) exit 1
        print value
      }
    ')" || return 1
  else
    [[ "$actual" != *'='* ]] || return 1
    calendar="$actual"
  fi
  calendar="${calendar#"${calendar%%[![:space:]]*}"}"
  calendar="${calendar%"${calendar##*[![:space:]]}"}"
  [[ -n "$calendar" ]] || return 1
  printf '%s' "$calendar"
}

systemd_daily_calendar_present() {
  local actual="$1"
  local calendar
  calendar="$(systemd_timers_calendar_value "$actual")" || return 1
  [[ "$calendar" == daily || "$calendar" == *'*-*-*'* ]]
}

inspect_runtime() {
  local production_sha='UNKNOWN' api_revision='UNKNOWN' web_revision='UNKNOWN' checkout_status='DIRTY'
  local api_image web_image status_output

  if [[ -d "$EXPECTED_APP_DIR/.git" && ! -L "$EXPECTED_APP_DIR/.git" ]] && command -v git >/dev/null 2>&1; then
    production_sha="$(git --no-optional-locks -C "$EXPECTED_APP_DIR" rev-parse HEAD 2>/dev/null || printf 'UNKNOWN')"
    if [[ "$production_sha" =~ ^[0-9a-f]{40}$ ]] && status_output="$(git --no-optional-locks -C "$EXPECTED_APP_DIR" status --porcelain --untracked-files=all 2>/dev/null)"; then
      [[ -z "$status_output" ]] && checkout_status='CLEAN'
    fi
  fi
  if command -v docker >/dev/null 2>&1; then
    api_image="$(docker inspect --type container --format '{{.Image}}' buildingos-api 2>/dev/null || true)"
    web_image="$(docker inspect --type container --format '{{.Image}}' buildingos-web 2>/dev/null || true)"
    [[ "$api_image" =~ ^sha256:[0-9a-f]{64}$ ]] && api_revision="$(docker image inspect "$api_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || printf 'UNKNOWN')"
    [[ "$web_image" =~ ^sha256:[0-9a-f]{64}$ ]] && web_revision="$(docker image inspect "$web_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || printf 'UNKNOWN')"
  fi
  printf 'PRODUCTION_RUNTIME_SHA=%s\n' "$(safe_output "$production_sha")"
  printf 'API_REVISION=%s\n' "$(safe_output "$api_revision")"
  printf 'WEB_REVISION=%s\n' "$(safe_output "$web_revision")"
  printf 'PRODUCTION_CHECKOUT_STATUS=%s\n' "$checkout_status"
  if [[ "$production_sha" == "$CANDIDATE_SHA" && "$api_revision" == "$CANDIDATE_SHA" && "$web_revision" == "$CANDIDATE_SHA" && "$checkout_status" == CLEAN ]]; then
    printf 'RUNTIME_IDENTITY=CONSISTENT\n'
  else
    printf 'RUNTIME_IDENTITY=INCONSISTENT\n'
    fail_check 'production runtime identity is not the expected clean, matching revision'
  fi
}

inspect_auxiliary_commands() {
  local label="$1"
  local unit="$2"
  local condition pre post
  local condition_available='YES' pre_available='YES' post_available='YES'
  local condition_empty='NO' pre_empty='NO' post_empty='NO'

  if ! condition="$(systemctl_value "$unit" ExecCondition)"; then
    condition_available='NO'
    fail_check "$unit ExecCondition is unavailable"
  fi
  if ! pre="$(systemctl_value "$unit" ExecStartPre)"; then
    pre_available='NO'
    fail_check "$unit ExecStartPre is unavailable"
  fi
  if ! post="$(systemctl_value "$unit" ExecStartPost)"; then
    post_available='NO'
    fail_check "$unit ExecStartPost is unavailable"
  fi

  if [[ "$condition_available" == YES ]] && systemd_no_command_list_matches "$condition"; then
    condition_empty='YES'
  else
    fail_check "$unit ExecCondition is not empty"
  fi
  if [[ "$pre_available" == YES ]] && systemd_no_command_list_matches "$pre"; then
    pre_empty='YES'
  else
    fail_check "$unit ExecStartPre is not empty"
  fi
  if [[ "$post_available" == YES ]] && systemd_no_command_list_matches "$post"; then
    post_empty='YES'
  else
    fail_check "$unit ExecStartPost is not empty"
  fi

  printf '%s_EXEC_CONDITION_EMPTY=%s\n' "$label" "$condition_empty"
  printf '%s_EXEC_START_PRE_EMPTY=%s\n' "$label" "$pre_empty"
  printf '%s_EXEC_START_POST_EMPTY=%s\n' "$label" "$post_empty"
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
  [[ "$workdir" == "$EXPECTED_APP_DIR" ]] || fail_check "$unit WorkingDirectory is unexpected"
  systemd_exec_matches "$exec_start" "$expected_exec" || fail_check "$unit ExecStart is unexpected"
  systemd_timeout_matches "$timeout" || fail_check "$unit TimeoutStartSec is not 6h"
  inspect_auxiliary_commands "$label" "$unit"

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
  local expected_exec="$3"
  local load_state state unit_type exec_start exists='NO' contract='NO' before
  before=$failures

  load_state="$(systemctl_value "$unit" LoadState || true)"
  state="$(unit_active_state "$unit")"
  unit_type="$(systemctl_value "$unit" Type || true)"
  exec_start="$(systemctl_value "$unit" ExecStart || true)"
  [[ "$load_state" == loaded ]] && exists='YES' || fail_check "$unit is not loaded"
  case "$state" in
    inactive) ;;
    active|activating) fail_check "$unit is active or activating" ;;
    failed|unknown|'') fail_check "$unit active state is unavailable or failed" ;;
    *) fail_check "$unit active state is ambiguous" ;;
  esac
  [[ "$unit_type" == oneshot ]] || fail_check "$unit Type is not oneshot"
  systemd_exec_matches "$exec_start" "$expected_exec" || fail_check "$unit ExecStart is unexpected"
  inspect_auxiliary_commands "$label" "$unit"
  (( failures == before )) && contract='YES'
  printf '%s_EXISTS=%s\n' "$label" "$exists"
  printf '%s_STATE=%s\n' "$label" "$(safe_output "$state")"
  printf '%s_TYPE=%s\n' "$label" "$(safe_output "$unit_type")"
  printf '%s_EXECSTART_MATCH=%s\n' "$label" "$([[ "$contract" == YES ]] && printf YES || printf NO)"
  printf '%s_CONTRACT=%s\n' "$label" "$contract"
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
  [[ "$trigger_epoch" =~ ^[0-9]+$ && "$trigger_epoch" -gt "$now_epoch" && $((trigger_epoch - now_epoch)) -le "$TIMER_HORIZON_SECONDS" ]]
}

inspect_timer() {
  local label="$1"
  local unit="$2"
  local expected_unit="$3"
  local expected_calendar="${4:-}"
  local load_state unit_file_state active_state next_trigger calendar persistent randomized
  local exists='NO' contract='NO' before
  before=$failures

  load_state="$(systemctl_value "$unit" LoadState || true)"
  unit_file_state="$(systemctl_value "$unit" UnitFileState || true)"
  active_state="$(unit_active_state "$unit")"
  next_trigger="$(systemctl_value "$unit" NextElapseUSecRealtime || true)"
  calendar="$(systemd_timers_calendar "$unit" || true)"
  persistent="$(systemctl_value "$unit" Persistent || true)"
  randomized="$(systemctl_value "$unit" RandomizedDelayUSec || true)"
  [[ "$load_state" == loaded ]] && exists='YES' || fail_check "$unit is not loaded"
  [[ "$unit_file_state" == enabled ]] || fail_check "$unit is not enabled"
  [[ "$active_state" == active ]] || fail_check "$unit is not active or waiting"
  [[ "$(systemctl_value "$unit" Unit || true)" == "$expected_unit" ]] || fail_check "$unit points to an unexpected service"
  if [[ -n "$expected_calendar" ]]; then
    systemd_calendar_matches "$calendar" "$expected_calendar" || fail_check "$unit calendar is unexpected"
    [[ "$persistent" == yes || "$persistent" == true ]] || fail_check "$unit is not persistent"
    systemd_delay_matches "$randomized" || fail_check "$unit randomized delay is not 15 minutes"
  else
    systemd_daily_calendar_present "$calendar" || fail_check "$unit calendar is not a daily schedule"
  fi
  timer_has_future_trigger "$next_trigger" || fail_check "$unit has no future trigger"

  if (( failures == before )); then contract='YES'; fi
  printf '%s_EXISTS=%s\n' "$label" "$exists"
  printf '%s_ENABLED=%s\n' "$label" "$([[ "$unit_file_state" == enabled ]] && printf YES || printf NO)"
  printf '%s_ACTIVE=%s\n' "$label" "$([[ "$active_state" == active ]] && printf YES || printf NO)"
  printf '%s_FUTURE_TRIGGER=%s\n' "$label" "$([[ "$next_trigger" != n/a && "$next_trigger" != '-' ]] && timer_has_future_trigger "$next_trigger" && printf YES || printf NO)"
  printf '%s_CALENDAR_MATCH=%s\n' "$label" "$([[ -n "$expected_calendar" ]] && systemd_calendar_matches "$calendar" "$expected_calendar" && printf YES || [[ -z "$expected_calendar" ]] && systemd_daily_calendar_present "$calendar" && printf YES || printf NO)"
  printf '%s_PERSISTENT=%s\n' "$label" "$([[ "$persistent" == yes || "$persistent" == true ]] && printf YES || printf NO)"
  printf '%s_RANDOMIZED_DELAY_MATCH=%s\n' "$label" "$([[ -n "$expected_calendar" ]] && systemd_delay_matches "$randomized" && printf YES || printf NOT_REQUIRED)"
  printf '%s_CONTRACT=%s\n' "$label" "$contract"
}

inspect_object_environment() {
  local source destination receipt rclone source_bucket destination_bucket
  local env_ok='NO' env_owner env_group env_mode config_mode before=$failures
  if ! file_is_regular_non_symlink "$OBJECT_BACKUP_ENV_FILE" || [[ ! -r "$OBJECT_BACKUP_ENV_FILE" ]]; then
    fail_check 'Object Storage environment is not a readable regular non-symlink file'
  else
    env_owner="$(file_owner "$OBJECT_BACKUP_ENV_FILE")"
    env_group="$(file_group "$OBJECT_BACKUP_ENV_FILE")"
    env_mode="0$(file_mode "$OBJECT_BACKUP_ENV_FILE")"
    [[ "$env_owner" == root ]] || fail_check 'Object Storage environment owner is not root'
    [[ "$env_group" == root ]] || fail_check 'Object Storage environment group is not root'
    [[ "$env_mode" == 0600 ]] || fail_check 'Object Storage environment mode is not 0600'
    source="$(env_value "$OBJECT_BACKUP_ENV_FILE" OBJECT_BACKUP_SOURCE 2>/dev/null || true)"
    destination="$(env_value "$OBJECT_BACKUP_ENV_FILE" OBJECT_BACKUP_DESTINATION 2>/dev/null || true)"
    receipt="$(env_value "$OBJECT_BACKUP_ENV_FILE" OBJECT_BACKUP_RECEIPT 2>/dev/null || true)"
    rclone="$(env_value "$OBJECT_BACKUP_ENV_FILE" RCLONE_CONFIG 2>/dev/null || true)"
    if [[ "$source" =~ ^([A-Za-z0-9][A-Za-z0-9._-]*):([A-Za-z0-9][A-Za-z0-9._-]*)$ ]] &&
      [[ "$destination" =~ ^([A-Za-z0-9][A-Za-z0-9._-]*):([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
      source_bucket="${source#*:}"
      destination_bucket="${destination#*:}"
      [[ "$source_bucket" == buildingos-production ]] || fail_check 'Object Storage source bucket is not authoritative'
      [[ "$source_bucket" != "$destination_bucket" ]] || fail_check 'Object Storage source and destination buckets must differ'
    else
      fail_check 'Object Storage source or destination is not a safe remote bucket root'
    fi
    [[ "$receipt" == "$OBJECT_BACKUP_RECEIPT" ]] || fail_check 'Object Storage receipt path is unexpected'
    [[ "$rclone" == "$OBJECT_BACKUP_RCLONE_CONFIG" ]] || fail_check 'Object Storage rclone config path is unexpected'
    if file_is_regular_non_symlink "$rclone" && [[ -r "$rclone" ]]; then
      local config_owner config_group
      config_owner="$(file_owner "$rclone")"
      config_group="$(file_group "$rclone")"
      config_mode="0$(file_mode "$rclone")"
      (( (8#${config_mode#0} & 004) == 0 )) || fail_check 'Object Storage rclone config is world-readable'
      (( (8#${config_mode#0} & 0022) == 0 )) || fail_check 'Object Storage rclone config is writable by group or world'
      if ! { [[ "$config_owner" == yoryi ]] && (( (8#${config_mode#0} & 0400) != 0 )); } &&
        ! { [[ "$config_group" == yoryi ]] && (( (8#${config_mode#0} & 0040) != 0 )); }; then
        fail_check 'Object Storage rclone config is not readable by yoryi'
      fi
    else
      fail_check 'Object Storage rclone config is not a readable regular non-symlink file'
    fi
    if (( failures == before )); then env_ok='YES'; fi
  fi
  printf 'OBJECT_BACKUP_ENV=%s\n' "$env_ok"
}

inspect_topology() {
  local before
  before=$failures
  before=$failures
  inspect_current_service_state POSTGRES_BACKUP_SERVICE "$POSTGRES_BACKUP_SERVICE" '/opt/pawtech/backups/scripts/backup-postgres.sh'
  inspect_timer POSTGRES_BACKUP_TIMER "$POSTGRES_BACKUP_TIMER" "$POSTGRES_BACKUP_SERVICE"
  [[ "$failures" -eq "$before" ]] && printf 'POSTGRES_BACKUP_TOPOLOGY=PASS\n' || printf 'POSTGRES_BACKUP_TOPOLOGY=FAIL\n'

  before=$failures
  inspect_service OBJECT_BACKUP_SERVICE "$OBJECT_BACKUP_SERVICE" "$OBJECT_BACKUP_EXEC" "$OBJECT_BACKUP_ENV_FILE"
  inspect_timer OBJECT_BACKUP_TIMER "$OBJECT_BACKUP_TIMER" "$OBJECT_BACKUP_SERVICE" "$OBJECT_BACKUP_CALENDAR"
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
  local required_commands=(awk bash date docker git stat systemctl)
  local runtime_app_dir

  [[ $# -eq 1 ]] || { printf 'Usage: %s <candidate_sha>\n' "${0##*/}" >&2; return 64; }
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || { printf 'ERROR: candidate SHA is not exactly 40 lowercase hexadecimal characters\n' >&2; return 1; }
  readonly CANDIDATE_SHA="$1"

  OBJECT_BACKUP_ENV_FILE="$DEFAULT_OBJECT_BACKUP_ENV_FILE"
  OBJECT_BACKUP_RCLONE_CONFIG="$DEFAULT_OBJECT_BACKUP_RCLONE_CONFIG"
  EXPECTED_APP_DIR="$DEFAULT_APP_DIR"
  if [[ "${BUILDINGOS_PREFLIGHT_TEST_MODE:-}" == LOCAL_ISOLATED_ONLY ]]; then
    EXPECTED_APP_DIR="${PREFLIGHT_APP_DIR:?}"
    OBJECT_BACKUP_ENV_FILE="${PREFLIGHT_ENV_FILE:?}"
    OBJECT_BACKUP_RCLONE_CONFIG="${PREFLIGHT_RCLONE_CONFIG_FILE:?}"
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
    inspect_runtime
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
