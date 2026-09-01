#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_APP_DIR='/opt/pawtech/apps/buildingos-staging/buildingos-app'
readonly EXPECTED_COMPOSE_FILE='infra/docker/docker-compose.staging.yml'
readonly EXPECTED_PROJECT_NAME='buildingos-staging'
readonly EXPECTED_ENV_FILE='/opt/pawtech/env/buildingos-staging.env'
readonly EXPECTED_DATABASE='buildingos_staging_db'
readonly EXPECTED_TESTED_SHA='15b8587c4e4740abd6d91e6c795c83ceeaf6bdcf'
readonly ALLOWED_TENANT='stg-golden-tenant-auto'
readonly ALLOWED_BUILDING='stg-golden-building-auto'
readonly ALLOWED_UNIT='stg-golden-unit-auto-102'
readonly QA_EMAIL='admin.autogestionada@staging.buildingos.local'
readonly SNAPSHOT_MIGRATION='20260831000000_add_payment_receipt_issuance_snapshot'
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

usage() {
  printf 'Usage: %s <tested_sha> <app_path> <compose_file> <project> <env_file> <api_base_url>\n' "${0##*/}" >&2
  exit 64
}

container_env_value() {
  local container="$1"
  local expected_name="$2"
  local name
  local value

  while IFS='=' read -r name value; do
    if [[ "$name" == "$expected_name" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done < <(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null)
  return 1
}

check_container_healthy() {
  local container="$1"
  [[ "$(docker inspect -f '{{.State.Running}}' "$container")" == 'true' ]] || fail "$container is not running"
  local health
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")"
  [[ "$health" == 'healthy' ]] || fail "$container health is $health"
}

validate_arguments() {
  [[ $# -eq 6 ]] || usage
  local tested_sha="$1"
  local app_path="$2"
  local compose_file="$3"
  local project="$4"
  local env_file="$5"
  local api_base_url="$6"

  [[ "$tested_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'tested SHA is not a 40-character lowercase hexadecimal commit'
  [[ "$tested_sha" == "$EXPECTED_TESTED_SHA" ]] || fail 'tested SHA is not the certified staging application SHA'
  [[ "$app_path" == "$EXPECTED_APP_DIR" ]] || fail 'unexpected staging application path'
  [[ "$compose_file" == "$EXPECTED_COMPOSE_FILE" ]] || fail 'unexpected staging Compose file'
  [[ "$project" == "$EXPECTED_PROJECT_NAME" ]] || fail 'unexpected staging Compose project'
  [[ "$env_file" == "$EXPECTED_ENV_FILE" ]] || fail 'unexpected staging environment file'
  [[ "$api_base_url" == 'http://buildingos-api:3000' ]] || fail 'unexpected internal staging API URL'

  case "$app_path" in
    ''|'/'|/opt/pawtech/apps/buildingos|/opt/pawtech/apps/buildingos/*|/opt/pawtech/apps/buildingos-production|/opt/pawtech/apps/buildingos-production/*|/opt/pawtech/apps/buildingos-release-staging|/opt/pawtech/apps/buildingos-release-staging/*)
      fail 'production or release-staging path rejected'
      ;;
  esac
}

assert_staging_runtime() {
  local app_path="$1"
  local compose_file="$2"
  local project="$3"
  local env_file="$4"
  local compose=(docker compose --project-name "$project" --env-file "$env_file" --file "$app_path/$compose_file")

  [[ -d "$app_path/.git" ]] || fail 'staging checkout is missing'
  [[ -r "$env_file" ]] || fail 'staging environment file is missing or unreadable'
  [[ -z "$(git -C "$app_path" status --porcelain --untracked-files=all)" ]] || fail 'staging checkout is not clean'
  [[ "$(git -C "$app_path" rev-parse HEAD)" == "$EXPECTED_TESTED_SHA" ]] || fail 'staging checkout is not at the tested application SHA'

  "${compose[@]}" config --quiet
  [[ "$(container_env_value buildingos-staging-api APP_ENV)" == 'staging' ]] || fail 'API APP_ENV is not staging'
  [[ "$(container_env_value buildingos-staging-api NODE_ENV)" == 'staging' ]] || fail 'API NODE_ENV is not staging'

  check_container_healthy buildingos-staging-api
  check_container_healthy buildingos-staging-postgres
  check_container_healthy buildingos-staging-redis
  check_container_healthy buildingos-staging-web
  [[ "$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' buildingos-staging-api)" == "$EXPECTED_TESTED_SHA" ]] || fail 'running staging API image is not built from the tested application SHA'
  [[ "$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' buildingos-staging-web)" == "$EXPECTED_TESTED_SHA" ]] || fail 'running staging web image is not built from the tested application SHA'

  local db_name
  db_name="$(container_env_value buildingos-staging-postgres POSTGRES_DB)"
  [[ "$db_name" == "$EXPECTED_DATABASE" ]] || fail 'staging PostgreSQL database identity is invalid'
  local current_database
  current_database="$(docker exec buildingos-staging-postgres sh -lc 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "select current_database()"')"
  [[ "$current_database" == "$EXPECTED_DATABASE" ]] || fail 'live PostgreSQL database identity is invalid'

  [[ -d "$app_path/apps/api/prisma/migrations/$SNAPSHOT_MIGRATION" ]] || fail 'required receipt snapshot migration is missing from tested application SHA'
  local migration_output
  migration_output="$("${compose[@]}" --profile migrate run --rm --no-deps -T api-migrate migrate status --schema apps/api/prisma/schema.prisma)"
  [[ "$migration_output" == *'No pending migrations to apply.'* ]] || fail 'staging database has pending Prisma migrations'
  printf 'snapshot_migration=APPLIED\n'
  printf 'pending_migrations=0\n'

  docker exec buildingos-staging-redis redis-cli ping >/dev/null || fail 'staging Redis connectivity failed'
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 http://127.0.0.1:4010/health >/dev/null || fail 'staging API health failed'
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 http://127.0.0.1:4011/ >/dev/null || fail 'staging web health failed'

  local payment_provider
  payment_provider="$(container_env_value buildingos-staging-api PAYMENT_PROVIDER || true)"
  [[ -z "$payment_provider" || "$payment_provider" == 'none' ]] || fail 'online payment provider is enabled'
  local webhooks_enabled
  webhooks_enabled="$(container_env_value buildingos-staging-api ENABLE_PAYMENT_WEBHOOKS || true)"
  [[ -z "$webhooks_enabled" || "$webhooks_enabled" == 'false' ]] || fail 'payment webhooks are enabled'
  printf 'payment_provider=%s\n' "${payment_provider:-none}"
  printf 'webhooks_enabled=%s\n' "${webhooks_enabled:-false}"

  local s3_endpoint
  local s3_bucket
  local s3_path_style
  s3_endpoint="$(container_env_value buildingos-staging-api S3_ENDPOINT)"
  s3_bucket="$(container_env_value buildingos-staging-api S3_BUCKET)"
  s3_path_style="$(container_env_value buildingos-staging-api S3_FORCE_PATH_STYLE)"
  [[ -n "$s3_endpoint" && -n "$s3_bucket" && -n "$s3_path_style" ]] || fail 'staging storage configuration is incomplete'
  local endpoint_host="${s3_endpoint#*://}"
  endpoint_host="${endpoint_host%%/*}"
  endpoint_host="${endpoint_host%%:*}"
  printf 'storage_backend=s3\n'
  printf 'storage_endpoint_host=%s\n' "$endpoint_host"
  printf 'storage_bucket=%s\n' "$s3_bucket"
  printf 'storage_path_style=%s\n' "$s3_path_style"
  printf '%s|%s|%s\n' "$s3_endpoint" "$s3_bucket" "$s3_path_style"
}

main() {
  validate_arguments "$@"
  local tested_sha="$1"
  local app_path="$2"
  local compose_file="$3"
  local project="$4"
  local env_file="$5"
  local api_base_url="$6"

  [[ -n "${STAGING_GOLDEN_QA_PASSWORD:-}" && "${#STAGING_GOLDEN_QA_PASSWORD}" -ge 12 ]] || fail 'ephemeral Golden QA password is missing or too short'
  [[ -n "${FINANCE_ACCEPTANCE_RUN_ID:-}" ]] || fail 'acceptance run identity is missing'

  local storage_before
  storage_before="$(assert_staging_runtime "$app_path" "$compose_file" "$project" "$env_file")"
  printf '%s\n' "$storage_before"
  printf 'tested_application_sha=%s\n' "$tested_sha"
  printf 'tenant_allowlist=%s\n' "$ALLOWED_TENANT"

  local compose=(docker compose --project-name "$project" --env-file "$env_file" --file "$app_path/$compose_file")
  "${compose[@]}" --profile seed-staging-golden run --rm --build -T \
    -e STAGING_GOLDEN_TENANTS=stg-golden-tenant-auto,stg-golden-tenant-multi \
    -v "$SCRIPT_DIR/apps/api/prisma/seed-staging-golden.ts:/app/apps/api/prisma/seed-staging-golden.ts:ro" \
    -v "$SCRIPT_DIR/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts:/app/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts:ro" \
    api-seed-staging-golden

  "${compose[@]}" run --rm --no-deps -T \
    -e STAGING_GOLDEN_QA_PASSWORD \
    -e FINANCE_ACCEPTANCE_RUN_ID \
    -e FINANCE_ACCEPTANCE_API_BASE_URL="$api_base_url" \
    -v "$SCRIPT_DIR/finance-staging-acceptance.mjs:/opt/finance-staging-acceptance.mjs:ro" \
    --entrypoint node buildingos-api /opt/finance-staging-acceptance.mjs

  local storage_after
  storage_after="$(assert_staging_runtime "$app_path" "$compose_file" "$project" "$env_file")"
  [[ "$storage_before" == "$storage_after" ]] || fail 'staging storage configuration changed during acceptance'
  [[ "$(git -C "$app_path" rev-parse HEAD)" == "$tested_sha" ]] || fail 'staging checkout changed during acceptance'
  printf 'storage_configuration_unchanged=PASS\n'
}

if [[ -z "${BASH_SOURCE[0]-}" || "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
