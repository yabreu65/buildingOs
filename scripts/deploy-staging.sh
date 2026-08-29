#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <sha> <app_path> <compose_file> <project> <env_file> <api_health> <api_ready> <api_readyz> <web_local> <api_public_health> <web_public_login>" >&2
  exit 64
}

readonly EXPECTED_APP_DIR="/opt/pawtech/apps/buildingos-staging/buildingos-app"
readonly EXPECTED_COMPOSE_FILE="infra/docker/docker-compose.staging.yml"
readonly EXPECTED_PROJECT_NAME="buildingos-staging"
readonly EXPECTED_ENV_FILE="/opt/pawtech/env/buildingos-staging.env"

write_record() {
  local state="$1"
  install -d -m 700 "$DEPLOYMENTS_DIR"
  umask 077
  {
    echo "deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "status=$state"
    echo "previous_sha=${BEFORE_SHA:-unknown}"
    echo "new_sha=$TARGET_SHA"
    echo "migrations=api-migrate (required)"
    echo "services=buildingos-api buildingos-web"
    echo "seeds=no"
  } > "$RECORD"
  chmod 600 "$RECORD"
}

on_error() {
  local rc=$?
  trap - ERR
  if ! write_record FAILED; then
    echo "Unable to write FAILED deployment record" >&2
  fi
  echo "Deployment failed (exit $rc)" >&2
  exit "$rc"
}
check_ignored_sensitive_files() {
  local path
  while IFS= read -r path; do
    case "$path" in
      .env|.env.*|*/.env|*/.env.*|*.pem|*.key|*.p12|*.pfx|*.crt|*.log|*.dump|*.sql|*.bak|*.backup)
        echo "Sensitive ignored file would enter the Docker context: $path" >&2
        return 1
        ;;
    esac
  done < <(git ls-files --others --ignored --exclude-standard)
}

env_value() {
  local expected_name="$1"
  local name
  local value

  while IFS='=' read -r name value; do
    if [[ "$name" == "$expected_name" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done < "$ENV_FILE"
  return 1
}

target_uses_external_storage() {
  local service

  while IFS= read -r service; do
    [[ "$service" == 'minio' ]] && return 1
  done < <("${compose[@]}" config --services)
  return 0
}

current_api_uses_legacy_minio() {
  local endpoint

  endpoint="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' buildingos-staging-api 2>/dev/null | while IFS='=' read -r name value; do
    if [[ "$name" == 'S3_ENDPOINT' ]]; then
      printf '%s' "$value"
      break
    fi
  done)" || {
    echo 'Current staging API storage endpoint cannot be inspected' >&2
    return 2
  }
  [[ -n "$endpoint" ]] || {
    echo 'Current staging API has no S3_ENDPOINT' >&2
    return 2
  }
  [[ "$endpoint" == 'http://minio:9000' ]]
}

