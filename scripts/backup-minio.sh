#!/usr/bin/env bash
set -Eeuo pipefail

# Create an append-only MinIO backup set. Credentials are supplied through the
# environment and are kept in a temporary mc config outside the repository.

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
require() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }
safe_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]]; }
endpoint_identity() { local value="${1#*://}"; printf '%s\n' "${value%%/*}"; }

for variable in SOURCE_ENVIRONMENT EXPECTED_SOURCE_ENVIRONMENT SOURCE_ENDPOINT SOURCE_ACCESS_KEY SOURCE_SECRET_KEY SOURCE_BUCKET BACKUP_ENDPOINT BACKUP_ACCESS_KEY BACKUP_SECRET_KEY BACKUP_BUCKET BACKUP_SET_ID APP_SHA POSTGRES_BACKUP_ID POSTGRES_BACKUP_SHA256 POSTGRES_BACKUP_COMPLETED_AT; do
  require "$variable"
done

[[ "$SOURCE_ENVIRONMENT" == "$EXPECTED_SOURCE_ENVIRONMENT" ]] || fail "source environment identity mismatch"
[[ "$SOURCE_ENVIRONMENT" =~ ^(production|staging|development|rehearsal)$ ]] || fail "unsafe source environment"
safe_id "$BACKUP_SET_ID" || fail "unsafe BACKUP_SET_ID"
[[ "$POSTGRES_BACKUP_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "POSTGRES_BACKUP_SHA256 must be SHA-256"
[[ "$APP_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "APP_SHA must be a 40-character commit SHA"
[[ "$SOURCE_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe SOURCE_BUCKET"
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe BACKUP_BUCKET"
[[ "$(endpoint_identity "$SOURCE_ENDPOINT")" != "$(endpoint_identity "$BACKUP_ENDPOINT")" || "$SOURCE_BUCKET" != "$BACKUP_BUCKET" ]] || fail "backup destination must not be the source bucket"
command -v mc >/dev/null 2>&1 || fail "mc is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

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
if mc ls --recursive --json "backup/$BACKUP_BUCKET/$PREFIX" | jq -e 'select((.type // "file") == "file")' >/dev/null 2>&1; then
  fail "backup set already exists; use a new BACKUP_SET_ID"
fi

mc ls --recursive --json "source/$SOURCE_BUCKET" \
  | jq -c 'select((.type // "file") == "file") | {key:(.key // .name),size:(.size // 0),etag:(.etag // null),lastModified:(.lastModified // null)}' \
  | jq -s 'sort_by(.key)' > "$TEMP_DIR/source-manifest.json"

object_count="$(jq 'length' "$TEMP_DIR/source-manifest.json")"
total_bytes="$(jq '[.[].size] | add // 0' "$TEMP_DIR/source-manifest.json")"
[[ "$object_count" =~ ^[0-9]+$ && "$total_bytes" =~ ^[0-9]+$ ]] || fail "source manifest totals are invalid"

# Deliberately omit --remove: source deletions must never propagate to backups.
mc mirror --overwrite --json "source/$SOURCE_BUCKET" "backup/$BACKUP_BUCKET/$PREFIX/objects" >/dev/null

mc ls --recursive --json "backup/$BACKUP_BUCKET/$PREFIX/objects" \
  | jq -c 'select((.type // "file") == "file") | {key:(.key // .name | sub("^.*?/objects/"; "")),size:(.size // 0),etag:(.etag // null),lastModified:(.lastModified // null)}' \
  | jq -s 'sort_by(.key)' > "$TEMP_DIR/backup-manifest.json"

backup_count="$(jq 'length' "$TEMP_DIR/backup-manifest.json")"
backup_bytes="$(jq '[.[].size] | add // 0' "$TEMP_DIR/backup-manifest.json")"
[[ "$object_count" == "$backup_count" && "$total_bytes" == "$backup_bytes" ]] || fail "copied object count or byte total does not match source"

if ! jq -S 'map({key,size})' "$TEMP_DIR/source-manifest.json" | cmp -s - <(jq -S 'map({key,size})' "$TEMP_DIR/backup-manifest.json"); then
  fail "copied object keys or sizes do not match source manifest"
fi
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
  --arg minioManifestSha256 "$(cut -d ' ' -f1 "$TEMP_DIR/minio-manifest.sha256")" \
  --argjson objectCount "$object_count" \
  --argjson totalBytes "$total_bytes" \
  '{backup_set_id:$backupSetId,started_at:$startedAt,completed_at:$completedAt,source_env:$sourceEnv,source_host:$sourceHost,source_bucket:$sourceBucket,app_sha:$appSha,postgres_backup_id:$postgresBackupId,postgres_sha256:$postgresSha256,postgres_completed_at:$postgresCompletedAt,minio_manifest:"minio-manifest.json",minio_manifest_sha256:$minioManifestSha256,object_count:$objectCount,total_bytes:$totalBytes,deletion_propagation:false}' \
  > "$TEMP_DIR/backup-receipt.json"

mc cp "$TEMP_DIR/minio-manifest.json" "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.json" >/dev/null
mc cp "$TEMP_DIR/minio-manifest.sha256" "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.sha256" >/dev/null
mc cp "$TEMP_DIR/backup-receipt.json" "backup/$BACKUP_BUCKET/$PREFIX/meta/backup-receipt.json" >/dev/null

printf 'MinIO backup verified: set=%s environment=%s objects=%s bytes=%s destination=%s/%s\n' \
  "$BACKUP_SET_ID" "$SOURCE_ENVIRONMENT" "$object_count" "$total_bytes" "$BACKUP_BUCKET" "$PREFIX"
