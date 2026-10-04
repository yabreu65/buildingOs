#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_APP_DIR='/opt/pawtech/apps/buildingos-staging/buildingos-app'
readonly EXPECTED_COMPOSE_FILE='infra/docker/docker-compose.staging.yml'
readonly EXPECTED_PROJECT_NAME='buildingos-staging'
readonly EXPECTED_ENV_FILE='/opt/pawtech/env/buildingos-staging.env'
readonly EXPECTED_DATABASE='buildingos_staging_db'
readonly ALLOWED_TENANT='stg-golden-tenant-auto'
readonly SNAPSHOT_MIGRATION='20260831000000_add_payment_receipt_issuance_snapshot'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
CONTROL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly CONTROL_ROOT
ACCEPTANCE_BASELINE_SNAPSHOT=''
ACCEPTANCE_SEQUENCE_BASELINE=''
ACCEPTANCE_SEED_PASSWORD_PREIMAGES=''
ACCEPTANCE_BASELINE_RESTORE_REQUIRED=0
COMPOSE_COMMAND=()
RUN_CLEANUP_PASS=0
GOLDEN_PASSWORD_RESTORE_PASS=0
FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH=''
export -n FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH
ACCEPTANCE_PRIVATE_DIR=''
COMPOSE_OVERRIDE_FILE=''
BASELINE_PRIVATE_MARKER=''
HASH_ONLY_PRIVATE_MARKER=''

sanitize_private_diagnostics() {
  local output="$1"
  local line
  local sanitized=''
  while IFS= read -r line; do
    if [[ -n "$BASELINE_PRIVATE_MARKER" && "$line" == *"$BASELINE_PRIVATE_MARKER"* ]]; then continue; fi
    if [[ -n "$HASH_ONLY_PRIVATE_MARKER" && "$line" == *"$HASH_ONLY_PRIVATE_MARKER"* ]]; then continue; fi
    if [[ -n "$FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH" ]]; then
      line="${line//"$FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH"/[REDACTED]}"
    fi
    while [[ "$line" =~ (\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}) ]]; do
      local private_hash="${BASH_REMATCH[1]}"
      line="${line/"$private_hash"/[REDACTED]}"
    done
    sanitized+="${sanitized:+$'\n'}$line"
  done <<< "$output"
  printf '%s' "$sanitized"
}

print_sanitized_output() {
  local sanitized
  sanitized="$(sanitize_private_diagnostics "$1")"
  [[ -z "$sanitized" ]] || printf '%s\n' "$sanitized"
}

print_sanitized_diagnostics() {
  print_sanitized_output "$1" >&2
}

acceptance_output_proves_cleanup() {
  local output="$1"
  local marker
  for marker in \
    QA_RUN_MUTABLE_DB_CLEANUP_PASS \
    QA_RUN_STORAGE_CLEANUP_PASS \
    QA_AUTH_SESSION_CLEANUP_PASS \
    QA_AUDIT_HISTORY_PRESERVED_PASS \
    QA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS \
    RUN_SCOPED_MUTABLE_DB_RESIDUE=0 \
    RUN_SCOPED_STORAGE_RESIDUE=0 \
    RUN_SCOPED_ACTIVE_SESSION_RESIDUE=0; do
    grep -Fxq -- "$marker" <<<"$output" || return 1
  done
}

