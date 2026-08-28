#!/usr/bin/env bash
set -Eeuo pipefail
set +x

unit_name="${1:-unknown}"
[[ "$unit_name" =~ ^[A-Za-z0-9@_.:-]{1,200}$ ]] || { printf 'ERROR: unsafe failed unit name\n' >&2; exit 1; }
occurred_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
payload="$(printf '{"event":"buildingos_backup_failure","unit":"%s","occurred_at":"%s"}' "$unit_name" "$occurred_at")"

logger -t buildingos-backup -- "$payload"
printf '%s\n' "$payload"

if [[ -n "${BACKUP_ALERT_HOOK:-}" ]]; then
  [[ "$BACKUP_ALERT_HOOK" == /* && ! -L "$BACKUP_ALERT_HOOK" && -f "$BACKUP_ALERT_HOOK" && -x "$BACKUP_ALERT_HOOK" ]] || {
    printf 'ERROR: BACKUP_ALERT_HOOK is not a trusted executable file\n' >&2
    exit 1
  }
  printf '%s\n' "$payload" | "$BACKUP_ALERT_HOOK"
fi
