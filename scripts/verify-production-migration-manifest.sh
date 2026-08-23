#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly REPO_ROOT
readonly MANIFEST_FILE="${MANIFEST_FILE:-$SCRIPT_DIR/manifests/production-migrations-81-to-97.tsv}"
readonly METADATA_EXCEPTION_FILE="${METADATA_EXCEPTION_FILE:-$SCRIPT_DIR/manifests/production-migration-metadata-exceptions.tsv}"
readonly MIGRATIONS_DIR="${MIGRATIONS_DIR:-$REPO_ROOT/apps/api/prisma/migrations}"
readonly POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-pawtech-postgres}"
readonly DATABASE_NAME="${DATABASE_NAME:-buildingos_db}"
readonly TEST_MODE="${TEST_MODE:-0}"
readonly MIGRATION_STATE_FILE="${MIGRATION_STATE_FILE:-}"
readonly MANIFEST_VERSION=1
readonly BASELINE_APPLIED=81
readonly BASELINE_FAILED=0
readonly TARGET_APPLIED=97
readonly TARGET_FAILED=0
readonly EXPECTED_PENDING=16
readonly TAB=$'\t'
readonly METADATA_EXCEPTION_VERSION=1

MODE="${1:-}"
PHASE="${2:-none}"
TMP_DIR=''
LOCAL_NAMES=()
STATE_NAMES=()
STATE_CHECKSUMS=()
HISTORICAL_EXCEPTION_NAME=''
HISTORICAL_EXCEPTION_CHECKSUM=''

EXPECTED_NAMES=(
  '20260805000000_add_receipt_generated_to_payment_audit_action'
  '20260807000000_add_recurring_expense_tenant_shared'
  '20260809000000_add_multicurrency_foundation'
  '20260810000000_add_expense_multicurrency_snapshot'
  '20260810010000_add_income_multicurrency_snapshot'
  '20260810020000_add_adjustment_multicurrency_snapshot'
  '20260810030000_add_liquidation_functional_valuation'
  '20260811000000_add_payment_multicurrency_snapshot'
  '20260812000000_add_payment_allocation_original_share'
  '20260814000000_add_funds_ledger'
  '20260815000000_add_income_applications'
  '20260816000000_add_income_policies'
  '20260816000001_income_policy_createdby_setnull'
  '20260816000002_income_offsets_to_liquidations'
  '20260816000003_liquidation_income_offset_invariants'
  '20260816000004_legacy_income_application_provenance'
)

EXPECTED_CHECKSUMS=(
  '2eca33fa948a8374c8e9df65b1ad03396b6e60618c2908eb76500ce24f314281'
  '73c11f3ae0bc2946b0292b6a7e19415922c215a0099725ccffad7dfd5792b7e5'
  '72387a00d29fc206601f175d09e858c8ef977b040f5b0b7828d2d6ba553580d8'
  '9fabbda282282973458afde3f7c827882423e242b8a0ae4fa7fec41cb23f61d8'
  '272cb4d1a2f574b97eb119c2085969680acebe97dfb3b5b64ed7c21df5253598'
  '01389a6aaa6b28913dc47929b32ea93036bd113d228dff44600910dae4c6cd64'
  'a5ac79fe256dc8efd47b283c79d5326ed48098a6706432b26f8e593eab7785b7'
  '13db688679ee726a37a3380dc3375e2ee55f0bbc516bfc440c47c9fe72b4227e'
  '857e76ba79b6ce52adba7e07bbda723a33ab0db76cfb55f3de177a1892f65832'
  'beadcf1d433740e224b64e6a7bcbc0d985bb8fbe92a7e43f15b3f2ad271419c9'
  'b73832c8cb8715ebc895270c26913f9a0e7c28cc55efd1e7b66810d11a608d08'
  '0b291960b38677ad95a70608f998865d8819378a26cf3ba989ae9ec13a63a345'
  '668bddb7cb548119979a72a22df26b3e1aca656a4b1fb07d419ecd5e526d2fc3'
  'c18ed0093da20da89e3e627ca1457349f1d36da93c1e11f914f4b8ace4aa654f'
  '4ff212a16eda9e32db64b28b8eb56f29a2ee5ccb5fbb034af56a7b7cad8fc6d9'
  'f77a48381a9d32198b34f3ed92465190f8f6284ec80cc4916c304ec776905a2b'
)

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT

fail() {
  local code="$1"
  printf 'status=error\tmode=%s\tphase=%s\tcode=%s\n' "$MODE" "$PHASE" "$code" >&2
  exit 1
}

