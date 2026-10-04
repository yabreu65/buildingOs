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

# Exercise private marker parsing/sanitization and the temporary Compose override without Docker.
private_channel_output="$(bash -c '
  set -euo pipefail
  source "$1"
  trap - EXIT
  create_private_compose_override
  marker="$BASELINE_PRIVATE_MARKER"
  hash_marker="$HASH_ONLY_PRIVATE_MARKER"
  [[ "$marker" =~ ^__FINANCE_ACCEPTANCE_BASELINE_[a-f0-9]{32}__$ && "$hash_marker" =~ ^__FINANCE_ACCEPTANCE_HASH_ONLY_[a-f0-9]{32}__$ && "$marker" != "$hash_marker" ]] || exit 9
  captured="$(printf "ordinary diagnostic\\n%s:baseline-json\\n" "$marker")"
  extract_private_record "$captured" "$marker" baseline || exit 10
  [[ "$baseline" == baseline-json ]] || exit 11
  if extract_private_record "diagnostic only" "$marker" missing; then exit 20; fi
  duplicate_output="$(printf "%s:one\\n%s:two\\n" "$marker" "$marker")"
  if extract_private_record "$duplicate_output" "$marker" duplicate; then exit 12; fi
  if extract_private_record "${marker}" "$marker" malformed; then exit 13; fi
  if extract_private_record "${marker}:" "$marker" empty; then exit 14; fi
  FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH=private-seed-hash
  bcrypt_hash="\$2b\$10\$$(printf 'a%.0s' {1..53})"
  diagnostic_output="$(printf "warning retained\\n%s:baseline-json\\n%s:private-seed-hash\\nattached private stream %s\\nmore useful diagnostics" "$marker" "$hash_marker" "$bcrypt_hash")"
  safe="$(sanitize_private_diagnostics "$diagnostic_output")"
  [[ "$safe" == *"warning retained"* && "$safe" == *"more useful diagnostics"* && "$safe" != *"baseline-json"* && "$safe" != *"private-seed-hash"* && "$safe" != *"$bcrypt_hash"* && "$safe" != *"$marker"* && "$safe" != *"$hash_marker"* ]] || exit 15
  [[ "$(node -e '\''const fs=require("node:fs");process.stdout.write((fs.statSync(process.argv[1]).mode&0o777).toString(8))'\'' "$ACCEPTANCE_PRIVATE_DIR")" == 700 ]] || exit 16
  [[ "$(node -e '\''const fs=require("node:fs");process.stdout.write((fs.statSync(process.argv[1]).mode&0o777).toString(8))'\'' "$COMPOSE_OVERRIDE_FILE")" == 600 ]] || exit 17
  expected=$'\''services:\n  buildingos-api:\n    logging:\n      driver: none\n  api-seed-staging-golden:\n    logging:\n      driver: none'\''
  [[ "$(<"$COMPOSE_OVERRIDE_FILE")" == "$expected" ]] || exit 18
  private_dir="$ACCEPTANCE_PRIVATE_DIR"
  cleanup_private_compose_override
  [[ ! -e "$private_dir" ]] || exit 19
  printf "PRIVATE_STREAM_HELPERS_PASS\\n"
' _ "$SCRIPT")"
[[ "$private_channel_output" == 'PRIVATE_STREAM_HELPERS_PASS' ]] || {
  printf 'FAIL: private marker, sanitization, or Compose override behavior failed\n' >&2
  exit 1
}

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
seed_hash_mode_block="$(awk '/export async function runSeedMode/,/^}/' "$ROOT_DIR/apps/api/prisma/seed-staging-golden.ts")"
if ! grep -Fq "if (mode !== 'hash-acceptance-seed-password') return runOrdinarySeed();" <<<"$seed_hash_mode_block" || \
  ! grep -Fq "writeOutput(\`\${record}\\n\`);" <<<"$seed_hash_mode_block"; then
  printf 'FAIL: private hash marker must be emitted only by the non-mutating hash-only mode\n' >&2
  exit 1
fi
if grep -Eq 'console\.(log|error).*FINANCE_ACCEPTANCE_HASH_ONLY_MARKER|console\.(log|error).*passwordHash' "$ROOT_DIR/apps/api/prisma/seed-staging-golden.ts"; then
  printf 'FAIL: mutating seed must not emit the private hash marker or generated hash\n' >&2
  exit 1
