#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly PREPARE_SCRIPT="$ROOT_DIR/scripts/prepare-production-postgres-recovery.sh"
readonly REHEARSE_SCRIPT="$ROOT_DIR/scripts/rehearse-postgres-custom-recovery.sh"
readonly CONTAINER_ID='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-recovery-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

record_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'ok %s - %s\n' "$PASS_COUNT" "$1"
}

record_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf 'not ok - %s\n' "$1" >&2
}

assert_success() {
  local name="$1"
  shift
  if "$@" > "$TEST_ROOT/output" 2>&1; then
    record_pass "$name"
  else
    record_fail "$name"
    printf '%s\n' "$(cat "$TEST_ROOT/output")" >&2
  fi
}

assert_failure() {
  local name="$1"
  shift
  if "$@" > "$TEST_ROOT/output" 2>&1; then
    record_fail "$name (unexpected success)"
  else
    record_pass "$name"
  fi
}

assert_no_mutation() {
  local name="$1"
  local line
  if [[ ! -f "$MOCK_LOG" ]]; then
    record_pass "$name"
    return
  fi
  while IFS= read -r line; do
    case "$line" in
      *createdb*|*dropdb*|*"ALTER DATABASE"*|*"pg_restore --exit-on-error"*)
        record_fail "$name (mutation observed: $line)"
        return
        ;;
    esac
  done < "$MOCK_LOG"
  record_pass "$name"
}

mkdir -p "$TEST_ROOT/bin"
MOCK_LOG="$TEST_ROOT/mock.log"
export MOCK_LOG CONTAINER_ID

cat > "$TEST_ROOT/bin/pg_restore" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == *"--list"* ]]; then
  printf '%s\n' '; mock PostgreSQL custom archive TOC' '1; 0 0 TABLE public Tenant owner'
fi
exit 0
MOCK

cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$MOCK_LOG"
if [[ "$1" == "inspect" && "$2" == "--format" ]]; then
  case "$3" in
    *'.Id'*) printf '%s\n' "$CONTAINER_ID" ;;
    *'com.buildingos.recovery.environment'*) printf '%s\n' 'rehearsal' ;;
  esac
  exit 0
fi
if [[ "$1" == "inspect" ]]; then
  exit 0
fi
if [[ "$1" == "exec" ]]; then
  case "$*" in
    *"pg_restore --list"*)
      printf '%s\n' '; mock PostgreSQL custom archive TOC' '1; 0 0 TABLE public Tenant owner'
      ;;
    *"df -Pk"*)
      printf '%s\n' '/dev/mock 1000000 1 999999 1% /var/lib/postgresql/data'
      ;;
    *"information_schema.tables"*) printf '%s\n' '5' ;;
    *"pg_stat_activity"*) printf '%s\n' '0' ;;
    *"SELECT 1 FROM pg_database"*) : ;;
    *"pg_database"*"buildingos_db"*) printf '%s\n' '1' ;;
    *"pg_database"*) printf '%s\n' '0' ;;
    *"SELECT 1"*) printf '%s\n' '1' ;;
  esac
  exit 0
fi
exit 1
MOCK

chmod +x "$TEST_ROOT/bin/pg_restore" "$TEST_ROOT/bin/docker"
export PATH="$TEST_ROOT/bin:$PATH"

DUMP_FILE="$TEST_ROOT/exact.dump"
CHECKSUM_FILE="$DUMP_FILE.sha256"
TOC_FILE="$TEST_ROOT/exact.toc"
printf '%s\n' 'PGDMP mock custom archive' > "$DUMP_FILE"
printf '%s  %s\n' "$(sha256_file "$DUMP_FILE")" "$(basename "$DUMP_FILE")" > "$CHECKSUM_FILE"
pg_restore --list "$DUMP_FILE" > "$TOC_FILE"

for hook in schema data migration; do
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$TEST_ROOT/$hook-hook"
  chmod +x "$TEST_ROOT/$hook-hook"
done

