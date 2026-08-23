#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s <dump> <target_database> [--checksum <file>] [--confirm <value>] [--allow-production]\n' "${0##*/}" >&2
  exit 64
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ $# -ge 2 ]] || usage
readonly DUMP_FILE="$1"
readonly TARGET_DATABASE="$2"
shift 2

CHECKSUM_FILE=""
CONFIRMATION=""
ALLOW_PRODUCTION=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --checksum)
      [[ $# -ge 2 ]] || usage
      CHECKSUM_FILE="$2"
      shift 2
      ;;
    --confirm)
      [[ $# -ge 2 ]] || usage
      CONFIRMATION="$2"
      shift 2
      ;;
    --allow-production)
      ALLOW_PRODUCTION=true
      shift
      ;;
    *) usage ;;
  esac
done

readonly POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-}"
readonly MAINTENANCE_DATABASE="${MAINTENANCE_DATABASE:-postgres}"
readonly TEMP_DATABASE_PATTERN='^buildingos_(prod00r|restore_test)_[a-z0-9_]+$'
CREATED_DATABASE=false

[[ -r "$DUMP_FILE" && -s "$DUMP_FILE" ]] || fail "Dump is missing, unreadable, or empty"
[[ "$TARGET_DATABASE" =~ ^[a-z][a-z0-9_]{2,62}$ ]] || fail "Unsafe target database name"
[[ "$MAINTENANCE_DATABASE" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || fail "Unsafe maintenance database name"

if [[ -z "$CHECKSUM_FILE" && -f "$DUMP_FILE.sha256" ]]; then
  CHECKSUM_FILE="$DUMP_FILE.sha256"
fi
if [[ -n "$CHECKSUM_FILE" ]]; then
  [[ -r "$CHECKSUM_FILE" ]] || fail "Checksum file is unreadable"
  expected_checksum="$(cut -d ' ' -f1 "$CHECKSUM_FILE")"
  actual_checksum="$(sha256sum "$DUMP_FILE" | cut -d ' ' -f1)"
  [[ "$expected_checksum" =~ ^[0-9a-f]{64}$ && "$actual_checksum" == "$expected_checksum" ]] || fail "Checksum verification failed"
elif [[ ! "$TARGET_DATABASE" =~ $TEMP_DATABASE_PATTERN ]]; then
  fail "A checksum is required for non-temporary restores"
fi

if [[ "$TARGET_DATABASE" == "buildingos_db" ]]; then
  [[ "$ALLOW_PRODUCTION" == true ]] || fail "Production restore is disabled by default"
  [[ "$CONFIRMATION" == "APPROVE DATABASE RESTORE" ]] || fail "Production restore confirmation is invalid"
elif [[ ! "$TARGET_DATABASE" =~ $TEMP_DATABASE_PATTERN ]]; then
  [[ "$CONFIRMATION" == "$TARGET_DATABASE" ]] || fail "Explicit target confirmation is required"
fi

run_psql() {
  if [[ -n "$POSTGRES_CONTAINER" ]]; then
    docker exec "$POSTGRES_CONTAINER" sh -lc \
      'exec psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$1" -c "$2"' sh "$MAINTENANCE_DATABASE" "$1"
  else
    psql -v ON_ERROR_STOP=1 -qAt -d "$MAINTENANCE_DATABASE" -c "$1"
  fi
}

run_createdb() {
  if [[ -n "$POSTGRES_CONTAINER" ]]; then
    docker exec "$POSTGRES_CONTAINER" sh -lc \
      'exec createdb -U "$POSTGRES_USER" "$1"' sh "$TARGET_DATABASE"
  else
    createdb "$TARGET_DATABASE"
  fi
}

run_dropdb() {
  if [[ -n "$POSTGRES_CONTAINER" ]]; then
    docker exec "$POSTGRES_CONTAINER" sh -lc \
      'exec dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$TARGET_DATABASE"
  else
    dropdb --if-exists "$TARGET_DATABASE"
  fi
}

run_pg_restore() {
  if [[ -n "$POSTGRES_CONTAINER" ]]; then
    docker exec -i "$POSTGRES_CONTAINER" sh -lc \
      'exec pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$1"' sh "$TARGET_DATABASE" < "$DUMP_FILE"
  else
    pg_restore --exit-on-error --no-owner --no-acl -d "$TARGET_DATABASE" "$DUMP_FILE"
  fi
}

validate_toc() {
  if [[ -n "$POSTGRES_CONTAINER" ]]; then
    docker exec -i "$POSTGRES_CONTAINER" pg_restore --list < "$DUMP_FILE" >/dev/null
  else
    pg_restore --list "$DUMP_FILE" >/dev/null
  fi
}

cleanup_failed_temporary_restore() {
  local rc=$?
  trap - EXIT
  if [[ "$CREATED_DATABASE" == true && "$TARGET_DATABASE" =~ $TEMP_DATABASE_PATTERN ]]; then
    run_dropdb >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap cleanup_failed_temporary_restore EXIT

if [[ -n "$POSTGRES_CONTAINER" ]]; then
  command -v docker >/dev/null || fail "docker is required"
  docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || fail "PostgreSQL container is unavailable"
else
  command -v psql >/dev/null || fail "psql is required"
  command -v createdb >/dev/null || fail "createdb is required"
  command -v dropdb >/dev/null || fail "dropdb is required"
  command -v pg_restore >/dev/null || fail "pg_restore is required"
fi

validate_toc || fail "The file is not a valid PostgreSQL custom dump"
[[ -z "$(run_psql "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DATABASE'")" ]] || fail "Target database already exists"
run_createdb
CREATED_DATABASE=true
run_pg_restore

table_count="$(if [[ -n "$POSTGRES_CONTAINER" ]]; then
  docker exec "$POSTGRES_CONTAINER" sh -lc \
    'exec psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$1" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()"' sh "$TARGET_DATABASE"
else
  psql -v ON_ERROR_STOP=1 -qAt -d "$TARGET_DATABASE" -c 'SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()'
fi)"
[[ "$table_count" =~ ^[1-9][0-9]*$ ]] || fail "Restore verification found no public tables"

trap - EXIT
printf 'Custom PostgreSQL restore verified: database=%s tables=%s\n' "$TARGET_DATABASE" "$table_count"
