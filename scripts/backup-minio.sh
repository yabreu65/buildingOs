#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# Create a deletion-propagation-protected MinIO backup set. Credentials are
# supplied through the environment and kept in a temporary mc config outside
# the repository.

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
require() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }
safe_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]]; }
source "$(dirname "${BASH_SOURCE[0]}")/lib/endpoint-identity.sh"
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
  local strip_objects_prefix="$4"
  local entries_file sorted_manifest_file
  entries_file="$TEMP_DIR/$(basename "$manifest_file").entries"
  sorted_manifest_file="$TEMP_DIR/$(basename "$manifest_file").sorted"
  local key size sha256 record

  if ! jq -s -e 'all(.[]; ((.type // "file") != "file") or (((.key // .name) | type) == "string" and ((.size // 0) | type) == "number" and ((.size // 0) >= 0) and (((.size // 0) | floor) == (.size // 0))))' "$listing_file" >/dev/null; then
    fail "invalid MinIO listing"
  fi
  if [[ "$strip_objects_prefix" == true ]]; then
    jq -r 'select((.type // "file") == "file") | [((.key // .name) | sub("^.*?/objects/"; "")), (.size // 0)] | @tsv' "$listing_file" > "$entries_file" || fail "unable to normalize MinIO listing"
  else
    jq -r 'select((.type // "file") == "file") | [(.key // .name), (.size // 0)] | @tsv' "$listing_file" > "$entries_file" || fail "unable to normalize MinIO listing"
  fi

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

for variable in SOURCE_ENVIRONMENT EXPECTED_SOURCE_ENVIRONMENT SOURCE_ENDPOINT SOURCE_ACCESS_KEY SOURCE_SECRET_KEY SOURCE_BUCKET BACKUP_ENDPOINT BACKUP_ACCESS_KEY BACKUP_SECRET_KEY BACKUP_BUCKET BACKUP_SET_ID APP_SHA POSTGRES_BACKUP_RECEIPT_FILE BACKUP_SSE_CAPABILITY_FILE; do
  require "$variable"
done

