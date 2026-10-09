#!/usr/bin/env bash
set -Eeuo pipefail
set +x

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly script_dir
readonly operation_lock_library="$script_dir/lib/production-operation-lock.sh"
readonly operation_lock_sha256='116f03904418abb7f84bc4624a9f0151a8b4f0713d9b8e6b9f05b4212f44b2d4'
[[ -f "$operation_lock_library" && ! -L "$operation_lock_library" ]] || fail 'shared operation lock helper is unavailable'
if command -v sha256sum >/dev/null 2>&1; then
  operation_lock_actual_sha256="$(sha256sum "$operation_lock_library" | awk '{print $1}')"
else
  operation_lock_actual_sha256="$(shasum -a 256 "$operation_lock_library" | awk '{print $1}')"
fi
[[ "$operation_lock_actual_sha256" == "$operation_lock_sha256" ]] || fail 'shared operation lock helper integrity check failed'
# shellcheck source=scripts/lib/production-operation-lock.sh
source "$operation_lock_library"

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
production_operation_lock_acquire || fail 'Unable to acquire the shared production operation lock'
trap 'production_operation_lock_release; [[ -z "${temporary_receipt:-}" ]] || rm -f -- "$temporary_receipt"' EXIT
rm -f "$receipt_file" || fail 'unable to clear the previous object backup receipt'

source_location="${OBJECT_BACKUP_SOURCE:-}"
destination_location="${OBJECT_BACKUP_DESTINATION:-}"
validate_location OBJECT_BACKUP_SOURCE "$source_location"
validate_location OBJECT_BACKUP_DESTINATION "$destination_location"
[[ "$source_bucket" != "$destination_bucket" ]] || fail 'source and destination bucket names must differ'
command -v rclone >/dev/null 2>&1 || fail 'rclone is required'

started_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
temporary_receipt=''

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
