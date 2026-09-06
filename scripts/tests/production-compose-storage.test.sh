#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.production.yml"
readonly RELEASE_STAGING_COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.release-staging.yml"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-production-compose.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

readonly API_ENV_FILE="$TEST_ROOT/api.env"
readonly WEB_ENV_FILE="$TEST_ROOT/web.env"
readonly RELEASE_STAGING_ENV_FILE="$TEST_ROOT/release-staging.env"
printf '%s\n' 'APP_ENV=production' > "$API_ENV_FILE"
printf '%s\n' 'APP_ENV=production' > "$WEB_ENV_FILE"

write_control_env() {
  local endpoint="$1"
  printf '%s\n' \
    'IMAGE_TAG=0000000000000000000000000000000000000000' \
    'BUILD_REVISION=0000000000000000000000000000000000000000' \
    "API_ENV_FILE=$API_ENV_FILE" \
    "WEB_ENV_FILE=$WEB_ENV_FILE" \
    "S3_ENDPOINT=$endpoint" \
    'S3_REGION=default' \
    'S3_ACCESS_KEY=placeholder-access-key' \
    'S3_SECRET_KEY=placeholder-secret-key' \
    'S3_BUCKET=buildingos-production' \
    'S3_FORCE_PATH_STYLE=true' \
    'S3_PUBLIC_BASE_URL=https://files.example.invalid' > "$TEST_ROOT/control.env"
}

run_config_case() {
  local name="$1"
  local endpoint="$2"
  local services service
  write_control_env "$endpoint"
  docker compose --project-name buildingos-production-test --env-file "$TEST_ROOT/control.env" --file "$COMPOSE_FILE" config --quiet
  services="$(docker compose --project-name buildingos-production-test --env-file "$TEST_ROOT/control.env" --file "$COMPOSE_FILE" config --services)"
  while IFS= read -r service; do
    case "$service" in
      buildingos-minio|buildingos-minio-init|minio|createbuckets)
        printf 'FAIL: %s still includes legacy service %s\n' "$name" "$service" >&2
        exit 1
        ;;
    esac
  done <<< "$services"
  printf 'PASS: %s\n' "$name"
}

run_config_case 'MINIO runtime env renders without MinIO service ownership' http://buildingos-minio:9000
run_config_case 'EXTERNAL S3 runtime env renders without MinIO-specific variables' https://usc1.contabostorage.com
printf 'PASS: production Compose storage topology and controlled env rendering\n'

printf '%s\n' \
  'POSTGRES_USER=buildingos' \
  'POSTGRES_PASSWORD=local-password' \
  'POSTGRES_DB=buildingos_release_staging_test' \
  'MINIO_ROOT_USER=local-root' \
  'MINIO_ROOT_PASSWORD=local-password' \
  'S3_BUCKET=buildingos-release-staging-test' \
  'NODE_ENV=production' \
  'REDIS_URL=redis://redis:6379' \
  'WEB_ORIGIN=https://web.example.invalid' \
  'APP_BASE_URL=https://web.example.invalid' \
  'S3_REGION=us-east-1' \
  'S3_PUBLIC_BASE_URL=https://files.example.invalid' \
  'JWT_SECRET=local-jwt-secret' \
  'JWT_EXPIRES_IN=24h' \
  'MAIL_PROVIDER=none' \
  'MAIL_FROM=BuildingOS <no-reply@example.invalid>' \
  'PAYMENT_PROVIDER=none' \
  'AI_PROVIDER=none' \
  'FEATURE_PORTAL_RESIDENT=true' \
  'FEATURE_PAYMENTS_MVP=true' \
  'LOG_LEVEL=info' \
  'API_URL=https://api.example.invalid' > "$RELEASE_STAGING_ENV_FILE"

release_staging_rendered="$(docker compose \
  --project-name buildingos-release-staging-compose-test \
  --env-file "$RELEASE_STAGING_ENV_FILE" \
  --file "$RELEASE_STAGING_COMPOSE_FILE" config)"
[[ "$release_staging_rendered" == *'mc alias set myminio http://minio:9000 local-root local-password && mc mb --ignore-existing myminio/buildingos-release-staging-test && mc version enable myminio/buildingos-release-staging-test'* ]]
[[ "$release_staging_rendered" != *'exit 0'* ]]
printf 'PASS: release-staging bucket bootstrap is idempotent and fail-closed with versioning enabled\n'
