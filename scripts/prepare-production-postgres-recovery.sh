#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
readonly PROJECT_DIR
readonly RESTORE_SCRIPT="$SCRIPT_DIR/restore-postgres-custom.sh"
readonly APPROVAL_CONFIRMATION='APPROVE DATABASE RESTORE'
PINNED_DUMP_FILE=''
PINNED_CHECKSUM_FILE=''
PINNED_SCHEMA_HOOK=''
PINNED_DATA_HOOK=''
PINNED_MIGRATION_HOOK=''

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
Usage: prepare-production-postgres-recovery.sh \
  --dump FILE --checksum FILE --toc FILE \
  --container NAME --expected-container-id ID \
  --candidate DATABASE --rollback-database DATABASE \
  --schema-hook FILE --data-hook FILE --migration-hook FILE \
  [--production-database buildingos_db] [--required-free-bytes BYTES] \
  [--execute-restore-candidate|--execute-swap|--execute-reverse] \
  [--approval-file FILE --confirm 'APPROVE DATABASE RESTORE']

Without an --execute-* option, this command performs read-only inspection and
prints the request identities and exact approval-file content. It never restores
over the production database.
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

validate_hook() {
  [[ -f "$1" && ! -L "$1" && -x "$1" ]] || fail "$2 validation hook must be an executable non-symlink file"
}

run_psql() {
  local database="$1"
  local sql="$2"
  docker exec "${ACTUAL_CONTAINER_ID:-$POSTGRES_CONTAINER}" sh -lc \
    'exec psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$1" -c "$2"' sh "$database" "$sql"
}

database_exists() {
  local database="$1"
  [[ "$(run_psql "$MAINTENANCE_DATABASE" "SELECT count(*) FROM pg_database WHERE datname = '$database'")" == "1" ]]
}

active_session_count() {
  run_psql "$MAINTENANCE_DATABASE" \
    "SELECT count(*) FROM pg_stat_activity WHERE datname IN ('$PRODUCTION_DATABASE', '$CANDIDATE_DATABASE') AND pid <> pg_backend_pid()"
}

request_id_for() {
  local action="$1"
  {
    printf 'action=%s\n' "$action"
    printf 'dump_sha256=%s\n' "$DUMP_SHA256"
    printf 'checksum_sha256=%s\n' "$CHECKSUM_SHA256"
    printf 'toc_sha256=%s\n' "$TOC_SHA256"
    printf 'postgres_container=%s\n' "$POSTGRES_CONTAINER"
    printf 'postgres_container_id=%s\n' "$ACTUAL_CONTAINER_ID"
    printf 'production_database=%s\n' "$PRODUCTION_DATABASE"
    printf 'candidate_database=%s\n' "$CANDIDATE_DATABASE"
    printf 'rollback_database=%s\n' "$ROLLBACK_DATABASE"
    printf 'required_free_bytes=%s\n' "$REQUIRED_FREE_BYTES"
    printf 'restore_script_sha256=%s\n' "$RESTORE_SCRIPT_SHA256"
    printf 'schema_hook_sha256=%s\n' "$SCHEMA_HOOK_SHA256"
    printf 'data_hook_sha256=%s\n' "$DATA_HOOK_SHA256"
    printf 'migration_hook_sha256=%s\n' "$MIGRATION_HOOK_SHA256"
  } | sha256_stream
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | cut -d ' ' -f 1
  else
    fail "sha256sum or shasum is required"
  fi
}

