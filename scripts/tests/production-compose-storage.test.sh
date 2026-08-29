#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.production.yml"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-production-compose.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

readonly API_ENV_FILE="$TEST_ROOT/api.env"
readonly WEB_ENV_FILE="$TEST_ROOT/web.env"
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
