#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
readonly ROLLBACK_SCRIPT="$ROOT_DIR/scripts/rollback-production.sh"
readonly SECURITY_VALIDATOR="$ROOT_DIR/scripts/production-security-validate.sh"

line_number() { awk -v pattern="$1" 'index($0, pattern) { print NR; exit }' "$2"; }
fail_test() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

EXPECTED_CURRENT_SHA='890b4f67044bbc62328493da01d485822e0beafc'
probe_script="[[ \"\$IMAGE_TAG\" == \"\$1\" ]] && [[ \"\$BUILD_REVISION\" == \"\$1\" ]] && [[ \"\$2\" == config && \"\$3\" == --quiet ]]"
unset IMAGE_TAG BUILD_REVISION
BUILDINGOS_ROLLBACK_SELECTOR_LIBRARY_ONLY=true source scripts/rollback-production.sh
rollback_compose_config_preflight "$EXPECTED_CURRENT_SHA" bash -c "$probe_script" _ "$EXPECTED_CURRENT_SHA"

rollback_stop_line="$(line_number 'stop --timeout 30 buildingos-api buildingos-web' "$ROLLBACK_SCRIPT")"
rollback_state_line="$(line_number 'Current Web remained running during rollback compatibility validation' "$ROLLBACK_SCRIPT")"
rollback_compat_pattern="validate_application_rollback_compatibility \"\$POSTGRES_CONTAINER\" buildingos_db"
rollback_compat_line="$(line_number "$rollback_compat_pattern" "$ROLLBACK_SCRIPT")"
rollback_barrier_open_line="$(line_number 'remove_release_a_barrier || fail' "$ROLLBACK_SCRIPT")"
rollback_start_line="$(line_number 'up --detach --no-deps --force-recreate buildingos-api buildingos-web' "$ROLLBACK_SCRIPT")"
rollback_failed_record_line="$(line_number 'write_rollback_record FAILED' "$ROLLBACK_SCRIPT")"
rollback_preflight_pattern="rollback_compose_config_preflight \"\$EXPECTED_CURRENT_SHA\""
rollback_quiesce_command_pattern="\"\${compose[@]}\" stop --timeout 30 buildingos-api buildingos-web"
rollback_preflight_line="$(line_number "$rollback_preflight_pattern" "$ROLLBACK_SCRIPT")"
rollback_quiesce_command_line="$(line_number "$rollback_quiesce_command_pattern" "$ROLLBACK_SCRIPT")"
rollback_tag_pattern="export IMAGE_TAG=\"\$rollback_tag\""
rollback_revision_pattern="export BUILD_REVISION=\"\$EXPECTED_CURRENT_SHA\""
rollback_tag_assignment_line="$(line_number "$rollback_tag_pattern" "$ROLLBACK_SCRIPT")"
rollback_revision_assignment_line="$(line_number "$rollback_revision_pattern" "$ROLLBACK_SCRIPT")"
rollback_trap_line="$(line_number 'trap rollback_exit EXIT' "$ROLLBACK_SCRIPT")"
rollback_fail_closed_function_line="$(line_number 'rollback_fail_closed() {' "$ROLLBACK_SCRIPT")"
rollback_exit_function_line="$(line_number 'rollback_exit() {' "$ROLLBACK_SCRIPT")"
rollback_fail_closed_call_line="$(line_number 'rollback_fail_closed || true' "$ROLLBACK_SCRIPT")"
rollback_fail_closed_barrier_line="$(line_number 'ensure_rollback_barrier || printf' "$ROLLBACK_SCRIPT")"
rollback_fail_closed_stop_line="$(line_number 'docker stop --timeout 30 buildingos-api buildingos-web' "$ROLLBACK_SCRIPT")"
[[ -n "$rollback_stop_line" && -n "$rollback_state_line" && -n "$rollback_compat_line" ]] \
  || fail_test 'rollback must stop both services and verify both remain stopped before compatibility validation'
[[ -n "$rollback_barrier_open_line" && -n "$rollback_start_line" && -n "$rollback_failed_record_line" ]] \
  || fail_test 'rollback must manage the barrier and record failed compatibility validation'
(( rollback_stop_line < rollback_state_line && rollback_state_line < rollback_compat_line )) \
  || fail_test 'rollback service quiescence must precede pair validation'
(( rollback_compat_line < rollback_barrier_open_line && rollback_barrier_open_line < rollback_start_line )) \
  || fail_test 'old application may start only after exact pair compatibility and barrier release'
[[ -n "$rollback_preflight_line" && -n "$rollback_tag_assignment_line" && -n "$rollback_revision_assignment_line" ]] \
  || fail_test 'rollback must bind deterministic preflight and later rollback image assignments'
(( rollback_preflight_line < rollback_quiesce_command_line )) \
  || fail_test 'Compose config preflight must precede rollback transitions'
(( rollback_tag_assignment_line < rollback_revision_assignment_line && rollback_revision_assignment_line < rollback_barrier_open_line && rollback_barrier_open_line < rollback_start_line )) \
  || fail_test 'rollback tag/current revision must be set before application recreation'
[[ -n "$rollback_trap_line" && -n "$rollback_exit_function_line" && -n "$rollback_fail_closed_call_line" && -n "$rollback_fail_closed_function_line" && -n "$rollback_fail_closed_barrier_line" && -n "$rollback_fail_closed_stop_line" ]] \
  || fail_test 'rollback must retain an EXIT fail-closed trap, barrier closure, and application stop'
(( rollback_fail_closed_function_line < rollback_fail_closed_barrier_line && rollback_fail_closed_barrier_line < rollback_fail_closed_stop_line && rollback_exit_function_line < rollback_fail_closed_call_line && rollback_fail_closed_call_line < rollback_trap_line )) \
  || fail_test 'rollback EXIT trap must invoke fail-closed handling that closes the barrier before stopping services'
if grep -Ei 'pg_restore|prisma[[:space:]]+migrate.*rollback|migrate[[:space:]]+resolve.*rolled-back' "$ROLLBACK_SCRIPT" >/dev/null; then
  fail_test 'application rollback must not restore the database or roll back migrations'
fi

if grep -F 'docker start buildingos-api' "$ROLLBACK_SCRIPT" >/dev/null; then
  fail_test 'rollback validation exit trap must not resume the old API blindly'
fi
if grep -F 'docker start buildingos-web' "$ROLLBACK_SCRIPT" >/dev/null; then
  fail_test 'rollback validation exit trap must not resume the old Web blindly'
fi
grep -F 'buildingos-api buildingos-web' "$ROLLBACK_SCRIPT" >/dev/null

grep -F 'db82d3d37fc6184a6d4063709b9a15b923371695' "$SECURITY_VALIDATOR" >/dev/null \
  || fail_test 'pinned old-runtime exception must be exact'
printf 'PASS: rollback pair validation fails closed with both services stopped\n'