fi
grep -Fq 'isAcceptanceHashHandoffEnabled' "$ROOT_DIR/apps/api/prisma/seed-staging-golden.ts" || {
  printf 'FAIL: ordinary Golden seed must remain separate from acceptance marker handoff\n' >&2
  exit 1
}
sanitized_success_output="$(bash -c '
  source "$1"
  BASELINE_PRIVATE_MARKER="__FINANCE_ACCEPTANCE_BASELINE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa__"
  HASH_ONLY_PRIVATE_MARKER="__FINANCE_ACCEPTANCE_HASH_ONLY_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb__"
  FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH="PRIVATE_HASH_SENTINEL"
  print_sanitized_output "$2"
' _ "$SCRIPT" $'benign warning retained\n__FINANCE_ACCEPTANCE_BASELINE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa__:PRIVATE_BASELINE_SENTINEL\n__FINANCE_ACCEPTANCE_HASH_ONLY_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb__:PRIVATE_HASH_SENTINEL\nrestore note PRIVATE_HASH_SENTINEL')"
[[ "$sanitized_success_output" == *'benign warning retained'* && "$sanitized_success_output" == *'restore note [REDACTED]'* && \
  "$sanitized_success_output" != *'PRIVATE_BASELINE_SENTINEL'* && "$sanitized_success_output" != *'PRIVATE_HASH_SENTINEL'* ]] || {
  printf 'FAIL: useful diagnostics must remain visible while private marker records/hash are suppressed\n' >&2
  exit 1
}
if grep -Eq -- '-e FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH|-e STAGING_GOLDEN_SEED_HASH' "$SCRIPT"; then
  printf 'FAIL: seed hash must never be passed in container environment\n' >&2
  exit 1
fi
if grep -Eq "seed-staging-golden.*(\$FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH|passwordHash)" "$SCRIPT"; then
  printf 'FAIL: seed hash must never be passed in container argv\n' >&2
  exit 1
fi
grep -Fq 'cleanup_private_compose_override' "$SCRIPT" || {
  printf 'FAIL: private Compose override file and directory must be removed on exit\n' >&2
  exit 1
}
if grep -Eq 'capture-acceptance-baseline >/dev/null|api-seed-staging-golden >/dev/null' "$SCRIPT"; then
  printf 'FAIL: capture/seed diagnostics must not be suppressed\n' >&2
  exit 1
fi
inherited_hash_env="$(bash -c '
  export FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH=PRIVATE_INHERITED_HASH
  source "$1"
  if export -p | grep -q FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH; then exit 1; fi
  printf "HASH_NOT_EXPORTED_PASS\\n"
' _ "$SCRIPT")"
[[ "$inherited_hash_env" == 'HASH_NOT_EXPORTED_PASS' ]] || {
  printf 'FAIL: generated seed hash must not reach child container environments\n' >&2
  exit 1
}
grep -Fq 'passwordPreimages' "$ROOT_DIR/apps/api/prisma/seed-staging-golden.ts" || {
  printf 'FAIL: seed must receive and enforce captured password preimages\n' >&2
  exit 1
}
seed_output_handler="$(awk '/local seed_status=0/,/local acceptance_output/' "$SCRIPT")"
if ! grep -Fq "print_sanitized_output \"\$seed_output\"" <<<"$seed_output_handler"; then
  printf 'FAIL: successful seed diagnostics must be preserved through private-output sanitization\n' >&2
  exit 1
fi
if ! grep -Fq "print_sanitized_diagnostics \"\$seed_output\"" <<<"$seed_output_handler"; then
  printf 'FAIL: failed seed diagnostics must be preserved through private-output sanitization\n' >&2
  exit 1
fi
if ! grep -Fq 'unset seed_output seed_handoff_payload ACCEPTANCE_SEED_PASSWORD_PREIMAGES' <<<"$seed_output_handler"; then
  printf 'FAIL: seed output may be cleared only after sanitized diagnostics are emitted\n' >&2
  exit 1
