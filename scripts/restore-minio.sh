#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
require() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }
safe_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]]; }
endpoint_identity() { local value="${1#*://}"; printf '%s\n' "${value%%/*}"; }

for variable in BACKUP_ENDPOINT BACKUP_ACCESS_KEY BACKUP_SECRET_KEY BACKUP_BUCKET BACKUP_SET_ID EXPECTED_SOURCE_ENVIRONMENT TARGET_ENDPOINT TARGET_ACCESS_KEY TARGET_SECRET_KEY TARGET_BUCKET TARGET_ENVIRONMENT RESTORE_CONFIRMATION; do require "$variable"; done
safe_id "$BACKUP_SET_ID" || fail "unsafe BACKUP_SET_ID"
[[ "$EXPECTED_SOURCE_ENVIRONMENT" =~ ^(production|staging|development|rehearsal)$ ]] || fail "unsafe source environment"
[[ "$TARGET_ENVIRONMENT" =~ ^(development|rehearsal|test)$ ]] || fail "restore target must be non-production"
[[ "$RESTORE_CONFIRMATION" == "RESTORE TO NON-PRODUCTION" ]] || fail "exact non-production restore confirmation is required"
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ && "$TARGET_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe bucket name"
[[ "$(endpoint_identity "$BACKUP_ENDPOINT")" != "$(endpoint_identity "$TARGET_ENDPOINT")" || "$BACKUP_BUCKET" != "$TARGET_BUCKET" ]] || fail "restore target must not be the backup bucket"
command -v mc >/dev/null 2>&1 || fail "mc is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-minio-restore.XXXXXX")"
readonly TEMP_DIR
readonly MC_CONFIG_DIR="$TEMP_DIR/mc-config"
readonly PREFIX="${BACKUP_PREFIX:-buildingos/$EXPECTED_SOURCE_ENVIRONMENT}/$BACKUP_SET_ID"
export MC_CONFIG_DIR
trap 'rm -rf "$TEMP_DIR"' EXIT
umask 077
mkdir -p "$MC_CONFIG_DIR"

mc alias set backup "$BACKUP_ENDPOINT" "$BACKUP_ACCESS_KEY" "$BACKUP_SECRET_KEY" >/dev/null
mc alias set target "$TARGET_ENDPOINT" "$TARGET_ACCESS_KEY" "$TARGET_SECRET_KEY" >/dev/null
mc stat "backup/$BACKUP_BUCKET" >/dev/null || fail "backup bucket is unavailable"
mc stat "target/$TARGET_BUCKET" >/dev/null || fail "target bucket is unavailable"
if mc ls --recursive --json "target/$TARGET_BUCKET" | jq -e 'select((.type // "file") == "file")' >/dev/null 2>&1; then
  fail "target bucket is not empty; restore will not overwrite or delete existing objects"
fi

mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.json" "$TEMP_DIR/minio-manifest.json" >/dev/null || fail "manifest is unavailable"
mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.sha256" "$TEMP_DIR/minio-manifest.sha256" >/dev/null || fail "manifest checksum is unavailable"
mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/backup-receipt.json" "$TEMP_DIR/backup-receipt.json" >/dev/null || fail "backup receipt is unavailable"
grep -Eq '^[0-9a-fA-F]{64}[[:space:]]+[*]?minio-manifest\.json$' "$TEMP_DIR/minio-manifest.sha256" || fail "invalid manifest checksum file"
(cd "$TEMP_DIR" && sha256sum -c minio-manifest.sha256 >/dev/null) || fail "manifest checksum verification failed"
jq -e --arg environment "$EXPECTED_SOURCE_ENVIRONMENT" '.source_env == $environment and .deletion_propagation == false' "$TEMP_DIR/backup-receipt.json" >/dev/null || fail "backup receipt identity or deletion guard is invalid"

# Restore is additive into a proven-empty bucket; no delete or mirror removal is used.
mc cp --recursive "backup/$BACKUP_BUCKET/$PREFIX/objects/" "target/$TARGET_BUCKET/" >/dev/null
mc ls --recursive --json "target/$TARGET_BUCKET" \
  | jq -c 'select((.type // "file") == "file") | {key:(.key // .name),size:(.size // 0),etag:(.etag // null),lastModified:(.lastModified // null)}' \
  | jq -s 'sort_by(.key)' > "$TEMP_DIR/actual-manifest.json"
if ! jq -S 'map({key,size})' "$TEMP_DIR/minio-manifest.json" | cmp -s - <(jq -S 'map({key,size})' "$TEMP_DIR/actual-manifest.json"); then
  fail "restored object keys or sizes do not match the approved manifest"
fi

restored_object_count="$(jq 'length' "$TEMP_DIR/minio-manifest.json")"
restored_total_bytes="$(jq '[.[].size] | add // 0' "$TEMP_DIR/minio-manifest.json")"
printf 'MINIO_RESTORE_COMPLETE\nSTATUS=PASS\nBACKUP_SET_ID=%s\nTARGET_ENV=%s\nTARGET_BUCKET=%s\nRESTORED_OBJECT_COUNT=%s\nRESTORED_TOTAL_BYTES=%s\n' \
  "$BACKUP_SET_ID" "$TARGET_ENVIRONMENT" "$TARGET_BUCKET" "$restored_object_count" "$restored_total_bytes"