write_expected_approval() {
  local action="$1"
  local destination="$2"
  local request_id
  request_id="$(request_id_for "$action")"
  {
    printf 'request_id=%s\n' "$request_id"
    printf 'action=%s\n' "$action"
    printf 'dump_sha256=%s\n' "$DUMP_SHA256"
    printf 'checksum_sha256=%s\n' "$CHECKSUM_SHA256"
    printf 'toc_sha256=%s\n' "$TOC_SHA256"
    printf 'postgres_container=%s\n' "$POSTGRES_CONTAINER"
    printf 'postgres_container_id=%s\n' "$ACTUAL_CONTAINER_ID"
    printf 'production_database=%s\n' "$PRODUCTION_DATABASE"
    printf 'candidate_database=%s\n' "$CANDIDATE_DATABASE"
    printf 'rollback_database=%s\n' "$ROLLBACK_DATABASE"
    printf 'required_free_bytes=%s\n' "$REQUIRED_FREE_BYTES"
    printf 'restore_script_sha256=%s\n' "$RESTORE_SCRIPT_SHA256"
    printf 'schema_hook_sha256=%s\n' "$SCHEMA_HOOK_SHA256"
    printf 'data_hook_sha256=%s\n' "$DATA_HOOK_SHA256"
    printf 'migration_hook_sha256=%s\n' "$MIGRATION_HOOK_SHA256"
    printf 'maintenance_window=CONFIRMED\n'
    printf 'application_quiescence=CONFIRMED\n'
    printf 'active_sessions=0\n'
    printf 'confirmation=%s\n' "$APPROVAL_CONFIRMATION"
  } > "$destination"
}

print_approval_template() {
  local action="$1"
  local expected_file="$TEMP_DIR/approval-$action"
  write_expected_approval "$action" "$expected_file"
  printf '\nApproval boundary: %s\n' "$action"
  cat "$expected_file"
}

