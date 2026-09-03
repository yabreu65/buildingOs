#!/usr/bin/env bash
set -Eeuo pipefail
set +x

readonly EXPECTED_RUNTIME_SHA='db82d3d37fc6184a6d4063709b9a15b923371695'
readonly DEFAULT_APP_DIR='/opt/pawtech/apps/buildingos/buildingos-app'
readonly EXPECTED_BACKUP_SERVICE='pawtech-buildingos-backup.service'
readonly EXPECTED_VERIFY_SERVICE='pawtech-buildingos-backup-verify.service'
readonly EXPECTED_LEGACY_BACKUP_SERVICE='pawtech-postgres-backup.service'
readonly EXPECTED_LEGACY_BACKUP_TIMER='pawtech-postgres-backup.timer'
readonly EXPECTED_BACKUP_ENTRYPOINT='/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh'
readonly DEFAULT_ENV_FILE='/etc/buildingos/buildingos-backup.env'
readonly DEFAULT_SSE_FILE='/etc/buildingos/contabo-sse-s3-capability.json'
readonly DEFAULT_STATE_DIR='/var/lib/buildingos-backup'
readonly EXPECTED_SOURCE_HOST='usc1.contabostorage.com'
readonly EXPECTED_SOURCE_BUCKET='buildingos-production'
readonly EXPECTED_PROPOSED_COMMAND='sudo systemctl start pawtech-buildingos-backup.service'
readonly POSTGRES_BACKUP_MIN_SAFETY_MARGIN_BYTES=104857600
readonly MAX_INT64_DIV_1024=9007199254740991
readonly MAX_POSTGRES_ESTIMATE_BASE_BYTES=6000000000000000000

failures=0

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

file_owner() {
  stat -L -c '%U' -- "$1" 2>/dev/null || stat -L -f '%Su' "$1"
}

file_group() {
  stat -L -c '%G' -- "$1" 2>/dev/null || stat -L -f '%Sg' "$1"
}

file_mode() {
  stat -L -c '%a' -- "$1" 2>/dev/null || stat -L -f '%Lp' "$1"
}

file_is_regular_non_symlink() {
  [[ -f "$1" && ! -L "$1" ]]
}

directory_is_regular_non_symlink() {
  [[ -d "$1" && ! -L "$1" ]]
}

endpoint_identity() {
  local value="$1" scheme authority default_port host port
  if [[ "$value" =~ ^([A-Za-z][A-Za-z0-9+.-]*)://([^/]+) ]]; then
    scheme="${BASH_REMATCH[1],,}"
    authority="${BASH_REMATCH[2]}"
  else
    scheme='https'
    authority="${value%%/*}"
  fi
  case "$scheme" in
    https) default_port=443 ;;
    http) default_port=80 ;;
    *) return 1 ;;
  esac
  [[ "$authority" =~ ^([A-Za-z0-9.-]+)(:([0-9]+))?$ ]] || return 1
  host="${BASH_REMATCH[1],,}"
  port="${BASH_REMATCH[3]:-$default_port}"
  printf '%s:%s\n' "$host" "$port"
}

endpoint_hostname() {
  local authority
  authority="$(endpoint_identity "$1")"
  authority="${authority##*@}"
  authority="${authority%%:*}"
  [[ "$authority" =~ ^[A-Za-z0-9.-]+$ ]] || return 1
  printf '%s\n' "$authority"
}

env_value() {
  local file="$1"
  local key="$2"
  awk -F '=' -v key="$key" '$1 == key { value=substr($0, index($0, "=") + 1); count++; } END { if (count != 1) exit 1; print value }' "$file"
}

env_name_present() {
  local file="$1"
  local key="$2"
  awk -F '=' -v key="$key" '$1 == key { count++; if (length(substr($0, index($0, "=") + 1)) == 0) empty=1; } END { exit count == 1 && !empty ? 0 : 1 }' "$file"
}

systemctl_value() {
  local unit="$1"
  local property="$2"
  systemctl show "$unit" --property="$property" --value 2>/dev/null
}

