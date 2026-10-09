#!/usr/bin/env bash
set -Eeuo pipefail
set +x

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
source "$SCRIPT_DIR/lib/production-operation-lock.sh"
source "$SCRIPT_DIR/lib/production-fence-operation-state.sh"

readonly WEEKLY_ROOT_NAME='weekly-recovery-points'
readonly RECEIPT_NAME='metadata/recovery-point-receipt.json'
readonly RECEIPT_HASH_NAME='metadata/recovery-point-receipt.sha256'

usage() {
  printf 'Usage: %s --mode capture|retention-dry-run|mock-capture [options]\n' "${0##*/}" >&2
  printf '  capture: requires BUILDINGOS_WEEKLY_RECOVERY_POINT_ENABLE=YES\n' >&2
  printf '  retention-dry-run: --remote-root REMOTE [--inventory FILE]\n' >&2
  printf '  mock-capture: --scenario success|capture-fail|fence-fail|interrupt\n' >&2
  exit 64
}

fail() {
  printf 'WEEKLY_RECOVERY_POINT=REJECTED\nREASON=%s\n' "$1" >&2
  exit 1
}

require_command() { command -v "$1" >/dev/null 2>&1 || fail "missing_tool_$1"; }

weekly_persist_fence_state() {
  local snapshot="$1"
  [[ "$snapshot" == "$RECOVERY_POINT_STATE_DIR/policy-snapshot" ]] || return 1
  production_fence_state_write "$RECOVERY_POINT_STATE_DIR/fence-operation-state.json" FENCE_PREPARED \
    "$RECOVERY_POINT_ID" "$PREVIOUS_SHA" "$PREVIOUS_API_DIGEST" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" \
    "$RECOVERY_POINT_STATE_DIR" "$RECOVERY_POINT_API_WAS_RUNNING" "$RECOVERY_POINT_API_QUIESCED"
}

