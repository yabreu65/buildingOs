#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly RESTORE_SCRIPT="$SCRIPT_DIR/restore-postgres-custom.sh"
readonly REHEARSAL_CONFIRMATION='NON-PRODUCTION REHEARSAL'
CREATED_DATABASES=""

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
Usage: rehearse-postgres-custom-recovery.sh \
  --dump FILE --checksum FILE --toc FILE \
  --container NAME --expected-container-id ID --test-id SAFE_ID \
  --schema-hook FILE --data-hook FILE --migration-hook FILE \
  --confirm 'NON-PRODUCTION REHEARSAL' [--required-free-bytes BYTES]

The container must carry the label:
  com.buildingos.recovery.environment=rehearsal
USAGE
  exit 64
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    fail "sha256sum or shasum is required"
  fi
}

file_size_bytes() {
  stat -f '%z' "$1" 2>/dev/null || stat -c '%s' "$1" 2>/dev/null || fail "Unable to read dump size"
}

assert_test_database() {
  [[ "$1" =~ ^buildingos_restore_test_[a-z0-9_]{1,37}$ ]] || fail "Refusing unsafe rehearsal database name"
}

run_psql() {
  local database="$1"
  local sql="$2"
  docker exec "$POSTGRES_CONTAINER" sh -lc \
    'exec psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$1" -c "$2"' sh "$database" "$sql"
}

database_exists() {
  [[ "$(run_psql postgres "SELECT count(*) FROM pg_database WHERE datname = '$1'")" == "1" ]]
}

create_database() {
  assert_test_database "$1"
  docker exec "$POSTGRES_CONTAINER" sh -lc 'exec createdb -U "$POSTGRES_USER" "$1"' sh "$1"
  CREATED_DATABASES="$CREATED_DATABASES $1"
}

drop_database() {
  assert_test_database "$1"
  docker exec "$POSTGRES_CONTAINER" sh -lc 'exec dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$1"
}

cleanup() {
  local rc=$?
  local database
  trap - EXIT
  for database in $CREATED_DATABASES; do
    drop_database "$database" >/dev/null 2>&1 || true
  done
  if [[ -n "${TEMP_DIR:-}" ]]; then
    rm -rf "$TEMP_DIR"
  fi
  exit "$rc"
}

run_hooks() {
  export RECOVERY_ACTION="REHEARSAL"
  export RECOVERY_CONTAINER="$POSTGRES_CONTAINER"
  export RECOVERY_DATABASE="$CANDIDATE_DATABASE"
  "$SCHEMA_HOOK"
  "$DATA_HOOK"
  "$MIGRATION_HOOK"
}