sha256_file() {
  local file="$1"
  local output

  if command -v sha256sum >/dev/null 2>&1; then
    output="$(sha256sum "$file")" || fail 'checksum_command_failed'
    printf '%s\n' "${output%% *}"
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    output="$(shasum -a 256 "$file")" || fail 'checksum_command_failed'
    printf '%s\n' "${output%% *}"
    return
  fi

  if command -v openssl >/dev/null 2>&1; then
    output="$(openssl dgst -sha256 "$file")" || fail 'checksum_command_failed'
    printf '%s\n' "${output##* }"
    return
  fi

  fail 'checksum_command_unavailable'
}

validate_manifest() {
  local line
  local line_number=0
  local migration_index
  local expected_line

  [[ -f "$MANIFEST_FILE" && ! -L "$MANIFEST_FILE" ]] || fail 'manifest_not_regular_file'
  [[ -s "$MANIFEST_FILE" ]] || fail 'manifest_empty'
  [[ -z "$(tail -c 1 "$MANIFEST_FILE")" ]] || fail 'manifest_missing_final_newline'

  while IFS= read -r line; do
    line_number=$((line_number + 1))
    case "$line_number" in
      1)
        [[ "$line" == "manifest_version${TAB}${MANIFEST_VERSION}" ]] || fail 'manifest_version_mismatch'
        ;;
      2)
        [[ "$line" == "baseline${TAB}${BASELINE_APPLIED}${TAB}${BASELINE_FAILED}" ]] || fail 'manifest_baseline_mismatch'
        ;;
      3)
        [[ "$line" == "target${TAB}${TARGET_APPLIED}${TAB}${TARGET_FAILED}" ]] || fail 'manifest_target_mismatch'
        ;;
      *)
        migration_index=$((line_number - 4))
        (( migration_index < EXPECTED_PENDING )) || fail 'manifest_extra_row'
        expected_line="migration${TAB}${EXPECTED_NAMES[$migration_index]}${TAB}${EXPECTED_CHECKSUMS[$migration_index]}"
        [[ "$line" == "$expected_line" ]] || fail 'manifest_migration_mismatch'
        ;;
    esac
  done < "$MANIFEST_FILE"

  [[ "$line_number" -eq $((EXPECTED_PENDING + 3)) ]] || fail 'manifest_row_count_mismatch'
}

validate_metadata_exception_manifest() {
  local line
  local line_number=0
  local exception_kind
  local exception_name
  local exception_checksum

  [[ -f "$METADATA_EXCEPTION_FILE" && ! -L "$METADATA_EXCEPTION_FILE" ]] || fail 'metadata_exception_manifest_not_regular_file'
  [[ -s "$METADATA_EXCEPTION_FILE" ]] || fail 'metadata_exception_manifest_empty'
  [[ -z "$(tail -c 1 "$METADATA_EXCEPTION_FILE")" ]] || fail 'metadata_exception_manifest_missing_final_newline'

  while IFS= read -r line; do
    line_number=$((line_number + 1))
    case "$line_number" in
      1)
        [[ "$line" == "manifest_version${TAB}${METADATA_EXCEPTION_VERSION}" ]] || fail 'metadata_exception_manifest_version_mismatch'
        ;;
      2)
        IFS="$TAB" read -r exception_kind exception_name exception_checksum <<< "$line"
        [[ "$exception_kind" == 'exception' ]] || fail 'metadata_exception_manifest_kind_mismatch'
        [[ "$exception_name" == '20260719000000_add_receipt_sequence' ]] || fail 'metadata_exception_manifest_name_mismatch'
        [[ "$exception_checksum" == '93c6d2c0b8c4468fea26489cfb4875bfdc6763ec0056487c21094eae0dbcb257' ]] || fail 'metadata_exception_manifest_checksum_mismatch'
        HISTORICAL_EXCEPTION_NAME="$exception_name"
        HISTORICAL_EXCEPTION_CHECKSUM="$exception_checksum"
        ;;
      *)
        fail 'metadata_exception_manifest_extra_row'
        ;;
    esac
  done < "$METADATA_EXCEPTION_FILE"

  [[ "$line_number" -eq 2 && -n "$HISTORICAL_EXCEPTION_NAME" && -n "$HISTORICAL_EXCEPTION_CHECKSUM" ]] \
    || fail 'metadata_exception_manifest_row_count_mismatch'
}

