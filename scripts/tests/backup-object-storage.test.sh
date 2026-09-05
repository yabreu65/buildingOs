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
readonly VALID_SOURCE='prod:buildingos-production'
readonly VALID_DESTINATION='backup:buildingos-production-backup'
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
  if [[ -e "$file" ]] && grep -Fq -- "$value" "$file"; then fail_test "$name"; else pass "$name"; fi
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
  local source="${1-$VALID_SOURCE}"
  local destination="${2-$VALID_DESTINATION}"
  local copy_result="${3-PASS}"
  local check_result="${4-PASS}"
  EXPECTED_SOURCE="$source" EXPECTED_DESTINATION="$destination" \
    RCLONE_LOG="$LOG_FILE" RCLONE_COPY_RESULT="$copy_result" RCLONE_CHECK_RESULT="$check_result" \
    OBJECT_BACKUP_SOURCE="$source" OBJECT_BACKUP_DESTINATION="$destination" OBJECT_BACKUP_RECEIPT="$RECEIPT" \
    RCLONE_CONFIG="$TEST_ROOT/rclone-config-with-credential-sentinel" PATH="$BIN_DIR:/usr/bin:/bin" \
    "$SCRIPT"
}

assert_success 'valid copy and verification pass' run_case
assert_contains 'copy is invoked' "copy $VALID_SOURCE $VALID_DESTINATION" "$LOG_FILE"
assert_contains 'check uses one-way verification' "check --one-way $VALID_SOURCE $VALID_DESTINATION" "$LOG_FILE"
assert_contains 'PASS receipt is written' '"status":"PASS"' "$RECEIPT"
assert_contains 'recovery point remains unevaluated' '"recovery_point_valid":"NOT_EVALUATED"' "$RECEIPT"
assert_absent 'credentials are absent from evidence' 'credential-sentinel' "$RECEIPT"

rm -f "$RECEIPT"
assert_failure 'missing source fails closed' run_case '' "$VALID_DESTINATION"
[[ ! -e "$RECEIPT" ]] && pass 'missing source leaves no PASS receipt' || fail_test 'missing source leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'missing destination fails closed' run_case "$VALID_SOURCE" ''
[[ ! -e "$RECEIPT" ]] && pass 'missing destination leaves no PASS receipt' || fail_test 'missing destination leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'same bucket name fails closed' run_case 'prod:buildingos-production' 'backup:buildingos-production'
[[ ! -e "$RECEIPT" ]] && pass 'same bucket name leaves no PASS receipt' || fail_test 'same bucket name leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'inline rclone connection string fails closed' run_case ':s3,access_key_id=FAKE_SECRET,secret_access_key=FAKE_SECRET:bucket' "$VALID_DESTINATION"
assert_absent 'rejected inline secret is absent from receipt' 'FAKE_SECRET' "$RECEIPT"
[[ ! -e "$RECEIPT" ]] && pass 'inline connection string leaves no PASS receipt' || fail_test 'inline connection string leaves no PASS receipt'

rm -f "$RECEIPT" "$LOG_FILE"
assert_failure 'remote root fails closed' run_case 'remote:' "$VALID_DESTINATION"
[[ ! -e "$RECEIPT" ]] && pass 'remote root leaves no PASS receipt' || fail_test 'remote root leaves no PASS receipt'

rm -f "$RECEIPT" "$LOG_FILE"
assert_failure 'remote slash root fails closed' run_case 'remote:/' "$VALID_DESTINATION"
[[ ! -e "$RECEIPT" ]] && pass 'remote slash root leaves no PASS receipt' || fail_test 'remote slash root leaves no PASS receipt'

rm -f "$RECEIPT" "$LOG_FILE"
assert_failure 'absolute local root fails closed' run_case '/' "$VALID_DESTINATION"
[[ ! -e "$RECEIPT" ]] && pass 'absolute local root leaves no PASS receipt' || fail_test 'absolute local root leaves no PASS receipt'

rm -f "$RECEIPT" "$LOG_FILE"
assert_failure 'relative local root fails closed' run_case './' "$VALID_DESTINATION"
[[ ! -e "$RECEIPT" ]] && pass 'relative local root leaves no PASS receipt' || fail_test 'relative local root leaves no PASS receipt'

rm -f "$RECEIPT" "$LOG_FILE"
assert_failure 'local root-equivalent path fails closed' run_case '/tmp/..' "$VALID_DESTINATION"
[[ ! -e "$RECEIPT" ]] && pass 'local root-equivalent path leaves no PASS receipt' || fail_test 'local root-equivalent path leaves no PASS receipt'

rm -f "$RECEIPT" "$LOG_FILE"
assert_failure 'same bucket with different aliases fails closed' run_case 'prod:buildingos-production' 'backup:buildingos-production'
[[ ! -e "$RECEIPT" ]] && pass 'same bucket aliases leave no PASS receipt' || fail_test 'same bucket aliases leave no PASS receipt'
[[ ! -s "$LOG_FILE" ]] && pass 'invalid locations do not invoke rclone' || fail_test 'invalid locations do not invoke rclone'

rm -f "$RECEIPT"
assert_failure 'copy failure fails backup' run_case "$VALID_SOURCE" "$VALID_DESTINATION" FAIL PASS
[[ ! -e "$RECEIPT" ]] && pass 'copy failure leaves no PASS receipt' || fail_test 'copy failure leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'verification failure fails backup' run_case "$VALID_SOURCE" "$VALID_DESTINATION" PASS FAIL
[[ ! -e "$RECEIPT" ]] && pass 'verification failure leaves no PASS receipt' || fail_test 'verification failure leaves no PASS receipt'

rm -f "$RECEIPT"
assert_failure 'unavailable rclone fails closed' env OBJECT_BACKUP_SOURCE="$VALID_SOURCE" OBJECT_BACKUP_DESTINATION="$VALID_DESTINATION" OBJECT_BACKUP_RECEIPT="$RECEIPT" PATH="$TEST_ROOT/no-rclone:/usr/bin:/bin" "$SCRIPT"
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
