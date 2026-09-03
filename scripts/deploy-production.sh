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
  if declare -F write_record >/dev/null 2>&1; then
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
      [[ "$phase" == 'application-recreate' && "$migration_count" == '98' ]] \
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
      if [[ "$migration_count" == '98' && "${record##*/}" == rollback-*.txt ]]; then
        previous_sha="$(read_deployment_record_value "$record" previous_sha || true)"
        previous_api_digest="$(read_deployment_record_value "$record" api_digest || true)"
        previous_web_digest="$(read_deployment_record_value "$record" web_digest || true)"
        storage_transition='unknown'
      elif [[ "$migration_count" == '98' || "$migration_count" == '97' ]]; then
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
    [[ "$migration_count" == '98' || "$migration_count" == 'unknown' ]] || continue
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
    printf 'storage_transition=%s\n' "${STORAGE_TRANSITION#STORAGE_TRANSITION=}"
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
