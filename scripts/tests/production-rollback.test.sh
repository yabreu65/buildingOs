#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROLLBACK_SCRIPT="$ROOT_DIR/scripts/rollback-production.sh"
readonly SECURITY_VALIDATOR="$ROOT_DIR/scripts/production-security-validate.sh"

line_number() { awk -v pattern="$1" 'index($0, pattern) { print NR; exit }' "$2"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

rollback_stop_line="$(line_number 'stop --timeout 30 buildingos-api buildingos-web' "$ROLLBACK_SCRIPT")"
rollback_state_line="$(line_number 'Current Web remained running during rollback compatibility validation' "$ROLLBACK_SCRIPT")"
rollback_compat_line="$(line_number 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$ROLLBACK_SCRIPT")"
rollback_barrier_open_line="$(line_number 'remove_release_a_barrier || fail' "$ROLLBACK_SCRIPT")"
rollback_start_line="$(line_number 'up --detach --no-deps --force-recreate buildingos-api buildingos-web' "$ROLLBACK_SCRIPT")"
rollback_failed_record_line="$(line_number 'write_rollback_record FAILED' "$ROLLBACK_SCRIPT")"
[[ -n "$rollback_stop_line" && -n "$rollback_state_line" && -n "$rollback_compat_line" ]] \
  || fail 'rollback must stop both services and verify both remain stopped before compatibility validation'
[[ -n "$rollback_barrier_open_line" && -n "$rollback_start_line" && -n "$rollback_failed_record_line" ]] \
  || fail 'rollback must manage the barrier and record failed compatibility validation'
(( rollback_stop_line < rollback_state_line && rollback_state_line < rollback_compat_line )) \
  || fail 'rollback service quiescence must precede pair validation'
(( rollback_compat_line < rollback_barrier_open_line && rollback_barrier_open_line < rollback_start_line )) \
  || fail 'old application may start only after exact pair compatibility and barrier release'

if grep -F 'docker start buildingos-api' "$ROLLBACK_SCRIPT" >/dev/null; then
  fail 'rollback validation exit trap must not resume the old API blindly'
fi
if grep -F 'docker start buildingos-web' "$ROLLBACK_SCRIPT" >/dev/null; then
  fail 'rollback validation exit trap must not resume the old Web blindly'
fi
grep -F 'buildingos-api buildingos-web' "$ROLLBACK_SCRIPT" >/dev/null

grep -F 'db82d3d37fc6184a6d4063709b9a15b923371695' "$SECURITY_VALIDATOR" >/dev/null \
  || fail 'pinned old-runtime exception must be exact'
printf 'PASS: rollback pair validation fails closed with both services stopped\n'