validate_approval() {
  local expected_file="$TEMP_DIR/expected-approval"
  local approval_directory
  local resolved_approval
  local approval_mode
  [[ "$CONFIRMATION" == "$APPROVAL_CONFIRMATION" ]] || fail "Exact confirmation is required"
  [[ -n "$APPROVAL_FILE" && -f "$APPROVAL_FILE" && -r "$APPROVAL_FILE" ]] || fail "A readable external approval file is required"
  [[ "$APPROVAL_FILE" == /* && ! -L "$APPROVAL_FILE" ]] || fail "Approval file must be an absolute, non-symlink file"
  approval_directory="$(cd "$(dirname "$APPROVAL_FILE")" && pwd -P)" || fail "Unable to resolve approval directory"
  resolved_approval="$approval_directory/$(basename "$APPROVAL_FILE")"
  case "$resolved_approval" in
    "$PROJECT_DIR"|"$PROJECT_DIR"/*) fail "Approval file must be stored outside the repository" ;;
  esac
  approval_mode="$(stat -c '%a' "$APPROVAL_FILE" 2>/dev/null || stat -f '%Lp' "$APPROVAL_FILE" 2>/dev/null)" || fail "Unable to inspect approval file permissions"
  [[ "$approval_mode" == "400" || "$approval_mode" == "600" ]] || fail "Approval file permissions must be 0400 or 0600"
  write_expected_approval "$ACTION" "$expected_file"
  cmp -s "$expected_file" "$APPROVAL_FILE" || fail "Approval file does not exactly match this request identity and gate state"
}

run_validation_hooks() {
  export RECOVERY_ACTION="$ACTION"
  export RECOVERY_CONTAINER="$ACTUAL_CONTAINER_ID"
  export RECOVERY_DATABASE="$CANDIDATE_DATABASE"
  "$PINNED_SCHEMA_HOOK"
  "$PINNED_DATA_HOOK"
  "$PINNED_MIGRATION_HOOK"
}

pin_recovery_inputs() {
  local pinned_dir="$TEMP_DIR/pinned"
  local actual_toc="$TEMP_DIR/pinned-actual.toc"
  local current_container_id

  install -d -m 700 "$pinned_dir"
  umask 077
  cp -- "$DUMP_FILE" "$pinned_dir/approved.dump"
  cp -- "$CHECKSUM_FILE" "$pinned_dir/approved.dump.sha256"
  cp -- "$TOC_FILE" "$pinned_dir/approved.toc"
  cp -- "$RESTORE_SCRIPT" "$pinned_dir/restore-postgres-custom.sh"
  cp -- "$SCHEMA_HOOK" "$pinned_dir/schema-hook"
  cp -- "$DATA_HOOK" "$pinned_dir/data-hook"
  cp -- "$MIGRATION_HOOK" "$pinned_dir/migration-hook"
  chmod 400 "$pinned_dir/approved.dump" "$pinned_dir/approved.dump.sha256" "$pinned_dir/approved.toc"
  chmod 500 "$pinned_dir/restore-postgres-custom.sh" "$pinned_dir/schema-hook" "$pinned_dir/data-hook" "$pinned_dir/migration-hook"

  [[ "$(sha256_file "$pinned_dir/approved.dump")" == "$DUMP_SHA256" ]] || fail "Pinned dump identity changed"
  [[ "$(sha256_file "$pinned_dir/approved.dump.sha256")" == "$CHECKSUM_SHA256" ]] || fail "Pinned checksum identity changed"
  [[ "$(sha256_file "$pinned_dir/approved.toc")" == "$TOC_SHA256" ]] || fail "Pinned TOC identity changed"
  [[ "$(sha256_file "$pinned_dir/restore-postgres-custom.sh")" == "$RESTORE_SCRIPT_SHA256" ]] || fail "Pinned restore helper identity changed"
  [[ "$(sha256_file "$pinned_dir/schema-hook")" == "$SCHEMA_HOOK_SHA256" ]] || fail "Pinned schema hook identity changed"
  [[ "$(sha256_file "$pinned_dir/data-hook")" == "$DATA_HOOK_SHA256" ]] || fail "Pinned data hook identity changed"
  [[ "$(sha256_file "$pinned_dir/migration-hook")" == "$MIGRATION_HOOK_SHA256" ]] || fail "Pinned migration hook identity changed"

  docker exec -i "$ACTUAL_CONTAINER_ID" pg_restore --list < "$pinned_dir/approved.dump" > "$actual_toc" \
    || fail "Pinned dump is not a valid archive for the approved container"
  cmp -s "$actual_toc" "$pinned_dir/approved.toc" || fail "Pinned dump TOC changed"
  current_container_id="$(docker inspect --format '{{.Id}}' "$ACTUAL_CONTAINER_ID" 2>/dev/null)" \
    || fail "Approved PostgreSQL container is unavailable"
  [[ "$current_container_id" == "$ACTUAL_CONTAINER_ID" ]] || fail "PostgreSQL container identity changed"

  PINNED_DUMP_FILE="$pinned_dir/approved.dump"
  PINNED_CHECKSUM_FILE="$pinned_dir/approved.dump.sha256"
  PINNED_SCHEMA_HOOK="$pinned_dir/schema-hook"
  PINNED_DATA_HOOK="$pinned_dir/data-hook"
  PINNED_MIGRATION_HOOK="$pinned_dir/migration-hook"
}

execute_swap() {
  local sql
  sql="BEGIN;
ALTER DATABASE $PRODUCTION_DATABASE WITH ALLOW_CONNECTIONS false;
DO \$gate\$ BEGIN IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = '$PRODUCTION_DATABASE' AND pid <> pg_backend_pid()) THEN RAISE EXCEPTION 'production sessions remain'; END IF; END \$gate\$;
ALTER DATABASE $PRODUCTION_DATABASE RENAME TO $ROLLBACK_DATABASE;
ALTER DATABASE $CANDIDATE_DATABASE RENAME TO $PRODUCTION_DATABASE;
ALTER DATABASE $ROLLBACK_DATABASE WITH ALLOW_CONNECTIONS false;
ALTER DATABASE $PRODUCTION_DATABASE WITH ALLOW_CONNECTIONS true;
COMMIT;"
  run_psql "$MAINTENANCE_DATABASE" "$sql"
}

execute_reverse() {
  local sql
  sql="BEGIN;
ALTER DATABASE $PRODUCTION_DATABASE WITH ALLOW_CONNECTIONS false;
DO \$gate\$ BEGIN IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = '$PRODUCTION_DATABASE' AND pid <> pg_backend_pid()) THEN RAISE EXCEPTION 'production sessions remain'; END IF; END \$gate\$;
ALTER DATABASE $PRODUCTION_DATABASE RENAME TO $CANDIDATE_DATABASE;
ALTER DATABASE $ROLLBACK_DATABASE RENAME TO $PRODUCTION_DATABASE;
ALTER DATABASE $CANDIDATE_DATABASE WITH ALLOW_CONNECTIONS false;
ALTER DATABASE $PRODUCTION_DATABASE WITH ALLOW_CONNECTIONS true;
COMMIT;"
  run_psql "$MAINTENANCE_DATABASE" "$sql"
}

DUMP_FILE=""
CHECKSUM_FILE=""
TOC_FILE=""
POSTGRES_CONTAINER=""
EXPECTED_CONTAINER_ID=""
PRODUCTION_DATABASE="buildingos_db"
CANDIDATE_DATABASE=""
ROLLBACK_DATABASE=""
MAINTENANCE_DATABASE="postgres"
REQUIRED_FREE_BYTES=""
SCHEMA_HOOK=""
DATA_HOOK=""
MIGRATION_HOOK=""
ACTION="PLAN"
APPROVAL_FILE=""
CONFIRMATION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) [[ $# -ge 2 ]] || usage; DUMP_FILE="$2"; shift 2 ;;
    --checksum) [[ $# -ge 2 ]] || usage; CHECKSUM_FILE="$2"; shift 2 ;;
    --toc) [[ $# -ge 2 ]] || usage; TOC_FILE="$2"; shift 2 ;;
    --container) [[ $# -ge 2 ]] || usage; POSTGRES_CONTAINER="$2"; shift 2 ;;
    --expected-container-id) [[ $# -ge 2 ]] || usage; EXPECTED_CONTAINER_ID="$2"; shift 2 ;;
    --production-database) [[ $# -ge 2 ]] || usage; PRODUCTION_DATABASE="$2"; shift 2 ;;
    --candidate) [[ $# -ge 2 ]] || usage; CANDIDATE_DATABASE="$2"; shift 2 ;;
    --rollback-database) [[ $# -ge 2 ]] || usage; ROLLBACK_DATABASE="$2"; shift 2 ;;
    --maintenance-database) [[ $# -ge 2 ]] || usage; MAINTENANCE_DATABASE="$2"; shift 2 ;;
    --required-free-bytes) [[ $# -ge 2 ]] || usage; REQUIRED_FREE_BYTES="$2"; shift 2 ;;
    --schema-hook) [[ $# -ge 2 ]] || usage; SCHEMA_HOOK="$2"; shift 2 ;;
    --data-hook) [[ $# -ge 2 ]] || usage; DATA_HOOK="$2"; shift 2 ;;
    --migration-hook) [[ $# -ge 2 ]] || usage; MIGRATION_HOOK="$2"; shift 2 ;;
    --execute-restore-candidate) [[ "$ACTION" == "PLAN" ]] || usage; ACTION="RESTORE_CANDIDATE"; shift ;;
    --execute-swap) [[ "$ACTION" == "PLAN" ]] || usage; ACTION="SWAP"; shift ;;
    --execute-reverse) [[ "$ACTION" == "PLAN" ]] || usage; ACTION="REVERSE_SWAP"; shift ;;
    --approval-file) [[ $# -ge 2 ]] || usage; APPROVAL_FILE="$2"; shift 2 ;;
    --confirm) [[ $# -ge 2 ]] || usage; CONFIRMATION="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -f "$DUMP_FILE" && ! -L "$DUMP_FILE" && -r "$DUMP_FILE" && -s "$DUMP_FILE" ]] || fail "Dump must be a readable non-symlink regular file"
[[ -f "$CHECKSUM_FILE" && ! -L "$CHECKSUM_FILE" && -r "$CHECKSUM_FILE" && -s "$CHECKSUM_FILE" ]] || fail "Checksum must be a readable non-symlink regular file"
[[ -f "$TOC_FILE" && ! -L "$TOC_FILE" && -r "$TOC_FILE" && -s "$TOC_FILE" ]] || fail "TOC must be a readable non-symlink regular file"
[[ "$POSTGRES_CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || fail "Unsafe PostgreSQL container name"
[[ "$EXPECTED_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] || fail "Expected container ID must be 64 lowercase hex characters"
[[ "$PRODUCTION_DATABASE" == "buildingos_db" ]] || fail "Production database must be exactly buildingos_db"
[[ "$CANDIDATE_DATABASE" =~ ^buildingos_prod00r_[a-z0-9_]{1,43}$ ]] || fail "Unsafe candidate database name"
[[ "$ROLLBACK_DATABASE" =~ ^buildingos_pre_restore_[a-z0-9_]{1,39}$ ]] || fail "Unsafe rollback database name"
[[ "$MAINTENANCE_DATABASE" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || fail "Unsafe maintenance database name"
validate_hook "$SCHEMA_HOOK" "Schema"
validate_hook "$DATA_HOOK" "Data"
validate_hook "$MIGRATION_HOOK" "Migration"
command -v docker >/dev/null 2>&1 || fail "docker is required"
[[ -f "$RESTORE_SCRIPT" && ! -L "$RESTORE_SCRIPT" ]] || fail "restore-postgres-custom.sh is unavailable or invalid"

checksum_line="$(cat "$CHECKSUM_FILE")"
[[ "$(wc -l < "$CHECKSUM_FILE")" -eq 1 && -z "$(tail -c 1 "$CHECKSUM_FILE")" ]] || fail "Checksum file must contain exactly one newline-terminated row"
[[ "$checksum_line" =~ ^([0-9a-f]{64})[[:space:]]+[*]?([^[:space:]]+)$ ]] || fail "Checksum file must contain exactly SHA-256 and dump basename"
EXPECTED_DUMP_SHA256="${BASH_REMATCH[1]}"
CHECKSUM_DUMP_NAME="${BASH_REMATCH[2]}"
[[ "$CHECKSUM_DUMP_NAME" == "$(basename "$DUMP_FILE")" ]] || fail "Checksum filename does not match the exact dump"
DUMP_SHA256="$(sha256_file "$DUMP_FILE")"
[[ "$DUMP_SHA256" == "$EXPECTED_DUMP_SHA256" ]] || fail "Checksum verification failed"
CHECKSUM_SHA256="$(sha256_file "$CHECKSUM_FILE")"
RESTORE_SCRIPT_SHA256="$(sha256_file "$RESTORE_SCRIPT")"

TEMP_DIR="$(mktemp -d /tmp/buildingos-recovery.XXXXXX)"
trap 'rm -rf "$TEMP_DIR"' EXIT
ACTUAL_CONTAINER_ID="$(docker inspect --format '{{.Id}}' "$POSTGRES_CONTAINER" 2>/dev/null)" || fail "PostgreSQL container is unavailable"
[[ "$ACTUAL_CONTAINER_ID" == "$EXPECTED_CONTAINER_ID" ]] || fail "PostgreSQL container identity does not match"
docker exec -i "$ACTUAL_CONTAINER_ID" pg_restore --list < "$DUMP_FILE" > "$TEMP_DIR/actual.toc" \
  || fail "The dump is not a valid PostgreSQL custom archive for the target container"
cmp -s "$TEMP_DIR/actual.toc" "$TOC_FILE" || fail "TOC does not exactly match the approved dump TOC"
TOC_SHA256="$(sha256_file "$TOC_FILE")"

DUMP_SIZE_BYTES="$(file_size_bytes "$DUMP_FILE")"
[[ "$DUMP_SIZE_BYTES" =~ ^[1-9][0-9]*$ ]] || fail "Invalid dump size"
if [[ -z "$REQUIRED_FREE_BYTES" ]]; then
  REQUIRED_FREE_BYTES=$((DUMP_SIZE_BYTES * 3))
fi
[[ "$REQUIRED_FREE_BYTES" =~ ^[1-9][0-9]*$ ]] || fail "Required free bytes must be a positive integer"
(( REQUIRED_FREE_BYTES >= DUMP_SIZE_BYTES )) || fail "Required free space cannot be smaller than the dump"
FREE_KIB="$(docker exec "$ACTUAL_CONTAINER_ID" sh -lc 'df -Pk "${PGDATA:-/var/lib/postgresql/data}" | tail -1' | awk '{print $4}')" || fail "Unable to inspect PostgreSQL free space"
[[ "$FREE_KIB" =~ ^[0-9]+$ ]] || fail "Unable to parse PostgreSQL free space"
FREE_BYTES=$((FREE_KIB * 1024))
(( FREE_BYTES >= REQUIRED_FREE_BYTES )) || fail "Insufficient PostgreSQL free space"

SCHEMA_HOOK_SHA256="$(sha256_file "$SCHEMA_HOOK")"
DATA_HOOK_SHA256="$(sha256_file "$DATA_HOOK")"
MIGRATION_HOOK_SHA256="$(sha256_file "$MIGRATION_HOOK")"
SESSIONS="$(active_session_count)" || fail "Unable to inspect database sessions"
[[ "$SESSIONS" =~ ^[0-9]+$ ]] || fail "Unable to parse active session count"

printf 'Recovery inspection passed (no mutation):\n'
printf '  dump_sha256=%s\n  toc_sha256=%s\n  container_id=%s\n' "$DUMP_SHA256" "$TOC_SHA256" "$ACTUAL_CONTAINER_ID"
printf '  free_bytes=%s\n  required_free_bytes=%s\n  active_sessions=%s\n' "$FREE_BYTES" "$REQUIRED_FREE_BYTES" "$SESSIONS"

if [[ "$ACTION" == "PLAN" ]]; then
  print_approval_template RESTORE_CANDIDATE
  print_approval_template SWAP
  print_approval_template REVERSE_SWAP
  printf '\nPLAN COMPLETE: no database was created, restored, renamed, or dropped.\n'
  exit 0
fi

validate_approval
[[ "$SESSIONS" == "0" ]] || fail "Maintenance/quiescence gate failed: active database sessions remain"
pin_recovery_inputs
[[ "$(active_session_count)" == "0" ]] || fail "Database sessions changed at the mutation boundary"

case "$ACTION" in
  RESTORE_CANDIDATE)
    database_exists "$PRODUCTION_DATABASE" || fail "Production database does not exist"
    ! database_exists "$CANDIDATE_DATABASE" || fail "Candidate database already exists"
    ! database_exists "$ROLLBACK_DATABASE" || fail "Rollback database already exists"
    POSTGRES_CONTAINER="$ACTUAL_CONTAINER_ID" MAINTENANCE_DATABASE="$MAINTENANCE_DATABASE" \
      bash "$TEMP_DIR/pinned/restore-postgres-custom.sh" "$PINNED_DUMP_FILE" "$CANDIDATE_DATABASE" --checksum "$PINNED_CHECKSUM_FILE"
    run_validation_hooks
    printf 'Candidate restored and validation hooks passed. Production remains unchanged.\n'
    ;;
  SWAP)
    database_exists "$PRODUCTION_DATABASE" || fail "Production database does not exist"
    database_exists "$CANDIDATE_DATABASE" || fail "Candidate database does not exist"
    ! database_exists "$ROLLBACK_DATABASE" || fail "Rollback database already exists"
    run_validation_hooks
    execute_swap
    printf 'Database names swapped. Keep maintenance active and execute the runbook health checklist.\n'
    ;;
  REVERSE_SWAP)
    database_exists "$PRODUCTION_DATABASE" || fail "Current production database does not exist"
    ! database_exists "$CANDIDATE_DATABASE" || fail "Candidate name must be free before reverse"
    database_exists "$ROLLBACK_DATABASE" || fail "Rollback database does not exist"
    execute_reverse
    printf 'Database names reversed. The restored candidate is retained with connections disabled.\n'
    ;;
  *) fail "Unsupported action" ;;
esac
