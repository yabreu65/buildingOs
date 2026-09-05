#!/usr/bin/env bash
set -Eeuo pipefail
set +x

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

validate_location() {
  local label="$1"
  local value="$2"
  [[ -n "$value" ]] || fail "$label is required"
  if [[ ! "$value" =~ ^([A-Za-z0-9][A-Za-z0-9._-]*):([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
    fail "$label must be a named rclone remote and bucket root (REMOTE_NAME:BUCKET_NAME)"
  fi

  if [[ "$label" == OBJECT_BACKUP_SOURCE ]]; then
    source_remote="${BASH_REMATCH[1]}"
    source_bucket="${BASH_REMATCH[2]}"
  else
    destination_remote="${BASH_REMATCH[1]}"
    destination_bucket="${BASH_REMATCH[2]}"
  fi
}

receipt_file="${OBJECT_BACKUP_RECEIPT:-${TMPDIR:-/tmp}/buildingos-object-backup-receipt.json}"
[[ "$receipt_file" == /* ]] || fail 'OBJECT_BACKUP_RECEIPT must be an absolute path'
[[ "$receipt_file" != *$'\n'* && "$receipt_file" != *$'\r'* ]] || fail 'OBJECT_BACKUP_RECEIPT contains a control character'
receipt_dir="${receipt_file%/*}"
[[ -d "$receipt_dir" ]] || fail 'OBJECT_BACKUP_RECEIPT parent directory is unavailable'
[[ ! -L "$receipt_file" ]] || fail 'OBJECT_BACKUP_RECEIPT must not be a symlink'
rm -f "$receipt_file" || fail 'unable to clear the previous object backup receipt'

source_location="${OBJECT_BACKUP_SOURCE:-}"
destination_location="${OBJECT_BACKUP_DESTINATION:-}"
validate_location OBJECT_BACKUP_SOURCE "$source_location"
validate_location OBJECT_BACKUP_DESTINATION "$destination_location"
[[ "$source_bucket" != "$destination_bucket" ]] || fail 'source and destination bucket names must differ'
command -v rclone >/dev/null 2>&1 || fail 'rclone is required'

started_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
temporary_receipt=''
cleanup() {
  [[ -z "$temporary_receipt" ]] || rm -f "$temporary_receipt"
}
trap cleanup EXIT

if ! rclone copy "$source_location" "$destination_location" >/dev/null; then
  fail 'object storage copy failed'
fi

if ! rclone check --one-way "$source_location" "$destination_location" >/dev/null; then
  fail 'object storage verification failed'
fi

completed_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
temporary_receipt="$(mktemp "${receipt_file}.tmp.XXXXXX")" || fail 'unable to create temporary object backup receipt'
umask 077
printf '{"receipt_version":1,"started_at_utc":"%s","completed_at_utc":"%s","source":"%s","destination":"%s","copy_status":"PASS","verification_status":"PASS","status":"PASS","recovery_point_valid":"NOT_EVALUATED"}\n' \
  "$started_at_utc" "$completed_at_utc" "$source_location" "$destination_location" > "$temporary_receipt" || fail 'unable to write object backup receipt'
mv -f "$temporary_receipt" "$receipt_file" || fail 'unable to publish object backup receipt'
temporary_receipt=''

printf 'OBJECT_BACKUP_COMPLETE\nSTATUS=PASS\nRECOVERY_POINT_VALID=NOT_EVALUATED\nRECEIPT=%s\n' "$receipt_file"
