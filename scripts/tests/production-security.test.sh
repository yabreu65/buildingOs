#!/usr/bin/env bash
# shellcheck disable=SC2016
set -Eeuo pipefail

ROOT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly ROOT_DIR
readonly VALIDATOR="$ROOT_DIR/scripts/production-security-validate.sh"
readonly ROLLBACK="$ROOT_DIR/scripts/rollback-production.sh"
readonly MANIFEST="$ROOT_DIR/infra/production/backup-postgres.identity.v1"
readonly TARGET_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
readonly PREVIOUS_SHA='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
readonly API_DIGEST='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
readonly WEB_DIGEST='sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'

tests_run=0

pass() {
  tests_run=$((tests_run + 1))
  printf 'ok %d - %s\n' "$tests_run" "$1"
}

fail_test() {
  printf 'not ok %d - %s\n' "$((tests_run + 1))" "$1" >&2
  exit 1
}

expect_success() {
  local name="$1"
  local output
  shift
  if ! output="$("$@" 2>&1)"; then
    printf '%s\n' "$output" >&2
    fail_test "$name"
  fi
  pass "$name"
}

expect_failure() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail_test "$name"
  fi
  pass "$name"
}

tmp_root="$(mktemp -d)"
tmp_root="$(cd -P -- "$tmp_root" && pwd -P)"
trap 'rm -rf -- "$tmp_root"' EXIT
protected_dir="$tmp_root/protected"
mock_bin="$tmp_root/mock-bin"
docker_marker="$tmp_root/docker-called"
mkdir -p "$protected_dir" "$mock_bin"
chmod 700 "$protected_dir"

current_owner="$(id -un)"
current_group="$(id -gn)"

cat > "$mock_bin/docker" <<EOF
#!/usr/bin/env bash
touch '$docker_marker'
if [[ "\$1" == 'inspect' ]]; then
  exit 0
fi
if [[ "\$1" == 'exec' ]]; then
  cat >/dev/null
  printf '%s\n' "\${MOCK_COMPATIBILITY:-SAFE}"
  exit 0
fi
exit 99
EOF
chmod 700 "$mock_bin/docker"

write_receipt() {
  local path="$1"
  local receipt_id="$2"
  cat > "$path" <<EOF
receipt_version=rollback-compatibility-receipt.v2
receipt_id=$receipt_id
timestamp_utc=2026-08-23T12:34:56Z
compatibility=SAFE
target_sha=$TARGET_SHA
previous_sha=$PREVIOUS_SHA
previous_api_digest=$API_DIGEST
previous_web_digest=$WEB_DIGEST
migration_count=97
EOF
  chmod 600 "$path"
}

validate_receipt() {
  env \
    TEST_MODE=1 \
    ROLLBACK_PROTECTED_DIR="$protected_dir" \
    ROLLBACK_EXPECTED_OWNER="$current_owner" \
    ROLLBACK_EXPECTED_GROUP="$current_group" \
    bash "$VALIDATOR" rollback-receipt "$@"
}

run_invalid_rollback() {
  local receipt="$1"
  shift
  env \
    PATH="$mock_bin:$PATH" \
    TEST_MODE=1 \
    ROLLBACK_PROTECTED_DIR="$protected_dir" \
    ROLLBACK_EXPECTED_OWNER="${ROLLBACK_TEST_OWNER:-$current_owner}" \
    ROLLBACK_EXPECTED_GROUP="$current_group" \
    bash "$ROLLBACK" \
      "$TARGET_SHA" "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST" "$receipt" \
      https://api.example.test/health https://api.example.test/readyz https://app.example.test/login \
      "$@"
}

validate_backup_fixture() {
  local script_path="$1"
  local expected_digest="$2"
  local expected_mode="$3"

  bash -c '
    source "$1"
    validate_backup_script_file "$2" "$2" "$3" "$4" "$5" "$6"
  ' _ "$VALIDATOR" "$script_path" "$expected_digest" "$current_owner" "$current_group" "$expected_mode"
}

execute_backup_fixture() {
  local script_path="$1"
  local expected_digest="$2"

  bash -c '
    source "$1"
    execute_pinned_backup_script "$2" "$3" "$4" "$5" "0700"
  ' _ "$VALIDATOR" "$script_path" "$expected_digest" "$current_owner" "$current_group"
}

valid_receipt="$protected_dir/rollback-check-001.receipt"
write_receipt "$valid_receipt" 'rollback-check-001'

expect_success 'accepts a valid strict backup identity manifest' \
  bash "$VALIDATOR" backup-manifest "$MANIFEST"

backup_fixture="$tmp_root/backup-postgres.sh"
backup_marker="$tmp_root/backup-executed"
export BACKUP_TEST_MARKER="$backup_marker"
# shellcheck disable=SC2016 # The fixture expands this variable when it executes.
printf '%s\n' '#!/usr/bin/env bash' 'printf '\''pinned-bytes-executed\n'\'' > "$BACKUP_TEST_MARKER"' > "$backup_fixture"
chmod 700 "$backup_fixture"
backup_fixture_digest="$(shasum -a 256 "$backup_fixture" | cut -d ' ' -f 1)"
expect_success 'accepts matching backup script path, owner, group, mode, and SHA-256' \
  validate_backup_fixture "$backup_fixture" "$backup_fixture_digest" '0700'
expect_failure 'rejects a backup script with a mismatched SHA-256' \
  validate_backup_fixture "$backup_fixture" '0000000000000000000000000000000000000000000000000000000000000000' '0700'
expect_failure 'rejects a backup script with a mismatched mode' \
  validate_backup_fixture "$backup_fixture" "$backup_fixture_digest" '0775'