fi
seed_diagnostics_output="$(bash -s "$SCRIPT" 2>&1 <<'BASH'
set -euo pipefail
source "$1"
FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH=PRIVATE_SEED_HASH_SENTINEL
seed_output=$'seed diagnostic retained\\nprivate seed postimage PRIVATE_SEED_HASH_SENTINEL'
seed_status=0
if [[ "$seed_status" == '0' ]]; then
  print_sanitized_output "$seed_output"
else
  print_sanitized_diagnostics "$seed_output"
fi
seed_status=1
if [[ "$seed_status" == '0' ]]; then
  print_sanitized_output "$seed_output"
else
  print_sanitized_diagnostics "$seed_output"
fi
BASH
)"
if [[ "$seed_diagnostics_output" != *'seed diagnostic retained'* || "$seed_diagnostics_output" == *'PRIVATE_SEED_HASH_SENTINEL'* ]]; then
  printf 'FAIL: sanitized seed diagnostics must remain useful without exposing the private seed hash\n' >&2
  exit 1
fi

hash_only_invocation="$(awk '/if hash_only_output=/,/hash_only_status=0/' "$SCRIPT")"
seed_invocation="$(awk '/if seed_output=/,/seed_status=0/' "$SCRIPT")"
for mount in \
  "-v \"\$CONTROL_ROOT/apps/api/prisma/seed-staging-golden.ts:/app/apps/api/prisma/seed-staging-golden.ts:ro\"" \
  "-v \"\$CONTROL_ROOT/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts:/app/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts:ro\""; do
  if ! grep -Fq -- "$mount" <<<"$hash_only_invocation" || ! grep -Fq -- "$mount" <<<"$seed_invocation"; then
    printf 'FAIL: prehash and mutating seed must mount the same exact read-only seed implementation files\n' >&2
    exit 1
  fi
done
baseline_capture_line="$(grep -n 'capture-acceptance-baseline' "$SCRIPT" | head -1 | cut -d: -f1)"
hash_only_line="$(grep -n 'hash-acceptance-seed-password' "$SCRIPT" | head -1 | cut -d: -f1)"
hash_capture_line="$(grep -n "extract_private_record \"\$hash_only_output\"" "$SCRIPT" | head -1 | cut -d: -f1)"
seed_line="$(grep -n 'if seed_output=' "$SCRIPT" | head -1 | cut -d: -f1)"
[[ -n "$baseline_capture_line" && -n "$hash_only_line" && -n "$hash_capture_line" && -n "$seed_line" && \
  "$baseline_capture_line" -lt "$hash_only_line" && "$hash_only_line" -lt "$hash_capture_line" && "$hash_capture_line" -lt "$seed_line" ]] || {
  printf 'FAIL: validated postimage hash must be captured before the mutating seed command\n' >&2
  exit 1
}
grep -Fq 'ACCEPTANCE_BASELINE_SNAPSHOT' "$SCRIPT" || {
  printf 'FAIL: full baseline must use ACCEPTANCE_BASELINE_SNAPSHOT\n' >&2
  exit 1
}
baseline_pipe_count="$(grep -Fc "printf '%s' \"\$ACCEPTANCE_BASELINE_SNAPSHOT\" |" "$SCRIPT")"
[[ "$baseline_pipe_count" == '2' ]] || {
  printf 'FAIL: full baseline must be piped only to local projectors; seed gets the restricted handoff and restore gets stdin\n' >&2
  exit 1
}
acceptance_invocation="$(awk '/local acceptance_output/,/record_acceptance_result/' "$SCRIPT")"
if grep -Fq 'ACCEPTANCE_BASELINE_SNAPSHOT' <<<"$acceptance_invocation" || grep -Fq 'passwordHashes' <<<"$acceptance_invocation" || grep -Fq 'FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH' <<<"$acceptance_invocation"; then
  printf 'FAIL: normal acceptance child must not receive full Golden password preimages\n' >&2
  exit 1
fi
capture_cli_block="$(awk '/if \(mode === "capture-acceptance-baseline"\)/,/else if \(mode === "restore-golden-passwords"\)/' "$ACCEPTANCE_MJS")"
if ! grep -Fq 'formatPrivateRecord(marker, fullBaseline)' <<<"$capture_cli_block" || ! grep -Fq 'process.stdout.write' <<<"$capture_cli_block"; then
  printf 'FAIL: capture must emit one validated private baseline marker through attached stdout\n' >&2
  exit 1