unit_active_state() {
  local unit="$1"
  systemctl is-active "$unit" 2>/dev/null || true
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
        } else if (field ~ /^(ignore_errors|start_time|stop_time|pid|code|status)=/) {
          continue
        } else {
          invalid=1
        }
      }
      if (path_count == 1 && argv_count == 1 && invalid == 0) {
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
  local rest entry tail count=0
  local trimmed

  trimmed="$raw"
  trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
  if [[ -z "$trimmed" ]]; then
    [[ -z "$expected_exec" ]]
    return
  fi
  if [[ "$trimmed" != *'{'* && "$trimmed" != *'}'* && "$trimmed" != *'path='* && "$trimmed" != *'argv[]='* ]]; then
    [[ -n "$expected_exec" && "$trimmed" == "$expected_argv" && "$trimmed" != *$'\n'* ]]
    return
  fi

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

inspect_unit() {
  local label="$1"
  local unit="$2"
  local expected_exec="$3"
  local expected_env="$4"
  local expected_user="$5"
  local expected_workdir="$6"
  local require_verify_arg="$7"
  local load_state active_state user exec_start exec_start_pre exec_start_post env_files workdir restart unit_type expected_argv
  local exists='NO' active='UNKNOWN' exec_match='NO' exec_pre_match='NO' exec_post_match='NO' env_match='NO'

  if ! systemctl cat "$unit" >/dev/null 2>&1; then
    printf '%s_EXISTS=NO\n' "$label"
    printf '%s_USER=UNKNOWN\n' "$label"
  printf '%s_EXECSTART_MATCH=NO\n' "$label"
    printf '%s_EXECSTARTPRE_MATCH=NO\n' "$label"
    printf '%s_EXECSTARTPOST_MATCH=NO\n' "$label"
    printf '%s_ENV_FILE_MATCH=NO\n' "$label"
    printf '%s_ACTIVE=UNKNOWN\n' "$label"
    fail_check "$unit is unavailable"
    return
  fi

  load_state="$(systemctl_value "$unit" LoadState || true)"
  active_state="$(systemctl_value "$unit" ActiveState || true)"
  user="$(systemctl_value "$unit" User || true)"
  exec_start_pre="$(systemctl_value "$unit" ExecStartPre || true)"
  exec_start="$(systemctl_value "$unit" ExecStart || true)"
  exec_start_post="$(systemctl_value "$unit" ExecStartPost || true)"
  env_files="$(systemctl_value "$unit" EnvironmentFiles || true)"
  workdir="$(systemctl_value "$unit" WorkingDirectory || true)"
  restart="$(systemctl_value "$unit" Restart || true)"
  unit_type="$(systemctl_value "$unit" Type || true)"

  if [[ "$load_state" == loaded ]]; then
    exists='YES'
  else
    fail_check "$unit is not loaded"
  fi
  if [[ "$active_state" == active ]] || [[ "$(unit_active_state "$unit")" == active ]]; then
    active='YES'
    fail_check "$unit is active"
  elif [[ "$active_state" == inactive || "$active_state" == failed || "$active_state" == dead ]]; then
    active='NO'
    [[ "$active_state" == failed ]] && fail_check "$unit is failed"
  else
    fail_check "$unit active state is unavailable"
  fi
  if [[ "$user" == "$expected_user" ]]; then
    :
  else
    fail_check "$unit user is not $expected_user"
  fi
  expected_argv="$expected_exec"
  [[ "$require_verify_arg" == true ]] && expected_argv+=' --verify-latest'
  systemd_command_list_matches "$exec_start" "$expected_exec" "$expected_argv" && exec_match='YES'
  if [[ "$exec_match" != YES ]]; then
    fail_check "$unit ExecStart is not the trusted read-only contract"
  fi
  systemd_command_list_matches "$exec_start_pre" '' && exec_pre_match='YES'
  if [[ "$exec_pre_match" != YES ]]; then
    fail_check "$unit has an unexpected ExecStartPre command"
  fi
  systemd_command_list_matches "$exec_start_post" '' && exec_post_match='YES'
  if [[ "$exec_post_match" != YES ]]; then
    fail_check "$unit has an unexpected ExecStartPost command"
  fi
  if [[ "$env_files" == "$expected_env" || "$env_files" == "-$expected_env" || "$env_files" == "$expected_env (ignore_errors=no)" || "$env_files" == "-$expected_env (ignore_errors=no)" ]]; then
    env_match='YES'
  else
    fail_check "$unit EnvironmentFile is not the protected backup environment"
  fi
  [[ "$workdir" == "$EXPECTED_APP_DIR" ]] || fail_check "$unit WorkingDirectory is unexpected"
  [[ "$restart" == '' || "$restart" == 'no' ]] || fail_check "$unit has an unexpected restart policy"
  [[ "$unit_type" == 'oneshot' ]] || fail_check "$unit is not a oneshot service"

  printf '%s_EXISTS=%s\n' "$label" "$exists"
  printf '%s_USER=%s\n' "$label" "$(safe_output "$user")"
  printf '%s_EXECSTART_MATCH=%s\n' "$label" "$exec_match"
  printf '%s_EXECSTARTPRE_MATCH=%s\n' "$label" "$exec_pre_match"
  printf '%s_EXECSTARTPOST_MATCH=%s\n' "$label" "$exec_post_match"
  printf '%s_ENV_FILE_MATCH=%s\n' "$label" "$env_match"
  printf '%s_ACTIVE=%s\n' "$label" "$active"
}

inspect_regular_file() {
  local label="$1"
  local file="$2"
  local expected_owner="$3"
  local expected_group="$4"
  local expected_mode="$5"
  local owner group mode

  if ! file_is_regular_non_symlink "$file"; then
    fail_check "$label is not a regular non-symlink file"
    return 1
  fi
  owner="$(file_owner "$file")"
  group="$(file_group "$file")"
  mode="0$(file_mode "$file")"
  [[ "$owner" == "$expected_owner" ]] || fail_check "$label owner is unexpected"
  [[ "$group" == "$expected_group" ]] || fail_check "$label group is unexpected"
  [[ "$mode" == "$expected_mode" ]] || fail_check "$label mode is unexpected"
  return 0
}

inspect_runtime() {
  local production_sha='UNKNOWN' api_revision='UNKNOWN' web_revision='UNKNOWN' checkout_status='DIRTY'
  local api_image web_image

  if [[ -d "$EXPECTED_APP_DIR/.git" && ! -L "$EXPECTED_APP_DIR/.git" ]] && command -v git >/dev/null 2>&1; then
    production_sha="$(git --no-optional-locks -C "$EXPECTED_APP_DIR" rev-parse HEAD 2>/dev/null || printf 'UNKNOWN')"
    if [[ "$production_sha" =~ ^[0-9a-f]{40}$ ]] && git --no-optional-locks -C "$EXPECTED_APP_DIR" status --porcelain --untracked-files=all >/dev/null 2>&1; then
      if [[ -z "$(git --no-optional-locks -C "$EXPECTED_APP_DIR" status --porcelain --untracked-files=all 2>/dev/null)" ]]; then
        checkout_status='CLEAN'
      fi
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
  if [[ "$production_sha" == "$EXPECTED_RUNTIME_SHA" && "$api_revision" == "$EXPECTED_RUNTIME_SHA" && "$web_revision" == "$EXPECTED_RUNTIME_SHA" && "$checkout_status" == CLEAN ]]; then
    printf 'RUNTIME_IDENTITY=CONSISTENT\n'
  else
    printf 'RUNTIME_IDENTITY=INCONSISTENT\n'
    fail_check 'production runtime identity is not the expected clean, matching revision'
  fi
}

inspect_scripts() {
  local script_name scripts_ok=true
  local required_scripts=(
    backup-buildingos-production.sh backup-postgres-paired.sh backup-minio.sh
    verify-minio-backup.sh validate-sse-capability.sh resolve-production-app-sha.sh
    check-production-backup-freshness.sh
  )
  for script_name in "${required_scripts[@]}"; do
    if ! file_is_regular_non_symlink "$EXPECTED_APP_DIR/scripts/$script_name" || [[ ! -x "$EXPECTED_APP_DIR/scripts/$script_name" ]]; then
      scripts_ok=false
      fail_check "required backup script is missing, non-executable, or unsafe: $script_name"
    fi
  done
  if [[ "$scripts_ok" == true ]]; then
    printf 'REQUIRED_SCRIPTS_PRESENT=YES\n'
  else
    printf 'REQUIRED_SCRIPTS_PRESENT=NO\n'
  fi
}

inspect_environment() {
  local env_ok=false owner group mode
  local source_environment expected_source_environment source_endpoint source_bucket backup_endpoint backup_bucket state_dir sse_file postgres_container postgres_database postgres_user postgres_backup_root postgres_sse_mode
  local source_host backup_host source_identity backup_identity separate='NO'
  local write_destination verify_destination write_remote verify_remote write_path verify_path
  local required_names=(
    BACKUP_ENDPOINT BACKUP_BUCKET BACKUP_VERIFY_ACCESS_KEY BACKUP_VERIFY_SECRET_KEY
    BACKUP_SSE_CAPABILITY_FILE BACKUP_STATE_DIR BACKUP_WRITE_ACCESS_KEY BACKUP_WRITE_SECRET_KEY
    SOURCE_ENVIRONMENT EXPECTED_SOURCE_ENVIRONMENT SOURCE_ENDPOINT SOURCE_ACCESS_KEY SOURCE_SECRET_KEY
    SOURCE_BUCKET POSTGRES_CONTAINER POSTGRES_DATABASE POSTGRES_USER POSTGRES_BACKUP_ROOT
    POSTGRES_RCLONE_DESTINATION POSTGRES_VERIFY_RCLONE_DESTINATION POSTGRES_SSE_MODE
  )

  if file_is_regular_non_symlink "$ENV_FILE"; then
    owner="$(file_owner "$ENV_FILE")"
    group="$(file_group "$ENV_FILE")"
    mode="0$(file_mode "$ENV_FILE")"
    [[ "$owner" == "$EXPECTED_ENV_OWNER" ]] || fail_check 'backup environment owner is unexpected'
    [[ "$group" == "$EXPECTED_ENV_GROUP" ]] || fail_check 'backup environment group is unexpected'
    [[ "$mode" == '0600' ]] || fail_check 'backup environment mode must be 0600'
    env_ok=true
    for name in "${required_names[@]}"; do
      env_name_present "$ENV_FILE" "$name" || { env_ok=false; fail_check "required environment name is missing or duplicated: $name"; }
    done
  else
    fail_check 'protected backup environment is not a regular non-symlink file'
  fi
  if [[ "$env_ok" == true ]]; then
    printf 'REQUIRED_ENV_NAMES_PRESENT=YES\n'
  else
    printf 'REQUIRED_ENV_NAMES_PRESENT=NO\n'
  fi

  source_environment="$(env_value "$ENV_FILE" SOURCE_ENVIRONMENT 2>/dev/null || true)"
  expected_source_environment="$(env_value "$ENV_FILE" EXPECTED_SOURCE_ENVIRONMENT 2>/dev/null || true)"
  source_endpoint="$(env_value "$ENV_FILE" SOURCE_ENDPOINT 2>/dev/null || true)"
  source_bucket="$(env_value "$ENV_FILE" SOURCE_BUCKET 2>/dev/null || true)"
  backup_endpoint="$(env_value "$ENV_FILE" BACKUP_ENDPOINT 2>/dev/null || true)"
  backup_bucket="$(env_value "$ENV_FILE" BACKUP_BUCKET 2>/dev/null || true)"
  state_dir="$(env_value "$ENV_FILE" BACKUP_STATE_DIR 2>/dev/null || true)"
  sse_file="$(env_value "$ENV_FILE" BACKUP_SSE_CAPABILITY_FILE 2>/dev/null || true)"
  postgres_container="$(env_value "$ENV_FILE" POSTGRES_CONTAINER 2>/dev/null || true)"
  postgres_database="$(env_value "$ENV_FILE" POSTGRES_DATABASE 2>/dev/null || true)"
  postgres_user="$(env_value "$ENV_FILE" POSTGRES_USER 2>/dev/null || true)"
  postgres_backup_root="$(env_value "$ENV_FILE" POSTGRES_BACKUP_ROOT 2>/dev/null || true)"
  postgres_sse_mode="$(env_value "$ENV_FILE" POSTGRES_SSE_MODE 2>/dev/null || true)"
  write_destination="$(env_value "$ENV_FILE" POSTGRES_RCLONE_DESTINATION 2>/dev/null || true)"
  verify_destination="$(env_value "$ENV_FILE" POSTGRES_VERIFY_RCLONE_DESTINATION 2>/dev/null || true)"
  write_remote="${write_destination%%:*}"
  verify_remote="${verify_destination%%:*}"
  write_path="${write_destination#*:}"
  verify_path="${verify_destination#*:}"

  source_host="$(endpoint_hostname "$source_endpoint" 2>/dev/null || true)"
  backup_host="$(endpoint_hostname "$backup_endpoint" 2>/dev/null || true)"
  source_identity="$(endpoint_identity "$source_endpoint")"
  backup_identity="$(endpoint_identity "$backup_endpoint")"
  if [[ -n "$source_identity" && -n "$backup_identity" && -n "$source_bucket" && -n "$backup_bucket" && ( "$source_identity" != "$backup_identity" || "$source_bucket" != "$backup_bucket" ) ]]; then
    separate='YES'
  else
    fail_check 'source and backup destinations are not provably separate'
  fi
  [[ "$source_environment" == production ]] || fail_check 'SOURCE_ENVIRONMENT must be production'
  [[ "$expected_source_environment" == production ]] || fail_check 'EXPECTED_SOURCE_ENVIRONMENT must be production'
  [[ "$source_host" == "$EXPECTED_SOURCE_HOST" ]] || fail_check 'source endpoint hostname is unexpected'
  [[ "$source_bucket" == "$EXPECTED_SOURCE_BUCKET" ]] || fail_check 'source bucket is unexpected'
  [[ "$backup_bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail_check 'backup bucket is invalid'
  [[ "$state_dir" == "$EXPECTED_STATE_DIR" ]] || fail_check 'BACKUP_STATE_DIR is unexpected'
  [[ "$sse_file" == "$SSE_FILE" ]] || fail_check 'BACKUP_SSE_CAPABILITY_FILE is unexpected'
  [[ "$postgres_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || fail_check 'PostgreSQL container name is invalid'
  [[ "$postgres_database" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail_check 'PostgreSQL database name is invalid'
  [[ "$postgres_user" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail_check 'PostgreSQL user name is invalid'
  [[ "$postgres_backup_root" == /* && "$postgres_backup_root" != '/' ]] || fail_check 'PostgreSQL backup root is invalid'
  [[ "$postgres_sse_mode" == SSE-S3 ]] || fail_check 'PostgreSQL SSE mode is not SSE-S3'
  [[ "$write_destination" =~ ^[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$ ]] || fail_check 'write rclone destination is invalid'
  [[ "$verify_destination" =~ ^[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$ ]] || fail_check 'verify rclone destination is invalid'
  [[ "$write_path" == "$backup_bucket/postgresql" ]] || fail_check 'write rclone destination is not the dedicated PostgreSQL prefix'
  [[ "$verify_path" == "$backup_bucket/postgresql" ]] || fail_check 'verify rclone destination is not the dedicated PostgreSQL prefix'
  [[ -n "$write_remote" && "$write_remote" != "$verify_remote" ]] || fail_check 'rclone write and verify identities must be separate'

  printf 'SOURCE_ENVIRONMENT=%s\n' "$(safe_output "$source_environment")"
  printf 'EXPECTED_SOURCE_ENVIRONMENT=%s\n' "$(safe_output "$expected_source_environment")"
  printf 'SOURCE_ENDPOINT_HOSTNAME=%s\n' "$(safe_output "${source_host:-UNKNOWN}")"
  printf 'SOURCE_BUCKET=%s\n' "$(safe_output "$source_bucket")"
  printf 'BACKUP_ENDPOINT_HOSTNAME=%s\n' "$(safe_output "${backup_host:-UNKNOWN}")"
  printf 'BACKUP_BUCKET=%s\n' "$(safe_output "$backup_bucket")"
  printf 'SOURCE_AND_BACKUP_SEPARATE=%s\n' "$separate"
  printf 'BACKUP_STATE_DIR_MATCH=%s\n' "$([[ "$state_dir" == "$EXPECTED_STATE_DIR" ]] && printf YES || printf NO)"
  printf 'POSTGRES_CONTAINER=%s\n' "$(safe_output "$postgres_container")"
  printf 'POSTGRES_DATABASE=%s\n' "$(safe_output "$postgres_database")"
  printf 'POSTGRES_USER=%s\n' "$(safe_output "$postgres_user")"
  printf 'POSTGRES_BACKUP_ROOT=%s\n' "$(safe_output "$postgres_backup_root")"
  printf 'POSTGRES_SSE_MODE=%s\n' "$(safe_output "$postgres_sse_mode")"
  printf 'POSTGRES_RCLONE_WRITE_DESTINATION=%s\n' "$(safe_output "$write_destination")"
  printf 'POSTGRES_RCLONE_VERIFY_DESTINATION=%s\n' "$(safe_output "$verify_destination")"
}

inspect_sse_evidence() {
  local owner group mode status algorithm endpoint bucket expected_endpoint expected_bucket
  local valid='NO' endpoint_match='NO' bucket_match='NO' path_match='NO' probed_at='UNKNOWN' probed_at_valid='NO'

  status='UNKNOWN'
  algorithm='UNKNOWN'
  endpoint='UNKNOWN'
  bucket='UNKNOWN'
  expected_endpoint="$(env_value "$ENV_FILE" BACKUP_ENDPOINT 2>/dev/null || true)"
  expected_bucket="$(env_value "$ENV_FILE" BACKUP_BUCKET 2>/dev/null || true)"
  if [[ "$(env_value "$ENV_FILE" BACKUP_SSE_CAPABILITY_FILE 2>/dev/null || true)" == "$SSE_FILE" ]]; then
    path_match='YES'
  else
    fail_check 'SSE capability path does not match the protected evidence path'
  fi
  if file_is_regular_non_symlink "$SSE_FILE"; then
    owner="$(file_owner "$SSE_FILE")"
    group="$(file_group "$SSE_FILE")"
    mode="0$(file_mode "$SSE_FILE")"
    status="$(jq -er '.status // "UNKNOWN"' "$SSE_FILE" 2>/dev/null || printf 'UNKNOWN')"
    algorithm="$(jq -er '.algorithm // "UNKNOWN"' "$SSE_FILE" 2>/dev/null || printf 'UNKNOWN')"
    endpoint="$(jq -er '.endpoint_identity // "UNKNOWN"' "$SSE_FILE" 2>/dev/null || printf 'UNKNOWN')"
    bucket="$(jq -er '.bucket // "UNKNOWN"' "$SSE_FILE" 2>/dev/null || printf 'UNKNOWN')"
    probed_at="$(jq -er '.probed_at // "UNKNOWN"' "$SSE_FILE" 2>/dev/null || printf 'UNKNOWN')"
    expected_endpoint="$(endpoint_identity "$expected_endpoint")"
    endpoint="$(endpoint_identity "$endpoint" 2>/dev/null || printf 'UNKNOWN')"
    [[ "$owner" == "$EXPECTED_SSE_OWNER" ]] || fail_check 'SSE evidence owner is unexpected'
    mode_value=$((8#${mode#0}))
    (( (mode_value & 0022) == 0 )) || fail_check 'SSE evidence is group/world writable'
    [[ "$status" == SSE_S3_SUPPORTED && "$algorithm" == AES256 ]] || fail_check 'SSE evidence status or algorithm is invalid'
    if [[ "$probed_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then probed_at_valid='YES'; else fail_check 'SSE evidence probed_at is invalid'; fi
    if [[ "$endpoint" == "$expected_endpoint" ]]; then endpoint_match='YES'; else fail_check 'SSE evidence endpoint does not match backup endpoint'; fi
    if [[ "$bucket" == "$expected_bucket" ]]; then bucket_match='YES'; else fail_check 'SSE evidence bucket does not match backup bucket'; fi
    if [[ "$owner" == "$EXPECTED_SSE_OWNER" && "$group" == "$EXPECTED_SSE_GROUP" && "$status" == SSE_S3_SUPPORTED && "$algorithm" == AES256 && "$endpoint_match" == YES && "$bucket_match" == YES && "$path_match" == YES && "$probed_at_valid" == YES ]]; then
      valid='YES'
    fi
  else
    fail_check 'SSE capability evidence is not a regular non-symlink file'
  fi
  printf 'SSE_EVIDENCE_VALID=%s\n' "$valid"
  printf 'SSE_STATUS=%s\n' "$(safe_output "$status")"
  printf 'SSE_ALGORITHM=%s\n' "$(safe_output "$algorithm")"
  printf 'SSE_PATH_MATCH=%s\n' "$path_match"
  printf 'SSE_PROBED_AT_VALID=%s\n' "$probed_at_valid"
  printf 'SSE_ENDPOINT_MATCH=%s\n' "$endpoint_match"
  printf 'SSE_BUCKET_MATCH=%s\n' "$bucket_match"
}

inspect_state() {
  local state_owner state_group state_mode latest='NO' receipt_count=0 receipt
  if ! directory_is_regular_non_symlink "$STATE_DIR"; then
    fail_check 'backup state directory is not a regular non-symlink directory'
    printf 'LATEST_STATE_EXISTS=NO\nPAIRED_RECEIPT_COUNT=0\n'
    return
  fi
  state_owner="$(file_owner "$STATE_DIR")"
  state_group="$(file_group "$STATE_DIR")"
  state_mode="0$(file_mode "$STATE_DIR")"
  [[ "$state_owner" == "$EXPECTED_STATE_OWNER" ]] || fail_check 'backup state directory owner is unexpected'
  [[ "$state_group" == "$EXPECTED_STATE_GROUP" ]] || fail_check 'backup state directory group is unexpected'
  [[ "$state_mode" == '0700' ]] || fail_check 'backup state directory mode must be 0700'

  if [[ -e "$STATE_DIR/latest.env" || -L "$STATE_DIR/latest.env" ]]; then
    latest='YES'
    if ! inspect_regular_file 'latest.env' "$STATE_DIR/latest.env" "$EXPECTED_STATE_OWNER" "$EXPECTED_STATE_GROUP" '0600'; then
      :
    fi
  fi
  for receipt in "$STATE_DIR"/paired-*.json; do
    [[ -e "$receipt" || -L "$receipt" ]] || continue
    if file_is_regular_non_symlink "$receipt"; then
      receipt_count=$((receipt_count + 1))
      receipt_owner="$(file_owner "$receipt")"
      receipt_group="$(file_group "$receipt")"
      receipt_mode="0$(file_mode "$receipt")"
      [[ "$receipt_owner" == "$EXPECTED_STATE_OWNER" && "$receipt_group" == "$EXPECTED_STATE_GROUP" && "$receipt_mode" == '0600' ]] || fail_check 'paired receipt metadata is unsafe'
    else
      fail_check 'paired receipt is not a regular non-symlink file'
    fi
  done
  printf 'LATEST_STATE_EXISTS=%s\n' "$latest"
  printf 'PAIRED_RECEIPT_COUNT=%s\n' "$receipt_count"
}

inspect_legacy_concurrency() {
  local service_exists='NO' service_active='NO' timer_exists='NO' timer_active='NO' timer_enabled='NO'
  local next_trigger='n/a' service_state service_probe timer_state timer_probe timer_unit_state
  LEGACY_BACKUP_OVERLAP_SAFE='NO'

  if systemctl cat "$EXPECTED_LEGACY_BACKUP_SERVICE" >/dev/null 2>&1; then
    service_exists='YES'
    service_state="$(systemctl_value "$EXPECTED_LEGACY_BACKUP_SERVICE" ActiveState || true)"
    service_probe="$(unit_active_state "$EXPECTED_LEGACY_BACKUP_SERVICE")"
    if [[ "$service_state" == active || "$service_probe" == active || "$service_state" == activating || "$service_probe" == activating ]]; then
      service_active='YES'
      fail_check 'legacy PostgreSQL backup service is active'
    elif [[ "$service_state" != inactive || "$service_probe" != inactive ]]; then
      service_active='UNKNOWN'
      fail_check 'legacy PostgreSQL backup service state is ambiguous'
    fi
  else
    service_state='not-found'
    service_probe='inactive'
  fi

  if systemctl cat "$EXPECTED_LEGACY_BACKUP_TIMER" >/dev/null 2>&1; then
    timer_exists='YES'
    timer_state="$(systemctl_value "$EXPECTED_LEGACY_BACKUP_TIMER" ActiveState || true)"
    timer_probe="$(unit_active_state "$EXPECTED_LEGACY_BACKUP_TIMER")"
    timer_unit_state="$(systemctl_value "$EXPECTED_LEGACY_BACKUP_TIMER" UnitFileState || true)"
    next_trigger="$(systemctl_value "$EXPECTED_LEGACY_BACKUP_TIMER" NextElapseUSecRealtime || true)"
    [[ -n "$next_trigger" ]] || next_trigger='UNKNOWN'
    case "$timer_unit_state" in
      enabled) timer_enabled='YES' ;;
      disabled|masked|static) timer_enabled='NO' ;;
      *) timer_enabled='UNKNOWN'; fail_check 'legacy PostgreSQL backup timer enablement is ambiguous' ;;
    esac
    if [[ "$timer_state" == active || "$timer_probe" == active ]]; then
      timer_active='YES'
      fail_check 'legacy PostgreSQL backup timer is active'
    elif [[ "$timer_state" != inactive || "$timer_probe" != inactive ]]; then
      timer_active='UNKNOWN'
      fail_check 'legacy PostgreSQL backup timer state is ambiguous'
    fi
    if [[ "$next_trigger" != n/a && "$next_trigger" != '-' && -n "$next_trigger" ]]; then
      fail_check 'legacy PostgreSQL backup timer has a scheduled next trigger'
    fi
  else
    timer_state='not-found'
    timer_probe='inactive'
    timer_unit_state='not-found'
  fi

  if [[ "$service_active" == NO && "$timer_active" == NO && "$timer_enabled" != UNKNOWN && "$next_trigger" == n/a ]]; then
    LEGACY_BACKUP_OVERLAP_SAFE='YES'
  else
    fail_check 'legacy PostgreSQL backup overlap safety is not proven'
  fi
  printf 'LEGACY_BACKUP_SERVICE_EXISTS=%s\n' "$service_exists"
  printf 'LEGACY_BACKUP_SERVICE_ACTIVE=%s\n' "$service_active"
  printf 'LEGACY_BACKUP_TIMER_EXISTS=%s\n' "$timer_exists"
  printf 'LEGACY_BACKUP_TIMER_ACTIVE=%s\n' "$timer_active"
  printf 'LEGACY_BACKUP_TIMER_ENABLED=%s\n' "$timer_enabled"
  printf 'LEGACY_BACKUP_NEXT_TRIGGER=%s\n' "$(safe_output "$next_trigger")"
  printf 'LEGACY_BACKUP_OVERLAP_SAFE=%s\n' "$LEGACY_BACKUP_OVERLAP_SAFE"
}

inspect_postgres_and_space() {
  local container="$1"
  local state='UNKNOWN' health='UNKNOWN' root free_bytes tmp_dir tmp_free_bytes
  local database database_user database_size_bytes='UNKNOWN' safety_margin_bytes='UNKNOWN' required_bytes='UNKNOWN' tmp_required_bytes='UNKNOWN'
  local postgres_space_safe='NO' tmp_space_safe='NO' free_kib
  if command -v docker >/dev/null 2>&1; then
    state="$(docker inspect --type container --format '{{.State.Status}}' "$container" 2>/dev/null || printf 'UNKNOWN')"
    health="$(docker inspect --type container --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not_configured{{end}}' "$container" 2>/dev/null || printf 'UNKNOWN')"
  fi
  [[ "$state" == running ]] || fail_check 'PostgreSQL container is not running'
  [[ "$health" == healthy ]] || fail_check 'PostgreSQL container is not healthy'
  printf 'POSTGRES_CONTAINER_STATE=%s\n' "$(safe_output "$state")"
  printf 'POSTGRES_CONTAINER_HEALTH=%s\n' "$(safe_output "$health")"

  root="$(env_value "$ENV_FILE" POSTGRES_BACKUP_ROOT 2>/dev/null || true)"
  if ! directory_is_regular_non_symlink "$root"; then
    fail_check 'PostgreSQL backup root is not a regular non-symlink directory'
    free_bytes='UNKNOWN'
  else
    free_kib="$(df -Pk "$root" 2>/dev/null | awk 'NR == 2 { print $4; exit }' || true)"
    if [[ "$free_kib" =~ ^[0-9]+$ && "$free_kib" -le "$MAX_INT64_DIV_1024" ]]; then
      free_bytes=$((free_kib * 1024))
    else
      free_bytes='UNKNOWN'
      fail_check 'PostgreSQL backup root free space is unavailable or has invalid units'
    fi
  fi

  database="$(env_value "$ENV_FILE" POSTGRES_DATABASE 2>/dev/null || true)"
  database_user="$(env_value "$ENV_FILE" POSTGRES_USER 2>/dev/null || true)"
  if [[ "$state" == running && "$health" == healthy && "$database" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ && "$database_user" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
    database_size_bytes="$(docker exec "$container" psql -U "$database_user" -d "$database" -Atqc 'SELECT pg_database_size(current_database());' 2>/dev/null || true)"
  fi
  if [[ "$database_size_bytes" =~ ^[0-9]+$ && "$database_size_bytes" -le "$MAX_POSTGRES_ESTIMATE_BASE_BYTES" ]]; then
    safety_margin_bytes=$((database_size_bytes / 2))
    (( safety_margin_bytes < POSTGRES_BACKUP_MIN_SAFETY_MARGIN_BYTES )) && safety_margin_bytes=$POSTGRES_BACKUP_MIN_SAFETY_MARGIN_BYTES
    required_bytes=$((database_size_bytes + safety_margin_bytes))
    tmp_required_bytes="$required_bytes"
  else
    fail_check 'PostgreSQL database size estimate is unavailable or invalid'
  fi

  if [[ "$free_bytes" =~ ^[0-9]+$ && "$required_bytes" =~ ^[0-9]+$ ]]; then
    if (( free_bytes >= required_bytes )); then postgres_space_safe='YES'; else fail_check 'PostgreSQL backup root lacks required free space'; fi
  else
    fail_check 'PostgreSQL backup root capacity safety is not provable'
  fi

  tmp_dir="$(cd -P -- /tmp 2>/dev/null && pwd -P || true)"
  if [[ -n "$tmp_dir" ]] && directory_is_regular_non_symlink "$tmp_dir"; then
    free_kib="$(df -Pk "$tmp_dir" 2>/dev/null | awk 'NR == 2 { print $4; exit }' || true)"
    if [[ "$free_kib" =~ ^[0-9]+$ && "$free_kib" -le "$MAX_INT64_DIV_1024" ]]; then
      tmp_free_bytes=$((free_kib * 1024))
    else
      tmp_free_bytes='UNKNOWN'
      fail_check 'temporary directory free space is unavailable or has invalid units'
    fi
  else
    tmp_free_bytes='UNKNOWN'
    fail_check 'temporary directory is not a regular non-symlink directory'
  fi
  if [[ "$tmp_free_bytes" =~ ^[0-9]+$ && "$tmp_required_bytes" =~ ^[0-9]+$ ]]; then
    if (( tmp_free_bytes >= tmp_required_bytes )); then tmp_space_safe='YES'; else fail_check 'temporary directory lacks required free space'; fi
  else
    fail_check 'temporary directory capacity safety is not provable'
  fi
  printf 'POSTGRES_BACKUP_ROOT_FREE_BYTES=%s\n' "$free_bytes"
  printf 'POSTGRES_DATABASE_SIZE_BYTES=%s\n' "$(safe_output "$database_size_bytes")"
  printf 'POSTGRES_BACKUP_SAFETY_MARGIN_BYTES=%s\n' "$(safe_output "$safety_margin_bytes")"
  printf 'POSTGRES_BACKUP_REQUIRED_BYTES=%s\n' "$(safe_output "$required_bytes")"
  printf 'POSTGRES_BACKUP_SPACE_SAFE=%s\n' "$postgres_space_safe"
  printf 'TMP_FREE_BYTES=%s\n' "$tmp_free_bytes"
  printf 'TMP_REQUIRED_BYTES=%s\n' "$(safe_output "$tmp_required_bytes")"
  printf 'TMP_SPACE_SAFE=%s\n' "$tmp_space_safe"
}

inspect_concurrency() {
  local backup_state timer_state timer_load_state concurrency='NO'
  backup_state="$(unit_active_state "$EXPECTED_BACKUP_SERVICE")"
  timer_load_state="$(systemctl_value 'pawtech-buildingos-backup.timer' LoadState || true)"
  if [[ "$timer_load_state" == not-found ]]; then
    timer_state='inactive'
  else
    timer_state="$(unit_active_state 'pawtech-buildingos-backup.timer')"
  fi
  [[ "$backup_state" != active ]] || fail_check 'backup service is already running'
  [[ "$timer_state" != active ]] || fail_check 'backup timer is active and could race the manual operation'
  inspect_legacy_concurrency
  if [[ "$backup_state" == inactive || "$backup_state" == dead || "$backup_state" == failed ]] && [[ "$timer_state" == inactive || "$timer_state" == dead || -z "$timer_state" ]]; then
    [[ "$LEGACY_BACKUP_OVERLAP_SAFE" == YES ]] && concurrency='YES'
  else
    fail_check 'backup concurrency state is unknown'
  fi
  printf 'BACKUP_ALREADY_RUNNING=%s\n' "$([[ "$backup_state" == active ]] && printf YES || printf NO)"
  printf 'CONCURRENCY_SAFE=%s\n' "$concurrency"
}

main() {
  local required_commands=(awk bash cat date df docker git id jq mc pg_restore rclone sha256sum stat systemctl)
  local command_name missing_dependency=false
  local app_dir env_file sse_file state_dir

  [[ $# -eq 1 ]] || { printf 'Usage: %s <candidate_sha>\n' "${0##*/}" >&2; return 64; }
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || { printf 'ERROR: candidate SHA is not exactly 40 lowercase hexadecimal characters\n' >&2; return 1; }
  readonly CANDIDATE_SHA="$1"

  if [[ "${BUILDINGOS_PREFLIGHT_TEST_MODE:-}" == LOCAL_ISOLATED_ONLY ]]; then
    test_mode=true
    app_dir="${PREFLIGHT_APP_DIR:?}"
    env_file="${PREFLIGHT_ENV_FILE:?}"
    sse_file="${PREFLIGHT_SSE_FILE:?}"
    state_dir="${PREFLIGHT_STATE_DIR:?}"
    EXPECTED_APP_DIR="$app_dir"
    EXPECTED_STATE_DIR="$state_dir"
    ENV_FILE="$env_file"
    SSE_FILE="$sse_file"
    STATE_DIR="$state_dir"
    EXPECTED_ENV_OWNER="${PREFLIGHT_EXPECTED_ENV_OWNER:-$(id -un)}"
    EXPECTED_ENV_GROUP="${PREFLIGHT_EXPECTED_ENV_GROUP:-$(id -gn)}"
    EXPECTED_STATE_OWNER="${PREFLIGHT_EXPECTED_STATE_OWNER:-$(id -un)}"
    EXPECTED_STATE_GROUP="${PREFLIGHT_EXPECTED_STATE_GROUP:-$(id -gn)}"
    EXPECTED_SSE_OWNER="${PREFLIGHT_EXPECTED_SSE_OWNER:-$(id -un)}"
    EXPECTED_SSE_GROUP="${PREFLIGHT_EXPECTED_SSE_GROUP:-$(id -gn)}"
  else
    [[ -z "${PREFLIGHT_APP_DIR:-}${PREFLIGHT_ENV_FILE:-}${PREFLIGHT_SSE_FILE:-}${PREFLIGHT_STATE_DIR:-}" ]] || { printf 'ERROR: test path overrides require LOCAL_ISOLATED_ONLY\n' >&2; return 1; }
    EXPECTED_APP_DIR="$DEFAULT_APP_DIR"
    EXPECTED_STATE_DIR="$DEFAULT_STATE_DIR"
    ENV_FILE="$DEFAULT_ENV_FILE"
    SSE_FILE="$DEFAULT_SSE_FILE"
    STATE_DIR="$DEFAULT_STATE_DIR"
    EXPECTED_ENV_OWNER='root'
    EXPECTED_ENV_GROUP='root'
    EXPECTED_STATE_OWNER='yoryi'
    EXPECTED_STATE_GROUP='yoryi'
    EXPECTED_SSE_OWNER='root'
    EXPECTED_SSE_GROUP='yoryi'
  fi
  EXPECTED_ENV_FILE="$DEFAULT_ENV_FILE"
  readonly EXPECTED_APP_DIR EXPECTED_ENV_FILE EXPECTED_STATE_DIR ENV_FILE SSE_FILE STATE_DIR EXPECTED_ENV_OWNER EXPECTED_ENV_GROUP EXPECTED_STATE_OWNER EXPECTED_STATE_GROUP EXPECTED_SSE_OWNER EXPECTED_SSE_GROUP

  for command_name in "${required_commands[@]}"; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      missing_dependency=true
      fail_check "required dependency is missing: $command_name"
    fi
  done

  printf 'PRODUCTION_BACKUP_PREFLIGHT\n'
  printf 'CANDIDATE_SHA=%s\n' "$CANDIDATE_SHA"
  if [[ "$missing_dependency" == true ]]; then
    printf 'DEPENDENCIES_READY=NO\n'
  else
    printf 'DEPENDENCIES_READY=YES\n'
  fi

  if [[ "$missing_dependency" == false ]]; then
    inspect_runtime
    inspect_scripts
    inspect_unit BACKUP_SERVICE "$EXPECTED_BACKUP_SERVICE" "$EXPECTED_BACKUP_ENTRYPOINT" "$EXPECTED_ENV_FILE" yoryi "$EXPECTED_APP_DIR" false
    inspect_unit VERIFY_SERVICE "$EXPECTED_VERIFY_SERVICE" "$EXPECTED_BACKUP_ENTRYPOINT" "$EXPECTED_ENV_FILE" yoryi "$EXPECTED_APP_DIR" true
    inspect_concurrency
    inspect_environment
    inspect_sse_evidence
    inspect_state
    inspect_postgres_and_space "$(env_value "$ENV_FILE" POSTGRES_CONTAINER 2>/dev/null || printf 'invalid-container')"
  else
    printf 'PRODUCTION_RUNTIME_SHA=UNKNOWN\nAPI_REVISION=UNKNOWN\nWEB_REVISION=UNKNOWN\nPRODUCTION_CHECKOUT_STATUS=UNKNOWN\nRUNTIME_IDENTITY=UNKNOWN\n'
    printf 'BACKUP_SERVICE_EXISTS=UNKNOWN\nBACKUP_SERVICE_USER=UNKNOWN\nBACKUP_SERVICE_EXECSTART_MATCH=UNKNOWN\nBACKUP_SERVICE_EXECSTARTPRE_MATCH=UNKNOWN\nBACKUP_SERVICE_EXECSTARTPOST_MATCH=UNKNOWN\nBACKUP_SERVICE_ENV_FILE_MATCH=UNKNOWN\nBACKUP_SERVICE_ACTIVE=UNKNOWN\n'
    printf 'VERIFY_SERVICE_EXISTS=UNKNOWN\nVERIFY_SERVICE_USER=UNKNOWN\nVERIFY_SERVICE_EXECSTART_MATCH=UNKNOWN\nVERIFY_SERVICE_EXECSTARTPRE_MATCH=UNKNOWN\nVERIFY_SERVICE_EXECSTARTPOST_MATCH=UNKNOWN\nVERIFY_SERVICE_ACTIVE=UNKNOWN\n'
    printf 'REQUIRED_ENV_NAMES_PRESENT=UNKNOWN\nSOURCE_ENVIRONMENT=UNKNOWN\nEXPECTED_SOURCE_ENVIRONMENT=UNKNOWN\nSOURCE_ENDPOINT_HOSTNAME=UNKNOWN\nSOURCE_BUCKET=UNKNOWN\nBACKUP_ENDPOINT_HOSTNAME=UNKNOWN\nBACKUP_BUCKET=UNKNOWN\nSOURCE_AND_BACKUP_SEPARATE=UNKNOWN\nBACKUP_STATE_DIR_MATCH=UNKNOWN\nLATEST_STATE_EXISTS=UNKNOWN\nPAIRED_RECEIPT_COUNT=UNKNOWN\nSSE_EVIDENCE_VALID=UNKNOWN\nSSE_STATUS=UNKNOWN\nSSE_ALGORITHM=UNKNOWN\nSSE_PATH_MATCH=UNKNOWN\nSSE_PROBED_AT_VALID=UNKNOWN\nSSE_ENDPOINT_MATCH=UNKNOWN\nSSE_BUCKET_MATCH=UNKNOWN\nPOSTGRES_CONTAINER_STATE=UNKNOWN\nPOSTGRES_CONTAINER_HEALTH=UNKNOWN\nPOSTGRES_BACKUP_ROOT_FREE_BYTES=UNKNOWN\nPOSTGRES_DATABASE_SIZE_BYTES=UNKNOWN\nPOSTGRES_BACKUP_SAFETY_MARGIN_BYTES=UNKNOWN\nPOSTGRES_BACKUP_REQUIRED_BYTES=UNKNOWN\nPOSTGRES_BACKUP_SPACE_SAFE=UNKNOWN\nTMP_FREE_BYTES=UNKNOWN\nTMP_REQUIRED_BYTES=UNKNOWN\nTMP_SPACE_SAFE=UNKNOWN\nLEGACY_BACKUP_SERVICE_EXISTS=UNKNOWN\nLEGACY_BACKUP_SERVICE_ACTIVE=UNKNOWN\nLEGACY_BACKUP_TIMER_EXISTS=UNKNOWN\nLEGACY_BACKUP_TIMER_ACTIVE=UNKNOWN\nLEGACY_BACKUP_TIMER_ENABLED=UNKNOWN\nLEGACY_BACKUP_NEXT_TRIGGER=UNKNOWN\nLEGACY_BACKUP_OVERLAP_SAFE=UNKNOWN\nBACKUP_ALREADY_RUNNING=UNKNOWN\nCONCURRENCY_SAFE=UNKNOWN\n'
  fi
  printf 'PROPOSED_BACKUP_COMMAND=%s\n' "$EXPECTED_PROPOSED_COMMAND"
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