[[ "$SOURCE_ENVIRONMENT" == "$EXPECTED_SOURCE_ENVIRONMENT" ]] || fail "source environment identity mismatch"
[[ "$SOURCE_ENVIRONMENT" =~ ^(production|staging|development|rehearsal)$ ]] || fail "unsafe source environment"
safe_id "$BACKUP_SET_ID" || fail "unsafe BACKUP_SET_ID"
validate_prefix "${BACKUP_PREFIX:-}"
[[ "$APP_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "APP_SHA must be a 40-character commit SHA"
[[ "$SOURCE_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe SOURCE_BUCKET"
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe BACKUP_BUCKET"
[[ "$(endpoint_identity "$SOURCE_ENDPOINT")" != "$(endpoint_identity "$BACKUP_ENDPOINT")" || "$SOURCE_BUCKET" != "$BACKUP_BUCKET" ]] || fail "backup destination must not be the source bucket"
command -v mc >/dev/null 2>&1 || fail "mc is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
[[ "$POSTGRES_BACKUP_RECEIPT_FILE" == /* && ! -L "$POSTGRES_BACKUP_RECEIPT_FILE" && -f "$POSTGRES_BACKUP_RECEIPT_FILE" && -r "$POSTGRES_BACKUP_RECEIPT_FILE" ]] || fail "PostgreSQL backup receipt is unavailable"
"$(dirname "${BASH_SOURCE[0]}")/validate-sse-capability.sh" >/dev/null || fail "SSE-S3 capability gate failed"

jq -e --arg setId "$BACKUP_SET_ID" --arg appSha "$APP_SHA" '
  .version == 1 and .status == "PASS" and
  .backup_set_id == $setId and .app_sha == $appSha and
  (.postgres_backup_id | type == "string" and test("^[a-z0-9][a-z0-9._-]{0,95}$")) and
  (.postgres_sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
  (.dump_filename | type == "string" and test("^[A-Za-z0-9._-]+$")) and
  (.remote_object_prefix | type == "string" and test("^postgresql/[a-z0-9][a-z0-9._-]{0,95}$")) and
  .encryption == "SSE-S3" and
  (.completed_at | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
' "$POSTGRES_BACKUP_RECEIPT_FILE" >/dev/null || fail "PostgreSQL backup receipt is invalid or does not match this backup set"
POSTGRES_BACKUP_ID="$(jq -er '.postgres_backup_id' "$POSTGRES_BACKUP_RECEIPT_FILE")"
POSTGRES_BACKUP_SHA256="$(jq -er '.postgres_sha256' "$POSTGRES_BACKUP_RECEIPT_FILE")"
POSTGRES_BACKUP_COMPLETED_AT="$(jq -er '.completed_at' "$POSTGRES_BACKUP_RECEIPT_FILE")"
POSTGRES_DUMP_FILENAME="$(jq -er '.dump_filename' "$POSTGRES_BACKUP_RECEIPT_FILE")"
POSTGRES_REMOTE_OBJECT_PREFIX="$(jq -er '.remote_object_prefix' "$POSTGRES_BACKUP_RECEIPT_FILE")"
POSTGRES_RECEIPT_SHA256="$(sha256sum "$POSTGRES_BACKUP_RECEIPT_FILE" | cut -d ' ' -f1)"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-minio-backup.XXXXXX")"
readonly TEMP_DIR
readonly MC_CONFIG_DIR="$TEMP_DIR/mc-config"
readonly PREFIX="${BACKUP_PREFIX:-buildingos/$SOURCE_ENVIRONMENT}/$BACKUP_SET_ID"
export MC_CONFIG_DIR
trap 'rm -rf "$TEMP_DIR"' EXIT
umask 077
mkdir -p "$MC_CONFIG_DIR"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
readonly STARTED_AT

mc alias set source "$SOURCE_ENDPOINT" "$SOURCE_ACCESS_KEY" "$SOURCE_SECRET_KEY" >/dev/null
mc alias set backup "$BACKUP_ENDPOINT" "$BACKUP_ACCESS_KEY" "$BACKUP_SECRET_KEY" >/dev/null
mc stat "source/$SOURCE_BUCKET" >/dev/null || fail "source bucket is unavailable"
mc stat "backup/$BACKUP_BUCKET" >/dev/null || fail "backup bucket is unavailable"
if ! mc ls --recursive --json "backup/$BACKUP_BUCKET/$PREFIX" > "$TEMP_DIR/backup-set-listing.json"; then
  fail "backup set listing is unavailable"
fi
if ! backup_set_has_objects="$(jq -s 'any(.[]; ((.type // "file") == "file"))' "$TEMP_DIR/backup-set-listing.json")"; then
  fail "backup set listing is invalid"
fi
if [[ "$backup_set_has_objects" == true ]]; then
  fail "backup set already exists; use a new BACKUP_SET_ID"
fi

if ! mc ls --recursive --json "source/$SOURCE_BUCKET" > "$TEMP_DIR/source-listing.json"; then
  fail "source listing is unavailable"
fi
create_manifest "$TEMP_DIR/source-listing.json" "source/$SOURCE_BUCKET" "$TEMP_DIR/source-manifest.json" false

object_count="$(jq 'length' "$TEMP_DIR/source-manifest.json")"
total_bytes="$(jq '[.[].size] | add // 0' "$TEMP_DIR/source-manifest.json")"
[[ "$object_count" =~ ^[0-9]+$ && "$total_bytes" =~ ^[0-9]+$ ]] || fail "source manifest totals are invalid"

# Deliberately omit --remove: source deletions must never propagate to backups.
mc mirror --overwrite --json --enc-s3 "backup/$BACKUP_BUCKET" "source/$SOURCE_BUCKET" "backup/$BACKUP_BUCKET/$PREFIX/objects" >/dev/null
cp "$TEMP_DIR/source-manifest.json" "$TEMP_DIR/minio-manifest.json"
printf '%s  %s\n' "$(sha256sum "$TEMP_DIR/minio-manifest.json" | cut -d ' ' -f1)" "minio-manifest.json" > "$TEMP_DIR/minio-manifest.sha256"

jq -n \
  --arg backupSetId "$BACKUP_SET_ID" \
  --arg startedAt "$STARTED_AT" \
  --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg sourceEnv "$SOURCE_ENVIRONMENT" \
  --arg sourceHost "$(endpoint_identity "$SOURCE_ENDPOINT")" \
  --arg sourceBucket "$SOURCE_BUCKET" \
  --arg appSha "$APP_SHA" \
  --arg postgresBackupId "$POSTGRES_BACKUP_ID" \
  --arg postgresSha256 "$POSTGRES_BACKUP_SHA256" \
  --arg postgresCompletedAt "$POSTGRES_BACKUP_COMPLETED_AT" \
  --arg postgresReceiptSha256 "$POSTGRES_RECEIPT_SHA256" \
  --arg postgresDumpFilename "$POSTGRES_DUMP_FILENAME" \
  --arg postgresRemoteObjectPrefix "$POSTGRES_REMOTE_OBJECT_PREFIX" \
  --arg minioManifestSha256 "$(cut -d ' ' -f1 "$TEMP_DIR/minio-manifest.sha256")" \
  --argjson objectCount "$object_count" \
  --argjson totalBytes "$total_bytes" \
  '{version:1,status:"PASS",backup_set_id:$backupSetId,started_at:$startedAt,completed_at:$completedAt,source_env:$sourceEnv,source_host:$sourceHost,source_bucket:$sourceBucket,app_sha:$appSha,postgres_backup_id:$postgresBackupId,postgres_sha256:$postgresSha256,postgres_completed_at:$postgresCompletedAt,postgres_dump_filename:$postgresDumpFilename,postgres_remote_object_prefix:$postgresRemoteObjectPrefix,postgres_receipt:"postgres-backup-receipt.json",postgres_receipt_sha256:$postgresReceiptSha256,minio_manifest:"minio-manifest.json",minio_manifest_sha256:$minioManifestSha256,object_count:$objectCount,total_bytes:$totalBytes,deletion_propagation:false,encryption:"SSE-S3"}' \
  > "$TEMP_DIR/backup-receipt.json"

mc cp --enc-s3 "backup/$BACKUP_BUCKET" "$POSTGRES_BACKUP_RECEIPT_FILE" "backup/$BACKUP_BUCKET/$PREFIX/meta/postgres-backup-receipt.json" >/dev/null
mc cp --enc-s3 "backup/$BACKUP_BUCKET" "$TEMP_DIR/minio-manifest.json" "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.json" >/dev/null
mc cp --enc-s3 "backup/$BACKUP_BUCKET" "$TEMP_DIR/minio-manifest.sha256" "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.sha256" >/dev/null
# The receipt is uploaded last and is the only completion marker for the set.
mc cp --enc-s3 "backup/$BACKUP_BUCKET" "$TEMP_DIR/backup-receipt.json" "backup/$BACKUP_BUCKET/$PREFIX/meta/backup-receipt.json" >/dev/null

printf 'MINIO_BACKUP_COMPLETE\nSTATUS=PASS\nBACKUP_SET_ID=%s\nAPP_SHA=%s\nOBJECT_COUNT=%s\nTOTAL_BYTES=%s\n' \
  "$BACKUP_SET_ID" "$APP_SHA" "$object_count" "$total_bytes"
