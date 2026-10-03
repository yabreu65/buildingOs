#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly SCRIPT="$ROOT_DIR/scripts/finance-staging-acceptance.sh"
readonly ACCEPTANCE_MJS="$ROOT_DIR/scripts/finance-staging-acceptance.mjs"
readonly SHA='15b8587c4e4740abd6d91e6c795c83ceeaf6bdcf'
readonly VALID_ARGS=(
  "$SHA"
  /opt/pawtech/apps/buildingos-staging/buildingos-app
  infra/docker/docker-compose.staging.yml
  buildingos-staging
  /opt/pawtech/env/buildingos-staging.env
  http://buildingos-api:3000
)

# shellcheck source=scripts/finance-staging-acceptance.sh
source "$SCRIPT"
dynamic_sha_args=("${VALID_ARGS[@]/$SHA/1111111111111111111111111111111111111111}")
validate_arguments "${dynamic_sha_args[@]}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
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
  if (assert_staging_runtime_environment "$container" "$name") >/dev/null 2>&1; then
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
seed_handoff_guard_line="$(grep -nF "process.env.FINANCE_ACCEPTANCE_SEED_HASH_HANDOFF === '1'" "$ROOT_DIR/apps/api/prisma/seed-staging-golden.ts" | cut -d: -f1)"
seed_handoff_output_line="$(grep -nF 'STAGING_GOLDEN_SEED_HASH_PRIVATE=' "$ROOT_DIR/apps/api/prisma/seed-staging-golden.ts" | cut -d: -f1)"
[[ -n "$seed_handoff_guard_line" && "$seed_handoff_output_line" == "$((seed_handoff_guard_line + 1))" && \
  "$(grep -Fc 'STAGING_GOLDEN_SEED_HASH_PRIVATE=' "$ROOT_DIR/apps/api/prisma/seed-staging-golden.ts")" == '1' ]] || {
  printf 'FAIL: direct seed source must emit its sole handoff only inside the acceptance switch\n' >&2
  exit 1
}
sanitized_success_output="$(bash -c '
  source "$1"
  FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH="PRIVATE_HASH_SENTINEL"
  print_sanitized_output "$2"
' _ "$SCRIPT" $'benign warning retained\nSTAGING_GOLDEN_SEED_HASH_PRIVATE=PRIVATE_HASH_SENTINEL\nrestore note PRIVATE_HASH_SENTINEL')"
[[ "$sanitized_success_output" == *'benign warning retained'* && "$sanitized_success_output" == *'restore note [REDACTED]'* && \
  "$sanitized_success_output" != *'STAGING_GOLDEN_SEED_HASH_PRIVATE='* && "$sanitized_success_output" != *'PRIVATE_HASH_SENTINEL'* ]] || {
  printf 'FAIL: successful diagnostics must remain visible with private handoff/hash redacted\n' >&2
  exit 1
}
grep -Fq -- '-e FINANCE_ACCEPTANCE_SEED_HASH_HANDOFF=1' "$SCRIPT" || {
  printf 'FAIL: acceptance seed invocation must explicitly enable private handoff\n' >&2
  exit 1
}
[[ "$(grep -Fc -- '-e FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH' "$SCRIPT")" == '1' ]] || {
  printf 'FAIL: seed hash must be passed only to the restore child\n' >&2
  exit 1
}
if ! grep -Fq "print_sanitized_output \"\$seed_output\"" "$SCRIPT" || \
  ! grep -Fq "print_sanitized_output \"\$restore_output\"" "$SCRIPT"; then
  printf 'FAIL: successful seed and restore diagnostics must be printed through redaction\n' >&2
  exit 1
fi

baseline_capture_line="$(grep -n 'capture-acceptance-baseline' "$SCRIPT" | head -1 | cut -d: -f1)"
seed_line="$(grep -n 'profile seed-staging-golden run' "$SCRIPT" | head -1 | cut -d: -f1)"
[[ -n "$baseline_capture_line" && -n "$seed_line" && "$baseline_capture_line" -lt "$seed_line" ]] || {
  printf 'FAIL: full acceptance baseline must be captured before seed\n' >&2
  exit 1
}
grep -Fq 'ACCEPTANCE_BASELINE_SNAPSHOT' "$SCRIPT" || {
  printf 'FAIL: full baseline must use ACCEPTANCE_BASELINE_SNAPSHOT\n' >&2
  exit 1
}
baseline_pipe_count="$(grep -Fc "printf '%s' \"\$ACCEPTANCE_BASELINE_SNAPSHOT\" |" "$SCRIPT")"
[[ "$baseline_pipe_count" == '2' ]] || {
  printf 'FAIL: the same full baseline must be piped to acceptance and password restoration\n' >&2
  exit 1
}
if grep -Eq 'capture-golden-passwords|PASSWORD_SNAPSHOT' "$SCRIPT"; then
  printf 'FAIL: password-only baseline mode and variable name are forbidden\n' >&2
  exit 1
