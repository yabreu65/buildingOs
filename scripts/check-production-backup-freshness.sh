#!/usr/bin/env bash
set -Eeuo pipefail
set +x

state_file="${BACKUP_STATE_FILE:-/var/lib/buildingos-backup/latest.env}"
max_age="${MAX_BACKUP_AGE_SECONDS:-129600}"
[[ "$state_file" == /* && ! -L "$state_file" && -f "$state_file" && -r "$state_file" ]] || { printf 'ERROR: successful backup state is unavailable\n' >&2; exit 1; }
[[ "$max_age" =~ ^[0-9]+$ && "$max_age" -ge 3600 ]] || { printf 'ERROR: invalid maximum backup age\n' >&2; exit 1; }

completed_at="$(grep -E '^COMPLETED_AT=' "$state_file" | cut -d= -f2-)"
[[ "$completed_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || { printf 'ERROR: latest completion timestamp is invalid\n' >&2; exit 1; }
if completed_epoch="$(date -u -d "$completed_at" +%s 2>/dev/null)"; then
  :
elif completed_epoch="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$completed_at" +%s 2>/dev/null)"; then
  :
else
  printf 'ERROR: unable to parse latest completion timestamp\n' >&2
  exit 1
fi
now_epoch="$(date -u +%s)"
age=$((now_epoch - completed_epoch))
(( age >= 0 && age <= max_age )) || { printf 'ERROR: latest successful paired backup is stale\n' >&2; exit 1; }
printf 'BUILDINGOS_BACKUP_FRESHNESS\nSTATUS=PASS\nCOMPLETED_AT=%s\nAGE_SECONDS=%s\n' "$completed_at" "$age"
