#!/usr/bin/env bash
set -Eeuo pipefail
set +x

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
source "$SCRIPT_DIR/lib/production-operation-lock.sh"
source "$SCRIPT_DIR/lib/production-fence-operation-state.sh"

state_root='/opt/pawtech/backups/recovery-points'
if [[ "${1:-}" == '--state-root' && $# -eq 2 ]]; then state_root="$2"; fi
[[ "$state_root" == /* && -d "$state_root" && ! -L "$state_root" ]] || { printf 'RECOVERY_FENCE_RECOVERY=REJECTED\nREASON=state_root_invalid\n' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf 'RECOVERY_FENCE_RECOVERY=REJECTED\nREASON=missing_tool_jq\n' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { printf 'RECOVERY_FENCE_RECOVERY=REJECTED\nREASON=missing_tool_docker\n' >&2; exit 1; }

production_operation_lock_acquire || { printf 'RECOVERY_FENCE_RECOVERY=NEEDS_MANUAL_RECOVERY\nREASON=operation_lock_unavailable\n' >&2; exit 1; }
cleanup() { local rc=$?; trap - EXIT INT TERM; production_operation_lock_release; exit "$rc"; }
trap cleanup EXIT INT TERM

BUILDINGOS_DEPLOY_RECOVERY_POINT_LIBRARY_ONLY=true
# shellcheck source=scripts/deploy-production.sh
source "$SCRIPT_DIR/deploy-production.sh"

recover_one() {
  local state_file="$1" state_dir image api_running api_was_running api_quiesced operation_id source_sha
  production_fence_state_validate "$state_file" || { printf 'NEEDS_MANUAL_RECOVERY state=%s reason=state_invalid\n' "$state_file" >&2; return 1; }
  [[ "$(jq -r .status "$state_file")" == FENCE_PREPARED ]] || return 0
  state_dir="$(jq -r .stateDir "$state_file")"
  [[ "$state_dir" == "${state_file%/*}" && -d "$state_dir/policy-snapshot" && ! -L "$state_dir/policy-snapshot" ]] || { printf 'NEEDS_MANUAL_RECOVERY state=%s reason=snapshot_invalid\n' "$state_file" >&2; return 1; }
  image="$(jq -r .image "$state_file")"
  operation_id="$(jq -r .operationId "$state_file")"
  source_sha="$(jq -r .sourceSha "$state_file")"
  api_was_running="$(jq -r .apiWasRunning "$state_file")"
  api_quiesced="$(jq -r .apiQuiesced "$state_file")"
  api_running="$(docker inspect --format '{{.State.Running}}' buildingos-api 2>/dev/null || true)"
  [[ "$api_running" == true || "$api_running" == false ]] || { printf 'NEEDS_MANUAL_RECOVERY state=%s reason=runtime_unavailable\n' "$state_file" >&2; return 1; }
  [[ "$(docker inspect --format '{{.Image}}' buildingos-api 2>/dev/null || true)" == "$image" ]] || { printf 'NEEDS_MANUAL_RECOVERY state=%s reason=runtime_identity_mismatch\n' "$state_file" >&2; return 1; }
  [[ "$api_running" == false ]] || { printf 'NEEDS_MANUAL_RECOVERY state=%s reason=api_running_during_recovery\n' "$state_file" >&2; return 1; }
  PREVIOUS_API_DIGEST="$image"
  ENV_FILE='/opt/pawtech/env/buildingos.env'
  RECOVERY_POINT_DOCKER_NETWORK='pawtech_public'
  RECOVERY_POINT_FENCE_EVIDENCE="$state_dir/fence"
  RECOVERY_POINT_POLICY_RESTORED=false
  RECOVERY_POINT_API_WAS_RUNNING="$api_was_running"
  RECOVERY_POINT_API_QUIESCED="$api_quiesced"
  RELEASE_A_BARRIER_ACTIVE=false
  if ! recovery_point_restore_and_resume; then
    production_fence_state_write "$state_file" NEEDS_MANUAL_RECOVERY "$operation_id" "$source_sha" "$image" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" "$state_dir" "$api_was_running" "$api_quiesced" || true
    return 1
  fi
  production_fence_state_write "$state_file" RECOVERED "$operation_id" "$source_sha" "$image" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" "$state_dir" "$api_was_running" false "$(date -u +%Y-%m-%dT%H:%M:%SZ)" || return 1
  printf 'RECOVERED state=%s\n' "$state_file"
}

pending=0
failed=0
while IFS= read -r state_file; do
  [[ -n "$state_file" ]] || continue
  [[ "$(jq -r .status "$state_file" 2>/dev/null || true)" == FENCE_PREPARED ]] || continue
  pending=$((pending + 1))
  recover_one "$state_file" || failed=$((failed + 1))
done < <(find "$state_root" -type f -name fence-operation-state.json -print)
if ((failed > 0)); then
  printf 'RECOVERY_FENCE_RECOVERY=NEEDS_MANUAL_RECOVERY\nPENDING=%s\nFAILED=%s\n' "$pending" "$failed"
  exit 1
fi
printf 'RECOVERY_FENCE_RECOVERY=PASS\nPENDING=%s\nFAILED=0\n' "$pending"