fi
grep -Fq 'trap restore_golden_password_baseline EXIT' "$SCRIPT" || {
  printf 'FAIL: Golden password restore must be registered for all shell exits\n' >&2
  exit 1
}
grep -Fq 'DURABLE_AUDIT_EVIDENCE' "$ROOT_DIR/scripts/lib/finance-staging-acceptance-cleanup.mjs" || {
  printf 'FAIL: mutation inventory must classify durable audit evidence\n' >&2
  exit 1
}
if grep -Eq 'prisma\.auditLog\.(delete|deleteMany)' "$ROOT_DIR/scripts/lib/finance-staging-acceptance-cleanup.mjs"; then
  printf 'FAIL: acceptance cleanup must preserve AuditLog history\n' >&2
  exit 1
fi
grep -Fq 'cleanup.markSessionAttempted()' "$ACCEPTANCE_MJS" || {
  printf 'FAIL: auth session identity capture must fail closed after login\n' >&2
  exit 1
}

successful_cleanup_markers=$'QA_RUN_MUTABLE_DB_CLEANUP_PASS\nQA_RUN_STORAGE_CLEANUP_PASS\nQA_AUTH_SESSION_CLEANUP_PASS\nQA_AUDIT_HISTORY_PRESERVED_PASS\nQA_RECEIPT_SEQUENCE_BASELINE_UNCHANGED_PASS\nQA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS\nRUN_SCOPED_MUTABLE_DB_RESIDUE=0\nRUN_SCOPED_STORAGE_RESIDUE=0\nRUN_SCOPED_ACTIVE_SESSION_RESIDUE=0'
failed_acceptance_output="$successful_cleanup_markers"$'\nFINANCE_02C_ACCEPTANCE_FAILED: synthetic original failure'
acceptance_output_proves_cleanup "$successful_cleanup_markers" || {
  printf 'FAIL: all exact cleanup success markers and zero residue counts must prove child cleanup\n' >&2
  exit 1
}
recorded_success_output="$(bash -c '
  source "$1"
  trap - EXIT
  record_acceptance_result 0 "$2" >/dev/null || exit $?
  [[ "$RUN_CLEANUP_PASS" == "1" ]] || exit 1
  printf "STATE_PASS\\n"
' _ "$SCRIPT" "$successful_cleanup_markers")"
[[ "$recorded_success_output" == 'STATE_PASS' ]] || {
  printf 'FAIL: the output/state helper must record proven child cleanup\n' >&2
  exit 1
}
for incomplete_output in \
  "${successful_cleanup_markers/QA_RUN_STORAGE_CLEANUP_PASS/QA_RUN_STORAGE_CLEANUP_FAIL}" \
  "${successful_cleanup_markers/RUN_SCOPED_STORAGE_RESIDUE=0/RUN_SCOPED_STORAGE_RESIDUE=1}" \
  "${successful_cleanup_markers/QA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS/}"; do
  if acceptance_output_proves_cleanup "$incomplete_output"; then
    printf 'FAIL: incomplete child cleanup evidence must not set cleanup-success state\n' >&2
    exit 1
  fi
done
set +e
incomplete_success_output="$(bash -c '
  source "$1"
  trap - EXIT
  record_acceptance_result 0 "$2"
' _ "$SCRIPT" "${successful_cleanup_markers/QA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS/}" 2>&1)"
incomplete_success_status=$?
set -e
[[ "$incomplete_success_status" -ne 0 && "$incomplete_success_output" == *'without complete cleanup evidence'* ]] || {
  printf 'FAIL: a successful child without all cleanup markers must fail the shell acceptance\n' >&2
  exit 1
}

set +e
preserved_failure_output="$(bash -c '
  source "$1"
  docker() { cat >/dev/null; printf "GOLDEN_PASSWORD_HASH_RESTORE_PASS\\n"; }
  ACCEPTANCE_BASELINE_SNAPSHOT="PRIVATE_HASH_SENTINEL"
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  COMPOSE_COMMAND=(docker)
  trap - EXIT
  set +e
  record_acceptance_result 7 "$2"
  original_status=$?
  (exit "$original_status")
  restore_golden_password_baseline
' _ "$SCRIPT" "$failed_acceptance_output" 2>&1)"
preserved_failure_status=$?
set -e
[[ "$preserved_failure_status" -eq 7 && "$preserved_failure_output" == *'FINANCE_02C_ACCEPTANCE_FAILED: synthetic original failure'* && "$preserved_failure_output" == *'GOLDEN_PASSWORD_HASH_RESIDUE=0'* && "$preserved_failure_output" == *'QA_GOLDEN_PASSWORD_RESTORE_PASS'* && "$preserved_failure_output" == *'QA_RUN_RESIDUE_ZERO_PASS'* ]] || {
  printf 'FAIL: successful exact cleanup plus password restoration must report zero residue without masking the original failure\n' >&2
  exit 1
}

