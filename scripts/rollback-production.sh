#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
# shellcheck source=scripts/production-security-validate.sh
source "$SCRIPT_DIR/production-security-validate.sh"

usage() {
  printf 'Usage: %s <expected_current_sha> <previous_sha> <previous_api_digest> <previous_web_digest> <compatibility_receipt> <api_health_url> <api_readyz_url> <web_login_url>\n' "${0##*/}" >&2
  exit 64
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 8 ]] || usage
readonly EXPECTED_CURRENT_SHA="$1"
readonly PREVIOUS_SHA="$2"
readonly PREVIOUS_API_DIGEST="$3"
readonly PREVIOUS_WEB_DIGEST="$4"
readonly RECEIPT="$5"
readonly API_HEALTH_URL="$6"
readonly API_READYZ_URL="$7"
readonly WEB_LOGIN_URL="$8"
readonly APP_DIR='/opt/pawtech/apps/buildingos/buildingos-app'
readonly PRODUCTION_ROOT='/opt/pawtech/apps/buildingos'
readonly COMPOSE_FILE='infra/docker/docker-compose.production.yml'
readonly ENV_FILE='/opt/pawtech/env/buildingos.env'
readonly POSTGRES_CONTAINER='pawtech-postgres'
RECORD="$PRODUCTION_ROOT/deployments/rollback-$(date -u +%Y%m%dT%H%M%SZ)-$PREVIOUS_SHA.txt"
readonly RECORD

for sha in "$EXPECTED_CURRENT_SHA" "$PREVIOUS_SHA"; do
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "Every SHA must be exactly 40 lowercase hexadecimal characters"
done
for digest in "$PREVIOUS_API_DIGEST" "$PREVIOUS_WEB_DIGEST"; do
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Every image digest must be immutable"
done
validate_rollback_receipt \
  "$RECEIPT" \
  "$EXPECTED_CURRENT_SHA" \
  "$PREVIOUS_SHA" \
  "$PREVIOUS_API_DIGEST" \
  "$PREVIOUS_WEB_DIGEST"
readonly migration_count="$VALIDATED_ROLLBACK_MIGRATION_COUNT"

cd "$APP_DIR"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail "Production checkout is not clean"
[[ "$(git rev-parse HEAD)" == "$EXPECTED_CURRENT_SHA" ]] || fail "Production checkout changed since compatibility review"
current_migration_count="$(docker exec "$POSTGRES_CONTAINER" sh -lc 'exec psql -qAt -U "$POSTGRES_USER" -d buildingos_db -c '\''SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'\''')"
[[ "$current_migration_count" == "$migration_count" ]] || fail "Database migration count changed after compatibility review"
validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db

docker image inspect "$PREVIOUS_API_DIGEST" >/dev/null
docker image inspect "$PREVIOUS_WEB_DIGEST" >/dev/null
rollback_tag="rollback-${PREVIOUS_SHA:0:12}"
docker tag "$PREVIOUS_API_DIGEST" "buildingos-api:$rollback_tag"
docker tag "$PREVIOUS_WEB_DIGEST" "buildingos-web:$rollback_tag"

export IMAGE_TAG="$rollback_tag"
export BUILD_REVISION="$EXPECTED_CURRENT_SHA"
compose=(docker compose --project-name buildingos --env-file "$ENV_FILE" --file "$COMPOSE_FILE")
"${compose[@]}" config --quiet
"${compose[@]}" up --detach --no-deps --force-recreate buildingos-api buildingos-web

for container in buildingos-api buildingos-web; do
  for attempt in {1..18}; do
    [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")" == 'healthy' ]] && break
    [[ "$attempt" -eq 18 ]] && fail "$container did not become healthy after rollback"
    sleep 5
  done
done
for url in "$API_HEALTH_URL" "$API_READYZ_URL" "$WEB_LOGIN_URL"; do
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$url" >/dev/null || fail "Rollback smoke failed"
done

install -d -m 700 "$(dirname "$RECORD")"
umask 077
{
  printf 'timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'status=SUCCESS\n'
  printf 'from_sha=%s\n' "$EXPECTED_CURRENT_SHA"
  printf 'previous_sha=%s\n' "$PREVIOUS_SHA"
  printf 'api_digest=%s\n' "$PREVIOUS_API_DIGEST"
  printf 'web_digest=%s\n' "$PREVIOUS_WEB_DIGEST"
  printf 'migration_count=%s\n' "$migration_count"
  printf 'database_changed=no\n'
  printf 'database_restore=never-automatic\n'
} > "$RECORD"
chmod 600 "$RECORD"
printf 'Application rollback completed without database changes\n'