DUMP_FILE=""
CHECKSUM_FILE=""
TOC_FILE=""
POSTGRES_CONTAINER=""
EXPECTED_CONTAINER_ID=""
TEST_ID=""
SCHEMA_HOOK=""
DATA_HOOK=""
MIGRATION_HOOK=""
CONFIRMATION=""
REQUIRED_FREE_BYTES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) [[ $# -ge 2 ]] || usage; DUMP_FILE="$2"; shift 2 ;;
    --checksum) [[ $# -ge 2 ]] || usage; CHECKSUM_FILE="$2"; shift 2 ;;
    --toc) [[ $# -ge 2 ]] || usage; TOC_FILE="$2"; shift 2 ;;
    --container) [[ $# -ge 2 ]] || usage; POSTGRES_CONTAINER="$2"; shift 2 ;;
    --expected-container-id) [[ $# -ge 2 ]] || usage; EXPECTED_CONTAINER_ID="$2"; shift 2 ;;
    --test-id) [[ $# -ge 2 ]] || usage; TEST_ID="$2"; shift 2 ;;
    --schema-hook) [[ $# -ge 2 ]] || usage; SCHEMA_HOOK="$2"; shift 2 ;;
    --data-hook) [[ $# -ge 2 ]] || usage; DATA_HOOK="$2"; shift 2 ;;
    --migration-hook) [[ $# -ge 2 ]] || usage; MIGRATION_HOOK="$2"; shift 2 ;;
    --confirm) [[ $# -ge 2 ]] || usage; CONFIRMATION="$2"; shift 2 ;;
    --required-free-bytes) [[ $# -ge 2 ]] || usage; REQUIRED_FREE_BYTES="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -f "$DUMP_FILE" && ! -L "$DUMP_FILE" && -r "$DUMP_FILE" && -s "$DUMP_FILE" ]] || fail "Dump must be a readable non-symlink regular file"
[[ -f "$CHECKSUM_FILE" && ! -L "$CHECKSUM_FILE" && -r "$CHECKSUM_FILE" && -s "$CHECKSUM_FILE" ]] || fail "Checksum must be a readable non-symlink regular file"
[[ -f "$TOC_FILE" && ! -L "$TOC_FILE" && -r "$TOC_FILE" && -s "$TOC_FILE" ]] || fail "TOC must be a readable non-symlink regular file"
[[ "$POSTGRES_CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || fail "Unsafe PostgreSQL container name"
[[ "$EXPECTED_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] || fail "Expected container ID must be 64 lowercase hex characters"
[[ "$TEST_ID" =~ ^[a-z0-9][a-z0-9_]{0,23}$ ]] || fail "Unsafe rehearsal test ID"
[[ "$CONFIRMATION" == "$REHEARSAL_CONFIRMATION" ]] || fail "Exact non-production rehearsal confirmation is required"
for hook in "$SCHEMA_HOOK" "$DATA_HOOK" "$MIGRATION_HOOK"; do
  [[ -f "$hook" && ! -L "$hook" && -x "$hook" ]] || fail "All validation hooks must be executable non-symlink files"
done
command -v docker >/dev/null 2>&1 || fail "docker is required"

CANDIDATE_DATABASE="buildingos_restore_test_${TEST_ID}_candidate"
ACTIVE_DATABASE="buildingos_restore_test_${TEST_ID}_active"
PREVIOUS_DATABASE="buildingos_restore_test_${TEST_ID}_previous"
assert_test_database "$CANDIDATE_DATABASE"
assert_test_database "$ACTIVE_DATABASE"
assert_test_database "$PREVIOUS_DATABASE"

checksum_line="$(cat "$CHECKSUM_FILE")"
[[ "$(wc -l < "$CHECKSUM_FILE")" -eq 1 && -z "$(tail -c 1 "$CHECKSUM_FILE")" ]] || fail "Checksum file must contain exactly one newline-terminated row"
[[ "$checksum_line" =~ ^([0-9a-f]{64})[[:space:]]+[*]?([^[:space:]]+)$ ]] || fail "Checksum file must contain exactly SHA-256 and dump basename"
EXPECTED_DUMP_SHA256="${BASH_REMATCH[1]}"
CHECKSUM_DUMP_NAME="${BASH_REMATCH[2]}"
[[ "$CHECKSUM_DUMP_NAME" == "$(basename "$DUMP_FILE")" ]] || fail "Checksum filename does not match the exact dump"
[[ "$(sha256_file "$DUMP_FILE")" == "$EXPECTED_DUMP_SHA256" ]] || fail "Checksum verification failed"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-rehearsal.XXXXXX")"
trap cleanup EXIT
docker exec -i "$POSTGRES_CONTAINER" pg_restore --list < "$DUMP_FILE" > "$TEMP_DIR/actual.toc" \
  || fail "The dump is not a valid PostgreSQL custom archive for the rehearsal container"
cmp -s "$TEMP_DIR/actual.toc" "$TOC_FILE" || fail "TOC does not exactly match the approved dump TOC"
rm -rf "$TEMP_DIR"
TEMP_DIR=""

ACTUAL_CONTAINER_ID="$(docker inspect --format '{{.Id}}' "$POSTGRES_CONTAINER" 2>/dev/null)" || fail "PostgreSQL container is unavailable"
[[ "$ACTUAL_CONTAINER_ID" == "$EXPECTED_CONTAINER_ID" ]] || fail "PostgreSQL container identity does not match"
CONTAINER_ENVIRONMENT="$(docker inspect --format '{{ index .Config.Labels "com.buildingos.recovery.environment" }}' "$POSTGRES_CONTAINER" 2>/dev/null)" || fail "Unable to inspect rehearsal container label"
[[ "$CONTAINER_ENVIRONMENT" == "rehearsal" ]] || fail "Container is not explicitly labeled as a recovery rehearsal environment"

DUMP_SIZE_BYTES="$(file_size_bytes "$DUMP_FILE")"
if [[ -z "$REQUIRED_FREE_BYTES" ]]; then
  REQUIRED_FREE_BYTES=$((DUMP_SIZE_BYTES * 3))
fi
[[ "$REQUIRED_FREE_BYTES" =~ ^[1-9][0-9]*$ ]] || fail "Required free bytes must be a positive integer"
(( REQUIRED_FREE_BYTES >= DUMP_SIZE_BYTES )) || fail "Required free space cannot be smaller than the dump"
FREE_KIB="$(docker exec "$POSTGRES_CONTAINER" sh -lc 'df -Pk "${PGDATA:-/var/lib/postgresql/data}" | tail -1' | awk '{print $4}')" || fail "Unable to inspect PostgreSQL free space"
[[ "$FREE_KIB" =~ ^[0-9]+$ ]] || fail "Unable to parse PostgreSQL free space"
(( FREE_KIB * 1024 >= REQUIRED_FREE_BYTES )) || fail "Insufficient PostgreSQL free space"

for database in "$CANDIDATE_DATABASE" "$ACTIVE_DATABASE" "$PREVIOUS_DATABASE"; do
  ! database_exists "$database" || fail "Rehearsal database already exists: $database"
done

POSTGRES_CONTAINER="$POSTGRES_CONTAINER" MAINTENANCE_DATABASE=postgres \
  bash "$RESTORE_SCRIPT" "$DUMP_FILE" "$CANDIDATE_DATABASE" --checksum "$CHECKSUM_FILE"
CREATED_DATABASES="$CREATED_DATABASES $CANDIDATE_DATABASE"
[[ "$(run_psql "$CANDIDATE_DATABASE" 'SELECT 1')" == "1" ]] || fail "Candidate SQL connectivity failed"
run_hooks

create_database "$ACTIVE_DATABASE"
run_psql postgres "BEGIN; ALTER DATABASE $ACTIVE_DATABASE RENAME TO $PREVIOUS_DATABASE; ALTER DATABASE $CANDIDATE_DATABASE RENAME TO $ACTIVE_DATABASE; COMMIT;"
[[ "$(run_psql "$ACTIVE_DATABASE" 'SELECT 1')" == "1" ]] || fail "Simulated swapped database connectivity failed"
run_psql postgres "BEGIN; ALTER DATABASE $ACTIVE_DATABASE RENAME TO $CANDIDATE_DATABASE; ALTER DATABASE $PREVIOUS_DATABASE RENAME TO $ACTIVE_DATABASE; COMMIT;"
[[ "$(run_psql "$ACTIVE_DATABASE" 'SELECT 1')" == "1" ]] || fail "Simulated reverse connectivity failed"

printf 'Recovery rehearsal passed: exact dump/TOC, restore, hooks, swap, reverse, and SQL connectivity.\n'