set +e
missing_cleanup_output="$(bash -c '
  source "$1"
  docker() { cat >/dev/null; printf "GOLDEN_PASSWORD_HASH_RESTORE_PASS\\n"; }
  ACCEPTANCE_BASELINE_SNAPSHOT="PRIVATE_HASH_SENTINEL"
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  COMPOSE_COMMAND=(docker)
  trap - EXIT
  set +e
  record_acceptance_result 7 "$2"
  original_status=$?
  (exit "$original_status")
  restore_golden_password_baseline
' _ "$SCRIPT" "${failed_acceptance_output/RUN_SCOPED_ACTIVE_SESSION_RESIDUE=0/}" 2>&1)"
missing_cleanup_status=$?
set -e
[[ "$missing_cleanup_status" -eq 7 && "$missing_cleanup_output" == *'FINANCE_02C_ACCEPTANCE_FAILED: synthetic original failure'* && "$missing_cleanup_output" != *'QA_RUN_RESIDUE_ZERO_PASS'* ]] || {
  printf 'FAIL: missing child cleanup evidence must not report zero residue\n' >&2
  exit 1
}

restore_output="$(bash -c '
  source "$1"
  docker() { cat >/dev/null; printf "GOLDEN_PASSWORD_HASH_RESTORE_PASS\\n"; }
  ACCEPTANCE_BASELINE_SNAPSHOT="PRIVATE_HASH_SENTINEL"
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  RUN_CLEANUP_PASS=1
  COMPOSE_COMMAND=(docker)
  trap - EXIT
  restore_golden_password_baseline
' _ "$SCRIPT")"
[[ "$restore_output" == *'GOLDEN_PASSWORD_HASH_RESTORE_PASS'* && "$restore_output" == *'GOLDEN_PASSWORD_HASH_RESIDUE=0'* && "$restore_output" == *'QA_GOLDEN_PASSWORD_RESTORE_PASS'* && "$restore_output" == *'QA_RUN_RESIDUE_ZERO_PASS'* ]] || {
  printf 'FAIL: exit trap must restore the exact baseline and report zero residue only after cleanup\n' >&2
  exit 1
}
[[ "$restore_output" != *'GOLDEN_BASELINE_MUTATION_RESIDUE=0'* && "$restore_output" != *'QA_GOLDEN_BASELINE_RESTORE_PASS'* ]] || {
  printf 'FAIL: ambiguous Golden baseline markers are forbidden\\n' >&2
  exit 1
}
[[ "$restore_output" != *'PRIVATE_HASH_SENTINEL'* ]] || {
  printf 'FAIL: password baseline escaped into output\n' >&2
  exit 1
}

set +e
failed_restore_output="$(bash -c '
  source "$1"
  docker() {
    cat >/dev/null
    printf "useful restore diagnostic\\nSTAGING_GOLDEN_SEED_HASH_PRIVATE=PRIVATE_HASH_SENTINEL\\nrestore failed for PRIVATE_HASH_SENTINEL\\n" >&2
    return 1
  }
  ACCEPTANCE_BASELINE_SNAPSHOT="PRIVATE_HASH_SENTINEL"
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH="PRIVATE_HASH_SENTINEL"
  COMPOSE_COMMAND=(docker)
  trap - EXIT
  restore_golden_password_baseline
' _ "$SCRIPT" 2>&1)"
failed_restore_status=$?
set -e
[[ "$failed_restore_status" -ne 0 && "$failed_restore_output" == *'useful restore diagnostic'* && "$failed_restore_output" != *'PRIVATE_HASH_SENTINEL'* ]] || {
  printf 'FAIL: restore diagnostics must remain useful while private hash material is redacted\\n' >&2
  exit 1
}

set +e
failed_restore_output="$(bash -c '
  source "$1"
  docker() { cat >/dev/null; return 1; }
  ACCEPTANCE_BASELINE_SNAPSHOT="PRIVATE_HASH_SENTINEL"
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  RUN_CLEANUP_PASS=1
  COMPOSE_COMMAND=(docker)
  trap - EXIT
  restore_golden_password_baseline
' _ "$SCRIPT" 2>&1)"
failed_restore_status=$?
set -e
[[ "$failed_restore_status" -ne 0 && "$failed_restore_output" == *'GOLDEN_PASSWORD_HASH_RESTORE_FAIL'* && "$failed_restore_output" != *'QA_RUN_RESIDUE_ZERO_PASS'* ]] || {
  printf 'FAIL: failed Golden password restoration must fail acceptance without claiming zero residue\n' >&2
  exit 1
}

set +e
missing_password_proof_output="$(bash -c '
  source "$1"
  docker() { cat >/dev/null; return 0; }
  ACCEPTANCE_BASELINE_SNAPSHOT="PRIVATE_HASH_SENTINEL"
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  RUN_CLEANUP_PASS=1
  COMPOSE_COMMAND=(docker)
  trap - EXIT
  restore_golden_password_baseline
' _ "$SCRIPT" 2>&1)"
missing_password_proof_status=$?
set -e
[[ "$missing_password_proof_status" -ne 0 && "$missing_password_proof_output" != *'QA_RUN_RESIDUE_ZERO_PASS'* ]] || {
  printf 'FAIL: successful restore command without exact password proof must not report zero residue\n' >&2
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