record_acceptance_result() {
  local child_status="$1"
  local output="$2"
  local safe_output
  safe_output="$(sanitize_private_diagnostics "$output")"
  printf '%s\n' "$safe_output"
  if acceptance_output_proves_cleanup "$output"; then
    RUN_CLEANUP_PASS=1
  elif [[ "$child_status" == '0' ]]; then
    printf 'ERROR: acceptance child exited successfully without complete cleanup evidence\n' >&2
    return 1
  fi
  return "$child_status"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

create_private_compose_override() {
  # This private tmp-only channel captures attached container output in shell memory; logging:none prevents daemon persistence.
  ACCEPTANCE_PRIVATE_DIR="$(mktemp -d /tmp/finance-acceptance.XXXXXXXX)"
  chmod 700 "$ACCEPTANCE_PRIVATE_DIR"
  COMPOSE_OVERRIDE_FILE="$ACCEPTANCE_PRIVATE_DIR/compose.override.yml"
  (umask 077; printf 'services:\n  buildingos-api:\n    logging:\n      driver: none\n  api-seed-staging-golden:\n    logging:\n      driver: none' > "$COMPOSE_OVERRIDE_FILE")
  chmod 600 "$COMPOSE_OVERRIDE_FILE"
  BASELINE_PRIVATE_MARKER="__FINANCE_ACCEPTANCE_BASELINE_$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')__"
  HASH_ONLY_PRIVATE_MARKER="__FINANCE_ACCEPTANCE_HASH_ONLY_$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')__"
}

extract_private_record() {
  local output="$1"
  local marker="$2"
  local destination="$3"
  local count=0
  local malformed=0
  local line
  local payload=''
  local suffix
  [[ -n "$marker" && "$marker" != *$'\n'* && "$marker" != *:* ]] || return 1
  while IFS= read -r line; do
    [[ "$line" == *"$marker"* ]] || continue
    ((count += 1))
    if [[ "$line" != "$marker:"* ]]; then
      malformed=1
      continue
    fi
    suffix="${line#"$marker:"}"
    if [[ -z "$suffix" || "$suffix" == *$'\r'* || "$suffix" == *"$marker"* ]]; then malformed=1; else payload="$suffix"; fi
  done <<< "$output"
  [[ "$count" == '1' && "$malformed" == '0' ]] || return 1
  printf -v "$destination" '%s' "$payload"
}

project_acceptance_baseline_locally() {
  printf '%s' "$ACCEPTANCE_BASELINE_SNAPSHOT" | node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const { projectAcceptanceChildBaseline } = await import(pathToFileURL(process.argv[1]).href);
    let serialized = "";
    for await (const chunk of process.stdin) serialized += chunk;
    process.stdout.write(projectAcceptanceChildBaseline(JSON.parse(serialized)));
  ' "$CONTROL_ROOT/scripts/lib/finance-staging-acceptance-cleanup.mjs"
}

project_acceptance_seed_password_hashes() {
  printf '%s' "$ACCEPTANCE_BASELINE_SNAPSHOT" | node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const { projectAcceptanceSeedPasswordHashes } = await import(pathToFileURL(process.argv[1]).href);
    let serialized = "";
    for await (const chunk of process.stdin) serialized += chunk;
    process.stdout.write(projectAcceptanceSeedPasswordHashes(JSON.parse(serialized)));
  ' "$CONTROL_ROOT/scripts/lib/finance-staging-acceptance-cleanup.mjs"
}

cleanup_private_compose_override() {
  if [[ -n "$ACCEPTANCE_PRIVATE_DIR" ]]; then
    [[ "$COMPOSE_OVERRIDE_FILE" == "$ACCEPTANCE_PRIVATE_DIR/compose.override.yml" ]] || fail 'private Compose override path invariant failed'
    rm -f -- "$COMPOSE_OVERRIDE_FILE"
    rmdir -- "$ACCEPTANCE_PRIVATE_DIR"
    ACCEPTANCE_PRIVATE_DIR=''
    COMPOSE_OVERRIDE_FILE=''
  fi
  BASELINE_PRIVATE_MARKER=''
  HASH_ONLY_PRIVATE_MARKER=''
}

restore_golden_password_baseline() {
  local original_status=$?
  trap '' HUP INT TERM
  local restore_status=0
  local restore_output=''
  trap - EXIT
  if [[ "$ACCEPTANCE_BASELINE_RESTORE_REQUIRED" == '1' ]]; then
    local restore_payload
    local seed_hash_json='null'
    if [[ -n "$FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH" ]]; then seed_hash_json="\"$FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH\""; fi
    restore_payload="$(printf '{\"baseline\":%s,\"seedPasswordHash\":%s}' "$ACCEPTANCE_BASELINE_SNAPSHOT" "$seed_hash_json")"
    if restore_output="$(printf '%s' "$restore_payload" | "${COMPOSE_COMMAND[@]}" run --rm --no-deps -T \
      -v "$SCRIPT_DIR/finance-staging-acceptance.mjs:/app/apps/api/finance-staging-acceptance.mjs:ro" \
      -v "$SCRIPT_DIR/lib/finance-staging-acceptance-cleanup.mjs:/app/apps/api/finance-staging-acceptance-cleanup.mjs:ro" \
      --entrypoint node buildingos-api /app/apps/api/finance-staging-acceptance.mjs restore-golden-passwords 2>&1)"; then
      if grep -Fxq -- 'GOLDEN_PASSWORD_HASH_RESTORE_PASS' <<<"$restore_output" || grep -Fxq -- 'GOLDEN_PASSWORD_HASH_UNCHANGED_PASS' <<<"$restore_output"; then
        print_sanitized_output "$restore_output"
        GOLDEN_PASSWORD_RESTORE_PASS=1
        printf 'GOLDEN_PASSWORD_HASH_RESTORE_PASS\n'
        printf 'GOLDEN_PASSWORD_HASH_RESIDUE=0\n'
        printf 'QA_GOLDEN_PASSWORD_RESTORE_PASS\n'
      else
        print_sanitized_diagnostics "$restore_output"
        printf 'GOLDEN_PASSWORD_HASH_RESTORE_FAIL\n' >&2
        restore_status=1
      fi
    else
      print_sanitized_diagnostics "$restore_output"
      printf 'GOLDEN_PASSWORD_HASH_RESTORE_FAIL\n' >&2
      restore_status=1
    fi
    unset restore_payload
  fi
  unset ACCEPTANCE_BASELINE_SNAPSHOT ACCEPTANCE_SEQUENCE_BASELINE ACCEPTANCE_SEED_PASSWORD_PREIMAGES FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH
  cleanup_private_compose_override
  if [[ "$RUN_CLEANUP_PASS" == '1' && "$restore_status" == '0' && "$GOLDEN_PASSWORD_RESTORE_PASS" == '1' ]]; then
    printf 'QA_RUN_RESIDUE_ZERO_PASS\n'
  fi
  if [[ "$original_status" -ne 0 ]]; then exit "$original_status"; fi
  if [[ "$restore_status" -ne 0 ]]; then exit 1; fi
  exit 0
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

check_migration_status() {
  local migration_output
  if ! migration_output="$("$@" 2>&1)"; then
    printf '%s\n' "$migration_output" >&2
    fail 'staging Prisma migration status is not healthy'
  fi
}

assert_staging_runtime_environment() {
  local container="$1"
  local label="$2"

  # APP_ENV identifies the BuildingOS deployment environment. NODE_ENV identifies the Node runtime mode.
  # Staging intentionally runs the long-lived API/web runtime with APP_ENV=staging and NODE_ENV=production.
  # The Golden seed remains separate and runs with APP_ENV=staging and NODE_ENV=staging.
  [[ "$(container_env_value "$container" APP_ENV || true)" == 'staging' ]] || fail "$label APP_ENV is not staging"
  [[ "$(container_env_value "$container" NODE_ENV || true)" == 'production' ]] || fail "$label NODE_ENV is not production"
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
  local tested_sha="$1"
  local app_path="$2"
  local compose_file="$3"
  local project="$4"
  local env_file="$5"
  local compose=(docker compose --project-name "$project" --env-file "$env_file" --file "$app_path/$compose_file" --file "$COMPOSE_OVERRIDE_FILE")

  [[ -d "$app_path/.git" ]] || fail 'staging checkout is missing'
  [[ -r "$env_file" ]] || fail 'staging environment file is missing or unreadable'
  [[ -z "$(git -C "$app_path" status --porcelain --untracked-files=all)" ]] || fail 'staging checkout is not clean'
  [[ "$(git -C "$app_path" rev-parse HEAD)" == "$tested_sha" ]] || fail 'staging checkout is not at the tested application SHA'

  "${compose[@]}" config --quiet
  assert_staging_runtime_environment buildingos-staging-api 'API'
  assert_staging_runtime_environment buildingos-staging-web 'WEB'

  check_container_healthy buildingos-staging-api
  check_container_healthy buildingos-staging-postgres
  check_container_healthy buildingos-staging-redis
  check_container_healthy buildingos-staging-web
  [[ "$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' buildingos-staging-api)" == "$tested_sha" ]] || fail 'running staging API image is not built from the tested application SHA'
  [[ "$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' buildingos-staging-web)" == "$tested_sha" ]] || fail 'running staging web image is not built from the tested application SHA'

  local db_name
  db_name="$(container_env_value buildingos-staging-postgres POSTGRES_DB)"
  [[ "$db_name" == "$EXPECTED_DATABASE" ]] || fail 'staging PostgreSQL database identity is invalid'
  local current_database
  current_database="$(docker exec buildingos-staging-postgres sh -lc 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "select current_database()"')"
  [[ "$current_database" == "$EXPECTED_DATABASE" ]] || fail 'live PostgreSQL database identity is invalid'

  [[ -d "$app_path/apps/api/prisma/migrations/$SNAPSHOT_MIGRATION" ]] || fail 'required receipt snapshot migration is missing from tested application SHA'
  check_migration_status "${compose[@]}" --profile migrate run --rm --no-deps -T api-migrate migrate status --schema apps/api/prisma/schema.prisma
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

  create_private_compose_override
  COMPOSE_COMMAND=(docker compose --project-name "$project" --env-file "$env_file" --file "$app_path/$compose_file" --file "$COMPOSE_OVERRIDE_FILE")
  local storage_before
  storage_before="$(assert_staging_runtime "$tested_sha" "$app_path" "$compose_file" "$project" "$env_file")"
  printf '%s\n' "$storage_before"
  printf 'tested_application_sha=%s\n' "$tested_sha"
  printf 'tenant_allowlist=%s\n' "$ALLOWED_TENANT"
  # Durable seed fixtures are intentionally retained and are not run-scoped residue.

  local compose=("${COMPOSE_COMMAND[@]}")
  local baseline_capture_status=0
  local baseline_capture_output=''
  if baseline_capture_output="$("${compose[@]}" run --rm --no-deps -T \
    -e FINANCE_ACCEPTANCE_BASELINE_MARKER="$BASELINE_PRIVATE_MARKER" \
    -v "$SCRIPT_DIR/finance-staging-acceptance.mjs:/app/apps/api/finance-staging-acceptance.mjs:ro" \
    -v "$SCRIPT_DIR/lib/finance-staging-acceptance-cleanup.mjs:/app/apps/api/finance-staging-acceptance-cleanup.mjs:ro" \
    --entrypoint node buildingos-api /app/apps/api/finance-staging-acceptance.mjs capture-acceptance-baseline 2>&1)"; then
    baseline_capture_status=0
  else
    baseline_capture_status=$?
  fi
  local baseline_record_status=0
  extract_private_record "$baseline_capture_output" "$BASELINE_PRIVATE_MARKER" ACCEPTANCE_BASELINE_SNAPSHOT || baseline_record_status=$?
  print_sanitized_output "$baseline_capture_output"
  unset baseline_capture_output
  [[ "$baseline_capture_status" == '0' && "$baseline_record_status" == '0' ]] || fail 'unable to capture private Golden acceptance baseline'
  [[ -n "$ACCEPTANCE_BASELINE_SNAPSHOT" ]] || fail 'Golden acceptance baseline snapshot is empty'
  ACCEPTANCE_SEQUENCE_BASELINE="$(project_acceptance_baseline_locally)" || fail 'unable to project private acceptance baseline locally'
  if ! printf '%s' "$ACCEPTANCE_SEQUENCE_BASELINE" | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const value = JSON.parse(input);
        const sequence = value?.receiptSequence;
        if (Object.keys(value).length !== 1 || !sequence || sequence.tenantId !== "stg-golden-tenant-auto" || !Number.isInteger(sequence.year) || sequence.nextYear?.year !== sequence.year + 1) process.exitCode = 1;
      } catch { process.exitCode = 1; }
    });
  '; then fail 'acceptance sequence-only baseline projection is invalid'; fi
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  ACCEPTANCE_SEED_PASSWORD_PREIMAGES="$(project_acceptance_seed_password_hashes)" || fail 'unable to project private Golden password preimages for seed'

  local hash_only_status=0
  local hash_only_output=''
  if hash_only_output="$("${compose[@]}" --profile seed-staging-golden run --rm --no-deps --build -T \
    -e FINANCE_ACCEPTANCE_HASH_ONLY_MARKER="$HASH_ONLY_PRIVATE_MARKER" \
    -v "$CONTROL_ROOT/apps/api/prisma/seed-staging-golden.ts:/app/apps/api/prisma/seed-staging-golden.ts:ro" \
    -v "$CONTROL_ROOT/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts:/app/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts:ro" \
    --entrypoint npm api-seed-staging-golden run seed:staging:golden -w apps/api -- hash-acceptance-seed-password 2>&1)"; then
    hash_only_status=0
  else
    hash_only_status=$?
  fi
  local hash_only_record_status=0
  extract_private_record "$hash_only_output" "$HASH_ONLY_PRIVATE_MARKER" FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH || hash_only_record_status=$?
  if [[ "$hash_only_status" == '0' ]]; then print_sanitized_output "$hash_only_output"; else print_sanitized_diagnostics "$hash_only_output"; fi
  unset hash_only_output
  [[ "$hash_only_status" == '0' && "$hash_only_record_status" == '0' ]] || fail 'unable to generate private Golden seed password postimage'
  if [[ ! "$FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH" =~ ^\$2[aby]\$10\$[./A-Za-z0-9]{53}$ ]]; then
    FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH=''
    fail 'private Golden seed password postimage is malformed'
  fi

  local seed_handoff_payload
  seed_handoff_payload="$(printf '{\"passwordHashes\":%s,\"seedPasswordHash\":\"%s\"}' "$ACCEPTANCE_SEED_PASSWORD_PREIMAGES" "$FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH")"
  local seed_status=0
  local seed_output=''
  if seed_output="$(printf '%s' "$seed_handoff_payload" | "${compose[@]}" --profile seed-staging-golden run --rm --build -T \
    -e FINANCE_ACCEPTANCE_SEED_HASH_HANDOFF=1 \
    -e STAGING_GOLDEN_TENANTS=stg-golden-tenant-auto \
    -v "$CONTROL_ROOT/apps/api/prisma/seed-staging-golden.ts:/app/apps/api/prisma/seed-staging-golden.ts:ro" \
    -v "$CONTROL_ROOT/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts:/app/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts:ro" \
    api-seed-staging-golden 2>&1)"; then
    seed_status=0
  else
    seed_status=$?
  fi
  if [[ "$seed_status" == '0' ]]; then
    print_sanitized_output "$seed_output"
  else
    print_sanitized_diagnostics "$seed_output"
  fi
  unset seed_output seed_handoff_payload ACCEPTANCE_SEED_PASSWORD_PREIMAGES
  [[ "$seed_status" == '0' ]] || fail 'Golden staging seed failed'

  local acceptance_output=''
  local acceptance_status=0
  if acceptance_output="$(printf '%s' "$ACCEPTANCE_SEQUENCE_BASELINE" | "${compose[@]}" run --rm --no-deps -T \
    -e STAGING_GOLDEN_QA_PASSWORD \
    -e FINANCE_ACCEPTANCE_RUN_ID \
    -e FINANCE_ACCEPTANCE_API_BASE_URL="$api_base_url" \
    -v "$SCRIPT_DIR/finance-staging-acceptance.mjs:/app/apps/api/finance-staging-acceptance.mjs:ro" \
    -v "$SCRIPT_DIR/lib/finance-staging-acceptance-cleanup.mjs:/app/apps/api/finance-staging-acceptance-cleanup.mjs:ro" \
    --entrypoint node buildingos-api /app/apps/api/finance-staging-acceptance.mjs 2>&1)"; then
    acceptance_status=0
  else
    acceptance_status=$?
  fi
  record_acceptance_result "$acceptance_status" "$acceptance_output" || return $?

  local storage_after
  storage_after="$(assert_staging_runtime "$tested_sha" "$app_path" "$compose_file" "$project" "$env_file")"
  [[ "$storage_before" == "$storage_after" ]] || fail 'staging storage configuration changed during acceptance'
  [[ "$(git -C "$app_path" rev-parse HEAD)" == "$tested_sha" ]] || fail 'staging checkout changed during acceptance'
  printf 'storage_configuration_unchanged=PASS\n'
}

if [[ -z "${BASH_SOURCE[0]-}" || "${BASH_SOURCE[0]}" == "$0" ]]; then
  trap restore_golden_password_baseline EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  main "$@"
fi
