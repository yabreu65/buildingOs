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
