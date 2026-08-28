#!/usr/bin/env bash
set -Eeuo pipefail
set +x

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
require() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }
safe_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]]; }
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly script_dir

for variable in BACKUP_ENDPOINT BACKUP_BUCKET BACKUP_VERIFY_ACCESS_KEY BACKUP_VERIFY_SECRET_KEY BACKUP_SSE_CAPABILITY_FILE BACKUP_STATE_DIR; do require "$variable"; done
"$script_dir/validate-sse-capability.sh" >/dev/null || fail "SSE-S3 capability gate failed; no BuildingOS backup was started"

if [[ "${1:-}" == "--verify-latest" ]]; then
  state_file="$BACKUP_STATE_DIR/latest.env"
  [[ ! -L "$state_file" && -f "$state_file" && -r "$state_file" ]] || fail "latest paired backup state is unavailable"
  backup_set_id="$(grep -E '^BACKUP_SET_ID=' "$state_file" | cut -d= -f2-)"
  app_sha="$(grep -E '^APP_SHA=' "$state_file" | cut -d= -f2-)"
  safe_id "$backup_set_id" || fail "latest backup set identity is invalid"
  [[ "$app_sha" =~ ^[0-9a-f]{40}$ ]] || fail "latest APP_SHA is invalid"
  BACKUP_ACCESS_KEY="$BACKUP_VERIFY_ACCESS_KEY" BACKUP_SECRET_KEY="$BACKUP_VERIFY_SECRET_KEY" BACKUP_SET_ID="$backup_set_id" EXPECTED_APP_SHA="$app_sha" \
    "$script_dir/verify-minio-backup.sh"
  exit 0
fi
[[ $# -eq 0 ]] || fail "unsupported argument"

for variable in BACKUP_WRITE_ACCESS_KEY BACKUP_WRITE_SECRET_KEY SOURCE_ENVIRONMENT EXPECTED_SOURCE_ENVIRONMENT SOURCE_ENDPOINT SOURCE_ACCESS_KEY SOURCE_SECRET_KEY SOURCE_BUCKET POSTGRES_CONTAINER POSTGRES_DATABASE POSTGRES_USER POSTGRES_BACKUP_ROOT POSTGRES_RCLONE_DESTINATION POSTGRES_VERIFY_RCLONE_DESTINATION POSTGRES_SSE_MODE; do require "$variable"; done
command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

app_sha="$("$script_dir/resolve-production-app-sha.sh")" || fail "unable to resolve deployed APP_SHA"
if [[ -n "${BACKUP_SET_ID:-}" ]]; then
  backup_set_id="$BACKUP_SET_ID"
else
  entropy="$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)-$$-${RANDOM:-0}"
  short_id="$(printf '%s' "$entropy" | sha256sum | cut -c1-16)"
  backup_set_id="$(date -u +%Y%m%dt%H%M%Sz)-$short_id"
fi
safe_id "$backup_set_id" || fail "unsafe BACKUP_SET_ID"

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-paired-backup.XXXXXX")"
readonly temp_dir
trap 'rm -rf "$temp_dir"' EXIT
umask 077
postgres_receipt="$temp_dir/postgres-backup-receipt.json"

if ! BACKUP_SET_ID="$backup_set_id" APP_SHA="$app_sha" POSTGRES_RECEIPT_FILE="$postgres_receipt" \
  "$script_dir/backup-postgres-paired.sh" > "$temp_dir/postgres-output" 2>&1; then
  fail "PostgreSQL backup failed; MinIO backup was not started"
fi
jq -e --arg setId "$backup_set_id" --arg appSha "$app_sha" '.status == "PASS" and .backup_set_id == $setId and .app_sha == $appSha' "$postgres_receipt" >/dev/null || fail "PostgreSQL PASS receipt is invalid"

if ! BACKUP_ACCESS_KEY="$BACKUP_WRITE_ACCESS_KEY" BACKUP_SECRET_KEY="$BACKUP_WRITE_SECRET_KEY" BACKUP_SET_ID="$backup_set_id" APP_SHA="$app_sha" POSTGRES_BACKUP_RECEIPT_FILE="$postgres_receipt" \
  "$script_dir/backup-minio.sh" > "$temp_dir/minio-output" 2>&1; then
  fail "MinIO backup failed"
fi

if ! BACKUP_ACCESS_KEY="$BACKUP_VERIFY_ACCESS_KEY" BACKUP_SECRET_KEY="$BACKUP_VERIFY_SECRET_KEY" BACKUP_SET_ID="$backup_set_id" EXPECTED_APP_SHA="$app_sha" \
  "$script_dir/verify-minio-backup.sh" > "$temp_dir/verify-output" 2>&1; then
  fail "independent MinIO verification failed"
fi
grep -Fxq 'MINIO_BACKUP_VERIFY_COMPLETE' "$temp_dir/verify-output" || fail "independent verification completion evidence is missing"
grep -Fxq 'STATUS=PASS' "$temp_dir/verify-output" || fail "independent verification did not pass"

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$BACKUP_STATE_DIR"
chmod 0700 "$BACKUP_STATE_DIR"
paired_receipt="$BACKUP_STATE_DIR/paired-$backup_set_id.json"
jq -n --arg setId "$backup_set_id" --arg appSha "$app_sha" --arg completedAt "$completed_at" \
  --slurpfile postgres "$postgres_receipt" \
  '{version:1,status:"PASS",backup_set_id:$setId,app_sha:$appSha,completed_at:$completedAt,postgres_receipt:$postgres[0],minio_verified:true}' > "$paired_receipt"
chmod 0600 "$paired_receipt"
printf 'BACKUP_SET_ID=%s\nAPP_SHA=%s\nCOMPLETED_AT=%s\n' "$backup_set_id" "$app_sha" "$completed_at" > "$BACKUP_STATE_DIR/latest.env"
chmod 0600 "$BACKUP_STATE_DIR/latest.env"

printf 'BUILDINGOS_PAIRED_BACKUP_COMPLETE\nSTATUS=PASS\nBACKUP_SET_ID=%s\nAPP_SHA=%s\n' "$backup_set_id" "$app_sha"
