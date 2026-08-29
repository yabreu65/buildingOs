#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy-staging.sh"
readonly INVALID_ARGS=(
  not-a-sha
  /controlled/app
  controlled-compose.yml
  controlled-project
  /controlled/env
  http://127.0.0.1:4010/health
  http://127.0.0.1:4010/ready
  http://127.0.0.1:4010/readyz
  http://127.0.0.1:4011/login
  http://127.0.0.1:4010/health
  http://127.0.0.1:4011/login
)

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_output() {
  local output="$1"
  local expected="$2"

  [[ "$output" == *"$expected"* ]] || fail "expected output to contain: $expected"
  [[ "$output" != *'BASH_SOURCE'* ]] || fail 'output unexpectedly mentions BASH_SOURCE'
  [[ "$output" != *'unbound variable'* ]] || fail 'output unexpectedly mentions an unbound variable'
}

if ! (
  source "$DEPLOY_SCRIPT"
  declare -F require_storage_cutover_preconditions >/dev/null
  if declare -p TARGET_SHA >/dev/null 2>&1; then
    exit 1
  fi
); then
  fail 'source mode invoked main or did not expose deployment helpers'
fi
printf 'PASS: source mode preserves helper access without invoking main\n'

set +e
stream_no_args_output="$(bash -s < "$DEPLOY_SCRIPT" 2>&1)"
stream_no_args_status=$?
set -e
[[ "$stream_no_args_status" -eq 64 ]] || fail "streamed no-args exit code was $stream_no_args_status"
assert_output "$stream_no_args_output" 'Usage:'
printf 'PASS: streamed no-args mode invokes usage\n'

set +e
stream_args_output="$(bash -s -- "${INVALID_ARGS[@]}" < "$DEPLOY_SCRIPT" 2>&1)"
stream_args_status=$?
set -e
[[ "$stream_args_status" -eq 2 ]] || fail "streamed argument exit code was $stream_args_status"
assert_output "$stream_args_output" 'Invalid SHA'
printf 'PASS: streamed argument mode invokes main\n'

set +e
direct_output="$("$DEPLOY_SCRIPT" "${INVALID_ARGS[@]}" 2>&1)"
direct_status=$?
set -e
[[ "$direct_status" -eq 2 ]] || fail "direct execution exit code was $direct_status"
assert_output "$direct_output" 'Invalid SHA'
printf 'PASS: direct execution invokes main\n'
