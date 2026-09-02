#!/usr/bin/env bash
# shellcheck disable=SC2012
set -Eeuo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
CONTROL_ROOT="$(dirname -- "$SCRIPT_DIR")"
readonly CONTROL_ROOT
readonly SECURITY_VALIDATOR="$SCRIPT_DIR/production-security-validate.sh"
readonly STORAGE_CUTOVER_GUARD="$SCRIPT_DIR/production-storage-cutover-guard.sh"
readonly BACKUP_IDENTITY_MANIFEST="$CONTROL_ROOT/infra/production/backup-postgres.identity.v1"
[[ -f "$SECURITY_VALIDATOR" && ! -L "$SECURITY_VALIDATOR" ]] || {
  printf 'ERROR: Trusted production security validator is missing or invalid\n' >&2
  exit 1
}
[[ -f "$STORAGE_CUTOVER_GUARD" && ! -L "$STORAGE_CUTOVER_GUARD" ]] || {
  printf 'ERROR: Trusted production storage transition guard is missing or invalid\n' >&2
  exit 1
}
# shellcheck source=scripts/production-security-validate.sh
source "$SECURITY_VALIDATOR"

usage() {
  printf 'Usage: %s <target_sha> <approved_sha> <expected_current_sha> <api_health_url> <api_readyz_url> <web_login_url>\n' "${0##*/}" >&2
  exit 64
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
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
readonly DEPLOYMENTS_DIR="$PRODUCTION_ROOT/deployments"
readonly ALLOWED_IGNORED_RUNTIME_ENV='infra/docker/.env'
DEPLOY_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
readonly DEPLOY_STARTED_AT
RECORD="$DEPLOYMENTS_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ)-$TARGET_SHA.txt"
readonly RECORD

PHASE='preflight'
PREVIOUS_SHA='unknown'
PREVIOUS_API_DIGEST='unknown'
PREVIOUS_WEB_DIGEST='unknown'
NEW_API_DIGEST='unknown'
NEW_WEB_DIGEST='unknown'
BACKUP_ID='unknown'
MIGRATION_COUNT='unknown'
ROLLBACK_RECEIPT='unknown'
TARGET_TREE_ROOT=''
TARGET_TREE=''
TARGET_TREE_ACTIVE=false

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

write_record() {
  local status="$1"
  install -d -m 700 "$DEPLOYMENTS_DIR"
  umask 077
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
    printf 'backup_id=%s\n' "$BACKUP_ID"
    printf 'migration_count=%s\n' "$MIGRATION_COUNT"
    printf 'rollback_receipt=%s\n' "$ROLLBACK_RECEIPT"
    printf 'rollback_compatibility_basis=%s\n' "$ROLLBACK_COMPATIBILITY_BASIS"
    printf 'database_rollback=never-automatic\n'
    printf 'services_recreated=buildingos-api buildingos-web\n'
    printf 'seeds=no\n'
  } > "$RECORD"
  chmod 600 "$RECORD"
}

on_error() {
  local rc=$?
  trap - ERR
  write_record FAILED || true
  printf 'Production deployment stopped in phase %s (exit %s). No automatic rollback or database restore was attempted.\n' "$PHASE" "$rc" >&2
  exit "$rc"
}
trap on_error ERR
trap cleanup_target_tree EXIT

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
PREVIOUS_SHA="$(git rev-parse HEAD)"
[[ "$PREVIOUS_SHA" == "$EXPECTED_CURRENT_SHA" ]] || fail "Production checkout changed since approval"
git fetch --no-tags origin main
git cat-file -e "$TARGET_SHA^{commit}"
git merge-base --is-ancestor "$TARGET_SHA" origin/main || fail "Target SHA is not reachable from origin/main"

for container in buildingos-api buildingos-web "$POSTGRES_CONTAINER" pawtech-redis pawtech-traefik; do
  docker inspect "$container" >/dev/null 2>&1 || fail "Required production container is unavailable: $container"
done

export IMAGE_TAG="$TARGET_SHA"
export BUILD_REVISION="$TARGET_SHA"
materialize_target_tree
readonly TARGET_COMPOSE_FILE="$TARGET_TREE/$COMPOSE_FILE"
target_compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$TARGET_COMPOSE_FILE")
"${target_compose[@]}" config --quiet
"${target_compose[@]}" --profile migrate config --quiet
STORAGE_TRANSITION="$(bash "$STORAGE_CUTOVER_GUARD" "$ENV_FILE" "$TARGET_COMPOSE_FILE" "$PROJECT_NAME")"
readonly STORAGE_TRANSITION
[[ "$STORAGE_TRANSITION" =~ ^STORAGE_TRANSITION=(MINIO|EXTERNAL_S3):(MINIO|EXTERNAL_S3)$ ]] \
  || fail 'Storage transition guard returned an invalid classification'
cleanup_target_tree

case "$STORAGE_TRANSITION" in
  STORAGE_TRANSITION=MINIO:MINIO|STORAGE_TRANSITION=EXTERNAL_S3:EXTERNAL_S3)
    wait_for_container_health buildingos-api
    wait_for_container_health buildingos-web
    ;;
esac

PREVIOUS_API_DIGEST="$(docker inspect --format '{{.Image}}' buildingos-api)"
PREVIOUS_WEB_DIGEST="$(docker inspect --format '{{.Image}}' buildingos-web)"
[[ "$PREVIOUS_API_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Unable to capture previous API digest"
[[ "$PREVIOUS_WEB_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Unable to capture previous Web digest"

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
env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db \
  bash ./scripts/verify-production-migration-manifest.sh verify-db pre

PHASE='migrations'
"${compose[@]}" --profile migrate run --rm --no-deps -T buildingos-migrate < /dev/null
"${compose[@]}" --profile migrate run --rm --no-deps -T buildingos-migrate migrate status --schema apps/api/prisma/schema.prisma < /dev/null
env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db \
  bash ./scripts/verify-production-migration-manifest.sh verify-db post
MIGRATION_COUNT="$(docker exec "$POSTGRES_CONTAINER" sh -lc 'exec psql -qAt -U "$POSTGRES_USER" -d buildingos_db -c '\''SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'\''')"
[[ "$MIGRATION_COUNT" == '98' ]] || fail "Final migration count is not exactly 98"

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

PHASE='observability'
critical_logs=0
for container in buildingos-api buildingos-web; do
  count="$(docker logs --since "$DEPLOY_STARTED_AT" "$container" 2>&1 | grep -Eic 'PrismaClient|P20[0-9]{2}|FATAL|PANIC' || true)"
  critical_logs=$((critical_logs + count))
done
[[ "$critical_logs" -eq 0 ]] || fail "Critical post-deploy log patterns detected"

PHASE='complete'
write_record SUCCESS
printf 'Production deployment completed at exact SHA %s\n' "$TARGET_SHA"
