#!/usr/bin/env bash
set -Eeuo pipefail

# One-shot Staging capture adapter. It deliberately does not source deploy-production.sh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly STAGING_API_CONTAINER='buildingos-staging-api'
readonly STAGING_POSTGRES_CONTAINER='buildingos-staging-postgres'
readonly STAGING_NETWORK='buildingos-staging_buildingos_staging_net'
readonly STAGING_ENV_FILE='/opt/pawtech/env/buildingos-staging.env'
readonly STAGING_BUCKET='buildingos-staging'
readonly STAGING_DESTINATION='stagingtest:buildingos-staging/staging-recovery-points'
readonly STAGING_STATE_PARENT='/opt/pawtech/backups/buildingos-staging-recovery-points'
# shellcheck disable=SC1091 # Trusted library root is resolved from this script at runtime.
source "$SCRIPT_DIR/lib/recovery-point-capture.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/production-s3-write-fence.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/production-operation-lock.sh"

usage() { cat >&2 <<'EOF'
Usage: capture-recovery-point-staging.sh --source-app-sha SHA --api-container NAME \
  --postgres-container NAME --database NAME --api-env-file PATH --s3-env-file PATH \
  --network NAME --destination REMOTE:BUCKET/PREFIX --rclone-config PATH \
  --state-parent PATH --lock-path PATH
EOF
  return 2
}
fail() { printf 'STAGING_RECOVERY_POINT=FAIL\nREASON=%s\n' "$1" >&2; return 1; }
valid_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
valid_name() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; }
valid_absolute_path() { [[ "$1" == /* && "$1" != *$'\n'* && "$1" != *$'\r'* ]]; }
valid_remote() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}:[a-z0-9][a-z0-9._/-]{1,255}$ ]]; }
safe_private_file() { [[ -f "$1" && ! -L "$1" ]] && [[ "$(recovery_point_portable_stat_mode "$1")" == 600 ]]; }

source_app_sha=''; api_container=''; postgres_container=''; database=''; api_env=''; s3_env=''
network=''; destination=''; rclone_config=''; state_parent=''; lock_path=''
while (($#)); do
  case "$1" in
    --source-app-sha) source_app_sha="${2-}"; shift 2;;
    --api-container) api_container="${2-}"; shift 2;;
    --postgres-container) postgres_container="${2-}"; shift 2;;
    --database) database="${2-}"; shift 2;;
    --api-env-file) api_env="${2-}"; shift 2;;
    --s3-env-file) s3_env="${2-}"; shift 2;;
    --network) network="${2-}"; shift 2;;
    --destination) destination="${2-}"; shift 2;;
    --rclone-config) rclone_config="${2-}"; shift 2;;
    --state-parent) state_parent="${2-}"; shift 2;;
    --lock-path) lock_path="${2-}"; shift 2;;
    -h|--help) usage;;
    *) usage;;
  esac
done

valid_sha "$source_app_sha" || fail 'source SHA is invalid'
[[ "$api_container" == "$STAGING_API_CONTAINER" ]] || fail 'only the Staging API container is permitted'
[[ "$postgres_container" == "$STAGING_POSTGRES_CONTAINER" ]] || fail 'only the Staging PostgreSQL container is permitted'
[[ "$network" == "$STAGING_NETWORK" ]] || fail 'only the Staging network is permitted'
valid_name "$database" || fail 'database name is invalid'
valid_remote "$destination" || fail 'destination is invalid'
[[ "$destination" == "$STAGING_DESTINATION" ]] || fail 'destination is not the fixed Staging destination'
[[ "$api_env" == "$STAGING_ENV_FILE" && "$s3_env" == "$STAGING_ENV_FILE" ]] || fail 'only the protected Staging environment file is permitted'
if ! valid_absolute_path "$rclone_config" || ! valid_absolute_path "$state_parent" || ! valid_absolute_path "$lock_path"; then fail 'paths must be absolute'; fi
if ! safe_private_file "$api_env" || ! safe_private_file "$s3_env" || ! safe_private_file "$rclone_config"; then fail 'protected environment and rclone files are required'; fi
[[ "$rclone_config" == /tmp/buildingos-staging-rclone.*/rclone.conf ]] || fail 'only an ephemeral Staging rclone config is permitted'
[[ "$state_parent" == "$STAGING_STATE_PARENT" ]] || fail 'only the protected Staging state directory is permitted'
[[ "$lock_path" == "$state_parent"/* ]] || fail 'lock path must be inside the staging state parent'
[[ "$lock_path" != */production-operations.lock ]] || fail 'production lock path is forbidden'
command -v docker >/dev/null 2>&1 || fail 'docker is required'
command -v rclone >/dev/null 2>&1 || fail 'rclone is required'
command -v jq >/dev/null 2>&1 || fail 'jq is required'

docker inspect "$api_container" >/dev/null 2>&1 || fail 'staging API container is unavailable'
docker inspect "$postgres_container" >/dev/null 2>&1 || fail 'staging PostgreSQL container is unavailable'
docker network inspect "$network" >/dev/null 2>&1 || fail 'staging Docker network is unavailable'

container_env() {
  local container="$1" key="$2" value
  value="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }')" || return 1
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
  printf '%s\n' "$value"
}

source_bucket="$(container_env "$api_container" S3_BUCKET)" || fail 'staging API bucket is unavailable'
postgres_user="$(container_env "$postgres_container" POSTGRES_USER)" || fail 'staging PostgreSQL user is unavailable'
s3_fence_bucket "$source_bucket" || fail 'staging source bucket is invalid'
[[ "$source_bucket" == "$STAGING_BUCKET" ]] || fail 'source bucket is not the fixed Staging bucket'
[[ "$postgres_user" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail 'staging PostgreSQL user is invalid'

api_image="$(docker inspect --format '{{.Image}}' "$api_container")" || fail 'staging API image is unavailable'
s3_fence_image "$api_image" || fail 'running staging API image is not digest-addressed'
[[ -d "$state_parent" && ! -L "$state_parent" ]] || fail 'state parent must exist and not be a symlink'
[[ "$(recovery_point_portable_stat_mode "$state_parent")" == 700 ]] || fail 'state parent must be private'
operation_id="staging-${source_app_sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8)"
valid_name "$operation_id" || fail 'operation id is invalid'
operation_root="$state_parent/operations/$operation_id"; evidence="$operation_root/fence"; capture_root="$operation_root/capture"
[[ ! -e "$state_parent/operations" || ! -L "$state_parent/operations" ]] || fail 'operations directory must not be a symlink'
mkdir -p -- "$state_parent/operations" "$operation_root" "$capture_root"
chmod 0700 "$state_parent/operations" "$operation_root" "$capture_root"
RECOVERY_POINT_STAGING_RESUMED=false
trap 'production_operation_lock_release >/dev/null 2>&1 || true; if [[ "$RECOVERY_POINT_STAGING_RESUMED" != true ]]; then printf "STAGING_RECOVERY_POINT=MANUAL_REVIEW_REQUIRED\nREASON=interrupted operation; inspect fence state before retrying\n" >&2; fi' EXIT

remote_root="$destination/$source_app_sha/$operation_id"
recovery_point_rclone_safe_remote_root "$remote_root" || fail 'remote root is invalid'
recovery_point_rclone_require_download_check rclone "$rclone_config" || fail 'rclone download capability is unavailable'

RECOVERY_POINT_STAGING_API_WAS_RUNNING=false
RECOVERY_POINT_STAGING_QUIESCED=false
recovery_point_staging_quiesce() {
  [[ "$(docker inspect --format '{{.State.Running}}' "$api_container")" == true ]] || return 0
  RECOVERY_POINT_STAGING_API_WAS_RUNNING=true
  docker stop --time 30 "$api_container" >/dev/null || return 1
  RECOVERY_POINT_STAGING_QUIESCED=true
}
recovery_point_staging_capture() {
  recovery_point_capture_create "$postgres_container" "$database" "$postgres_user" \
    "$api_image" "$api_env" "$network" "$source_bucket" rclone "$rclone_config" \
    "$remote_root" "$capture_root" "$source_app_sha" "$operation_id" || return 1
  [[ "${RECOVERY_POINT_VALID:-}" == PASS ]]
}
recovery_point_staging_resume() {
  if [[ "$RECOVERY_POINT_STAGING_API_WAS_RUNNING" == true && "$RECOVERY_POINT_STAGING_QUIESCED" == true ]]; then
    docker start "$api_container" >/dev/null || return 1
  fi
  RECOVERY_POINT_STAGING_RESUMED=true
}

export BUILDINGOS_OPERATION_LOCK_PATH="$lock_path"
production_operation_lock_acquire || fail 'staging operation lock unavailable'
if ! s3_fence_run_recovery_point "$api_image" "$s3_env" "$network" "$evidence" \
  recovery_point_staging_quiesce recovery_point_staging_capture recovery_point_staging_resume; then
  printf 'STAGING_RECOVERY_POINT=FAIL\nSOURCE_APP_SHA=%s\nOPERATION_ID=%s\n' "$source_app_sha" "$operation_id" >&2
  exit 1
fi

receipt="$capture_root/metadata/recovery-point-receipt.json"; receipt_hash="$capture_root/metadata/recovery-point-receipt.sha256"
[[ -f "$receipt" && -f "$receipt_hash" ]] || fail 'receipt is incomplete'
jq -e --arg sha "$source_app_sha" --arg id "$operation_id" --arg remote "$remote_root" \
  '.status == "PASS" and .sourceAppSha == $sha and .backupSetId == $id and .remoteRoot == $remote and .statuses.databaseArchive == "PASS" and .statuses.contentManifest == "PASS"' \
  "$receipt" >/dev/null || fail 'receipt failed independent validation'
receipt_digest="$(cat "$receipt_hash")"; [[ "$receipt_digest" =~ ^[0-9a-f]{64}$ ]] || fail 'receipt digest is invalid'
printf 'STAGING_RECOVERY_POINT=PASS\nSOURCE_APP_SHA=%s\nOPERATION_ID=%s\nREMOTE_ROOT=%s\nRECEIPT_SHA256=%s\n' \
  "$source_app_sha" "$operation_id" "$remote_root" "$receipt_digest"
