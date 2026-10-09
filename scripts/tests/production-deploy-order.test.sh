#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy-production.sh"
readonly ROLLBACK_SCRIPT="$ROOT_DIR/scripts/rollback-production.sh"
readonly WORKFLOW="$ROOT_DIR/.github/workflows/deploy-production.yml"

line_number() { awk -v pattern="$1" 'index($0, pattern) { print NR; exit }' "$2"; }
line_number_after() { awk -v start="$1" -v pattern="$2" 'NR > start && index($0, pattern) { print NR; exit }' "$3"; }
recovery_helper_paths=(
  scripts/lib/recovery-point-portable-stat.sh
  scripts/lib/recovery-point-capture.sh
  scripts/lib/recovery-point-postgres-snapshot.sh
  scripts/lib/recovery-point-file-manifest.sh
  scripts/lib/recovery-point-file-object-bundle.sh
  scripts/lib/recovery-point-object-source.sh
  scripts/lib/production-operation-lock.sh
  scripts/lib/production-rclone-recovery-check.sh
  scripts/lib/production-s3-write-fence.sh
  scripts/lib/recovery-point-s3-helper.cjs
)
bundle_start_line="$(line_number 'tar -czf -' "$WORKFLOW")"
remote_invocation_line="$(line_number '| ssh "${ssh_opts[@]}" "$SSH_USER@$SSH_HOST" "$remote_command"' "$WORKFLOW")"
storage_guard_line="$(line_number 'bash "$STORAGE_CUTOVER_GUARD"' "$DEPLOY_SCRIPT")"
target_tree_line="$(awk '$0 == "materialize_target_tree" { print NR; exit }' "$DEPLOY_SCRIPT")"
target_compose_line="$(line_number 'TARGET_COMPOSE_FILE' "$DEPLOY_SCRIPT")"
api_revision_line="$(line_number 'PREVIOUS_API_REVISION="$(docker image inspect' "$DEPLOY_SCRIPT")"
web_revision_line="$(line_number 'PREVIOUS_WEB_REVISION="$(docker image inspect' "$DEPLOY_SCRIPT")"
revision_match_line="$(line_number 'PREVIOUS_API_REVISION" == "$PREVIOUS_WEB_REVISION' "$DEPLOY_SCRIPT")"
previous_sha_line="$(line_number 'PREVIOUS_SHA="$PREVIOUS_API_REVISION"' "$DEPLOY_SCRIPT")"
recovery_preflight_line="$(line_number "PHASE='recovery-point-preflight'" "$DEPLOY_SCRIPT")"
recovery_capture_line="$(line_number "PHASE='recovery-point-capture'" "$DEPLOY_SCRIPT")"
recovery_gate_line="$(line_number "recovery_point_validate_capture || fail 'Recovery-point receipt did not prove every required component'" "$DEPLOY_SCRIPT")"
backup_phase_line="$(line_number "PHASE='backup'" "$DEPLOY_SCRIPT")"
checkout_phase_line="$(line_number "PHASE='checkout'" "$DEPLOY_SCRIPT")"
target_checkout_line="$(line_number 'git switch --detach --quiet "$TARGET_SHA"' "$DEPLOY_SCRIPT")"
build_phase_line="$(line_number "PHASE='build'" "$DEPLOY_SCRIPT")"
baseline_phase_line="$(line_number "PHASE='migration-baseline'" "$DEPLOY_SCRIPT")"
migrations_phase_line="$(line_number "PHASE='migrations'" "$DEPLOY_SCRIPT")"
baseline_line="$(line_number 'verify-production-migration-baseline.sh' "$DEPLOY_SCRIPT")"
early_state_line="$(line_number 'validate_database_migration_state "$TARGET_TREE/scripts/verify-production-migration-manifest.sh"' "$DEPLOY_SCRIPT")"
later_state_line="$(line_number 'validate_database_migration_state ./scripts/verify-production-migration-manifest.sh' "$DEPLOY_SCRIPT")"
migrate_line="$(line_number '--profile migrate run --rm --no-deps -T buildingos-migrate' "$DEPLOY_SCRIPT")"
post_line="$(line_number 'verify-production-migration-manifest.sh verify-db post' "$DEPLOY_SCRIPT")"
compatibility_binding='PRODUCTION_DB107_MIGRATION_VERIFIER="$APP_DIR/scripts/verify-production-migration-manifest.sh"'
compatibility_binding_line="$(line_number "$compatibility_binding" "$DEPLOY_SCRIPT")"
compatibility_line="$(line_number 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$DEPLOY_SCRIPT")"
receipt_line="$(line_number 'generate_rollback_compatibility_receipt' "$DEPLOY_SCRIPT")"
recreate_line="$(line_number 'up --detach --no-deps --force-recreate buildingos-api buildingos-web' "$DEPLOY_SCRIPT")"
checkpoint_line="$(line_number 'write_record IN_PROGRESS' "$DEPLOY_SCRIPT")"
rollback_compose_line="$(line_number 'compose=(docker compose --project-name buildingos' "$ROLLBACK_SCRIPT")"
rollback_quiesce_line="$(line_number_after "$rollback_compose_line" '"${compose[@]}" stop --timeout 30 buildingos-api buildingos-web' "$ROLLBACK_SCRIPT")"
rollback_migration_line="$(line_number 'current_migration_count=' "$ROLLBACK_SCRIPT")"
rollback_compatibility_line="$(line_number 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$ROLLBACK_SCRIPT")"
rollback_fail_closed_line="$(line_number 'rollback_fail_closed() {' "$ROLLBACK_SCRIPT")"
rollback_fail_closed_barrier_line="$(line_number_after "$rollback_fail_closed_line" 'ensure_rollback_barrier || printf' "$ROLLBACK_SCRIPT")"
rollback_fail_closed_stop_line="$(line_number_after "$rollback_fail_closed_line" 'docker stop --timeout 30 buildingos-api buildingos-web' "$ROLLBACK_SCRIPT")"
rollback_exit_line="$(line_number 'rollback_exit() {' "$ROLLBACK_SCRIPT")"
rollback_exit_guard_line="$(line_number_after "$rollback_exit_line" 'if [[ "$ROLLBACK_BARRIER_ACTIVE" == true && "$ROLLBACK_RECORD_SUCCESS" != true ]]; then' "$ROLLBACK_SCRIPT")"
rollback_exit_fail_closed_line="$(line_number_after "$rollback_exit_line" 'rollback_fail_closed || true' "$ROLLBACK_SCRIPT")"
rollback_exit_failed_record_line="$(line_number_after "$rollback_exit_line" 'write_rollback_record FAILED || true' "$ROLLBACK_SCRIPT")"
rollback_exit_trap_line="$(line_number 'trap rollback_exit EXIT' "$ROLLBACK_SCRIPT")"
rollback_recreate_started_line="$(line_number 'ROLLBACK_RECREATE_STARTED=true' "$ROLLBACK_SCRIPT")"
rollback_record_line="$(line_number 'write_rollback_record IN_PROGRESS' "$ROLLBACK_SCRIPT")"
rollback_smoke_line="$(line_number 'Rollback smoke failed' "$ROLLBACK_SCRIPT")"
rollback_active_identity_line="$(line_number 'active_api_digest="$(docker inspect' "$ROLLBACK_SCRIPT")"
rollback_recovery_binding_line="$(line_number 'bind_unique_prior_success_recovery_point "$DEPLOYMENTS_DIR" || true' "$ROLLBACK_SCRIPT")"
rollback_success_record_line="$(line_number 'write_rollback_record SUCCESS' "$ROLLBACK_SCRIPT")"
rollback_target_sha_line="$(line_number 'target_sha=%s' "$ROLLBACK_SCRIPT")"
rollback_selector_publish_line="$(line_number 'if ! publish_current_successful_selector "$DEPLOYMENTS_DIR"' "$ROLLBACK_SCRIPT")"
[[ -n "$backup_phase_line" && -n "$checkout_phase_line" && -n "$build_phase_line" ]]
[[ -n "$baseline_phase_line" && -n "$migrations_phase_line" && -n "$baseline_line" ]]
[[ -n "$early_state_line" && -n "$later_state_line" && -n "$migrate_line" && -n "$post_line" ]]
[[ -n "$compatibility_binding_line" && -n "$compatibility_line" && -n "$receipt_line" && -n "$recreate_line" ]]
[[ -n "$checkpoint_line" && -n "$recovery_preflight_line" && -n "$recovery_capture_line" && -n "$recovery_gate_line" ]]
[[ -n "$rollback_compose_line" && -n "$rollback_quiesce_line" && -n "$rollback_migration_line" && -n "$rollback_compatibility_line" ]] \
  || { printf 'FAIL: rollback main quiesce invocation is missing after compose initialization\n' >&2; exit 1; }
[[ -n "$rollback_fail_closed_line" && -n "$rollback_fail_closed_barrier_line" && -n "$rollback_fail_closed_stop_line" \
  && -n "$rollback_exit_line" && -n "$rollback_exit_guard_line" && -n "$rollback_exit_fail_closed_line" \
  && -n "$rollback_exit_failed_record_line" && -n "$rollback_exit_trap_line" ]] \
  || { printf 'FAIL: rollback EXIT trap fail-closed contract is missing\n' >&2; exit 1; }
(( rollback_fail_closed_line < rollback_fail_closed_barrier_line && rollback_fail_closed_barrier_line < rollback_fail_closed_stop_line \
  && rollback_fail_closed_stop_line < rollback_exit_line && rollback_exit_line < rollback_exit_guard_line \
  && rollback_exit_guard_line < rollback_exit_fail_closed_line && rollback_exit_fail_closed_line < rollback_exit_failed_record_line \
  && rollback_exit_failed_record_line < rollback_exit_trap_line && rollback_exit_trap_line < rollback_record_line )) \
  || { printf 'FAIL: rollback EXIT trap must fail closed before rollback state changes\n' >&2; exit 1; }
[[ -n "$rollback_recreate_started_line" && -n "$rollback_record_line" && -n "$rollback_smoke_line" && -n "$rollback_active_identity_line" && -n "$rollback_recovery_binding_line" && -n "$rollback_success_record_line" && -n "$rollback_target_sha_line" && -n "$rollback_selector_publish_line" ]]
[[ -n "$storage_guard_line" ]]
[[ -n "$bundle_start_line" && -n "$remote_invocation_line" ]]
(( bundle_start_line < remote_invocation_line )) \
  || { printf 'FAIL: workflow bundle must be assembled before remote invocation\n' >&2; exit 1; }
for recovery_helper_path in "${recovery_helper_paths[@]}"; do
  grep -F "test -f $recovery_helper_path && test ! -L $recovery_helper_path" "$WORKFLOW" >/dev/null
  recovery_bundle_line="$(line_number_after "$bundle_start_line" "$recovery_helper_path" "$WORKFLOW")"
  [[ -n "$recovery_bundle_line" ]]
  (( bundle_start_line < recovery_bundle_line && recovery_bundle_line < remote_invocation_line )) \
    || { printf 'FAIL: recovery helper %s is not bundled before remote invocation\n' "$recovery_helper_path" >&2; exit 1; }
done

rollback_success_line="$(line_number 'if [[ "${record##*/}" == rollback-*.txt && ( "$migration_count" == '\''98'\'' || "$migration_count" == '\''99'\'' || "$migration_count" == "$MIGRATION_TARGET_APPLIED" ) ]]; then' "$DEPLOY_SCRIPT")"
rollback_previous_sha_line="$(line_number_after "$rollback_success_line" 'previous_sha="$(read_deployment_record_value "$record" previous_sha || true)"' "$DEPLOY_SCRIPT")"
rollback_api_digest_line="$(line_number_after "$rollback_success_line" 'previous_api_digest="$(read_deployment_record_value "$record" api_digest || true)"' "$DEPLOY_SCRIPT")"
rollback_web_digest_line="$(line_number_after "$rollback_success_line" 'previous_web_digest="$(read_deployment_record_value "$record" web_digest || true)"' "$DEPLOY_SCRIPT")"
generic_success_line="$(line_number 'elif [[ "$migration_count" == "$MIGRATION_TARGET_APPLIED" || "$migration_count" == '\''99'\'' || "$migration_count" == '\''98'\'' || "$migration_count" == '\''97'\'' ]]; then' "$DEPLOY_SCRIPT")"
generic_reject_line="$(line_number_after "$generic_success_line" 'else' "$DEPLOY_SCRIPT")"
generic_reject_continue_line="$(line_number_after "$generic_reject_line" 'continue' "$DEPLOY_SCRIPT")"
[[ -n "$rollback_success_line" && -n "$rollback_previous_sha_line" && -n "$rollback_api_digest_line" && -n "$rollback_web_digest_line" ]]
[[ -n "$generic_success_line" && -n "$generic_reject_line" && -n "$generic_reject_continue_line" ]]
(( rollback_success_line < rollback_previous_sha_line && rollback_previous_sha_line < rollback_api_digest_line && rollback_api_digest_line < rollback_web_digest_line )) \
  || { printf 'FAIL: rollback predecessor identity fields are out of order\n' >&2; exit 1; }
(( rollback_web_digest_line < generic_success_line && generic_success_line < generic_reject_line && generic_reject_line < generic_reject_continue_line )) \
  || { printf 'FAIL: rollback-record scan ordering is invalid\n' >&2; exit 1; }
[[ -n "$target_tree_line" && -n "$target_compose_line" ]]
[[ -n "$api_revision_line" && -n "$web_revision_line" && -n "$revision_match_line" && -n "$previous_sha_line" ]]
[[ "$(grep -F -c 'bash "$STORAGE_CUTOVER_GUARD"' "$DEPLOY_SCRIPT")" -eq 1 ]]
[[ "$(grep -F 'bash "$STORAGE_CUTOVER_GUARD"' "$DEPLOY_SCRIPT")" == *'TARGET_COMPOSE_FILE'* ]]
[[ "$target_tree_line" -lt "$target_compose_line" ]]
(( api_revision_line < revision_match_line && web_revision_line < revision_match_line && revision_match_line < previous_sha_line )) \
  || { printf 'FAIL: API/Web revision agreement must precede previous SHA selection\n' >&2; exit 1; }
[[ "$(grep -F -c 'CURRENT_CHECKOUT_SHA" == "$PREVIOUS_API_REVISION' "$DEPLOY_SCRIPT")" -eq 0 ]]
[[ "$target_compose_line" -lt "$storage_guard_line" ]]
[[ "$target_compose_line" -lt "$early_state_line" && "$early_state_line" -lt "$storage_guard_line" ]]
[[ "$storage_guard_line" -lt "$backup_phase_line" ]]
[[ "$storage_guard_line" -lt "$build_phase_line" ]]
[[ "$storage_guard_line" -lt "$migrations_phase_line" ]]
[[ "$storage_guard_line" -lt "$recreate_line" ]]
(( backup_phase_line < checkout_phase_line )) || { printf 'FAIL: backup must precede checkout\n' >&2; exit 1; }
(( checkout_phase_line < build_phase_line )) || { printf 'FAIL: checkout must precede build\n' >&2; exit 1; }
(( build_phase_line < baseline_phase_line && baseline_phase_line < migrations_phase_line )) || { printf 'FAIL: build, migration baseline, and migrations are out of order\n' >&2; exit 1; }
(( baseline_line < later_state_line && later_state_line < migrate_line && migrate_line < post_line )) || { printf 'FAIL: migration verification commands are out of order\n' >&2; exit 1; }
(( checkout_phase_line < target_checkout_line && target_checkout_line < post_line && post_line < compatibility_binding_line && compatibility_binding_line < compatibility_line && compatibility_line < receipt_line && receipt_line < recreate_line )) || { printf 'FAIL: target checkout, post verification, explicit compatibility binding, receipt, and recreate gates are out of order\n' >&2; exit 1; }
(( previous_sha_line < recovery_preflight_line && recovery_preflight_line < recovery_capture_line && recovery_capture_line < recovery_gate_line && recovery_gate_line < checkpoint_line && checkpoint_line < backup_phase_line )) || { printf 'FAIL: recovery point must be validated before deployment state changes\n' >&2; exit 1; }
(( rollback_compose_line < rollback_quiesce_line && rollback_quiesce_line < rollback_migration_line && rollback_migration_line < rollback_compatibility_line )) || { printf 'FAIL: rollback must initialize compose, quiesce both services, then validate migrations/compatibility\n' >&2; exit 1; }
rollback_recreate_line="$(line_number 'up --detach --no-deps --force-recreate buildingos-api buildingos-web' "$ROLLBACK_SCRIPT")"
(( rollback_compatibility_line < rollback_record_line && rollback_record_line < rollback_recreate_line && rollback_recreate_line < rollback_recreate_started_line )) || { printf 'FAIL: rollback validation must precede record and runtime recreation\n' >&2; exit 1; }
(( rollback_smoke_line < rollback_active_identity_line && rollback_active_identity_line < rollback_recovery_binding_line && rollback_recovery_binding_line < rollback_success_record_line && rollback_success_record_line < rollback_selector_publish_line )) || { printf 'FAIL: rollback success evidence and selector publication are out of order\n' >&2; exit 1; }

env_invocation_count="$(grep -F -c 'env POSTGRES_CONTAINER="$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db' "$DEPLOY_SCRIPT")"
[[ "$env_invocation_count" -eq 4 ]]
if awk '/POSTGRES_CONTAINER="\$POSTGRES_CONTAINER" DATABASE_NAME=buildingos_db/ && $0 !~ /env POSTGRES_CONTAINER=/ { bad = 1 } END { exit bad }' "$DEPLOY_SCRIPT"; then
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
grep -F 'Current Web remained running during rollback compatibility validation' "$ROLLBACK_SCRIPT" >/dev/null
if grep -F 'docker start buildingos-api' "$ROLLBACK_SCRIPT" >/dev/null; then exit 1; fi
if grep -F 'docker start buildingos-web' "$ROLLBACK_SCRIPT" >/dev/null; then exit 1; fi
grep -F 'Interrupted rollback state does not match the running predecessor or source images' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'RETRY_PREVIOUS_SHA="$from_sha"' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'write_rollback_record SUCCESS' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'target_sha=%s' "$ROLLBACK_SCRIPT" >/dev/null

old_api_stop_line="$(line_number 'stop_release_a_apps || fail' "$DEPLOY_SCRIPT")"
barrier_closed_line="$(line_number 'ensure_release_a_barrier || fail' "$DEPLOY_SCRIPT")"
barrier_open_line="$(line_number 'remove_release_a_barrier || fail' "$DEPLOY_SCRIPT")"
manifest_pass_line="$(line_number 'verify-production-migration-manifest.sh verify-db post' "$DEPLOY_SCRIPT")"
compatibility_pass_line="$(line_number 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$DEPLOY_SCRIPT")"
candidate_start_line="$(line_number 'up --detach --no-deps --force-recreate buildingos-api buildingos-web' "$DEPLOY_SCRIPT")"
closed_probe_line="$(line_number_after "$candidate_start_line" 'probe_release_a_runtime_barrier CLOSED' "$DEPLOY_SCRIPT")"
open_probe_line="$(line_number_after "$barrier_open_line" 'probe_release_a_runtime_barrier OPEN' "$DEPLOY_SCRIPT")"
api_container_health_line="$(line_number_after "$candidate_start_line" 'wait_for_container_health buildingos-api' "$DEPLOY_SCRIPT")"
web_container_health_line="$(line_number_after "$candidate_start_line" 'wait_for_container_health buildingos-web' "$DEPLOY_SCRIPT")"
api_health_line="$(line_number_after "$candidate_start_line" 'check_http api-health' "$DEPLOY_SCRIPT")"
readyz_line="$(line_number_after "$api_health_line" 'check_http api-readyz' "$DEPLOY_SCRIPT")"
web_login_line="$(line_number_after "$readyz_line" 'check_http web-login' "$DEPLOY_SCRIPT")"
post_release_api_line="$(line_number_after "$barrier_open_line" 'check_http api-health' "$DEPLOY_SCRIPT")"
post_release_readyz_line="$(line_number_after "$post_release_api_line" 'check_http api-readyz' "$DEPLOY_SCRIPT")"
post_release_login_line="$(line_number_after "$post_release_readyz_line" 'check_http web-login' "$DEPLOY_SCRIPT")"
observability_line="$(line_number "PHASE='observability'" "$DEPLOY_SCRIPT")"
success_line="$(line_number 'write_record SUCCESS' "$DEPLOY_SCRIPT")"
selector_line="$(line_number 'if ! publish_current_successful_selector; then' "$DEPLOY_SCRIPT")"
[[ -n "$old_api_stop_line" && -n "$barrier_closed_line" && -n "$barrier_open_line" && -n "$manifest_pass_line" && -n "$compatibility_pass_line" ]] \
  || { printf 'FAIL: Release A stop/barrier/manifest/compatibility gates are missing\n' >&2; exit 1; }
[[ -n "$candidate_start_line" && -n "$api_container_health_line" && -n "$web_container_health_line" \
  && -n "$closed_probe_line" && -n "$open_probe_line" ]] \
  || { printf 'FAIL: candidate health gates or runtime barrier probes are missing\n' >&2; exit 1; }
[[ -n "$api_health_line" && -n "$readyz_line" && -n "$web_login_line" \
  && -n "$post_release_api_line" && -n "$post_release_readyz_line" && -n "$post_release_login_line" ]] \
  || { printf 'FAIL: candidate API, readyz, and Web login gates are missing before or after release\n' >&2; exit 1; }
[[ -n "$observability_line" && -n "$success_line" && -n "$selector_line" ]] \
  || { printf 'FAIL: observability SUCCESS and selector gates are missing\n' >&2; exit 1; }
(( backup_phase_line < old_api_stop_line && build_phase_line < old_api_stop_line )) || { printf 'FAIL: backup and build must precede stopping the old API\n' >&2; exit 1; }
(( old_api_stop_line < barrier_closed_line && barrier_closed_line < migrations_phase_line )) || { printf 'FAIL: old API stop and CLOSED barrier must precede migrations\n' >&2; exit 1; }
(( migrations_phase_line < manifest_pass_line && manifest_pass_line < compatibility_pass_line )) || { printf 'FAIL: migration and compatibility validation gates are out of order\n' >&2; exit 1; }
(( compatibility_pass_line < candidate_start_line && candidate_start_line < api_container_health_line )) || { printf 'FAIL: compatibility must pass before candidate recreation and health checks\n' >&2; exit 1; }
(( api_container_health_line < web_container_health_line && web_container_health_line < closed_probe_line \
  && closed_probe_line < api_health_line )) || { printf 'FAIL: CLOSED runtime proof must follow container health and precede HTTP checks\n' >&2; exit 1; }
(( api_health_line < readyz_line && readyz_line < web_login_line )) || { printf 'FAIL: candidate API, readyz, and web login checks are out of order\n' >&2; exit 1; }
(( web_login_line < barrier_open_line && barrier_open_line < open_probe_line \
  && open_probe_line < post_release_api_line )) || { printf 'FAIL: OPEN runtime proof must precede post-release checks\n' >&2; exit 1; }
(( post_release_api_line < post_release_readyz_line && post_release_readyz_line < post_release_login_line )) || { printf 'FAIL: post-release API, readyz, and login checks are out of order\n' >&2; exit 1; }
(( post_release_login_line < observability_line && open_probe_line < success_line && open_probe_line < selector_line )) \
  || { printf 'FAIL: OPEN runtime proof and post-release health checks must precede success and selector\n' >&2; exit 1; }
(( observability_line < success_line && success_line < selector_line )) || { printf 'FAIL: observability and success must precede selector publication\n' >&2; exit 1; }
grep -F 'recovery_point_resume_api' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'RELEASE_A_BARRIER_ACTIVE' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'docker exec --user 1001:1001 buildingos-api node -e' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'process.env.RELEASE_A_WRITE_BARRIER_ENABLED !== "true"' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'process.env.RELEASE_A_WRITE_BARRIER_PATH' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'fs.accessSync(parent, fs.constants.X_OK)' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'probe_rollback_runtime_barrier CLOSED' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'NOT_APPLICABLE (current API is non-barrier-aware)' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'Rollback runtime image IDs do not match the requested previous digests' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'Rollback API revision does not match the requested previous SHA' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'Rollback Web revision does not match the requested previous SHA' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'if ! publish_current_successful_selector "$DEPLOYMENTS_DIR"' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'bind_unique_prior_success_recovery_point "$DEPLOYMENTS_DIR" || true' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'find "$deployments_dir" -mindepth 1 -maxdepth 1 -type f -print0' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'from_api_digest' "$ROLLBACK_SCRIPT" >/dev/null
grep -F 'RETRY_RECOVERY_ACTIVE=true' "$DEPLOY_SCRIPT" >/dev/null
grep -F "storage_transition='unknown'" "$DEPLOY_SCRIPT" >/dev/null
grep -F 'Final migration count is not exactly the verified target' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'if [[ "${record##*/}" == rollback-*.txt && ( "$migration_count" == '\''98'\'' || "$migration_count" == '\''99'\'' || "$migration_count" == "$MIGRATION_TARGET_APPLIED" ) ]]; then' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'previous_sha="$(read_deployment_record_value "$record" previous_sha || true)"' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'previous_api_digest="$(read_deployment_record_value "$record" api_digest || true)"' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'previous_web_digest="$(read_deployment_record_value "$record" web_digest || true)"' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'migration_count" == "$MIGRATION_TARGET_APPLIED" || "$migration_count" == '\''99'\'' || "$migration_count" == '\''98'\'' || "$migration_count" == '\''97'\''' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'is_retryable_migration_count "$migration_count" || continue' "$DEPLOY_SCRIPT" >/dev/null
grep -F '(( 10#$actual >= 98 && 10#$actual <= 10#$MIGRATION_TARGET_APPLIED ))' "$DEPLOY_SCRIPT" >/dev/null
grep -F 'test -f scripts/manifests/production-migrations-81-to-107.tsv && test ! -L scripts/manifests/production-migrations-81-to-107.tsv' "$WORKFLOW" >/dev/null
grep -F 'scripts/manifests/production-migrations-81-to-107.tsv' "$WORKFLOW" >/dev/null
if grep -F 'scripts/manifests/production-migrations-81-to-106.tsv' "$WORKFLOW" >/dev/null; then
  printf 'FAIL: workflow still requires the historical 106 manifest\n' >&2
  exit 1
