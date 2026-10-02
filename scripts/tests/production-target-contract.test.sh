#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly GATE="$ROOT_DIR/scripts/verify-production-target-contract.sh"
readonly WORKFLOW="$ROOT_DIR/.github/workflows/deploy-production.yml"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-target-contract-test.XXXXXX")"
readonly TMP_ROOT

cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

fail_test() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

pass_test() { printf 'ok - %s\n' "$1"; }
line_number() { awk -v pattern="$1" 'index($0, pattern) { print NR; exit }' "$2"; }

old_target="$TMP_ROOT/pre-107"
mkdir -p "$old_target/scripts/manifests"
printf 'manifest_version\t1\nbaseline\t81\t0\ntarget\t98\t0\n' \
  > "$old_target/scripts/manifests/production-migrations-81-to-98.tsv"
if bash "$GATE" "$old_target" >/dev/null 2>&1; then
  fail_test 'pre-107 target contract was accepted'
fi
pass_test 'pre-107 target contract is rejected'

stale_target="$TMP_ROOT/stale-106"
mkdir -p "$stale_target/scripts/manifests" "$stale_target/apps/api/prisma"
cp "$ROOT_DIR/scripts/manifests/production-migrations-81-to-106.tsv" \
  "$stale_target/scripts/manifests/production-migrations-81-to-106.tsv"
cp -R "$ROOT_DIR/apps/api/prisma/migrations" "$stale_target/apps/api/prisma/"
if bash "$GATE" "$stale_target" >/dev/null 2>&1; then
  fail_test 'stale 106 target contract was accepted after validator moved to 107'
fi
pass_test 'stale 106 target contract is rejected after validator moves to 107'

valid_target="$TMP_ROOT/valid-107"
mkdir -p "$valid_target/scripts/manifests" "$valid_target/apps/api/prisma"
cp "$ROOT_DIR/scripts/manifests/production-migrations-81-to-107.tsv" \
  "$valid_target/scripts/manifests/production-migrations-81-to-107.tsv"
cp -R "$ROOT_DIR/apps/api/prisma/migrations" "$valid_target/apps/api/prisma/"
bash "$GATE" "$valid_target" >/dev/null || fail_test 'valid 107 target contract was rejected'
pass_test 'verified 107 target contract is accepted'

grep -F 'readonly TRUSTED_VERIFIER="$SCRIPT_DIR/verify-production-migration-manifest.sh"' "$GATE" >/dev/null
if grep -F 'target_tree/scripts/verify-production-migration-manifest.sh' "$GATE" >/dev/null; then
  fail_test 'target tree verifier is trusted by the gate'
fi
pass_test 'target tree verifier is not trusted by the gate'

manifest_gate_line="$(line_number 'test -f scripts/manifests/production-migrations-81-to-107.tsv && test ! -L scripts/manifests/production-migrations-81-to-107.tsv' "$WORKFLOW")"
target_contract_line="$(line_number 'bash scripts/verify-production-target-contract.sh "$target_tree"' "$WORKFLOW")"
deployment_step_line="$(line_number '- name: Run trusted production deployment' "$WORKFLOW")"
ssh_line="$(line_number 'ssh "${ssh_opts[@]}" "$SSH_USER@$SSH_HOST"' "$WORKFLOW")"
[[ -n "$manifest_gate_line" && -n "$target_contract_line" && -n "$deployment_step_line" && -n "$ssh_line" ]] || fail_test 'workflow manifest gate, target contract gate, or SSH step is missing'
(( manifest_gate_line < target_contract_line && target_contract_line < deployment_step_line && deployment_step_line < ssh_line )) || fail_test 'manifest and target gates must run before the SSH deployment step'
pass_test 'exact 107 manifest and target contract rejection occur before the SSH deployment step'

release_a_manifest="$ROOT_DIR/scripts/manifests/production-migrations-81-to-107.tsv"
[[ -f "$release_a_manifest" ]] || fail_test '107 target manifest is missing'
grep -Fx $'target\t107\t0' "$release_a_manifest" >/dev/null \
  || fail_test '107 target manifest does not declare exact target 107'
[[ ! -e "$ROOT_DIR/apps/api/prisma/migrations/20260920000000_release_a_followup" ]] \
  || fail_test 'future migration 108 exists'
pass_test 'Release A inventory targets exactly 107 and has no follow-up migration 108'

printf '1..6\n'