fi
local_projection="$(bash -c '
  source "$1"
  ACCEPTANCE_BASELINE_SNAPSHOT='\''{"passwordHashes":[{"passwordHash":"PRIVATE_HASH_SENTINEL"}],"receiptSequence":{"tenantId":"stg-golden-tenant-auto","year":2026,"row":{"id":"seq-1","lastNumber":4,"updatedAt":"2026-01-01T00:00:00.000Z"},"nextYear":{"year":2027,"row":null}}}'\''
  project_acceptance_baseline_locally
' _ "$SCRIPT")"
[[ "$local_projection" == '{"receiptSequence":{"tenantId":"stg-golden-tenant-auto","year":2026,"row":{"id":"seq-1","lastNumber":4,"updatedAt":"2026-01-01T00:00:00.000Z"},"nextYear":{"year":2027,"row":null}}}' && "$local_projection" != *PRIVATE_HASH_SENTINEL* ]] || {
  printf 'FAIL: local baseline projection must output only ReceiptSequence data\n' >&2
  exit 1
}
seed_password_projection="$(bash -c '
  source "$1"
  ACCEPTANCE_BASELINE_SNAPSHOT='\''{"passwordHashes":[{"id":"qa-user","email":"qa@example.invalid","passwordHash":"PRIVATE_HASH_SENTINEL"}],"receiptSequence":{"lastNumber":999}}'\''
  project_acceptance_seed_password_hashes
' _ "$SCRIPT")"
[[ "$seed_password_projection" == '[{"id":"qa-user","email":"qa@example.invalid","passwordHash":"PRIVATE_HASH_SENTINEL"}]' && "$seed_password_projection" != *'lastNumber'* ]] || {
  printf 'FAIL: seed projection must include only captured password preimages\n' >&2
  exit 1
}
grep -Fq -- "--file \"\$COMPOSE_OVERRIDE_FILE\")" "$SCRIPT" || {
  printf 'FAIL: every private one-shot Compose command must append the override file last\n' >&2
  exit 1
}
if grep -Eq -- "--user|-v \"\$ACCEPTANCE_PRIVATE_DIR|exec [0-9]+<>" "$SCRIPT"; then
  printf 'FAIL: stream transport must not use a private bind mount, user override, or special descriptor\n' >&2
  exit 1
fi
grep -Fq "ACCEPTANCE_SEQUENCE_BASELINE=\"\$(project_acceptance_baseline_locally)" "$SCRIPT" || {
  printf 'FAIL: shell must project receiptSequence locally from its private full snapshot\n' >&2
  exit 1
}
grep -Fq "acceptance_output=\"\$(printf '%s' \"\$ACCEPTANCE_SEQUENCE_BASELINE\" |" "$SCRIPT" || {
  printf 'FAIL: acceptance stdin must contain only the sequence-only projection\n' >&2
  exit 1
}
grep -Fq "printf '%s' \"\$restore_payload\" |" "$SCRIPT" || {
  printf 'FAIL: password restore must receive baseline and generated hash over stdin\n' >&2
  exit 1
}
if ! grep -Fq "printf '%s' \"\$seed_handoff_payload\" |" "$SCRIPT" || ! grep -Fq "seedPasswordHash\\\":\\\"%s" "$SCRIPT"; then
  printf 'FAIL: seed must receive the exact generated hash and password preimages together over stdin\n' >&2
  exit 1
fi
restore_function_body="$(awk '/^restore_golden_password_baseline\(\)/,/^}/' "$SCRIPT")"
if grep -Eq -- '--user|ACCEPTANCE_PRIVATE_DIR' <<<"$restore_function_body"; then
  printf 'FAIL: stdin-only password restore must not alter container identity or mount private paths\n' >&2
  exit 1