fi
if grep -F 'scripts/manifests/production-migrations-81-to-98.tsv' "$WORKFLOW" >/dev/null; then
  exit 1
fi
if grep -F 'incompatible_rows=' "$ROLLBACK_SCRIPT" >/dev/null; then exit 1; fi
if [[ "${PRODUCTION_DEPLOY_ORDER_HARNESS:-0}" != 1 ]]; then
  harness_dir="$(mktemp -d "${TMPDIR:-/tmp}/production-deploy-order.XXXXXX")"
  trap 'rm -rf -- "$harness_dir"' EXIT
  mkdir -p "$harness_dir/scripts/tests" "$harness_dir/scripts"
  cp "$0" "$harness_dir/scripts/tests/production-deploy-order.test.sh"
  cp "$DEPLOY_SCRIPT" "$harness_dir/scripts/deploy-production.sh"
  cp "$ROLLBACK_SCRIPT" "$harness_dir/scripts/rollback-production.sh"
  cp "$WORKFLOW" "$harness_dir/.github-workflow-placeholder"
  mkdir -p "$harness_dir/.github/workflows"
  mv "$harness_dir/.github-workflow-placeholder" "$harness_dir/.github/workflows/deploy-production.yml"

  if PRODUCTION_DEPLOY_ORDER_HARNESS=1 bash "$harness_dir/scripts/tests/production-deploy-order.test.sh"; then
    printf 'PASS: valid production deploy-order fixture returned 0\n'
  else
    printf 'FAIL: valid production deploy-order fixture returned nonzero\n' >&2
    exit 1
  fi

  python3 - "$harness_dir/scripts/rollback-production.sh" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
