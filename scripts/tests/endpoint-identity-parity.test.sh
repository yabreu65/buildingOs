#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly HELPER="$ROOT_DIR/scripts/lib/endpoint-identity.sh"

pass_count=0
fail_count=0
pass() { pass_count=$((pass_count + 1)); printf 'ok %s - %s\n' "$pass_count" "$1"; }
fail_test() { fail_count=$((fail_count + 1)); printf 'not ok - %s\n' "$1" >&2; }

endpoint_from_helper() {
  bash -c 'source "$1"; endpoint_identity "$2"' _ "$HELPER" "$1"
}

assert_identity() {
  local input="$1"
  local expected="$2"
  local actual
  actual="$(endpoint_from_helper "$input")"
  if [[ "$actual" == "$expected" ]]; then pass "endpoint identity: $input"; else fail_test "endpoint identity: $input"; fi
}

assert_invalid_identity() {
  local input="$1"
  if endpoint_from_helper "$input" >/dev/null 2>&1; then fail_test "invalid endpoint rejected: $input"; else pass "invalid endpoint rejected: $input"; fi
}

for runtime_script in \
  production-backup-preflight.sh validate-sse-capability.sh backup-minio.sh \
  probe-contabo-sse-s3.sh restore-minio.sh render-minio-restore-target-policy.sh; do
  if grep -Fq 'lib/endpoint-identity.sh' "$ROOT_DIR/scripts/$runtime_script"; then
    pass "$runtime_script uses shared endpoint helper"
  else
    fail_test "$runtime_script uses shared endpoint helper"
  fi
done

assert_identity 'https://backup.example.invalid/' 'backup.example.invalid:443'
assert_identity 'HTTPS://BACKUP.EXAMPLE.INVALID' 'backup.example.invalid:443'
assert_identity 'http://backup.example.invalid' 'backup.example.invalid:80'
assert_identity 'https://backup.example.invalid:8443' 'backup.example.invalid:8443'
assert_identity 'http://192.0.2.10:19000/' '192.0.2.10:19000'
assert_identity 'http://[::1]:19000' '[::1]:19000'
assert_identity 'HTTP://[2001:DB8::1]:8443/' '[2001:db8::1]:8443'
assert_identity '[::1]' '[::1]:443'
assert_identity 'http://[::1]' '[::1]:80'

for invalid_endpoint in \
  'https://backup.example.invalid/path' \
  'http://[::1]:99999' \
  'http://[::1]:19000/path' \
  'http://[::1:::2]:19000' \
  'http://[2001:db8:1:2:3:4:5]:19000' \
  'ftp://backup.example.invalid'; do
  assert_invalid_identity "$invalid_endpoint"
done

generated_endpoint="$("$ROOT_DIR/scripts/render-minio-restore-target-policy.sh" \
  --environment rehearsal --endpoint-identity restore.example.invalid \
  --bucket buildingos-rehearsal-restore-test | jq -er '.rehearsal.endpoint_identity')"
target_endpoint="$(endpoint_from_helper 'https://restore.example.invalid')"
policy_endpoint="$(endpoint_from_helper "$generated_endpoint")"
if [[ "$target_endpoint" == "$policy_endpoint" ]]; then
  pass 'restore policy generator output matches runtime canonical identity'
else
  fail_test 'restore policy generator output matches runtime canonical identity'
fi

if (( fail_count > 0 )); then
  printf 'FAILED: %s test(s) failed; %s passed\n' "$fail_count" "$pass_count" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$pass_count"
