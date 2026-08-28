#!/usr/bin/env bash
set -Eeuo pipefail
set +x

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
require() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }
safe_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]]; }

for variable in BACKUP_SET_ID APP_SHA BACKUP_BUCKET POSTGRES_CONTAINER POSTGRES_DATABASE POSTGRES_USER POSTGRES_BACKUP_ROOT POSTGRES_RCLONE_DESTINATION POSTGRES_VERIFY_RCLONE_DESTINATION POSTGRES_SSE_MODE POSTGRES_RECEIPT_FILE; do require "$variable"; done
safe_id "$BACKUP_SET_ID" || fail "unsafe BACKUP_SET_ID"
[[ "$APP_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "APP_SHA must be the deployed 40-character revision"
[[ "$POSTGRES_CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || fail "unsafe PostgreSQL container name"
[[ "$POSTGRES_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail "unsafe PostgreSQL database name"
[[ "$POSTGRES_USER" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail "unsafe PostgreSQL user name"
[[ "$POSTGRES_BACKUP_ROOT" == /* && ! -L "$POSTGRES_BACKUP_ROOT" ]] || fail "POSTGRES_BACKUP_ROOT must be an absolute non-symlink path"
[[ "$POSTGRES_RCLONE_DESTINATION" =~ ^[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$ ]] || fail "unsafe PostgreSQL off-host destination"
[[ "$POSTGRES_VERIFY_RCLONE_DESTINATION" =~ ^[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$ ]] || fail "unsafe PostgreSQL verification destination"
[[ "${POSTGRES_RCLONE_DESTINATION#*:}" == "$BACKUP_BUCKET/postgresql" ]] || fail "PostgreSQL backup must use the dedicated paired backup bucket"
[[ "${POSTGRES_VERIFY_RCLONE_DESTINATION#*:}" == "$BACKUP_BUCKET/postgresql" ]] || fail "PostgreSQL verification must use the dedicated paired backup bucket"
[[ "${POSTGRES_RCLONE_DESTINATION%%:*}" != "${POSTGRES_VERIFY_RCLONE_DESTINATION%%:*}" ]] || fail "PostgreSQL upload and verification must use separate rclone identities"
[[ "$POSTGRES_SSE_MODE" == "SSE-S3" ]] || fail "PostgreSQL backup requires SSE-S3"
[[ "$POSTGRES_RECEIPT_FILE" == /* && ! -e "$POSTGRES_RECEIPT_FILE" ]] || fail "POSTGRES_RECEIPT_FILE must be a new absolute path"
for command_name in docker pg_restore rclone jq sha256sum; do command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"; done

umask 077
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
postgres_backup_id="postgres-$BACKUP_SET_ID"
run_dir="$POSTGRES_BACKUP_ROOT/$postgres_backup_id"
[[ ! -e "$run_dir" ]] || fail "PostgreSQL backup set already exists"
mkdir -p "$run_dir"
dump_filename="buildingos_db_${BACKUP_SET_ID}.dump"
dump_file="$run_dir/$dump_filename"
checksum_file="$dump_file.sha256"
remote_root="${POSTGRES_RCLONE_DESTINATION%/}/$BACKUP_SET_ID"
verify_remote_root="${POSTGRES_VERIFY_RCLONE_DESTINATION%/}/$BACKUP_SET_ID"
remote_object_prefix="postgresql/$BACKUP_SET_ID"

docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DATABASE" --format=custom --no-owner --no-privileges > "$dump_file" || fail "PostgreSQL dump failed"
[[ -s "$dump_file" ]] || fail "PostgreSQL dump is empty"
pg_restore --list "$dump_file" >/dev/null || fail "PostgreSQL custom archive validation failed"
postgres_sha256="$(sha256sum "$dump_file" | cut -d ' ' -f1)"
[[ "$postgres_sha256" =~ ^[0-9a-f]{64}$ ]] || fail "PostgreSQL SHA-256 is invalid"
printf '%s  %s\n' "$postgres_sha256" "$dump_filename" > "$checksum_file"

rclone copyto --s3-server-side-encryption AES256 "$dump_file" "$remote_root/$dump_filename" || fail "PostgreSQL encrypted off-host dump upload failed"
rclone copyto --s3-server-side-encryption AES256 "$checksum_file" "$remote_root/$dump_filename.sha256" || fail "PostgreSQL encrypted off-host checksum upload failed"
remote_sha256="$(rclone cat "$verify_remote_root/$dump_filename" | sha256sum | cut -d ' ' -f1)" || fail "PostgreSQL remote checksum evidence is unavailable"
[[ "$remote_sha256" == "$postgres_sha256" ]] || fail "PostgreSQL remote checksum does not match"

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -n \
  --arg backupSetId "$BACKUP_SET_ID" \
  --arg startedAt "$started_at" \
  --arg completedAt "$completed_at" \
  --arg appSha "$APP_SHA" \
  --arg postgresBackupId "$postgres_backup_id" \
  --arg postgresSha256 "$postgres_sha256" \
  --arg dumpFilename "$dump_filename" \
  --arg destination "$remote_root" \
  --arg remoteObjectPrefix "$remote_object_prefix" \
  '{version:1,backup_set_id:$backupSetId,started_at:$startedAt,completed_at:$completedAt,app_sha:$appSha,postgres_backup_id:$postgresBackupId,postgres_sha256:$postgresSha256,dump_filename:$dumpFilename,destination:$destination,remote_object_prefix:$remoteObjectPrefix,encryption:"SSE-S3",status:"PASS"}' \
  > "$POSTGRES_RECEIPT_FILE"
chmod 0600 "$POSTGRES_RECEIPT_FILE"
rclone copyto --s3-server-side-encryption AES256 "$POSTGRES_RECEIPT_FILE" "$remote_root/postgres-backup-receipt.json" || fail "PostgreSQL encrypted receipt upload failed"
local_receipt_sha256="$(sha256sum "$POSTGRES_RECEIPT_FILE" | cut -d ' ' -f1)"
remote_receipt_sha256="$(rclone cat "$verify_remote_root/postgres-backup-receipt.json" | sha256sum | cut -d ' ' -f1)" || fail "PostgreSQL remote receipt evidence is unavailable"
[[ "$remote_receipt_sha256" == "$local_receipt_sha256" ]] || fail "PostgreSQL remote receipt does not match local PASS evidence"

printf 'POSTGRES_BACKUP_COMPLETE\nSTATUS=PASS\nBACKUP_SET_ID=%s\nAPP_SHA=%s\nPOSTGRES_BACKUP_ID=%s\nPOSTGRES_SHA256=%s\nCOMPLETED_AT=%s\n' \
  "$BACKUP_SET_ID" "$APP_SHA" "$postgres_backup_id" "$postgres_sha256" "$completed_at"