fi
grep -Fq 'GOLDEN_PASSWORD_HASH_UNCHANGED_PASS' "$ACCEPTANCE_MJS" || {
  printf 'FAIL: restore must prove unchanged baseline when seed performed no mutation\n' >&2
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

create_private_compose_override
second_signal_private_dir="$ACCEPTANCE_PRIVATE_DIR"
set +e
second_signal_restore_output="$(bash -c '
  source "$1"
  ACCEPTANCE_PRIVATE_DIR="$2"
  COMPOSE_OVERRIDE_FILE="$2/compose.override.yml"
  docker() {
    cat >/dev/null
    kill -TERM "$$"
    printf "GOLDEN_PASSWORD_HASH_RESTORE_PASS\\n"
  }
  ACCEPTANCE_BASELINE_SNAPSHOT="{\\"passwordHashes\\":[]}"
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  RUN_CLEANUP_PASS=1
  COMPOSE_COMMAND=(docker)
  trap '\''exit 129'\'' HUP
  trap '\''exit 130'\'' INT
  trap '\''exit 143'\'' TERM
  trap - EXIT
  set +e
  (exit 7)
  restore_golden_password_baseline
' _ "$SCRIPT" "$second_signal_private_dir" 2>&1)"
second_signal_restore_status=$?
set -e
second_signal_private_dir_cleaned=1
[[ ! -e "$second_signal_private_dir" ]] || second_signal_private_dir_cleaned=0
if [[ "$second_signal_private_dir_cleaned" == 0 ]]; then cleanup_private_compose_override; fi
[[ "$second_signal_restore_status" -eq 7 && "$second_signal_restore_output" == *'GOLDEN_PASSWORD_HASH_RESTORE_PASS'* && "$second_signal_restore_output" == *'GOLDEN_PASSWORD_HASH_RESIDUE=0'* && "$second_signal_restore_output" == *'QA_GOLDEN_PASSWORD_RESTORE_PASS'* && "$second_signal_restore_output" == *'QA_RUN_RESIDUE_ZERO_PASS'* && "$second_signal_private_dir_cleaned" == 1 ]] || {
  printf 'FAIL: second-signal restore status=%s output=%s private_dir_cleaned=%s\\n' "$second_signal_restore_status" "$second_signal_restore_output" "$second_signal_private_dir_cleaned" >&2
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
restore_stdin_framing="$(bash -c '
  source "$1"
  docker() {
    local payload
    payload="$(cat)"
    [[ "$payload" == '\''{"baseline":{"passwordHashes":[]},"seedPasswordHash":"private-seed-hash"}'\'' ]] || return 1
    printf "GOLDEN_PASSWORD_HASH_RESTORE_PASS\\n"
  }
  ACCEPTANCE_BASELINE_SNAPSHOT="{\"passwordHashes\":[]}"
  FINANCE_ACCEPTANCE_GOLDEN_PASSWORD_HASH="private-seed-hash"
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  COMPOSE_COMMAND=(docker)
  trap - EXIT
  restore_golden_password_baseline
' _ "$SCRIPT")"
[[ "$restore_stdin_framing" == *'GOLDEN_PASSWORD_HASH_RESTORE_PASS'* && "$restore_stdin_framing" != *'private-seed-hash'* ]] || {
  printf 'FAIL: restore must receive one framed JSON payload over stdin without exposing its seed hash\n' >&2
  exit 1
}
unchanged_restore_output="$(bash -c '
  source "$1"
  docker() { cat >/dev/null; printf "GOLDEN_PASSWORD_HASH_UNCHANGED_PASS\\n"; }
  ACCEPTANCE_BASELINE_SNAPSHOT="{\"passwordHashes\":[],\"receiptSequence\":{}}"
  ACCEPTANCE_BASELINE_RESTORE_REQUIRED=1
  COMPOSE_COMMAND=(docker)
  trap - EXIT
  restore_golden_password_baseline
' _ "$SCRIPT")"
[[ "$unchanged_restore_output" == *'GOLDEN_PASSWORD_HASH_UNCHANGED_PASS'* && "$unchanged_restore_output" == *'GOLDEN_PASSWORD_HASH_RESIDUE=0'* ]] || {
  printf 'FAIL: baseline unchanged after seed failure must be accepted and proven\n' >&2
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
    printf "useful restore diagnostic\\n%s:PRIVATE_HASH_SENTINEL\\nrestore failed for PRIVATE_HASH_SENTINEL\\n" "$HASH_ONLY_PRIVATE_MARKER" >&2
    return 1
  }
  HASH_ONLY_PRIVATE_MARKER="__FINANCE_ACCEPTANCE_HASH_ONLY_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb__"
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
