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

old_target="$TMP_ROOT/pre-99"
mkdir -p "$old_target/scripts/manifests"
printf 'manifest_version\t1\nbaseline\t81\t0\ntarget\t98\t0\n' \
  > "$old_target/scripts/manifests/production-migrations-81-to-98.tsv"
if bash "$GATE" "$old_target" >/dev/null 2>&1; then
  fail_test 'pre-99 target contract was accepted'
fi
pass_test 'pre-99 target contract is rejected'

valid_target="$TMP_ROOT/valid-99"
mkdir -p "$valid_target/scripts/manifests" "$valid_target/apps/api/prisma"
cp "$ROOT_DIR/scripts/manifests/production-migrations-81-to-99.tsv" \
  "$valid_target/scripts/manifests/production-migrations-81-to-99.tsv"
cp -R "$ROOT_DIR/apps/api/prisma/migrations" "$valid_target/apps/api/prisma/"
printf '#!/usr/bin/env bash\nexit 99\n' > "$valid_target/scripts/verify-production-migration-manifest.sh"
chmod 755 "$valid_target/scripts/verify-production-migration-manifest.sh"
if ! bash "$GATE" "$valid_target" >/dev/null; then
  fail_test 'valid 99 target contract was rejected'
fi
pass_test 'valid 99 target contract is accepted using trusted control logic'

grep -F 'readonly TRUSTED_VERIFIER="$SCRIPT_DIR/verify-production-migration-manifest.sh"' "$GATE" >/dev/null
if grep -F 'target_tree/scripts/verify-production-migration-manifest.sh' "$GATE" >/dev/null; then
  fail_test 'target tree verifier is trusted by the gate'
fi
pass_test 'target tree verifier is not trusted by the gate'

target_contract_line="$(line_number 'bash scripts/verify-production-target-contract.sh "$target_tree"' "$WORKFLOW")"
deployment_step_line="$(line_number '- name: Run trusted production deployment' "$WORKFLOW")"
ssh_line="$(line_number 'ssh "${ssh_opts[@]}" "$SSH_USER@$SSH_HOST"' "$WORKFLOW")"
[[ -n "$target_contract_line" && -n "$deployment_step_line" && -n "$ssh_line" ]] || fail_test 'workflow gate or SSH step is missing'
(( target_contract_line < deployment_step_line && deployment_step_line < ssh_line )) || fail_test 'target gate runs after SSH boundary'
pass_test 'target contract rejection occurs before the SSH deployment step'

printf '1..4\n'
