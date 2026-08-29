#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy-production.sh"
readonly ROLLBACK_SCRIPT="$ROOT_DIR/scripts/rollback-production.sh"

line_number() { awk -v pattern="$1" 'index($0, pattern) { print NR; exit }' "$2"; }
storage_guard_line="$(line_number 'bash "$STORAGE_CUTOVER_GUARD"' "$DEPLOY_SCRIPT")"
target_tree_line="$(awk '$0 == "materialize_target_tree" { print NR; exit }' "$DEPLOY_SCRIPT")"
target_compose_line="$(line_number 'TARGET_COMPOSE_FILE' "$DEPLOY_SCRIPT")"
backup_phase_line="$(line_number "PHASE='backup'" "$DEPLOY_SCRIPT")"
checkout_phase_line="$(line_number "PHASE='checkout'" "$DEPLOY_SCRIPT")"
build_phase_line="$(line_number "PHASE='build'" "$DEPLOY_SCRIPT")"
baseline_phase_line="$(line_number "PHASE='migration-baseline'" "$DEPLOY_SCRIPT")"
migrations_phase_line="$(line_number "PHASE='migrations'" "$DEPLOY_SCRIPT")"
baseline_line="$(line_number 'verify-production-migration-baseline.sh' "$DEPLOY_SCRIPT")"
pre_line="$(line_number 'verify-production-migration-manifest.sh verify-db pre' "$DEPLOY_SCRIPT")"
migrate_line="$(line_number '--profile migrate run --rm --no-deps -T buildingos-migrate' "$DEPLOY_SCRIPT")"
post_line="$(line_number 'verify-production-migration-manifest.sh verify-db post' "$DEPLOY_SCRIPT")"
compatibility_line="$(line_number 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$DEPLOY_SCRIPT")"
receipt_line="$(line_number 'generate_rollback_compatibility_receipt' "$DEPLOY_SCRIPT")"
recreate_line="$(line_number 'up --detach --no-deps --force-recreate buildingos-api buildingos-web' "$DEPLOY_SCRIPT")"
[[ -n "$backup_phase_line" && -n "$checkout_phase_line" && -n "$build_phase_line" ]]
[[ -n "$baseline_phase_line" && -n "$migrations_phase_line" && -n "$baseline_line" ]]
[[ -n "$pre_line" && -n "$migrate_line" && -n "$post_line" ]]
[[ -n "$compatibility_line" && -n "$receipt_line" && -n "$recreate_line" ]]
[[ -n "$storage_guard_line" ]]
[[ -n "$target_tree_line" && -n "$target_compose_line" ]]
[[ "$(grep -F -c 'bash "$STORAGE_CUTOVER_GUARD"' "$DEPLOY_SCRIPT")" -eq 1 ]]
[[ "$(grep -F 'bash "$STORAGE_CUTOVER_GUARD"' "$DEPLOY_SCRIPT")" == *'TARGET_COMPOSE_FILE'* ]]
[[ "$target_tree_line" -lt "$target_compose_line" ]]
[[ "$target_compose_line" -lt "$storage_guard_line" ]]
[[ "$storage_guard_line" -lt "$backup_phase_line" ]]
[[ "$storage_guard_line" -lt "$build_phase_line" ]]
[[ "$storage_guard_line" -lt "$migrations_phase_line" ]]
[[ "$storage_guard_line" -lt "$recreate_line" ]]
(( backup_phase_line < checkout_phase_line ))
(( checkout_phase_line < build_phase_line ))
(( build_phase_line < baseline_phase_line && baseline_phase_line < migrations_phase_line ))
(( baseline_line < pre_line && pre_line < migrate_line && migrate_line < post_line ))
(( post_line < compatibility_line && compatibility_line < receipt_line && receipt_line < recreate_line ))

env_invocation_count="$(grep -F -c 'env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db' "$DEPLOY_SCRIPT")"
[[ "$env_invocation_count" -eq 3 ]]
if awk '/POSTGRES_CONTAINER="\$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db/ && $0 !~ /^[[:space:]]*env / { bad = 1 } END { exit bad }' "$DEPLOY_SCRIPT"; then
  :
else
  printf 'FAIL: readonly environment was reassigned in the parent shell\n' >&2
  exit 1
fi

assert_child_environment() {
  local -r POSTGRES_CONTAINER='pawtech-postgres'
  local -r DATABASE_NAME='buildingos_db'
  local phase
  local received

  for phase in baseline pre post; do
    received="$(env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME="$DATABASE_NAME" \
      bash -c 'printf "%s|%s" "$POSTGRES_CONTAINER" "$DATABASE_NAME"')"
    [[ "$received" == 'pawtech-postgres|buildingos_db' ]] || {
      printf 'FAIL: %s did not receive the expected environment\n' "$phase" >&2
      exit 1
    }
  done
}

assert_child_environment
grep -F 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$ROLLBACK_SCRIPT" >/dev/null
if grep -F 'incompatible_rows=' "$ROLLBACK_SCRIPT" >/dev/null; then exit 1; fi
printf 'PASS: readonly env propagation and backup -> checkout -> build -> baseline -> pre -> migrate -> post -> compatibility -> receipt -> application recreation\n'