expect_success 'executes a private snapshot of the validated backup bytes' \
  execute_backup_fixture "$backup_fixture" "$backup_fixture_digest"
[[ "$(cat "$backup_marker")" == 'pinned-bytes-executed' ]] || fail_test 'validated backup snapshot did not execute'
pass 'validated backup execution produced the expected marker'

expect_success 'accepts a valid secured rollback receipt' \
  validate_receipt "$valid_receipt" "$TARGET_SHA" "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST"

traversal_receipt="$protected_dir/../protected/rollback-check-001.receipt"
expect_failure 'rejects receipt path traversal before Docker' \
  run_invalid_rollback "$traversal_receipt"

symlink_receipt="$protected_dir/rollback-link.receipt"
ln -s "$valid_receipt" "$symlink_receipt"
expect_failure 'rejects a symlink receipt before Docker' \
  run_invalid_rollback "$symlink_receipt"

ROLLBACK_TEST_OWNER='owner-that-must-not-exist'
export ROLLBACK_TEST_OWNER
expect_failure 'rejects a simulated wrong receipt owner before Docker' \
  run_invalid_rollback "$valid_receipt"
unset ROLLBACK_TEST_OWNER

wrong_mode_receipt="$protected_dir/rollback-wrong-mode.receipt"
write_receipt "$wrong_mode_receipt" 'rollback-wrong-mode'
chmod 640 "$wrong_mode_receipt"
expect_failure 'rejects a receipt not using exact 0600 before Docker' \
  run_invalid_rollback "$wrong_mode_receipt"

malformed_receipt="$protected_dir/rollback-malformed.receipt"
printf 'receipt_version=rollback-compatibility-receipt.v2\r\nreceipt_id=rollback-malformed\r\n' > "$malformed_receipt"
chmod 600 "$malformed_receipt"
expect_failure 'rejects a malformed CRLF receipt before Docker' \
  run_invalid_rollback "$malformed_receipt"

expect_failure 'rejects a receipt whose target SHA does not match the argument before Docker' \
  env \
    PATH="$mock_bin:$PATH" \
    TEST_MODE=1 \
    ROLLBACK_PROTECTED_DIR="$protected_dir" \
    ROLLBACK_EXPECTED_OWNER="$current_owner" \
    ROLLBACK_EXPECTED_GROUP="$current_group" \
    bash "$ROLLBACK" \
      eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST" "$valid_receipt" \
      https://api.example.test/health https://api.example.test/readyz https://app.example.test/login

bad_manifest="$tmp_root/backup-postgres.identity.v1"
cat > "$bad_manifest" <<'EOF'
version=backup-postgres.identity.v1
path=/opt/pawtech/backups/scripts/backup-postgres.sh
sha256=0000000000000000000000000000000000000000000000000000000000000000
owner=yoryi
group=yoryi
mode=0775
EOF
expect_failure 'rejects a backup manifest with a mismatched SHA-256' \
  bash "$VALIDATOR" backup-manifest "$bad_manifest"

[[ ! -e "$docker_marker" ]] || fail_test 'failed validation must not invoke Docker'
pass 'all failed rollback validations avoid Docker side effects'

expect_success 'shared compatibility guard accepts safe data' \
  env \
    PATH="$mock_bin:$PATH" \
    MOCK_COMPATIBILITY=SAFE \
    bash -c 'source "$1"; validate_application_rollback_compatibility mock-postgres buildingos_db' _ "$VALIDATOR"

expect_failure 'shared compatibility guard rejects unsafe data' \
  env \
    PATH="$mock_bin:$PATH" \
    MOCK_COMPATIBILITY=UNSAFE \
    bash -c 'source "$1"; validate_application_rollback_compatibility mock-postgres buildingos_db' _ "$VALIDATOR"

generated_receipt="$(env \
  TEST_MODE=1 \
  ROLLBACK_PROTECTED_DIR="$protected_dir" \
  ROLLBACK_EXPECTED_OWNER="$current_owner" \
  ROLLBACK_EXPECTED_GROUP="$current_group" \
  bash -c 'source "$1"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 97' _ "$VALIDATOR" "$TARGET_SHA" "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST")" \
  || fail_test 'receipt generation failed'
[[ -f "$generated_receipt" ]] || fail_test 'receipt generation did not return a regular receipt path'
pass 'generates and immediately validates a safe rollback receipt'

reused_receipt="$(env \
  TEST_MODE=1 \
  ROLLBACK_PROTECTED_DIR="$protected_dir" \
  ROLLBACK_EXPECTED_OWNER="$current_owner" \
  ROLLBACK_EXPECTED_GROUP="$current_group" \
  bash -c 'source "$1"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 97' _ "$VALIDATOR" "$TARGET_SHA" "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST")" \
  || fail_test 'valid receipt reuse failed'
[[ "$reused_receipt" == "$generated_receipt" ]] || fail_test 'receipt reuse returned a different path'
pass 'reuses a matching receipt after a retry'

expect_failure 'rejects an existing receipt with mismatched immutable inputs' \
  env \
    TEST_MODE=1 \
    ROLLBACK_PROTECTED_DIR="$protected_dir" \
    ROLLBACK_EXPECTED_OWNER="$current_owner" \
    ROLLBACK_EXPECTED_GROUP="$current_group" \
    bash -c 'source "$1"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 97' _ "$VALIDATOR" "$TARGET_SHA" "$TARGET_SHA" "$API_DIGEST" "$WEB_DIGEST"

printf '1..%d\n' "$tests_run"
