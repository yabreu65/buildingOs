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
hash_object() {
  local object_path="$1"
  local sha256
  if ! sha256="$(mc cat "$object_path" < /dev/null | sha256sum | cut -d ' ' -f1)"; then
    fail "unable to hash object: $object_path"
  fi
  [[ "$sha256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "invalid object SHA-256: $object_path"
  printf '%s\n' "$sha256"
}
create_manifest() {
  local listing_file="$1"
  local object_root="$2"
  local manifest_file="$3"
  local entries_file sorted_manifest_file
  entries_file="$TEMP_DIR/$(basename "$manifest_file").entries"
  sorted_manifest_file="$TEMP_DIR/$(basename "$manifest_file").sorted"
  local key size sha256 record

  if ! jq -s -e 'all(.[]; ((.type // "file") != "file") or (((.key // .name) | type) == "string" and ((.size // 0) | type) == "number" and ((.size // 0) >= 0) and (((.size // 0) | floor) == (.size // 0))))' "$listing_file" >/dev/null; then
    fail "invalid MinIO listing"
  fi
  jq -r 'select((.type // "file") == "file") | [((.key // .name) | sub("^.*?/objects/"; "")), (.size // 0)] | @tsv' "$listing_file" > "$entries_file" || fail "unable to normalize MinIO listing"

  : > "$manifest_file"
  while IFS=$'\t' read -r key size; do
    [[ -n "$key" ]] || fail "MinIO listing contains an empty object key"
    sha256="$(hash_object "$object_root/$key")"
    record="$(jq -cn --arg key "$key" --argjson size "$size" --arg sha256 "$sha256" '{key:$key,size:$size,sha256:$sha256}')"
    printf '%s\n' "$record" >> "$manifest_file"
  done < "$entries_file"
  jq -s 'sort_by(.key)' "$manifest_file" > "$sorted_manifest_file" || fail "unable to create MinIO manifest"
  mv "$sorted_manifest_file" "$manifest_file"
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
receipt_manifest_sha256="$(jq -er 'select((.minio_manifest_sha256 | type) == "string") | .minio_manifest_sha256' "$TEMP_DIR/backup-receipt.json")" || fail "backup receipt manifest SHA-256 is missing or invalid"
[[ "$receipt_manifest_sha256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "backup receipt manifest SHA-256 is invalid"
receipt_object_count="$(jq -er 'select((.object_count | type) == "number" and .object_count >= 0 and ((.object_count | floor) == .object_count)) | .object_count' "$TEMP_DIR/backup-receipt.json")" || fail "backup receipt object count is missing or invalid"
receipt_total_bytes="$(jq -er 'select((.total_bytes | type) == "number" and .total_bytes >= 0 and ((.total_bytes | floor) == .total_bytes)) | .total_bytes' "$TEMP_DIR/backup-receipt.json")" || fail "backup receipt byte total is missing or invalid"
if ! jq -e 'type == "array" and all(.[]; (.key | type == "string" and length > 0) and (.size | type == "number" and . >= 0 and floor == .) and (.sha256 | type == "string" and test("^[0-9a-fA-F]{64}$")))' "$TEMP_DIR/minio-manifest.json" >/dev/null; then
  fail "manifest schema is invalid"
fi

if ! grep -Eq '^[0-9a-fA-F]{64}[[:space:]]+[*]?minio-manifest\.json$' "$TEMP_DIR/minio-manifest.sha256"; then
  fail "invalid manifest checksum file"
fi
(cd "$TEMP_DIR" && sha256sum -c minio-manifest.sha256 >/dev/null) || fail "manifest checksum verification failed"
actual_manifest_sha256="$(sha256sum "$TEMP_DIR/minio-manifest.json" | cut -d ' ' -f1)"
actual_object_count="$(jq 'length' "$TEMP_DIR/minio-manifest.json")"
actual_total_bytes="$(jq '[.[].size] | add // 0' "$TEMP_DIR/minio-manifest.json")"
[[ "$actual_manifest_sha256" == "$receipt_manifest_sha256" ]] || fail "manifest SHA-256 does not match backup receipt"
[[ "$actual_object_count" == "$receipt_object_count" ]] || fail "manifest object count does not match backup receipt"
[[ "$actual_total_bytes" == "$receipt_total_bytes" ]] || fail "manifest byte total does not match backup receipt"

if ! mc ls --recursive --json "backup/$BACKUP_BUCKET/$PREFIX/objects" > "$TEMP_DIR/backup-listing.json"; then
  fail "backup object listing is unavailable"
fi
create_manifest "$TEMP_DIR/backup-listing.json" "backup/$BACKUP_BUCKET/$PREFIX/objects" "$TEMP_DIR/actual-manifest.json" true
if ! jq -S 'map({key,size,sha256})' "$TEMP_DIR/minio-manifest.json" | cmp -s - <(jq -S 'map({key,size,sha256})' "$TEMP_DIR/actual-manifest.json"); then
  fail "backup object keys, sizes, or SHA-256 values do not match the approved manifest"
fi

object_count="$actual_object_count"
total_bytes="$actual_total_bytes"
manifest_sha256="$(cut -d ' ' -f1 "$TEMP_DIR/minio-manifest.sha256")"
printf 'MINIO_BACKUP_VERIFY_COMPLETE\nSTATUS=PASS\nBACKUP_SET_ID=%s\nSOURCE_ENV=%s\nBUCKET=%s\nOBJECT_COUNT=%s\nTOTAL_BYTES=%s\nMANIFEST_SHA256=%s\n' \
  "$BACKUP_SET_ID" "$EXPECTED_SOURCE_ENVIRONMENT" "$BACKUP_BUCKET" "$object_count" "$total_bytes" "$manifest_sha256"
