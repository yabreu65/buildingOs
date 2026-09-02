#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-readonly-audit-backup.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

source "$AUDITOR"

auditor_text="$(< "$AUDITOR")"
[[ "$auditor_text" == *'--arg completedAt "$completed_at"'* ]]
[[ "$auditor_text" == *'.completed_at == $completedAt'* ]]
[[ "$auditor_text" == *'--arg runtimeAppSha "$RUNTIME_APP_SHA"'* ]]
[[ "$auditor_text" == *'.app_sha == $runtimeAppSha'* ]]

dump="$TEST_ROOT/existing.dump"
printf 'existing custom archive fixture\n' > "$dump"

host_restore_call=''
pg_restore() {
  host_restore_call="$*"
  [[ "$1" == '--list' && "$2" == "$dump" ]]
}
validate_pg_restore_list "$dump"
[[ "$host_restore_call" == "--list $dump" ]]
unset -f pg_restore

container_call=''
docker() {
  case "$1 ${2:-}" in
    'inspect --type')
      return 0
      ;;
    exec*)
      container_call="$*"
      cat >/dev/null
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}
PATH="$TEST_ROOT:/usr/bin:/bin" validate_pg_restore_list "$dump"
[[ "$container_call" == *'exec -i pawtech-postgres pg_restore --list'* ]]

docker() {
  return 1
}
if PATH="$TEST_ROOT:/usr/bin:/bin" validate_pg_restore_list "$dump"; then
  printf 'FAIL: unavailable pg_restore path unexpectedly passed\n' >&2
  exit 1
else
  [[ "$?" -eq 2 ]]
fi

manifest="$TEST_ROOT/backup-postgres.identity.v1"
printf 'version=%s\npath=%s\nsha256=%s\nowner=%s\ngroup=%s\nmode=%s\n' \
  "$BACKUP_IDENTITY_VERSION" "$BACKUP_SCRIPT_PATH" "$BACKUP_SCRIPT_SHA256" \
  "$BACKUP_SCRIPT_OWNER" "$BACKUP_SCRIPT_GROUP" "$BACKUP_SCRIPT_MODE" > "$manifest"
validate_backup_manifest "$manifest"
ln -s "$manifest" "$TEST_ROOT/manifest-link"
if validate_backup_manifest "$TEST_ROOT/manifest-link"; then
  printf 'FAIL: symlink manifest unexpectedly passed\n' >&2
  exit 1
fi

printf 'PASS: backup validation uses host or PostgreSQL-container pg_restore and rejects unavailable or symlinked evidence\n'
