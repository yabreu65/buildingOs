#!/usr/bin/env bash
# shellcheck disable=SC2012
set -Eeuo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
CONTROL_ROOT="$(dirname -- "$SCRIPT_DIR")"
readonly CONTROL_ROOT
readonly SECURITY_VALIDATOR="$SCRIPT_DIR/production-security-validate.sh"
readonly STORAGE_CUTOVER_GUARD="$SCRIPT_DIR/production-storage-cutover-guard.sh"
readonly RECOVERY_POINT_CAPTURE_LIBRARY="$SCRIPT_DIR/lib/recovery-point-capture.sh"
readonly S3_WRITE_FENCE_LIBRARY="$SCRIPT_DIR/lib/production-s3-write-fence.sh"
readonly BACKUP_IDENTITY_MANIFEST="$CONTROL_ROOT/infra/production/backup-postgres.identity.v1"
[[ -f "$SECURITY_VALIDATOR" && ! -L "$SECURITY_VALIDATOR" ]] || {
  printf 'ERROR: Trusted production security validator is missing or invalid\n' >&2
  exit 1
}
[[ -f "$STORAGE_CUTOVER_GUARD" && ! -L "$STORAGE_CUTOVER_GUARD" ]] || {
  printf 'ERROR: Trusted production storage transition guard is missing or invalid\n' >&2
  exit 1
}
[[ -f "$RECOVERY_POINT_CAPTURE_LIBRARY" && ! -L "$RECOVERY_POINT_CAPTURE_LIBRARY" && -f "$S3_WRITE_FENCE_LIBRARY" && ! -L "$S3_WRITE_FENCE_LIBRARY" ]] || {
  printf 'ERROR: Trusted recovery-point helpers are missing or invalid\n' >&2
  exit 1
}
# shellcheck source=scripts/production-security-validate.sh
source "$SECURITY_VALIDATOR"
# shellcheck source=scripts/lib/recovery-point-capture.sh
# recovery-point-capture loads the fence through its trusted sibling control path.
source "$RECOVERY_POINT_CAPTURE_LIBRARY"

usage() {
  printf 'Usage: %s <target_sha> <approved_sha> <expected_current_sha> <api_health_url> <api_readyz_url> <web_login_url>\n' "${0##*/}" >&2
  exit 64
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  if declare -F write_record >/dev/null 2>&1 && [[ "$RECORD_SUCCESS" != true ]]; then
    write_record FAILED || true
  fi
  exit 1
}

