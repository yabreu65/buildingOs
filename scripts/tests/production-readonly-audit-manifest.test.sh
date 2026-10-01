#!/usr/bin/env bash
set -euo pipefail

parser='scripts/lib/production-migration-target.sh'
tab=$'\t'

assert_target() {
  local expected="$1"
  local input="$2"
  local actual

  if actual="$(printf '%s\n' "$input" | bash "$parser")" && [[ "$actual" == "$expected" ]]; then
    return
  fi
  printf 'FAIL: expected target %s, got %s\n' "$expected" "${actual:-<none>}" >&2
  exit 1
}

assert_rejected() {
  local description="$1"
  local input="$2"

  if printf '%s\n' "$input" | bash "$parser" >/dev/null; then
    printf 'FAIL: %s was accepted\n' "$description" >&2
    exit 1
  fi
}

assert_target '106' "status=ok${tab}mode=verify-files${tab}manifest_version=1${tab}local=106${tab}baseline=81${tab}target=106${tab}pending=25"
assert_target '106' "target=106${tab}status=ok"
assert_target '106' "status=ok${tab}target=106${tab}pending=25"
assert_target '106' "status=ok${tab}pending=25${tab}target=106"
assert_rejected 'missing target' "status=ok${tab}mode=verify-files"
assert_rejected 'duplicate target fields' "status=ok${tab}target=106${tab}target=107"
assert_rejected 'malformed target field' "status=ok${tab}target=106-extra"
assert_rejected 'target without value delimiter' "status=ok${tab}target"
assert_rejected 'substring target field' "status=ok${tab}foo-target=106"

printf 'PASS: exact target field is parsed once from any position and invalid targets fail closed\n'