weekly_resume_and_record() {
  recovery_point_resume_api || return 1
  production_fence_state_write "$RECOVERY_POINT_STATE_DIR/fence-operation-state.json" RECOVERED \
    "$RECOVERY_POINT_ID" "$PREVIOUS_SHA" "$PREVIOUS_API_DIGEST" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" \
    "$RECOVERY_POINT_STATE_DIR" "$RECOVERY_POINT_API_WAS_RUNNING" false "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

capture_real() {
  [[ "${BUILDINGOS_WEEKLY_RECOVERY_POINT_ENABLE:-NO}" == YES ]] || fail capture_not_enabled
  require_command docker
  require_command jq
  require_command rclone
  require_command flock

  local api_digest app_sha weekly_remote_root

  production_operation_lock_acquire || exit 1
  api_digest="$(docker inspect --format '{{.Image}}' buildingos-api)" || fail runtime_unavailable
  [[ "$api_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail runtime_digest_invalid
  app_sha="$(docker image inspect "$api_digest" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" || fail runtime_revision_unavailable
  [[ "$app_sha" =~ ^[0-9a-f]{40}$ ]] || fail runtime_revision_invalid

  local finished=false
  cleanup() {
    local rc=$?
    trap - EXIT INT TERM
    if [[ "$finished" != true ]] && declare -F recovery_point_restore_and_resume >/dev/null 2>&1; then
      recovery_point_restore_and_resume >/dev/null 2>&1 || true
      if [[ -n "${RECOVERY_POINT_STATE_DIR:-}" && -f "${RECOVERY_POINT_STATE_DIR:-}/fence-operation-state.json" && "${RECOVERY_POINT_POLICY_RESTORED:-false}" == true ]]; then
        production_fence_state_write "$RECOVERY_POINT_STATE_DIR/fence-operation-state.json" RECOVERED \
          "$RECOVERY_POINT_ID" "$PREVIOUS_SHA" "$PREVIOUS_API_DIGEST" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" \
          "$RECOVERY_POINT_STATE_DIR" "$RECOVERY_POINT_API_WAS_RUNNING" false "$(date -u +%Y-%m-%dT%H:%M:%SZ)" || true
      fi
    fi
    production_operation_lock_release
    exit "$rc"
  }
  trap cleanup EXIT INT TERM

  BUILDINGOS_DEPLOY_RECOVERY_POINT_LIBRARY_ONLY=true
  # shellcheck source=scripts/deploy-production.sh
  source "$SCRIPT_DIR/deploy-production.sh"
  PREVIOUS_API_DIGEST="$api_digest"
  PREVIOUS_SHA="$app_sha"
  RECOVERY_POINT_API_WAS_RUNNING=false
  RECOVERY_POINT_API_QUIESCED=false
  RECOVERY_POINT_POLICY_RESTORED=false
  RELEASE_A_BARRIER_ACTIVE=false
  recovery_point_preflight || fail recovery_point_preflight_failed
  weekly_remote_root="${RECOVERY_POINT_OBJECT_BACKUP_DESTINATION%/}/$WEEKLY_ROOT_NAME/$PREVIOUS_SHA/$RECOVERY_POINT_ID"
  recovery_point_rclone_safe_remote_root "$weekly_remote_root" || fail weekly_remote_root_invalid
  RECOVERY_POINT_REMOTE_ROOT="$weekly_remote_root"
  S3_FENCE_AFTER_SNAPSHOT_CALLBACK=weekly_persist_fence_state
  s3_fence_run_recovery_point "$PREVIOUS_API_DIGEST" "$ENV_FILE" "$RECOVERY_POINT_DOCKER_NETWORK" \
    "$RECOVERY_POINT_FENCE_EVIDENCE" recovery_point_quiesce_api recovery_point_capture_under_fence weekly_resume_and_record \
    || fail recovery_point_capture_failed
  unset S3_FENCE_AFTER_SNAPSHOT_CALLBACK
  recovery_point_validate_capture || fail recovery_point_validation_failed
  [[ "$RECOVERY_POINT_POLICY_RESTORED" == true ]] || fail policy_restoration_unverified
  finished=true
  production_operation_lock_release
  trap - EXIT INT TERM
  printf 'WEEKLY_RECOVERY_POINT=PASS\nRECOVERY_POINT_ID=%s\nSOURCE_SHA=%s\nREMOTE_ROOT=%s\n' \
    "$RECOVERY_POINT_ID" "$PREVIOUS_SHA" "$RECOVERY_POINT_REMOTE_ROOT"
}

retention_inventory() {
  local remote_root="$1" inventory_file="${2:-}" tmp listing line root_rel root record_file record_hash expected actual
  require_command jq
  require_command rclone
  [[ "$remote_root" == *"/$WEEKLY_ROOT_NAME" || "$remote_root" == *"/$WEEKLY_ROOT_NAME/"* ]] || fail weekly_root_required
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-weekly-retention.XXXXXX")"
  trap 'rm -rf -- "$tmp"' RETURN
  if [[ -n "$inventory_file" ]]; then
    [[ -f "$inventory_file" && ! -L "$inventory_file" ]] || fail inventory_unavailable
    listing="$tmp/listing"
    jq -r '.[].path' "$inventory_file" > "$listing" || fail inventory_invalid
  else
    listing="$tmp/listing"
    rclone lsf --files-only --recursive "$remote_root" > "$listing" || fail inventory_unavailable
  fi

  local root_records="$tmp/root-records" root_count=0
  awk -v receipt_name="/$RECEIPT_NAME" '
    $0 == "" { next }
    {
      root = $0
      is_receipt = 0
      if (root ~ receipt_name "$") {
        sub(receipt_name "$", "", root)
        is_receipt = 1
      } else if (root ~ /\/metadata\//) {
        sub(/\/metadata\/.*/, "", root)
      } else {
        exit 2
      }
      if (root == "") exit 2
      roots[root] = 1
      receipt_count[root] += is_receipt
    }
    END { for (root in roots) print root "\t" (receipt_count[root] + 0) }
  ' "$listing" > "$root_records" || fail inventory_path_invalid
  root_count="$(wc -l < "$root_records" | tr -d '[:space:]')"
  ((root_count > 0)) || { printf 'WEEKLY_RETENTION_DRY_RUN=PASS\nVALID_WEEKLY_POINTS=0\nDELETE_CANDIDATES=0\nDELETIONS_PERFORMED=0\n'; return 0; }

  local records="$tmp/records" root_index=0
  : > "$records"
  while IFS=$'\t' read -r root_rel receipt_total; do
    root_index=$((root_index + 1))
    [[ "$receipt_total" == 1 ]] || fail incomplete_weekly_point
    root="${remote_root%/}/$root_rel"
    record_file="$tmp/receipt-$root_index.json"
    record_hash="$tmp/hash-$root_index"
    rclone cat "$root/$RECEIPT_NAME" > "$record_file" || fail receipt_unavailable
    rclone cat "$root/$RECEIPT_HASH_NAME" > "$record_hash" || fail receipt_hash_unavailable
    actual="$(sha256sum "$record_file" | awk '{print $1}')"
    expected="$(awk 'NF{print $1; exit}' "$record_hash")"
    [[ "$actual" =~ ^[0-9a-f]{64}$ && "$actual" == "$expected" ]] || fail receipt_hash_mismatch
    jq -e --arg root "$root" '
      (keys | sort) == ["backupSetId","completedAtUtc","contentManifestSha256","databaseDump","format","inputManifestSha256","referenceCount","remoteRoot","sourceAppSha","startedAtUtc","status","statuses","uniqueObjectCount"]
      and .format == "buildingos-recovery-point/v1" and .status == "PASS" and .remoteRoot == $root
      and ($root | contains("weekly-recovery-points/")) and (.sourceAppSha | type == "string" and test("^[0-9a-f]{40}$"))
      and (.completedAtUtc | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
      and (.statuses | type == "object" and all(.[]; . == "PASS"))
    ' "$record_file" >/dev/null || fail receipt_invalid
    jq -r '[.completedAtUtc,.backupSetId,.remoteRoot] | @tsv' "$record_file" >> "$records"
  done < "$root_records"

  local count keep=4 candidates=0
  count="$(wc -l < "$records" | tr -d '[:space:]')"
  printf '%s\n' 'WEEKLY_RETENTION_DRY_RUN=PASS' "VALID_WEEKLY_POINTS=$count" 'KEEP_LAST=4'
  if ((count > keep)); then
    candidates=$((count - keep))
    printf 'DELETE_CANDIDATES=%s\n' "$candidates"
    sort -t $'\t' -k1,1 "$records" | head -n "$candidates" | while IFS=$'\t' read -r completed backup root; do
      printf 'WOULD_DELETE completed=%s backup_set=%s remote_root=%s\n' "$completed" "$backup" "$root"
    done
  else
    printf 'DELETE_CANDIDATES=0\n'
  fi
  printf 'DELETIONS_PERFORMED=0\n'
}

mock_capture() {
  local scenario="$1"
  production_operation_lock_acquire || exit 1
  cleanup() { local rc=$?; trap - EXIT INT TERM; production_operation_lock_release; exit "$rc"; }
  trap cleanup EXIT INT TERM
  case "$scenario" in
    success) printf 'WEEKLY_RECOVERY_POINT=MOCK_PASS\n' ;;
    capture-fail) fail mock_capture_failed ;;
    fence-fail) fail mock_fence_failed ;;
    interrupt) trap - INT TERM; kill -TERM "$$" ;;
    *) fail mock_scenario_invalid ;;
  esac
}

mode=''; remote_root=''; inventory_file=''; scenario=''
while (($#)); do
  case "$1" in
    --mode) (($# >= 2)) || usage; mode="$2"; shift 2 ;;
    --remote-root) (($# >= 2)) || usage; remote_root="$2"; shift 2 ;;
    --inventory) (($# >= 2)) || usage; inventory_file="$2"; shift 2 ;;
    --scenario) (($# >= 2)) || usage; scenario="$2"; shift 2 ;;
    *) usage ;;
  esac
done
case "$mode" in
  capture) capture_real ;;
  retention-dry-run) [[ -n "$remote_root" ]] || usage; retention_inventory "$remote_root" "$inventory_file" ;;
  mock-capture) [[ -n "$scenario" ]] || usage; mock_capture "$scenario" ;;
  *) usage ;;
esac