[[ $# -eq 6 ]] || usage
readonly TARGET_SHA="$1"
readonly APPROVED_SHA="$2"
readonly EXPECTED_CURRENT_SHA="$3"
readonly API_HEALTH_URL="$4"
readonly API_READYZ_URL="$5"
readonly WEB_LOGIN_URL="$6"
readonly APP_DIR='/opt/pawtech/apps/buildingos/buildingos-app'
readonly PRODUCTION_ROOT='/opt/pawtech/apps/buildingos'
readonly COMPOSE_FILE='infra/docker/docker-compose.production.yml'
readonly PROJECT_NAME='buildingos'
readonly ENV_FILE='/opt/pawtech/env/buildingos.env'
readonly BACKUP_ROOT='/opt/pawtech/backups/tmp'
readonly POSTGRES_CONTAINER='pawtech-postgres'
readonly RECOVERY_POINT_OBJECT_BACKUP_ENV='/etc/buildingos/object-backup.env'
readonly RECOVERY_POINT_STATE_PARENT='/opt/pawtech/backups/recovery-points'
readonly RECOVERY_POINT_DOCKER_NETWORK='pawtech_public'
readonly DEPLOYMENTS_DIR="$PRODUCTION_ROOT/deployments"
readonly CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR="$DEPLOYMENTS_DIR/current-successful-deployment.v1"
readonly ALLOWED_IGNORED_RUNTIME_ENV='infra/docker/.env'
DEPLOY_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
readonly DEPLOY_STARTED_AT
RECORD="$DEPLOYMENTS_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ)-$TARGET_SHA.txt"
readonly RECORD

PHASE='preflight'
PREVIOUS_SHA='unknown'
PREVIOUS_API_DIGEST='unknown'
PREVIOUS_WEB_DIGEST='unknown'
PREVIOUS_API_REVISION='unknown'
PREVIOUS_WEB_REVISION='unknown'
NEW_API_DIGEST='unknown'
NEW_WEB_DIGEST='unknown'
BACKUP_ID='unknown'
MIGRATION_COUNT='unknown'
MIGRATION_RETRY=false
ROLLBACK_RECEIPT='unknown'
STORAGE_TRANSITION='unknown'
RETRY_RECORD_ACTIVE=false
RETRY_RECOVERY_ACTIVE=false
RETRY_PREVIOUS_SHA='unknown'
RETRY_PREVIOUS_API_DIGEST='unknown'
RETRY_PREVIOUS_WEB_DIGEST='unknown'
RETRY_CURRENT_PROVIDER='unknown'
TARGET_TREE_ROOT=''
TARGET_TREE=''
TARGET_TREE_ACTIVE=false
RECOVERY_POINT_VALID=''
RECOVERY_POINT_API_WAS_RUNNING=false
RECOVERY_POINT_API_QUIESCED=false
RECOVERY_POINT_POLICY_RESTORED=false
RECOVERY_POINT_STATE_DIR=''
RECOVERY_POINT_FENCE_EVIDENCE=''
RECOVERY_POINT_SOURCE_BUCKET=''
RECOVERY_POINT_POSTGRES_USER=''
RECOVERY_POINT_RCLONE_BIN=''
RECOVERY_POINT_RCLONE_CONFIG=''
RECOVERY_POINT_OBJECT_BACKUP_DESTINATION=''
RECOVERY_POINT_REMOTE_ROOT=''
RECOVERY_POINT_ID=''
RECORD_SUCCESS=false

cleanup_target_tree() {
  if [[ "$TARGET_TREE_ACTIVE" == true ]]; then
    git -C "$APP_DIR" worktree remove --force "$TARGET_TREE" >/dev/null 2>&1 || true
    TARGET_TREE_ACTIVE=false
  fi
  if [[ -n "$TARGET_TREE_ROOT" && -d "$TARGET_TREE_ROOT" ]]; then
    rm -rf -- "$TARGET_TREE_ROOT"
  fi
}

materialize_target_tree() {
  TARGET_TREE_ROOT="$(mktemp -d /tmp/buildingos-production-target.XXXXXX)"
  TARGET_TREE="$TARGET_TREE_ROOT/target"
  git worktree add --detach --quiet "$TARGET_TREE" "$TARGET_SHA" || fail 'Unable to materialize the target SHA worktree'
  TARGET_TREE_ACTIVE=true
}

validate_database_migration_state() {
  local verifier="$1"
  local migration_preflight_output

  migration_preflight_output="$(mktemp /tmp/buildingos-production-migration-preflight.XXXXXX)"
  if env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db \
    bash "$verifier" verify-db pre > "$migration_preflight_output" 2>&1; then
    cat "$migration_preflight_output"
    MIGRATION_RETRY=false
  else
    if grep -F $'\tcode=database_pre_state_count_invalid' "$migration_preflight_output" >/dev/null; then
      env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db \
        bash "$verifier" verify-db retry
      MIGRATION_RETRY=true
    else
      cat "$migration_preflight_output" >&2
      rm -f "$migration_preflight_output"
      fail 'Production database did not match the exact 97-migration pre-state'
    fi
  fi
  rm -f "$migration_preflight_output"
}

read_deployment_record_value() {
  local record="$1"
  local expected_name="$2"
  local line name value count=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || continue
    name="${line%%=*}"
    value="${line#*=}"
    [[ "$name" == "$expected_name" ]] || continue
    count=$((count + 1))
    [[ "$count" -eq 1 ]] || return 1
    printf '%s' "$value"
  done < "$record"

  [[ "$count" -eq 1 ]]
}

load_retry_predecessor_record() {
  local record status phase migration_count storage_transition record_target_sha
  local previous_sha previous_api_digest previous_web_digest runtime_api_digest runtime_web_digest runtime_api_running
  local from_sha from_api_digest from_web_digest

  while IFS= read -r record; do
    [[ -f "$record" && ! -L "$record" ]] || continue
    status="$(read_deployment_record_value "$record" status || true)"
    if [[ "$status" == 'IN_PROGRESS' && "${record##*/}" == rollback-*.txt ]]; then
      phase="$(read_deployment_record_value "$record" phase || true)"
      migration_count="$(read_deployment_record_value "$record" migration_count || true)"
      from_sha="$(read_deployment_record_value "$record" from_sha || true)"
      previous_sha="$(read_deployment_record_value "$record" previous_sha || true)"
      previous_api_digest="$(read_deployment_record_value "$record" api_digest || true)"
      previous_web_digest="$(read_deployment_record_value "$record" web_digest || true)"
      from_api_digest="$(read_deployment_record_value "$record" from_api_digest || true)"
      from_web_digest="$(read_deployment_record_value "$record" from_web_digest || true)"
      [[ "$phase" == 'application-recreate' && ( "$migration_count" == '98' || "$migration_count" == '99' ) ]] \
        || fail 'Interrupted rollback record has an invalid recovery state'
      [[ "$from_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Interrupted rollback record has an invalid source SHA'
      [[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Interrupted rollback record has an invalid predecessor SHA'
      [[ "$previous_api_digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
        || fail 'Interrupted rollback record has an invalid API digest'
      [[ "$previous_web_digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
        || fail 'Interrupted rollback record has an invalid Web digest'
      [[ "$from_api_digest" =~ ^sha256:[0-9a-f]{64}$ && "$from_web_digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
        || fail 'Interrupted rollback record has invalid source image digests'
      runtime_api_running="$(docker inspect --format '{{.State.Running}}' buildingos-api 2>/dev/null || true)"
      runtime_api_digest="$(docker inspect --format '{{.Image}}' buildingos-api 2>/dev/null || true)"
      runtime_web_digest="$(docker inspect --format '{{.Image}}' buildingos-web 2>/dev/null || true)"
      if [[ "$runtime_api_digest" == "$from_api_digest" && "$runtime_web_digest" == "$from_web_digest" ]]; then
        RETRY_RECORD_ACTIVE=true
        RETRY_PREVIOUS_SHA="$from_sha"
        RETRY_PREVIOUS_API_DIGEST="$from_api_digest"
        RETRY_PREVIOUS_WEB_DIGEST="$from_web_digest"
        [[ "$runtime_api_running" == 'true' ]] || RETRY_RECOVERY_ACTIVE=true
        return 0
      fi
      [[ "$runtime_api_digest" == "$previous_api_digest" && "$runtime_web_digest" == "$previous_web_digest" ]] \
        || fail 'Interrupted rollback state does not match the running predecessor or source images'
      RETRY_RECORD_ACTIVE=true
      RETRY_PREVIOUS_SHA="$previous_sha"
      RETRY_PREVIOUS_API_DIGEST="$previous_api_digest"
      RETRY_PREVIOUS_WEB_DIGEST="$previous_web_digest"
      RETRY_RECOVERY_ACTIVE=true
      return 0
    fi
    if [[ "$status" == 'SUCCESS' ]]; then
      migration_count="$(read_deployment_record_value "$record" migration_count || true)"
      if [[ "${record##*/}" == rollback-*.txt && ( "$migration_count" == '98' || "$migration_count" == '99' ) ]]; then
        previous_sha="$(read_deployment_record_value "$record" previous_sha || true)"
        previous_api_digest="$(read_deployment_record_value "$record" api_digest || true)"
        previous_web_digest="$(read_deployment_record_value "$record" web_digest || true)"
        storage_transition='unknown'
      elif [[ "$migration_count" == '99' || "$migration_count" == '98' || "$migration_count" == '97' ]]; then
        previous_sha="$(read_deployment_record_value "$record" target_sha || true)"
        previous_api_digest="$(read_deployment_record_value "$record" new_api_digest || true)"
        previous_web_digest="$(read_deployment_record_value "$record" new_web_digest || true)"
        storage_transition="$(read_deployment_record_value "$record" storage_transition || true)"
      else
        continue
      fi
      [[ -n "$storage_transition" ]] || storage_transition='unknown'
      [[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]] || continue
      [[ "$previous_api_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || continue
      [[ "$previous_web_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || continue
      if [[ -n "$storage_transition" && "$storage_transition" != 'unknown' ]]; then
        [[ "$storage_transition" =~ ^(MINIO|EXTERNAL_S3):(MINIO|EXTERNAL_S3)$ ]] || continue
        [[ "$RETRY_CURRENT_PROVIDER" == 'unknown' ]] && RETRY_CURRENT_PROVIDER="${storage_transition##*:}"
      fi
      RETRY_RECORD_ACTIVE=true
      RETRY_PREVIOUS_SHA="$previous_sha"
      RETRY_PREVIOUS_API_DIGEST="$previous_api_digest"
      RETRY_PREVIOUS_WEB_DIGEST="$previous_web_digest"
      [[ "$migration_count" == '97' ]] && RETRY_RECOVERY_ACTIVE=true
      return 0
    fi
    [[ "$status" == 'FAILED' || "$status" == 'IN_PROGRESS' ]] || continue
    record_target_sha="$(read_deployment_record_value "$record" target_sha || true)"
    phase="$(read_deployment_record_value "$record" phase || true)"
    migration_count="$(read_deployment_record_value "$record" migration_count || true)"
    [[ "$phase" == 'pre-migration' || "$phase" == 'migrations' || "$phase" == 'rollback-compatibility' || "$phase" == 'application-recreate' || "$phase" == 'observability' ]] || continue
    [[ "$migration_count" == '99' || "$migration_count" == '98' || "$migration_count" == 'unknown' ]] || continue
    storage_transition="$(read_deployment_record_value "$record" storage_transition || true)"
    [[ -n "$storage_transition" ]] || storage_transition='unknown'
    if [[ "$record_target_sha" != "$TARGET_SHA" ]]; then
      RETRY_RECOVERY_ACTIVE=true
      if [[ "$storage_transition" != 'unknown' ]]; then
        [[ "$storage_transition" =~ ^(MINIO|EXTERNAL_S3):(MINIO|EXTERNAL_S3)$ ]] || continue
        [[ "$RETRY_CURRENT_PROVIDER" == 'unknown' ]] && RETRY_CURRENT_PROVIDER="${storage_transition%%:*}"
      fi
      continue
    fi
    previous_sha="$(read_deployment_record_value "$record" previous_sha || true)"
    previous_api_digest="$(read_deployment_record_value "$record" previous_api_digest || true)"
    previous_web_digest="$(read_deployment_record_value "$record" previous_web_digest || true)"
    [[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]] || continue
    [[ "$previous_api_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || continue
    [[ "$previous_web_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || continue
    if [[ "$storage_transition" != 'unknown' ]]; then
      [[ "$storage_transition" =~ ^(MINIO|EXTERNAL_S3):(MINIO|EXTERNAL_S3)$ ]] || continue
      RETRY_CURRENT_PROVIDER="${storage_transition%%:*}"
    fi
    RETRY_RECORD_ACTIVE=true
    RETRY_PREVIOUS_SHA="$previous_sha"
    RETRY_PREVIOUS_API_DIGEST="$previous_api_digest"
    RETRY_PREVIOUS_WEB_DIGEST="$previous_web_digest"
    RETRY_RECOVERY_ACTIVE=true
    return 0
  done < <(ls -1dt "$DEPLOYMENTS_DIR"/deploy-*.txt "$DEPLOYMENTS_DIR"/rollback-*.txt 2>/dev/null || true)

  fail 'Validated migration retry requires a failed deployment record with predecessor image state'
}

write_record() {
  local status="$1" temporary_record recovery_id recovery_receipt recovery_bundle recovery_receipt_hash recovery_source_sha recovery_remote_root
  install -d -m 700 "$DEPLOYMENTS_DIR"
  umask 077
  if [[ "$RECOVERY_POINT_VALID" == PASS ]]; then
    recovery_id="$RECOVERY_POINT_ID"
    recovery_bundle="$RECOVERY_POINT_STATE_DIR/capture"
    recovery_receipt="$recovery_bundle/metadata/recovery-point-receipt.json"
    recovery_receipt_hash="$RECOVERY_POINT_CAPTURE_RECEIPT_SHA256"
    recovery_source_sha="$PREVIOUS_SHA"
    recovery_remote_root="$RECOVERY_POINT_REMOTE_ROOT"
  else
    recovery_id='NOT_EVALUATED'; recovery_receipt='NOT_EVALUATED'; recovery_bundle='NOT_EVALUATED'
    recovery_receipt_hash='NOT_EVALUATED'; recovery_source_sha='NOT_EVALUATED'; recovery_remote_root='NOT_EVALUATED'
  fi
  temporary_record="$(mktemp "$DEPLOYMENTS_DIR/.${RECORD##*/}.tmp.XXXXXX")"
  {
    printf 'timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'status=%s\n' "$status"
    printf 'phase=%s\n' "$PHASE"
    printf 'previous_sha=%s\n' "$PREVIOUS_SHA"
    printf 'target_sha=%s\n' "$TARGET_SHA"
    printf 'previous_api_digest=%s\n' "$PREVIOUS_API_DIGEST"
    printf 'previous_web_digest=%s\n' "$PREVIOUS_WEB_DIGEST"
    printf 'new_api_digest=%s\n' "$NEW_API_DIGEST"
    printf 'new_web_digest=%s\n' "$NEW_WEB_DIGEST"
    printf 'recovery_point_id=%s\n' "$recovery_id"
    printf 'recovery_point_receipt_path=%s\n' "$recovery_receipt"
    printf 'recovery_point_bundle_path=%s\n' "$recovery_bundle"
    printf 'recovery_point_receipt_sha256=%s\n' "$recovery_receipt_hash"
    printf 'recovery_point_source_sha=%s\n' "$recovery_source_sha"
    printf 'recovery_point_remote_root=%s\n' "$recovery_remote_root"
    printf 'backup_id=%s\n' "$BACKUP_ID"
    printf 'migration_count=%s\n' "$MIGRATION_COUNT"
    printf 'rollback_receipt=%s\n' "$ROLLBACK_RECEIPT"
    printf 'rollback_compatibility_basis=%s\n' "$ROLLBACK_COMPATIBILITY_BASIS"
    printf 'storage_transition=%s\n' "${STORAGE_TRANSITION#STORAGE_TRANSITION=}"
    printf 'database_rollback=never-automatic\n'
    printf 'services_recreated=buildingos-api buildingos-web\n'
    printf 'seeds=no\n'
  } > "$temporary_record"
  chmod 600 "$temporary_record"
  mv -f -- "$temporary_record" "$RECORD"
}

publish_current_successful_selector() {
  local temporary_selector
  [[ "$RECORD" == "$DEPLOYMENTS_DIR/"* && "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || return 1
  temporary_selector="$(mktemp "$DEPLOYMENTS_DIR/.current-successful-deployment.v1.tmp.XXXXXX")" || return 1
  {
    printf 'format=buildingos-current-successful-deployment/v1\n'
    printf 'record_path=%s\n' "$RECORD"
    printf 'target_sha=%s\n' "$TARGET_SHA"
  } > "$temporary_selector" || return 1
  chmod 600 "$temporary_selector" || return 1
  mv -f -- "$temporary_selector" "$CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR"
}

on_error() {
  local rc=$?
  trap - ERR
  recovery_point_restore_and_resume || true
  [[ "$RECORD_SUCCESS" == true ]] || write_record FAILED || true
  printf 'Production deployment stopped in phase %s (exit %s). No automatic rollback or database restore was attempted.\n' "$PHASE" "$rc" >&2
  exit "$rc"
}

on_signal() {
  local signal="$1" rc=1
  case "$signal" in INT) rc=130 ;; TERM) rc=143 ;; esac
  trap - ERR INT TERM
  recovery_point_restore_and_resume || true
  [[ "$RECORD_SUCCESS" == true ]] || write_record FAILED || true
  printf 'Production deployment interrupted in phase %s; recovery-point policy restoration was attempted before exit.\n' "$PHASE" >&2
  exit "$rc"
}

on_exit() {
  local rc=$?
  trap - EXIT
  recovery_point_restore_and_resume || true
  cleanup_target_tree
  return "$rc"
}

trap on_error ERR
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap on_exit EXIT

check_http() {
  local label="$1"
  local url="$2"
  for _ in {1..12}; do
    if curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$url" >/dev/null; then
      printf '%s passed\n' "$label"
      return 0
    fi
    sleep 5
  done
  fail "$label failed after 12 attempts"
}

wait_for_container_health() {
  local container="$1"
  local status
  for _ in {1..18}; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
    [[ "$status" == 'healthy' ]] && return 0
    [[ "$status" == 'unhealthy' || "$status" == 'exited' || "$status" == 'dead' ]] && fail "$container entered state $status"
    sleep 5
  done
  fail "$container did not become healthy"
}

check_ignored_sensitive_files() {
  local path pattern
  local runtime_env_excluded=false

  while IFS= read -r pattern; do
    [[ "$pattern" =~ ^[[:space:]]*! ]] && fail "Docker ignore negations require an explicit production security review"
    if [[ "$pattern" == '**/.env' || "$pattern" == 'infra/docker/.env' ]]; then
      runtime_env_excluded=true
    fi
  done < .dockerignore
  [[ "$runtime_env_excluded" == true ]] || fail "$ALLOWED_IGNORED_RUNTIME_ENV is not excluded from the Docker context"

  while IFS= read -r path; do
    case "$path" in
      .env|.env.*|*/.env|*/.env.*|*.pem|*.key|*.p12|*.pfx|*.crt|*.log|*.dump|*.sql|*.bak|*.backup)
        [[ "$path" == "$ALLOWED_IGNORED_RUNTIME_ENV" ]] && continue
        fail "Unapproved sensitive ignored file exists in the production checkout: $path"
        ;;
    esac
  done < <(git ls-files --others --ignored --exclude-standard)
}

recovery_point_read_selected_config() {
  local file="$1" expected_name="$2" line name value count=0
  [[ -f "$file" && ! -L "$file" && -r "$file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == "$expected_name"=* ]] || continue
    name="${line%%=*}"
    value="${line#*=}"
    [[ "$name" == "$expected_name" && -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
    count=$((count + 1))
    [[ "$count" -eq 1 ]] || return 1
    printf '%s' "$value"
  done < "$file"
  [[ "$count" -eq 1 ]]
}

recovery_point_read_container_env() {
  local container="$1" expected_name="$2" line name value count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == "$expected_name"=* ]] || continue
    name="${line%%=*}"
    value="${line#*=}"
    [[ "$name" == "$expected_name" && -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
    count=$((count + 1))
    [[ "$count" -eq 1 ]] || return 1
    printf '%s' "$value"
  done < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container")
  [[ "$count" -eq 1 ]]
}

recovery_point_normalize_s3_value() {
  local name="$1" value="$2"
  case "$name" in
    S3_ENDPOINT) [[ -n "$value" ]] || return 1 ;;
    S3_BUCKET) s3_fence_bucket "$value" || return 1 ;;
    S3_REGION) [[ "$value" =~ ^[A-Za-z0-9-]+$ ]] || return 1 ;;
    S3_FORCE_PATH_STYLE) [[ "$value" == true || "$value" == false ]] || return 1 ;;
    *) return 1 ;;
  esac
  printf '%s' "$value"
}

recovery_point_read_effective_selected_value() {
  local source="$1" expected_name="$2" default_value="$3" line name value='' count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || continue
    name="${line%%=*}"
    [[ "$name" == "$expected_name" ]] || continue
    value="${line#*=}"
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
    count=$((count + 1))
    [[ "$count" -eq 1 ]] || return 1
  done < "$source"
  if [[ "$count" -eq 0 || -z "$value" ]]; then
    [[ -n "$default_value" ]] || return 1
    value="$default_value"
  fi
  recovery_point_normalize_s3_value "$expected_name" "$value"
}

recovery_point_validate_api_s3_runtime_env() {
  local api_env="$1" container="$2" name default_value file_value runtime_value
  s3_fence_private_readable_file "$api_env" || return 1
  for name in S3_ENDPOINT S3_BUCKET S3_REGION S3_FORCE_PATH_STYLE; do
    default_value=''
    case "$name" in
      S3_REGION) default_value='us-east-1' ;;
      S3_FORCE_PATH_STYLE) default_value=false ;;
    esac
    file_value="$(recovery_point_read_effective_selected_value "$api_env" "$name" "$default_value")" || return 1
    if ! runtime_value="$(recovery_point_read_container_env "$container" "$name" 2>/dev/null)"; then
      runtime_value=''
    fi
    if [[ -z "$runtime_value" ]]; then
      [[ -n "$default_value" ]] || return 1
      runtime_value="$default_value"
    fi
    runtime_value="$(recovery_point_normalize_s3_value "$name" "$runtime_value")" || return 1
    [[ "$file_value" == "$runtime_value" ]] || return 1
  done
}

recovery_point_validate_backup_destination() {
  local source_bucket="$1" destination="$2" recovery_root="$3" destination_path destination_bucket
  s3_fence_bucket "$source_bucket" || return 1
  recovery_point_rclone_safe_remote_root "$destination" || return 1
  recovery_point_rclone_safe_remote_root "$recovery_root" || return 1
  destination_path="${destination#*:}"
  destination_bucket="${destination_path%%/*}"
  s3_fence_bucket "$destination_bucket" || return 1
  [[ "$destination_bucket" != "$source_bucket" ]] || return 1
  [[ "$recovery_root" == "${destination%/}/recovery-points/"* ]]
}

recovery_point_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null
}

recovery_point_create_private_state_dir() {
  local parent="$1" sha_prefix="$2"
  [[ "$sha_prefix" =~ ^[0-9a-f]{12}$ && ! -L "$parent" ]] || return 1
  if [[ -e "$parent" ]]; then
    [[ -d "$parent" && "$(recovery_point_mode "$parent")" == 700 ]] || return 1
  else
    (umask 077; mkdir -m 0700 "$parent") || return 1
    [[ -d "$parent" && ! -L "$parent" && "$(recovery_point_mode "$parent")" == 700 ]] || return 1
  fi
  RECOVERY_POINT_STATE_DIR="$(umask 077; mktemp -d "$parent/recovery-point-${sha_prefix}.XXXXXX")" || return 1
  [[ -d "$RECOVERY_POINT_STATE_DIR" && ! -L "$RECOVERY_POINT_STATE_DIR" && "$(recovery_point_mode "$RECOVERY_POINT_STATE_DIR")" == 700 ]]
}

recovery_point_generate_id() {
  local timestamp random
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)" || return 1
  timestamp="$(printf '%s' "$timestamp" | tr '[:upper:]' '[:lower:]')" || return 1
  random="$(openssl rand -hex 12)" || return 1
  RECOVERY_POINT_ID="${PREVIOUS_SHA:0:12}-${timestamp}-${random}"
  [[ "$RECOVERY_POINT_ID" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]]
}

recovery_point_quiesce_api() {
  if [[ "$RECOVERY_POINT_API_WAS_RUNNING" == true ]]; then
    docker stop --timeout 30 buildingos-api >/dev/null
    [[ "$(docker inspect --format '{{.State.Running}}' buildingos-api)" == false ]] || return 1
    RECOVERY_POINT_API_QUIESCED=true
  else
    [[ "$(docker inspect --format '{{.State.Running}}' buildingos-api)" == false ]]
  fi
}

recovery_point_resume_api() {
  [[ "$RECOVERY_POINT_API_QUIESCED" == true ]] || return 0
  # This callback is reached only after the fence library proved original policy readback.
  RECOVERY_POINT_POLICY_RESTORED=true
  if [[ "$RECOVERY_POINT_API_WAS_RUNNING" == true ]]; then
    docker start buildingos-api >/dev/null
    wait_for_container_health buildingos-api
  fi
  RECOVERY_POINT_API_QUIESCED=false
}

recovery_point_capture_under_fence() {
  local receipt="$RECOVERY_POINT_STATE_DIR/capture/metadata/recovery-point-receipt.json"
  [[ -r "$RECOVERY_POINT_FENCE_EVIDENCE/policy-snapshot/bucket" ]] || return 1
  [[ "$(<"$RECOVERY_POINT_FENCE_EVIDENCE/policy-snapshot/bucket")" == "$RECOVERY_POINT_SOURCE_BUCKET" ]] || {
    printf 'ERROR: Recovery-point source bucket does not agree with the policy snapshot\n' >&2
    return 1
  }
  recovery_point_capture_create "$POSTGRES_CONTAINER" buildingos_db "$RECOVERY_POINT_POSTGRES_USER" \
    "$PREVIOUS_API_DIGEST" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" "$RECOVERY_POINT_SOURCE_BUCKET" \
    "$RECOVERY_POINT_RCLONE_BIN" "$RECOVERY_POINT_RCLONE_CONFIG" "$RECOVERY_POINT_REMOTE_ROOT" \
    "$RECOVERY_POINT_STATE_DIR/capture" "$PREVIOUS_SHA" "$RECOVERY_POINT_ID" || return 1
  [[ "$RECOVERY_POINT_VALID" == PASS && -r "$receipt" ]] || return 1
}

recovery_point_validate_capture() {
  local receipt="$RECOVERY_POINT_STATE_DIR/capture/metadata/recovery-point-receipt.json"
  [[ "$RECOVERY_POINT_VALID" == PASS && "$RECOVERY_POINT_CAPTURE_BACKUP_SET_ID" == "$RECOVERY_POINT_ID" && "$RECOVERY_POINT_CAPTURE_RECEIPT_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  s3_fence_private_readable_file "$receipt" || return 1
  jq -e --arg sha "$PREVIOUS_SHA" --arg id "$RECOVERY_POINT_ID" --arg remote "$RECOVERY_POINT_REMOTE_ROOT" '
    .format == "buildingos-recovery-point/v1" and .status == "PASS"
    and .sourceAppSha == $sha and .backupSetId == $id and .remoteRoot == $remote
    and (.statuses | type == "object" and .databaseArchive == "PASS" and .referenceCount == "PASS"
      and .contentIdentity == "PASS" and .remoteDump == "PASS" and .inputManifest == "PASS"
      and .contentManifest == "PASS" and .hashes == "PASS")
  ' "$receipt" >/dev/null
}

recovery_point_restore_and_resume() {
  if [[ "$RECOVERY_POINT_POLICY_RESTORED" != true && -n "$RECOVERY_POINT_FENCE_EVIDENCE" && -d "$RECOVERY_POINT_FENCE_EVIDENCE" && ! -L "$RECOVERY_POINT_FENCE_EVIDENCE" && -d "$RECOVERY_POINT_FENCE_EVIDENCE/policy-snapshot" && ! -L "$RECOVERY_POINT_FENCE_EVIDENCE/policy-snapshot" ]]; then
    if ! s3_fence_restore_policy "$PREVIOUS_API_DIGEST" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" "$RECOVERY_POINT_FENCE_EVIDENCE/policy-snapshot"; then
      printf 'ERROR: Recovery-point policy restoration is unverified; buildingos-api remains stopped. Operator intervention is required.\n' >&2
      return 1
    fi
    RECOVERY_POINT_POLICY_RESTORED=true
  elif [[ "$RECOVERY_POINT_API_QUIESCED" == true && "$RECOVERY_POINT_POLICY_RESTORED" != true ]]; then
    printf 'ERROR: Recovery-point policy restoration is unverified; buildingos-api remains stopped. Operator intervention is required.\n' >&2
    return 1
  fi
  recovery_point_resume_api
}

recovery_point_preflight() {
  local api_digest api_running
  [[ "$PREVIOUS_API_DIGEST" =~ ^sha256:[0-9a-f]{64}$ && "$ENV_FILE" == '/opt/pawtech/env/buildingos.env' ]] || return 1
  api_digest="$(docker inspect --format '{{.Image}}' buildingos-api)"
  [[ "$api_digest" == "$PREVIOUS_API_DIGEST" ]] || return 1
  api_running="$(docker inspect --format '{{.State.Running}}' buildingos-api)"
  [[ "$api_running" == true || "$api_running" == false ]] || return 1
  [[ "$api_running" == true ]] && RECOVERY_POINT_API_WAS_RUNNING=true
  recovery_point_validate_api_s3_runtime_env "$ENV_FILE" buildingos-api || return 1
  RECOVERY_POINT_SOURCE_BUCKET="$(recovery_point_read_container_env buildingos-api S3_BUCKET)" || return 1
  s3_fence_bucket "$RECOVERY_POINT_SOURCE_BUCKET" || return 1
  RECOVERY_POINT_POSTGRES_USER="$(recovery_point_read_container_env "$POSTGRES_CONTAINER" POSTGRES_USER)" || return 1
  [[ "$RECOVERY_POINT_POSTGRES_USER" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || return 1
  grep -Eq '^[[:space:]]*pawtech_public:[[:space:]]*$' "$COMPOSE_FILE" || return 1
  docker network inspect "$RECOVERY_POINT_DOCKER_NETWORK" >/dev/null
  recovery_point_postgres_snapshot_require_runtime "$POSTGRES_CONTAINER" || return 1
  s3_fence_private_readable_file "$RECOVERY_POINT_OBJECT_BACKUP_ENV" || return 1
  RECOVERY_POINT_RCLONE_CONFIG="$(recovery_point_read_selected_config "$RECOVERY_POINT_OBJECT_BACKUP_ENV" RCLONE_CONFIG)" || return 1
  RECOVERY_POINT_OBJECT_BACKUP_DESTINATION="$(recovery_point_read_selected_config "$RECOVERY_POINT_OBJECT_BACKUP_ENV" OBJECT_BACKUP_DESTINATION)" || return 1
  [[ "$RECOVERY_POINT_RCLONE_CONFIG" =~ ^/[A-Za-z0-9._/-]+$ && "$RECOVERY_POINT_RCLONE_CONFIG" != *'..'* && "$RECOVERY_POINT_RCLONE_CONFIG" != *'//' ]] || return 1
  recovery_point_rclone_safe_remote_root "$RECOVERY_POINT_OBJECT_BACKUP_DESTINATION" || return 1
  RECOVERY_POINT_RCLONE_BIN="$(command -v rclone)" || return 1
  recovery_point_rclone_require_download_check "$RECOVERY_POINT_RCLONE_BIN" "$RECOVERY_POINT_RCLONE_CONFIG" || return 1
  command -v openssl >/dev/null 2>&1 || return 1
  recovery_point_create_private_state_dir "$RECOVERY_POINT_STATE_PARENT" "${PREVIOUS_SHA:0:12}" || return 1
  recovery_point_generate_id || return 1
  RECOVERY_POINT_REMOTE_ROOT="${RECOVERY_POINT_OBJECT_BACKUP_DESTINATION%/}/recovery-points/$PREVIOUS_SHA/$RECOVERY_POINT_ID"
  recovery_point_validate_backup_destination "$RECOVERY_POINT_SOURCE_BUCKET" "$RECOVERY_POINT_OBJECT_BACKUP_DESTINATION" "$RECOVERY_POINT_REMOTE_ROOT" || return 1
  mkdir -m 0700 "$RECOVERY_POINT_STATE_DIR/preflight" "$RECOVERY_POINT_STATE_DIR/capture"
  s3_fence_preflight "$PREVIOUS_API_DIGEST" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" "$RECOVERY_POINT_STATE_DIR/preflight" || return 1
  RECOVERY_POINT_FENCE_EVIDENCE="$RECOVERY_POINT_STATE_DIR/fence"
}

if [[ "${BUILDINGOS_DEPLOY_RECOVERY_POINT_LIBRARY_ONLY:-false}" == true && "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

for sha in "$TARGET_SHA" "$APPROVED_SHA" "$EXPECTED_CURRENT_SHA"; do
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "Every SHA must be exactly 40 lowercase hexadecimal characters"
done
[[ "$TARGET_SHA" == "$APPROVED_SHA" ]] || fail "Target SHA does not match the approved SHA"
for url in "$API_HEALTH_URL" "$API_READYZ_URL" "$WEB_LOGIN_URL"; do
  [[ "$url" =~ ^https://[A-Za-z0-9._:/?=%+-]+$ ]] || fail "Unsafe production health URL"
done

for command in git docker curl sha256sum stat; do
  command -v "$command" >/dev/null || fail "$command is required"
done
[[ -f "$BACKUP_IDENTITY_MANIFEST" && ! -L "$BACKUP_IDENTITY_MANIFEST" ]] || fail "Trusted backup identity manifest is missing or invalid"
validate_backup_manifest "$BACKUP_IDENTITY_MANIFEST"
[[ -d "$APP_DIR/.git" ]] || fail "Production checkout is missing"
[[ -r "$ENV_FILE" ]] || fail "Production env file is missing or unreadable"

cd "$APP_DIR"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail "Production checkout is not clean"
check_ignored_sensitive_files
[[ "$(git rev-parse HEAD)" == "$EXPECTED_CURRENT_SHA" ]] || fail "Production checkout changed since approval"
git fetch --no-tags origin main
git cat-file -e "$TARGET_SHA^{commit}"
git merge-base --is-ancestor "$TARGET_SHA" origin/main || fail "Target SHA is not reachable from origin/main"

for container in "$POSTGRES_CONTAINER" pawtech-redis pawtech-traefik; do
  docker inspect "$container" >/dev/null 2>&1 || fail "Required production container is unavailable: $container"
done

export IMAGE_TAG="$TARGET_SHA"
export BUILD_REVISION="$TARGET_SHA"
materialize_target_tree
readonly TARGET_COMPOSE_FILE="$TARGET_TREE/$COMPOSE_FILE"
target_compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$TARGET_COMPOSE_FILE")
"${target_compose[@]}" config --quiet
"${target_compose[@]}" --profile migrate config --quiet
validate_database_migration_state "$TARGET_TREE/scripts/verify-production-migration-manifest.sh"
if [[ "$MIGRATION_RETRY" == true ]]; then
  load_retry_predecessor_record
fi
STORAGE_TRANSITION="$(
  STORAGE_CUTOVER_ALLOW_UNHEALTHY_RETRY="$RETRY_RECOVERY_ACTIVE" \
  STORAGE_CUTOVER_CURRENT_PROVIDER="$RETRY_CURRENT_PROVIDER" \
    bash "$STORAGE_CUTOVER_GUARD" "$ENV_FILE" "$TARGET_COMPOSE_FILE" "$PROJECT_NAME"
)"
readonly STORAGE_TRANSITION
[[ "$STORAGE_TRANSITION" =~ ^STORAGE_TRANSITION=(MINIO|EXTERNAL_S3):(MINIO|EXTERNAL_S3)$ ]] \
  || fail 'Storage transition guard returned an invalid classification'
cleanup_target_tree

if [[ "$RETRY_RECORD_ACTIVE" == true ]]; then
  PREVIOUS_API_DIGEST="$RETRY_PREVIOUS_API_DIGEST"
  PREVIOUS_WEB_DIGEST="$RETRY_PREVIOUS_WEB_DIGEST"
else
  PREVIOUS_API_DIGEST="$(docker inspect --format '{{.Image}}' buildingos-api)"
  PREVIOUS_WEB_DIGEST="$(docker inspect --format '{{.Image}}' buildingos-web)"
fi
[[ "$PREVIOUS_API_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Unable to capture previous API digest"
[[ "$PREVIOUS_WEB_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Unable to capture previous Web digest"
PREVIOUS_API_REVISION="$(docker image inspect "$PREVIOUS_API_DIGEST" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
PREVIOUS_WEB_REVISION="$(docker image inspect "$PREVIOUS_WEB_DIGEST" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
[[ "$PREVIOUS_API_REVISION" =~ ^[0-9a-f]{40}$ ]] || fail "Previous API image revision is invalid"
[[ "$PREVIOUS_WEB_REVISION" =~ ^[0-9a-f]{40}$ ]] || fail "Previous Web image revision is invalid"
[[ "$PREVIOUS_API_REVISION" == "$PREVIOUS_WEB_REVISION" ]] || fail "Previous API and Web image revisions disagree"
PREVIOUS_SHA="$PREVIOUS_API_REVISION"
if [[ "$RETRY_RECORD_ACTIVE" == true ]]; then
  [[ "$PREVIOUS_SHA" == "$RETRY_PREVIOUS_SHA" ]] || fail "Retry predecessor image revision does not match the failed deployment record"
fi

# This gate is deliberately before the deployment checkpoint, normal backup, checkout, build, and migrations.
PHASE='recovery-point-preflight'
recovery_point_preflight || fail 'Recovery-point preflight failed before API quiescence'
PHASE='recovery-point-capture'
s3_fence_run_recovery_point "$PREVIOUS_API_DIGEST" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" \
  "$RECOVERY_POINT_FENCE_EVIDENCE" recovery_point_quiesce_api recovery_point_capture_under_fence recovery_point_resume_api \
  || fail 'Recovery-point capture or policy restoration failed'
recovery_point_validate_capture || fail 'Recovery-point receipt did not prove every required component'
[[ "$RECOVERY_POINT_VALID" == PASS ]] || fail 'Recovery point did not reach PASS'

PHASE='pre-migration'
write_record IN_PROGRESS

PHASE='backup'
# Backup names are generated by the official backup script and contain no whitespace.
latest_before="$(ls -1dt "$BACKUP_ROOT"/* 2>/dev/null | sed -n '1p' || true)"
run_validated_backup "$BACKUP_IDENTITY_MANIFEST"
latest_after="$(ls -1dt "$BACKUP_ROOT"/* 2>/dev/null | sed -n '1p' || true)"
[[ -n "$latest_after" && "$latest_after" != "$latest_before" ]] || fail "Backup script did not create a new backup directory"
backup_dump="$(ls -1 "$latest_after"/buildingos_db_*.dump 2>/dev/null | sed -n '1p')"
backup_sha="$backup_dump.sha256"
[[ -s "$backup_dump" && -s "$backup_sha" ]] || fail "BuildingOS backup or checksum is missing"
sha256sum -c "$backup_sha" >/dev/null
docker exec -i "$POSTGRES_CONTAINER" pg_restore --list < "$backup_dump" >/dev/null
BACKUP_ID="$(basename "$latest_after")/$(basename "$backup_dump")"

PHASE='checkout'
git switch --detach --quiet "$TARGET_SHA"
[[ "$(git rev-parse HEAD)" == "$TARGET_SHA" ]] || fail "Detached checkout did not reach the target SHA"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail "Checkout became dirty"
check_ignored_sensitive_files

PHASE='migration-manifest-files'
[[ -f ./scripts/verify-production-migration-manifest.sh && ! -L ./scripts/verify-production-migration-manifest.sh ]] \
  || fail "Target migration manifest verifier is missing or invalid"
bash ./scripts/verify-production-migration-manifest.sh verify-files

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$COMPOSE_FILE")

PHASE='build'
"${compose[@]}" --profile migrate build buildingos-migrate
"${compose[@]}" build buildingos-api buildingos-web
for image in buildingos-api buildingos-web; do
  revision="$(docker image inspect "$image:$TARGET_SHA" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
  [[ "$revision" == "$TARGET_SHA" ]] || fail "$image OCI revision does not match target SHA"
done

PHASE='migration-baseline'
env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db ./scripts/verify-production-migration-baseline.sh
validate_database_migration_state ./scripts/verify-production-migration-manifest.sh

if [[ "$RETRY_RECOVERY_ACTIVE" == false ]]; then
  case "$STORAGE_TRANSITION" in
    STORAGE_TRANSITION=MINIO:MINIO|STORAGE_TRANSITION=EXTERNAL_S3:EXTERNAL_S3)
      wait_for_container_health buildingos-api
      wait_for_container_health buildingos-web
      ;;
  esac
fi

PHASE='migrations'
if [[ "$MIGRATION_RETRY" == false ]]; then
  "${compose[@]}" --profile migrate run --rm --no-deps -T buildingos-migrate < /dev/null
fi
"${compose[@]}" --profile migrate run --rm --no-deps -T buildingos-migrate migrate status --schema apps/api/prisma/schema.prisma < /dev/null
env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db \
  bash ./scripts/verify-production-migration-manifest.sh verify-db post
MIGRATION_COUNT="$(docker exec "$POSTGRES_CONTAINER" sh -lc 'exec psql -qAt -U "$POSTGRES_USER" -d buildingos_db -c '\''SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'\''')"
[[ "$MIGRATION_COUNT" == '99' ]] || fail "Final migration count is not exactly 99"

PHASE='rollback-compatibility'
validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db "$PREVIOUS_SHA" "$TARGET_SHA"
ROLLBACK_RECEIPT="$(generate_rollback_compatibility_receipt \
  "$TARGET_SHA" "$PREVIOUS_SHA" "$PREVIOUS_API_DIGEST" "$PREVIOUS_WEB_DIGEST" "$MIGRATION_COUNT")"

PHASE='application-recreate'
"${compose[@]}" up --detach --no-deps --force-recreate buildingos-api buildingos-web
wait_for_container_health buildingos-api
wait_for_container_health buildingos-web
check_http api-health "$API_HEALTH_URL"
check_http api-readyz "$API_READYZ_URL"
check_http web-login "$WEB_LOGIN_URL"

NEW_API_DIGEST="$(docker inspect --format '{{.Image}}' buildingos-api)"
NEW_WEB_DIGEST="$(docker inspect --format '{{.Image}}' buildingos-web)"
[[ "$NEW_API_DIGEST" == "$(docker image inspect "buildingos-api:$TARGET_SHA" --format '{{.Id}}')" ]] || fail "Running API digest does not match target image"
[[ "$NEW_WEB_DIGEST" == "$(docker image inspect "buildingos-web:$TARGET_SHA" --format '{{.Id}}')" ]] || fail "Running Web digest does not match target image"
[[ "$(docker image inspect "$NEW_API_DIGEST" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$TARGET_SHA" ]] || fail "Running API revision does not match target SHA"
[[ "$(docker image inspect "$NEW_WEB_DIGEST" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$TARGET_SHA" ]] || fail "Running Web revision does not match target SHA"

PHASE='observability'
critical_logs=0
for container in buildingos-api buildingos-web; do
  count="$(docker logs --since "$DEPLOY_STARTED_AT" "$container" 2>&1 | grep -Eic 'PrismaClient|P20[0-9]{2}|FATAL|PANIC' || true)"
  critical_logs=$((critical_logs + count))
done
[[ "$critical_logs" -eq 0 ]] || fail "Critical post-deploy log patterns detected"

PHASE='complete'
write_record SUCCESS
RECORD_SUCCESS=true
if ! publish_current_successful_selector; then
  trap - ERR INT TERM
  printf 'ERROR: deployment record succeeded but the current-successful selector was not published; the prior selector remains authoritative\n' >&2
  exit 1
fi
printf 'Production deployment completed at exact SHA %s\n' "$TARGET_SHA"
