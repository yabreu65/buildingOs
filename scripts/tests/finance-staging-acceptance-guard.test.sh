#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly SCRIPT="$ROOT_DIR/scripts/finance-staging-acceptance.sh"
readonly SHA='15b8587c4e4740abd6d91e6c795c83ceeaf6bdcf'
readonly VALID_ARGS=(
  "$SHA"
  /opt/pawtech/apps/buildingos-staging/buildingos-app
  infra/docker/docker-compose.staging.yml
  buildingos-staging
  /opt/pawtech/env/buildingos-staging.env
  http://buildingos-api:3000
)

source "$SCRIPT"
dynamic_sha_args=("${VALID_ARGS[@]/$SHA/1111111111111111111111111111111111111111}")
validate_arguments "${dynamic_sha_args[@]}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  return 1
}

MOCK_CONTAINER=''
MOCK_APP_ENV=''
MOCK_NODE_ENV=''
container_env_value() {
  local container="$1"
  local expected_name="$2"
  [[ "$container" == "$MOCK_CONTAINER" ]] || return 1
  case "$expected_name" in
    APP_ENV) printf '%s' "$MOCK_APP_ENV" ;;
    NODE_ENV) printf '%s' "$MOCK_NODE_ENV" ;;
    *) return 1 ;;
  esac
}

run_runtime_case() {
  local name="$1"
  local container="$2"
  local app_env="$3"
  local node_env="$4"
  local expected_status="$5"
  MOCK_CONTAINER="$container"
  MOCK_APP_ENV="$app_env"
  MOCK_NODE_ENV="$node_env"

  local actual_status='FAIL'
  if assert_staging_runtime_environment "$container" "$name" >/dev/null 2>&1; then
    actual_status='PASS'
  fi
  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'FAIL: %s expected %s, got %s\n' "$name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

run_runtime_case 'API certified runtime' buildingos-staging-api staging production PASS
run_runtime_case 'WEB certified runtime' buildingos-staging-web staging production PASS
run_runtime_case 'API staging Node runtime' buildingos-staging-api staging staging FAIL
run_runtime_case 'WEB staging Node runtime' buildingos-staging-web staging staging FAIL
run_runtime_case 'API production deployment identity' buildingos-staging-api production production FAIL
run_runtime_case 'WEB production deployment identity' buildingos-staging-web production production FAIL
run_runtime_case 'API missing APP_ENV' buildingos-staging-api '' production FAIL
run_runtime_case 'WEB unexpected NODE_ENV' buildingos-staging-web staging development FAIL

golden_seed_source="$ROOT_DIR/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts"
golden_seed_contract=''
while IFS= read -r line; do
  case "$line" in
    *"nodeEnv !== 'staging'"*) golden_seed_contract="$line" ;;
  esac
done < "$golden_seed_source"
[[ "$golden_seed_contract" == *"nodeEnv !== 'staging'"* ]] || {
  printf 'FAIL: Golden seed NODE_ENV=staging contract changed\n' >&2
  exit 1
}

run_rejected_case() {
  local name="$1"
  local expected="$2"
  shift 2
  set +e
  local output
  output="$(STAGING_GOLDEN_QA_PASSWORD='not-used' FINANCE_ACCEPTANCE_RUN_ID='test-run' bash "$SCRIPT" "$@" 2>&1)"
  local status=$?
  set -e
  [[ "$status" -ne 0 ]] || { printf 'FAIL: %s unexpectedly succeeded\n' "$name" >&2; exit 1; }
  [[ "$output" == *"$expected"* ]] || { printf 'FAIL: %s did not report %s\n' "$name" "$expected" >&2; exit 1; }
}

run_rejected_case 'wrong SHA' '40-character lowercase hexadecimal' "${VALID_ARGS[@]/$SHA/deadbeef}"
run_rejected_case 'production path' 'unexpected staging application path' "$SHA" /opt/pawtech/apps/buildingos infra/docker/docker-compose.staging.yml buildingos-staging /opt/pawtech/env/buildingos-staging.env http://buildingos-api:3000
run_rejected_case 'production Compose project' 'unexpected staging Compose project' "$SHA" /opt/pawtech/apps/buildingos-staging/buildingos-app infra/docker/docker-compose.staging.yml buildingos-production /opt/pawtech/env/buildingos-staging.env http://buildingos-api:3000

printf 'PASS: finance staging acceptance rejects invalid and non-staging targets\n'
