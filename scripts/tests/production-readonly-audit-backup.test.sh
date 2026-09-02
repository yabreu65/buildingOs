#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-readonly-audit-backup.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

source "$AUDITOR"

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
validator="$TEST_ROOT/production-security-validate.sh"
printf 'trusted manifest fixture\n' > "$manifest"
printf '#!/usr/bin/env bash\n[[ "$1" == backup-identity && "$2" == *backup-postgres.identity.v1 ]]\n' > "$validator"
chmod 700 "$validator"
validate_backup_mechanism "$manifest" "$validator"
ln -s "$manifest" "$TEST_ROOT/manifest-link"
if validate_backup_mechanism "$TEST_ROOT/manifest-link" "$validator"; then
  printf 'FAIL: symlink manifest unexpectedly passed\n' >&2
  exit 1
fi

printf 'PASS: backup validation uses host or PostgreSQL-container pg_restore and rejects unavailable or symlinked evidence\n'