network_is_attached() {
  local container="$1"
  local network="$2"

  [[ -n "$(docker inspect -f "{{with index .NetworkSettings.Networks \"$network\"}}{{.NetworkID}}{{end}}" "$container")" ]]
}

require_storage_cutover_preconditions() {
  target_uses_external_storage || return 0
  # This applies only while the current API still depends on local MinIO.
  # Later external-S3 deployments do not require repeating the cutover barrier.
  if current_api_uses_legacy_minio; then
    :
  else
    local inspection_status=$?
    [[ "$inspection_status" -eq 1 ]] && return 0
    return "$inspection_status"
  fi

  [[ "$(env_value STORAGE_CUTOVER_CONFIRMATION || true)" == 'STORAGE_01_CONTABO' ]] || {
    echo 'External-storage cutover confirmation is required' >&2
    return 1
  }
  [[ "$(docker inspect -f '{{.State.Running}}' buildingos-staging-api)" == 'false' ]] || {
    echo 'Staging API must be quiescent before external-storage cutover deployment' >&2
    return 1
  }
  [[ "$(docker inspect -f '{{.State.Running}}' buildingos-staging-minio)" == 'true' ]] || {
    echo 'Legacy MinIO must remain running for rollback' >&2
    return 1
  }
  ! network_is_attached buildingos-staging-minio pawtech_public || {
    echo 'Legacy MinIO must be detached from pawtech_public before cutover deployment' >&2
    return 1
  }
  network_is_attached buildingos-staging-minio buildingos-staging_buildingos_staging_net || {
    echo 'Legacy MinIO must remain attached to the internal staging network' >&2
    return 1
  }
}

main() {
trap on_error ERR
[[ $# -eq 11 ]] || usage
readonly TARGET_SHA="$1"
readonly APP_DIR="$2"
readonly COMPOSE_FILE="$3"
readonly PROJECT_NAME="$4"
readonly ENV_FILE="$5"
readonly API_HEALTH_URL="$6"
readonly API_READY_URL="$7"
readonly API_READYZ_URL="$8"
readonly WEB_LOCAL_URL="$9"
readonly API_PUBLIC_HEALTH_URL="${10}"
readonly WEB_PUBLIC_LOGIN_URL="${11}"
readonly DEPLOYMENTS_DIR="$(dirname "$APP_DIR")/deployments"
readonly RECORD="$DEPLOYMENTS_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$TARGET_SHA.txt"

[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid SHA" >&2; exit 2; }
for value in "$APP_DIR" "$COMPOSE_FILE" "$PROJECT_NAME" "$ENV_FILE" "$API_HEALTH_URL" "$API_READY_URL" "$API_READYZ_URL" "$WEB_LOCAL_URL" "$API_PUBLIC_HEALTH_URL" "$WEB_PUBLIC_LOGIN_URL"; do
  [[ -n "$value" ]] || { echo "Required deployment setting is empty" >&2; exit 2; }
done
[[ "$APP_DIR" == "$EXPECTED_APP_DIR" ]] || { echo "Unexpected staging app path" >&2; exit 2; }
[[ "$COMPOSE_FILE" == "$EXPECTED_COMPOSE_FILE" ]] || { echo "Unexpected staging compose file" >&2; exit 2; }
[[ "$PROJECT_NAME" == "$EXPECTED_PROJECT_NAME" ]] || { echo "Unexpected staging Compose project" >&2; exit 2; }
[[ "$ENV_FILE" == "$EXPECTED_ENV_FILE" ]] || { echo "Unexpected staging env file" >&2; exit 2; }
for url in "$API_HEALTH_URL" "$API_READY_URL" "$API_READYZ_URL" "$WEB_LOCAL_URL" "$API_PUBLIC_HEALTH_URL" "$WEB_PUBLIC_LOGIN_URL"; do
  [[ "$url" =~ ^https?://[A-Za-z0-9._:/?=%+\&-]+$ ]] || { echo "Unsafe health URL" >&2; exit 2; }
done
[[ -d "$APP_DIR/.git" ]] || { echo "Remote checkout missing: $APP_DIR" >&2; exit 1; }
[[ -r "$ENV_FILE" ]] || { echo "Environment file missing or unreadable" >&2; exit 1; }
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

cd "$APP_DIR"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo "Remote checkout has tracked, untracked, or staged changes" >&2; exit 1; }
check_ignored_sensitive_files
readonly BEFORE_SHA="$(git rev-parse HEAD)"
git fetch --prune origin main
git cat-file -e "$TARGET_SHA^{commit}"
git merge-base --is-ancestor "$TARGET_SHA" origin/main || { echo "SHA is not reachable from origin/main" >&2; exit 1; }
git switch --detach --quiet "$TARGET_SHA"
[[ "$(git rev-parse HEAD)" == "$TARGET_SHA" ]] || { echo "Detached checkout did not reach requested SHA" >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo "Checkout became dirty after checkout" >&2; exit 1; }
check_ignored_sensitive_files

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$COMPOSE_FILE")
"${compose[@]}" config --quiet
"${compose[@]}" --profile migrate config --quiet
require_storage_cutover_preconditions

"${compose[@]}" --profile migrate build api-migrate
"${compose[@]}" \
  --profile migrate \
  run \
  --rm \
  --no-deps \
  -T \
  api-migrate < /dev/null
"${compose[@]}" build buildingos-api buildingos-web
"${compose[@]}" up --detach --no-deps --force-recreate buildingos-api buildingos-web

check_http() {
  local name="$1"
  local url="$2"
  local attempt=1
  local max_attempts=8
  while (( attempt <= max_attempts )); do
    echo "Health check $name attempt $attempt/$max_attempts"
    if curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$url" >/dev/null; then
      echo "Health check $name passed"
      return 0
    fi
    if (( attempt == max_attempts )); then
      echo "Health check $name failed after $max_attempts attempts" >&2
      return 1
    fi
    sleep 5
    ((attempt++))
  done
}
check_http "api-health" "$API_HEALTH_URL"
check_http "api-ready" "$API_READY_URL"
check_http "api-readyz" "$API_READYZ_URL"
check_http "web-local" "$WEB_LOCAL_URL"
check_http "api-public-health" "$API_PUBLIC_HEALTH_URL"
check_http "web-public-login" "$WEB_PUBLIC_LOGIN_URL"

write_record SUCCESS
echo "Deployment completed: $TARGET_SHA"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
