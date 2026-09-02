#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"
readonly CANDIDATE_SHA='0000000000000000000000000000000000000000'

set +e
output="$(bash -s -- only-one-argument < "$AUDITOR" 2>&1)"
rc=$?
set -e

[[ "$rc" -eq 64 ]] || { printf 'FAIL: streamed argument validation returned %s\n' "$rc" >&2; exit 1; }
[[ "$output" == *'Usage: bash <candidate_sha>'* ]]
[[ "$output" != *'AUDIT_INTERNAL_FAILURES='* ]]
[[ "$output" != *'BASH_SOURCE[0]: unbound variable'* ]]

set +e
output="$(bash -s -- invalid-sha https://example.invalid/health https://example.invalid/readyz https://example.invalid/login < "$AUDITOR" 2>&1)"
rc=$?
set -e

[[ "$rc" -eq 1 ]] || { printf 'FAIL: invalid input returned %s\n' "$rc" >&2; exit 1; }
[[ "$output" == *'AUDIT_INTERNAL_FAILURES=0'* ]]
[[ "$output" == *'FAILURE_CLASS=INPUT_ERROR'* ]]
[[ "$output" == *'candidate SHA is not exactly 40 lowercase hexadecimal characters'* ]]

set +e
output="$(PATH="/usr/bin:/bin" bash -s -- "$CANDIDATE_SHA" https://example.invalid/health https://example.invalid/readyz https://example.invalid/login < "$AUDITOR" 2>&1)"
rc=$?
set -e

[[ "$rc" -eq 1 ]] || { printf 'FAIL: missing dependency returned %s\n' "$rc" >&2; exit 1; }
[[ "$output" == *'AUDIT_STATUS=INCOMPLETE'* ]]
[[ "$output" == *'AUDIT_INTERNAL_FAILURES=1'* ]]
[[ "$output" == *'FAILED_STAGE=STARTUP'* ]]
[[ "$output" == *'FAILURE_CLASS=AUDITOR_ERROR'* ]]
[[ "$output" == *'docker is required'* ]]
[[ "$output" != *'BASH_SOURCE[0]: unbound variable'* ]]

all_tools_bin="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-readonly-audit-jq.XXXXXX")"
trap 'rm -rf "$all_tools_bin"' EXIT
cat > "$all_tools_bin/docker" <<'SH'
#!/bin/bash
exit 1
SH
chmod +x "$all_tools_bin/docker"
for command_name in awk bash cat curl date find git sha256sum stat; do
  ln -s "$(command -v "$command_name")" "$all_tools_bin/$command_name"
done

set +e
output="$(PATH="$all_tools_bin" /bin/bash -s -- "$CANDIDATE_SHA" https://example.invalid/health https://example.invalid/readyz https://example.invalid/login < "$AUDITOR" 2>&1)"
rc=$?
set -e

[[ "$rc" -eq 1 ]] || { printf 'FAIL: missing jq returned %s\n' "$rc" >&2; exit 1; }
[[ "$output" == *'jq is required'* ]]
[[ "$output" == *'AUDIT_INTERNAL_FAILURES=1'* ]]
[[ "$output" == *'FAILURE_CLASS=AUDITOR_ERROR'* ]]
[[ "$output" != *'BASH_SOURCE[0]: unbound variable'* ]]

printf 'PASS: auditor initializes and reports controlled failures through bash -s stdin transport\n'
