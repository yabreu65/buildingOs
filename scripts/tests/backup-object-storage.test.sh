#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly SCRIPT="$ROOT_DIR/scripts/backup-object-storage.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-object-backup-test.XXXXXX")"
readonly BIN_DIR="$TEST_ROOT/bin"
readonly RECEIPT="$TEST_ROOT/object-backup-receipt.json"
readonly LOG_FILE="$TEST_ROOT/rclone.log"
readonly OUTPUT_FILE="$TEST_ROOT/output"
trap 'rm -rf "$TEST_ROOT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok %s - %s\n' "$FAIL_COUNT" "$1" >&2; }

assert_success() {
  local name="$1"
  shift
  if "$@" > "$OUTPUT_FILE" 2>&1; then pass "$name"; else fail_test "$name"; cat "$OUTPUT_FILE" >&2; fi
}

assert_failure() {
  local name="$1"
  shift
  if "$@" > "$OUTPUT_FILE" 2>&1; then fail_test "$name (unexpected success)"; else pass "$name"; fi
}

assert_contains() {
  local name="$1"
  local value="$2"
  local file="$3"
  if grep -Fq -- "$value" "$file"; then pass "$name"; else fail_test "$name"; fi
}

assert_absent() {
  local name="$1"
  local value="$2"
  local file="$3"
  if grep -Fq -- "$value" "$file"; then fail_test "$name"; else pass "$name"; fi
}

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/rclone" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$RCLONE_LOG"
case "${1:-}" in
  copy)
    [[ "${2:-}" == "$EXPECTED_SOURCE" && "${3:-}" == "$EXPECTED_DESTINATION" ]] || exit 10
    [[ "${RCLONE_COPY_RESULT:-PASS}" == PASS ]] || exit 11
    ;;
  check)
    [[ "${2:-}" == --one-way ]] || exit 12
    [[ "${3:-}" == "$EXPECTED_SOURCE" && "${4:-}" == "$EXPECTED_DESTINATION" ]] || exit 13
    [[ "${RCLONE_CHECK_RESULT:-PASS}" == PASS ]] || exit 14
    ;;
  *)
    exit 15
    ;;
esac
MOCK
chmod +x "$BIN_DIR/rclone"

run_case() {
  local source="${1-source:buildingos-production}"
  local destination="${2-backup:buildingos-production}"
  local copy_result="${3-PASS}"
  local check_result="${4-PASS}"
  EXPECTED_SOURCE="$source" EXPECTED_DESTINATION="$destination" \
    RCLONE_LOG="$LOG_FILE" RCLONE_COPY_RESULT="$copy_result" RCLONE_CHECK_RESULT="$check_result" \
    OBJECT_BACKUP_SOURCE="$source" OBJECT_BACKUP_DESTINATION="$destination" OBJECT_BACKUP_RECEIPT="$RECEIPT" \
    RCLONE_CONFIG="$TEST_ROOT/rclone-config-with-credential-sentinel" PATH="$BIN_DIR:/usr/bin:/bin" \
    "$SCRIPT"
}

assert_success 'valid copy and verification pass' run_case
assert_contains 'copy is invoked' 'copy source:buildingos-production backup:buildingos-production' "$LOG_FILE"
assert_contains 'check uses one-way verification' 'check --one-way source:buildingos-production backup:buildingos-production' "$LOG_FILE"
assert_contains 'PASS receipt is written' '"status":"PASS"' "$RECEIPT"
assert_contains 'recovery point remains unevaluated' '"recovery_point_valid":"NOT_EVALUATED"' "$RECEIPT"
assert_absent 'credentials are absent from evidence' 'credential-sentinel' "$RECEIPT"

rm -f "$RECEIPT"
assert_failure 'missing source fails closed' run_case '' 'backup:buildingos-production'
[[ ! -e "$RECEIPT" ]] && pass 'missing source leaves no PASS receipt' || fail_test 'missing source leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'missing destination fails closed' run_case 'source:buildingos-production' ''
[[ ! -e "$RECEIPT" ]] && pass 'missing destination leaves no PASS receipt' || fail_test 'missing destination leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'identical source and destination fail closed' run_case 'same:location' 'same:location'
[[ ! -e "$RECEIPT" ]] && pass 'identical locations leave no PASS receipt' || fail_test 'identical locations leave no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'root destination fails closed' run_case 'source:buildingos-production' '/'
[[ ! -e "$RECEIPT" ]] && pass 'root destination leaves no PASS receipt' || fail_test 'root destination leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'copy failure fails backup' run_case 'source:buildingos-production' 'backup:buildingos-production' FAIL PASS
[[ ! -e "$RECEIPT" ]] && pass 'copy failure leaves no PASS receipt' || fail_test 'copy failure leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'verification failure fails backup' run_case 'source:buildingos-production' 'backup:buildingos-production' PASS FAIL
[[ ! -e "$RECEIPT" ]] && pass 'verification failure leaves no PASS receipt' || fail_test 'verification failure leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'unavailable rclone fails closed' env OBJECT_BACKUP_SOURCE='source:buildingos-production' OBJECT_BACKUP_DESTINATION='backup:buildingos-production' OBJECT_BACKUP_RECEIPT="$RECEIPT" PATH="$TEST_ROOT/no-rclone:/usr/bin:/bin" "$SCRIPT"
[[ ! -e "$RECEIPT" ]] && pass 'unavailable rclone leaves no PASS receipt' || fail_test 'unavailable rclone leaves no PASS receipt'

assert_absent 'script never invokes sync' 'rclone sync' "$SCRIPT"
assert_absent 'script never invokes move' 'rclone move' "$SCRIPT"
assert_absent 'script never invokes delete' 'rclone delete' "$SCRIPT"
assert_absent 'script never invokes purge' 'rclone purge' "$SCRIPT"
assert_absent 'script never uses delete-before' '--delete-before' "$SCRIPT"
assert_absent 'script never uses delete-after' '--delete-after' "$SCRIPT"

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s failed, %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