validate_local_migrations() {
  local paths=()
  local path
  local name
  local sql_file
  local migration_index
  local pending_index
  local actual_checksum

  [[ -d "$MIGRATIONS_DIR" && ! -L "$MIGRATIONS_DIR" ]] || fail 'migrations_directory_invalid'

  shopt -s nullglob
  paths=("$MIGRATIONS_DIR"/*)
  shopt -u nullglob

  for path in "${paths[@]}"; do
    [[ -d "$path" ]] || continue
    [[ ! -L "$path" ]] || fail 'migration_directory_symlink'
    name="${path##*/}"
    [[ "$name" =~ ^[0-9]{8,14}_[a-z0-9_]+$ ]] || fail 'migration_name_invalid'
    sql_file="$path/migration.sql"
    [[ -f "$sql_file" && ! -L "$sql_file" ]] || fail 'migration_sql_invalid'
    LOCAL_NAMES[${#LOCAL_NAMES[@]}]="$name"
  done

  [[ "${#LOCAL_NAMES[@]}" -eq "$TARGET_APPLIED" ]] || fail 'local_migration_count_mismatch'

  migration_index="$BASELINE_APPLIED"
  while (( migration_index < TARGET_APPLIED )); do
    pending_index=$((migration_index - BASELINE_APPLIED))
    [[ "${LOCAL_NAMES[$migration_index]}" == "${EXPECTED_NAMES[$pending_index]}" ]] || fail 'local_pending_name_mismatch'
    actual_checksum="$(sha256_file "$MIGRATIONS_DIR/${LOCAL_NAMES[$migration_index]}/migration.sql")"
    [[ "$actual_checksum" == "${EXPECTED_CHECKSUMS[$pending_index]}" ]] || fail 'local_pending_checksum_mismatch'
    migration_index=$((migration_index + 1))
  done
}

contains_state_name() {
  local expected_name="$1"
  local state_name

  for state_name in "${STATE_NAMES[@]}"; do
    if [[ "$state_name" == "$expected_name" ]]; then
      return 0
    fi
  done
  return 1
}

local_name_index() {
  local candidate="$1"
  local index=0

  while (( index < TARGET_APPLIED )); do
    if [[ "${LOCAL_NAMES[$index]}" == "$candidate" ]]; then
      printf '%s\n' "$index"
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}

read_database_state() {
  local destination="$1"

  if [[ "$TEST_MODE" == '1' ]]; then
    [[ -n "$MIGRATION_STATE_FILE" ]] || fail 'test_fixture_required'
    [[ -f "$MIGRATION_STATE_FILE" && ! -L "$MIGRATION_STATE_FILE" ]] || fail 'test_fixture_invalid'
    cp "$MIGRATION_STATE_FILE" "$destination"
    return
  fi

  [[ "$TEST_MODE" == '0' ]] || fail 'test_mode_invalid'
  [[ -z "$MIGRATION_STATE_FILE" ]] || fail 'test_fixture_forbidden'
  [[ "$DATABASE_NAME" =~ ^[a-z0-9_]+$ ]] || fail 'database_name_unsafe'
  [[ "$POSTGRES_CONTAINER" =~ ^[A-Za-z0-9_.-]+$ ]] || fail 'container_name_unsafe'
  command -v docker >/dev/null 2>&1 || fail 'docker_unavailable'
  docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || fail 'postgres_container_unavailable'

  if ! docker exec -i "$POSTGRES_CONTAINER" sh -lc \
    'exec psql -v ON_ERROR_STOP=1 -qAt -F "$(printf "\t")" -U "$POSTGRES_USER" -d "$1"' sh "$DATABASE_NAME" > "$destination" <<'SQL'
BEGIN READ ONLY;
SELECT migration_name,
       checksum,
       CASE WHEN finished_at IS NULL THEN 'failed' ELSE 'finished' END,
       CASE WHEN rolled_back_at IS NULL THEN 'active' ELSE 'rolled_back' END,
       applied_steps_count::text
FROM "_prisma_migrations"
ORDER BY migration_name;
COMMIT;
SQL
  then
    fail 'database_query_failed'
  fi
}

validate_database_state() {
  local state_file="$1"
  local state_row_pattern
  local line
  local name
  local checksum
  local finish_state
  local rollback_state
  local applied_steps
  local index
  local pending_index
  local expected_limit
  local expected_index=0
  local state_name
  local duplicate_name

  [[ -s "$state_file" ]] || fail 'database_state_empty'
  validate_metadata_exception_manifest
  [[ -z "$(tail -c 1 "$state_file")" ]] || fail 'database_state_missing_final_newline'
  state_row_pattern="^([^[:space:]]+)${TAB}([0-9a-f]{64}|manual_insert)${TAB}(finished|failed)${TAB}(active|rolled_back)${TAB}([0-9]+)$"

  while IFS= read -r line; do
    [[ "$line" =~ $state_row_pattern ]] || fail 'database_state_row_invalid'
    name="${BASH_REMATCH[1]}"
    checksum="${BASH_REMATCH[2]}"
    finish_state="${BASH_REMATCH[3]}"
    rollback_state="${BASH_REMATCH[4]}"
    applied_steps="${BASH_REMATCH[5]}"

    if (( ${#STATE_NAMES[@]} > 0 )); then
      for duplicate_name in "${STATE_NAMES[@]}"; do
        [[ "$duplicate_name" != "$name" ]] || fail 'database_duplicate_row'
      done
    fi

    [[ "$finish_state" == 'finished' ]] || fail 'database_failed_row'
    [[ "$rollback_state" == 'active' ]] || fail 'database_rolled_back_row'
    if [[ "$applied_steps" != '1' ]]; then
      [[ "$name" == "$HISTORICAL_EXCEPTION_NAME" ]] || fail 'database_incomplete_row'
      [[ "$checksum" == "$HISTORICAL_EXCEPTION_CHECKSUM" ]] || fail 'database_metadata_exception_checksum_mismatch'
      [[ "$applied_steps" == '0' ]] || fail 'database_incomplete_row'
    fi

    STATE_NAMES[${#STATE_NAMES[@]}]="$name"
    STATE_CHECKSUMS[${#STATE_CHECKSUMS[@]}]="$checksum"
  done < "$state_file"

  if [[ "$PHASE" == 'pre' ]]; then
    expected_limit="$BASELINE_APPLIED"
  else
    expected_limit="$TARGET_APPLIED"
  fi

  while (( expected_index < expected_limit )); do
    contains_state_name "${LOCAL_NAMES[$expected_index]}" || fail 'database_missing_row'
    expected_index=$((expected_index + 1))
  done

  expected_index=0
  while (( expected_index < ${#STATE_NAMES[@]} )); do
    state_name="${STATE_NAMES[$expected_index]}"
    index="$(local_name_index "$state_name")" || fail 'database_extra_row'
    (( index < expected_limit )) || fail 'database_extra_row'
    if (( index >= BASELINE_APPLIED )); then
      pending_index=$((index - BASELINE_APPLIED))
      [[ "${STATE_CHECKSUMS[$expected_index]}" == "${EXPECTED_CHECKSUMS[$pending_index]}" ]] || fail 'database_pending_checksum_mismatch'
    fi
    expected_index=$((expected_index + 1))
  done

  [[ "${#STATE_NAMES[@]}" -eq "$expected_limit" ]] || fail 'database_count_mismatch'
}

case "$MODE" in
  verify-files)
    [[ "$#" -eq 1 ]] || fail 'usage'
    validate_manifest
    validate_metadata_exception_manifest
    validate_local_migrations
    printf 'status=ok\tmode=verify-files\tmanifest_version=%s\tlocal=%s\tbaseline=%s\ttarget=%s\tpending=%s\n' \
      "$MANIFEST_VERSION" "${#LOCAL_NAMES[@]}" "$BASELINE_APPLIED" "$TARGET_APPLIED" "$EXPECTED_PENDING"
    ;;
  verify-db)
    [[ "$#" -eq 2 ]] || fail 'usage'
    [[ "$PHASE" == 'pre' || "$PHASE" == 'post' ]] || fail 'phase_invalid'
    validate_manifest
    validate_local_migrations
    TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/production-migration-state.XXXXXX")"
    read_database_state "$TMP_DIR/state.tsv"
    validate_database_state "$TMP_DIR/state.tsv"
    if [[ "$PHASE" == 'pre' ]]; then
      printf 'status=ok\tmode=verify-db\tphase=pre\tmanifest_version=%s\tapplied=%s\tfailed=0\tpending=%s\ttarget=%s\n' \
        "$MANIFEST_VERSION" "$BASELINE_APPLIED" "$EXPECTED_PENDING" "$TARGET_APPLIED"
    else
      printf 'status=ok\tmode=verify-db\tphase=post\tmanifest_version=%s\tapplied=%s\tfailed=0\tpending=0\ttarget=%s\n' \
        "$MANIFEST_VERSION" "$TARGET_APPLIED" "$TARGET_APPLIED"
    fi
    ;;
  *)
    fail 'usage'
    ;;
esac