lines = path.read_text().splitlines(keepends=True)
quiesce = '"${compose[@]}" stop --timeout 30 buildingos-api buildingos-web'
quiesce_index = next(index for index, line in enumerate(lines) if quiesce in line)
migration_index = next(index for index, line in enumerate(lines) if 'current_migration_count=' in line)
line = lines.pop(quiesce_index)
if migration_index > quiesce_index:
    migration_index -= 1
lines.insert(migration_index + 1, line)
path.write_text(''.join(lines))
PY
  if PRODUCTION_DEPLOY_ORDER_HARNESS=1 bash "$harness_dir/scripts/tests/production-deploy-order.test.sh"; then
    printf 'FAIL: invalid rollback quiesce order unexpectedly returned 0\n' >&2
    exit 1
  else
    printf 'PASS: invalid rollback quiesce order returned nonzero\n'
  fi

  make_deploy_fixture() {
    local name="$1"
    local fixture="$harness_dir/$name"
    mkdir -p "$fixture/scripts/tests" "$fixture/scripts" "$fixture/.github/workflows"
    cp "$0" "$fixture/scripts/tests/production-deploy-order.test.sh"
    cp "$DEPLOY_SCRIPT" "$fixture/scripts/deploy-production.sh"
    cp "$ROLLBACK_SCRIPT" "$fixture/scripts/rollback-production.sh"
    cp "$WORKFLOW" "$fixture/.github/workflows/deploy-production.yml"
    printf '%s' "$fixture"
  }
  expect_rejected_deploy_fixture() {
    local fixture="$1" label="$2"
    if PRODUCTION_DEPLOY_ORDER_HARNESS=1 bash "$fixture/scripts/tests/production-deploy-order.test.sh"; then
      printf 'FAIL: %s negative fixture unexpectedly returned 0\n' "$label" >&2
      exit 1
    fi
    printf 'PASS: %s negative fixture returned nonzero\n' "$label"
  }

  no_open_fixture="$(make_deploy_fixture no-open-probe)"
  python3 - "$no_open_fixture/scripts/deploy-production.sh" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(path.read_text().replace('probe_release_a_runtime_barrier OPEN', 'probe_release_a_runtime_barrier REMOVED'))
PY
  expect_rejected_deploy_fixture "$no_open_fixture" 'missing OPEN probe'

  late_open_fixture="$(make_deploy_fixture late-open-probe)"
  python3 - "$late_open_fixture/scripts/deploy-production.sh" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
lines = path.read_text().splitlines(keepends=True)
start = next(index for index, line in enumerate(lines) if 'if ! probe_release_a_runtime_barrier OPEN' in line)
end = next(index for index in range(start, len(lines)) if lines[index] == 'fi\n') + 1
block = lines[start:end]
del lines[start:end]
success = next(index for index, line in enumerate(lines) if 'write_record SUCCESS' in line)
lines[success + 1:success + 1] = block
path.write_text(''.join(lines))
PY
  expect_rejected_deploy_fixture "$late_open_fixture" 'OPEN probe after SUCCESS'
fi

printf 'PASS: rollback EXIT trap fail-closed contract and Release A deploy-order assertions executed\n'
