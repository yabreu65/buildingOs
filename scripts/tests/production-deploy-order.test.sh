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
api_revision_line="$(line_number 'PREVIOUS_API_REVISION="$(docker image inspect' "$DEPLOY_SCRIPT")"
web_revision_line="$(line_number 'PREVIOUS_WEB_REVISION="$(docker image inspect' "$DEPLOY_SCRIPT")"
revision_match_line="$(line_number 'PREVIOUS_API_REVISION" == "$PREVIOUS_WEB_REVISION' "$DEPLOY_SCRIPT")"
previous_sha_line="$(line_number 'PREVIOUS_SHA="$PREVIOUS_API_REVISION"' "$DEPLOY_SCRIPT")"
backup_phase_line="$(line_number "PHASE='backup'" "$DEPLOY_SCRIPT")"
checkout_phase_line="$(line_number "PHASE='checkout'" "$DEPLOY_SCRIPT")"
build_phase_line="$(line_number "PHASE='build'" "$DEPLOY_SCRIPT")"
baseline_phase_line="$(line_number "PHASE='migration-baseline'" "$DEPLOY_SCRIPT")"
migrations_phase_line="$(line_number "PHASE='migrations'" "$DEPLOY_SCRIPT")"
baseline_line="$(line_number 'verify-production-migration-baseline.sh' "$DEPLOY_SCRIPT")"
early_state_line="$(line_number 'validate_database_migration_state "$TARGET_TREE/scripts/verify-production-migration-manifest.sh"' "$DEPLOY_SCRIPT")"
later_state_line="$(line_number 'validate_database_migration_state ./scripts/verify-production-migration-manifest.sh' "$DEPLOY_SCRIPT")"
migrate_line="$(line_number '--profile migrate run --rm --no-deps -T buildingos-migrate' "$DEPLOY_SCRIPT")"
post_line="$(line_number 'verify-production-migration-manifest.sh verify-db post' "$DEPLOY_SCRIPT")"
compatibility_line="$(line_number 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$DEPLOY_SCRIPT")"
receipt_line="$(line_number 'generate_rollback_compatibility_receipt' "$DEPLOY_SCRIPT")"
recreate_line="$(line_number 'up --detach --no-deps --force-recreate buildingos-api buildingos-web' "$DEPLOY_SCRIPT")"
checkpoint_line="$(line_number 'write_record IN_PROGRESS' "$DEPLOY_SCRIPT")"
rollback_compose_line="$(line_number 'compose=(docker compose --project-name buildingos' "$ROLLBACK_SCRIPT")"
rollback_quiesce_line="$(line_number 'stop --timeout 30 buildingos-api' "$ROLLBACK_SCRIPT")"
rollback_migration_line="$(line_number 'current_migration_count=' "$ROLLBACK_SCRIPT")"
rollback_compatibility_line="$(line_number 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$ROLLBACK_SCRIPT")"
[[ -n "$backup_phase_line" && -n "$checkout_phase_line" && -n "$build_phase_line" ]]
[[ -n "$baseline_phase_line" && -n "$migrations_phase_line" && -n "$baseline_line" ]]
[[ -n "$early_state_line" && -n "$later_state_line" && -n "$migrate_line" && -n "$post_line" ]]
[[ -n "$compatibility_line" && -n "$receipt_line" && -n "$recreate_line" ]]
[[ -n "$checkpoint_line" ]]
[[ -n "$rollback_compose_line" && -n "$rollback_quiesce_line" && -n "$rollback_migration_line" && -n "$rollback_compatibility_line" ]]
[[ -n "$storage_guard_line" ]]
[[ -n "$target_tree_line" && -n "$target_compose_line" ]]
[[ -n "$api_revision_line" && -n "$web_revision_line" && -n "$revision_match_line" && -n "$previous_sha_line" ]]
[[ "$(grep -F -c 'bash "$STORAGE_CUTOVER_GUARD"' "$DEPLOY_SCRIPT")" -eq 1 ]]
[[ "$(grep -F 'bash "$STORAGE_CUTOVER_GUARD"' "$DEPLOY_SCRIPT")" == *'TARGET_COMPOSE_FILE'* ]]
[[ "$target_tree_line" -lt "$target_compose_line" ]]
(( api_revision_line < revision_match_line && web_revision_line < revision_match_line && revision_match_line < previous_sha_line ))
[[ "$(grep -F -c 'CURRENT_CHECKOUT_SHA" == "$PREVIOUS_API_REVISION' "$DEPLOY_SCRIPT")" -eq 0 ]]
[[ "$target_compose_line" -lt "$storage_guard_line" ]]
[[ "$target_compose_line" -lt "$early_state_line" && "$early_state_line" -lt "$storage_guard_line" ]]
[[ "$storage_guard_line" -lt "$backup_phase_line" ]]
[[ "$storage_guard_line" -lt "$build_phase_line" ]]
[[ "$storage_guard_line" -lt "$migrations_phase_line" ]]
[[ "$storage_guard_line" -lt "$recreate_line" ]]
(( backup_phase_line < checkout_phase_line ))
(( checkout_phase_line < build_phase_line ))
(( build_phase_line < baseline_phase_line && baseline_phase_line < migrations_phase_line ))
(( baseline_line < later_state_line && later_state_line < migrate_line && migrate_line < post_line ))
(( post_line < compatibility_line && compatibility_line < receipt_line && receipt_line < recreate_line ))
(( previous_sha_line < checkpoint_line && checkpoint_line < backup_phase_line ))
(( rollback_compose_line < rollback_quiesce_line && rollback_quiesce_line < rollback_migration_line && rollback_migration_line < rollback_compatibility_line ))
(( rollback_compatibility_line < $(line_number 'up --detach --no-deps --force-recreate buildingos-api buildingos-web' "$ROLLBACK_SCRIPT") ))

env_invocation_count="$(grep -F -c 'env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db' "$DEPLOY_SCRIPT")"
[[ "$env_invocation_count" -eq 4 ]]
if awk '/POSTGRES_CONTAINER="\$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db/ && $0 !~ /^[[:space:]]*(if )?env / { bad = 1 } END { exit bad }' "$DEPLOY_SCRIPT"; then
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
grep -F 'Current API remained running during rollback compatibility validation' "$ROLLBACK_SCRIPT" >/dev/null
if grep -F 'incompatible_rows=' "$ROLLBACK_SCRIPT" >/dev/null; then exit 1; fi
printf 'PASS: readonly env propagation and backup -> checkout -> build -> baseline -> pre -> migrate -> post -> compatibility -> receipt -> application recreation\n'