common_prepare_args=(
  --dump "$DUMP_FILE"
  --checksum "$CHECKSUM_FILE"
  --toc "$TOC_FILE"
  --container production-postgres
  --expected-container-id "$CONTAINER_ID"
  --candidate buildingos_prod00r_incident_42
  --rollback-database buildingos_pre_restore_incident_42
  --schema-hook "$TEST_ROOT/schema-hook"
  --data-hook "$TEST_ROOT/data-hook"
  --migration-hook "$TEST_ROOT/migration-hook"
)

: > "$MOCK_LOG"
assert_success "valid custom dump produces a read-only production plan" bash "$PREPARE_SCRIPT" "${common_prepare_args[@]}"
assert_no_mutation "default production plan performs no mutation"
cp "$TEST_ROOT/output" "$TEST_ROOT/plan-output"
awk '
  /^Approval boundary: RESTORE_CANDIDATE$/ { capture = 1; next }
  capture && /^$/ { exit }
  capture { print }
' "$TEST_ROOT/plan-output" > "$TEST_ROOT/restore-candidate.approval"
chmod 600 "$TEST_ROOT/restore-candidate.approval"
: > "$MOCK_LOG"
assert_success "exact external approval executes only pinned recovery inputs" \
  bash "$PREPARE_SCRIPT" "${common_prepare_args[@]}" \
    --execute-restore-candidate \
    --approval-file "$TEST_ROOT/restore-candidate.approval" \
    --confirm 'APPROVE DATABASE RESTORE'

cp "$CHECKSUM_FILE" "$TEST_ROOT/bad.sha256"
printf '%064d  %s\n' 0 "$(basename "$DUMP_FILE")" > "$TEST_ROOT/bad.sha256"
assert_failure "bad checksum fails closed" bash "$PREPARE_SCRIPT" "${common_prepare_args[@]}" --checksum "$TEST_ROOT/bad.sha256"

ln -s "$DUMP_FILE" "$TEST_ROOT/symlink.dump"
assert_failure "symlink dump evidence fails closed" bash "$PREPARE_SCRIPT" "${common_prepare_args[@]}" --dump "$TEST_ROOT/symlink.dump"

printf '%s\n' 'different TOC' > "$TEST_ROOT/bad.toc"
assert_failure "invalid TOC fails closed" bash "$PREPARE_SCRIPT" "${common_prepare_args[@]}" --toc "$TEST_ROOT/bad.toc"

assert_failure "unsafe production target is rejected" bash "$PREPARE_SCRIPT" "${common_prepare_args[@]}" --production-database another_database

assert_failure "unsafe container name is rejected" bash "$PREPARE_SCRIPT" "${common_prepare_args[@]}" --container '../production'

: > "$MOCK_LOG"
assert_failure "production candidate restore without approval is rejected" bash "$PREPARE_SCRIPT" "${common_prepare_args[@]}" --execute-restore-candidate --confirm 'APPROVE DATABASE RESTORE'
assert_no_mutation "missing production approval blocks mutation"

: > "$MOCK_LOG"
assert_failure "production swap without approval is rejected" bash "$PREPARE_SCRIPT" "${common_prepare_args[@]}" --execute-swap --confirm 'APPROVE DATABASE RESTORE'
assert_no_mutation "missing swap approval blocks mutation"

: > "$MOCK_LOG"
assert_success "isolated labeled rehearsal restores and simulates swap/reverse" \
  bash "$REHEARSE_SCRIPT" \
    --dump "$DUMP_FILE" --checksum "$CHECKSUM_FILE" --toc "$TOC_FILE" \
    --container recovery-rehearsal --expected-container-id "$CONTAINER_ID" \
    --test-id incident42 \
    --schema-hook "$TEST_ROOT/schema-hook" \
    --data-hook "$TEST_ROOT/data-hook" \
    --migration-hook "$TEST_ROOT/migration-hook" \
    --confirm 'NON-PRODUCTION REHEARSAL'

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s test(s) failed; %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
