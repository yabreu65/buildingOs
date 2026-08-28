#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
require() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }
safe_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]]; }
validate_prefix() {
  local prefix="$1"
  [[ -z "$prefix" ]] && return 0
  [[ "$prefix" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] || fail "unsafe BACKUP_PREFIX"
  local segment
  local -a segments
  IFS='/' read -r -a segments <<< "$prefix"
  for segment in "${segments[@]}"; do
    [[ "$segment" != "." && "$segment" != ".." ]] || fail "unsafe BACKUP_PREFIX"
  done
}

for variable in BACKUP_ENDPOINT BACKUP_ACCESS_KEY BACKUP_SECRET_KEY BACKUP_BUCKET BACKUP_SET_ID EXPECTED_SOURCE_ENVIRONMENT; do require "$variable"; done
safe_id "$BACKUP_SET_ID" || fail "unsafe BACKUP_SET_ID"
validate_prefix "${BACKUP_PREFIX:-}"
[[ "$EXPECTED_SOURCE_ENVIRONMENT" =~ ^(production|staging|development|rehearsal)$ ]] || fail "unsafe expected source environment"
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe BACKUP_BUCKET"
command -v mc >/dev/null 2>&1 || fail "mc is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-minio-verify.XXXXXX")"
readonly TEMP_DIR
readonly MC_CONFIG_DIR="$TEMP_DIR/mc-config"
readonly PREFIX="${BACKUP_PREFIX:-buildingos/$EXPECTED_SOURCE_ENVIRONMENT}/$BACKUP_SET_ID"
export MC_CONFIG_DIR
trap 'rm -rf "$TEMP_DIR"' EXIT
umask 077
mkdir -p "$MC_CONFIG_DIR"

mc alias set backup "$BACKUP_ENDPOINT" "$BACKUP_ACCESS_KEY" "$BACKUP_SECRET_KEY" >/dev/null
mc stat "backup/$BACKUP_BUCKET" >/dev/null || fail "backup bucket is unavailable"
mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.json" "$TEMP_DIR/minio-manifest.json" >/dev/null || fail "manifest is unavailable"
mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.sha256" "$TEMP_DIR/minio-manifest.sha256" >/dev/null || fail "manifest checksum is unavailable"
mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/backup-receipt.json" "$TEMP_DIR/backup-receipt.json" >/dev/null || fail "backup receipt is unavailable"

grep -Eq '^[0-9a-fA-F]{64}[[:space:]]+[*]?minio-manifest\.json$' "$TEMP_DIR/minio-manifest.sha256" || fail "invalid manifest checksum file"
(cd "$TEMP_DIR" && sha256sum -c minio-manifest.sha256 >/dev/null) || fail "manifest checksum verification failed"
jq -e --arg environment "$EXPECTED_SOURCE_ENVIRONMENT" '.source_env == $environment and .deletion_propagation == false' "$TEMP_DIR/backup-receipt.json" >/dev/null || fail "backup receipt identity or deletion guard is invalid"
jq -er 'select((.backup_set_id | type) == "string") | .backup_set_id' "$TEMP_DIR/backup-receipt.json" > "$TEMP_DIR/receipt-backup-set-id" || fail "backup receipt backup_set_id is missing or invalid"
[[ "$(<"$TEMP_DIR/receipt-backup-set-id")" == "$BACKUP_SET_ID" ]] || fail "backup set identity mismatch"
jq -e 'type == "array" and all(.[]; (.key | type == "string") and (.size | type == "number"))' "$TEMP_DIR/minio-manifest.json" >/dev/null || fail "manifest schema is invalid"

mc ls --recursive --json "backup/$BACKUP_BUCKET/$PREFIX/objects" \
  | jq -c 'select((.type // "file") == "file") | {key:(.key // .name | sub("^.*?/objects/"; "")),size:(.size // 0),etag:(.etag // null),lastModified:(.lastModified // null)}' \
  | jq -s 'sort_by(.key)' > "$TEMP_DIR/actual-manifest.json"
if ! jq -S 'map({key,size})' "$TEMP_DIR/minio-manifest.json" | cmp -s - <(jq -S 'map({key,size})' "$TEMP_DIR/actual-manifest.json"); then
  fail "backup object keys or sizes do not match the approved manifest"
fi

object_count="$(jq 'length' "$TEMP_DIR/minio-manifest.json")"
total_bytes="$(jq '[.[].size] | add // 0' "$TEMP_DIR/minio-manifest.json")"
manifest_sha256="$(cut -d ' ' -f1 "$TEMP_DIR/minio-manifest.sha256")"
printf 'MINIO_BACKUP_VERIFY_COMPLETE\nSTATUS=PASS\nBACKUP_SET_ID=%s\nSOURCE_ENV=%s\nBUCKET=%s\nOBJECT_COUNT=%s\nTOTAL_BYTES=%s\nMANIFEST_SHA256=%s\n' \
  "$BACKUP_SET_ID" "$EXPECTED_SOURCE_ENVIRONMENT" "$BACKUP_BUCKET" "$object_count" "$total_bytes" "$manifest_sha256"
