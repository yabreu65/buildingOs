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

fixture_repo="$tmp_root/database-contract-repo"
mkdir -p "$fixture_repo"
(
  cd "$fixture_repo"
  git init -q
  git config core.hooksPath /dev/null
  git config user.name 'BuildingOS Tests'
  git config user.email 'tests@buildingos.invalid'
  mkdir -p apps/api/prisma/migrations
  printf 'schema-v1\n' > apps/api/prisma/schema.prisma
  printf 'migration-v1\n' > apps/api/prisma/migrations/001_contract.sql
  git add apps/api/prisma
  git commit -qm 'fixture: initial database contract'
)
fixture_base_sha="$(git -C "$fixture_repo" rev-parse HEAD)"

printf 'application-v2\n' > "$fixture_repo/application.txt"
git -C "$fixture_repo" add application.txt
git -C "$fixture_repo" commit -qm 'fixture: application-only release'
fixture_same_sha="$(git -C "$fixture_repo" rev-parse HEAD)"

git -C "$fixture_repo" switch --quiet --detach "$fixture_base_sha"
printf 'schema-v2\n' > "$fixture_repo/apps/api/prisma/schema.prisma"
git -C "$fixture_repo" add apps/api/prisma/schema.prisma
git -C "$fixture_repo" commit -qm 'fixture: schema contract change'
fixture_schema_changed_sha="$(git -C "$fixture_repo" rev-parse HEAD)"

git -C "$fixture_repo" switch --quiet --detach "$fixture_base_sha"
printf 'migration-v2\n' > "$fixture_repo/apps/api/prisma/migrations/001_contract.sql"
git -C "$fixture_repo" add apps/api/prisma/migrations/001_contract.sql
git -C "$fixture_repo" commit -qm 'fixture: migration contract change'
fixture_migration_changed_sha="$(git -C "$fixture_repo" rev-parse HEAD)"

run_contract_validation() {
  local previous_sha="$1"
  local target_sha="$2"
  local mock_compatibility="$3"

  env \
    PATH="$mock_bin:$PATH" \
    MOCK_COMPATIBILITY="$mock_compatibility" \
    bash -c 'cd "$1"; source "$2"; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4"' \
    _ "$fixture_repo" "$VALIDATOR" "$previous_sha" "$target_sha"
}

expect_output_contains() {
  local name="$1"
  local expected="$2"
  local output
  shift 2
  if ! output="$("$@" 2>&1)"; then
    printf '%s\n' "$output" >&2
    fail_test "$name"
  fi
  [[ "$output" == *"$expected"* ]] || fail_test "$name"
  pass "$name"
}

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

generate_receipt_for_context() {
  local target_sha="$1"
  local previous_sha="$2"
  local api_digest="$3"
  local web_digest="$4"

  env \
    TEST_MODE=1 \
    ROLLBACK_PROTECTED_DIR="$protected_dir" \
    ROLLBACK_EXPECTED_OWNER="$current_owner" \
    ROLLBACK_EXPECTED_GROUP="$current_group" \
    bash -c 'source "$1"; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 97' _ \
    "$VALIDATOR" "$target_sha" "$previous_sha" "$api_digest" "$web_digest"
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

legacy_receipt="$protected_dir/rollback-$TARGET_SHA.receipt"
write_receipt "$legacy_receipt" "rollback-$TARGET_SHA"
expect_success 'accepts a legacy target-only rollback receipt' \
  validate_receipt "$legacy_receipt" "$TARGET_SHA" "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST"

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
    bash -c 'cd "$1"; source "$2"; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4"' _ \
    "$fixture_repo" "$VALIDATOR" "$fixture_base_sha" "$fixture_schema_changed_sha"

expect_failure 'shared compatibility guard rejects unsafe data' \
  run_contract_validation "$fixture_base_sha" "$fixture_schema_changed_sha" UNSAFE

expect_output_contains 'same schema and migrations with new data use SAME_DB_CONTRACT' \
  'basis=SAME_DB_CONTRACT' \
  run_contract_validation "$fixture_base_sha" "$fixture_same_sha" UNSAFE

expect_failure 'schema changes with new data remain unsafe' \
  run_contract_validation "$fixture_base_sha" "$fixture_schema_changed_sha" UNSAFE

expect_failure 'migration changes with new data remain unsafe' \
  run_contract_validation "$fixture_base_sha" "$fixture_migration_changed_sha" UNSAFE

expect_failure 'same migration count with different migration content is not SAME_DB_CONTRACT' \
  run_contract_validation "$fixture_base_sha" "$fixture_migration_changed_sha" UNSAFE

expect_failure 'same schema with different migration content is not SAME_DB_CONTRACT' \
  run_contract_validation "$fixture_base_sha" "$fixture_migration_changed_sha" UNSAFE

expect_output_contains 'schema changes with zero new data use DATA_COMPATIBILITY' \
  'basis=DATA_COMPATIBILITY' \
  run_contract_validation "$fixture_base_sha" "$fixture_schema_changed_sha" SAFE

expect_output_contains 'migration changes with zero new data use DATA_COMPATIBILITY' \
  'basis=DATA_COMPATIBILITY' \
  run_contract_validation "$fixture_base_sha" "$fixture_migration_changed_sha" SAFE

expect_failure 'missing previous SHA fails closed' \
  run_contract_validation aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$fixture_same_sha" UNSAFE

expect_failure 'missing target SHA fails closed' \
  run_contract_validation "$fixture_base_sha" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb UNSAFE

git_error_bin="$tmp_root/git-error-bin"
mkdir -p "$git_error_bin"
real_git="$(command -v git)"
cat > "$git_error_bin/git" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  cat-file) exit 0 ;;
  diff) exit 2 ;;
  *) exec "$real_git" "\$@" ;;
EOF
chmod 700 "$git_error_bin/git"

expect_failure 'git comparison errors fail closed' \
  env \
    PATH="$git_error_bin:$PATH" \
    bash -c 'cd "$1"; source "$2"; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4"' _ \
    "$fixture_repo" "$VALIDATOR" "$fixture_base_sha" "$fixture_same_sha"

expect_failure 'receipt generation rejects unvalidated compatibility' \
  env \
    TEST_MODE=1 \
    ROLLBACK_PROTECTED_DIR="$protected_dir" \
    ROLLBACK_EXPECTED_OWNER="$current_owner" \
    ROLLBACK_EXPECTED_GROUP="$current_group" \
    bash -c 'source "$1"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 97' _ \
    "$VALIDATOR" "$TARGET_SHA" "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST"

generated_receipt="$(env \
  TEST_MODE=1 \
  ROLLBACK_PROTECTED_DIR="$protected_dir" \
  ROLLBACK_EXPECTED_OWNER="$current_owner" \
  ROLLBACK_EXPECTED_GROUP="$current_group" \
  PATH="$mock_bin:$PATH" \
  MOCK_COMPATIBILITY=UNSAFE \
  bash -c 'cd "$1"; source "$2"; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4" >&2; generate_rollback_compatibility_receipt "$4" "$3" "$5" "$6" 97' _ \
  "$fixture_repo" "$VALIDATOR" "$fixture_base_sha" "$fixture_same_sha" "$API_DIGEST" "$WEB_DIGEST")" \
  || fail_test 'receipt generation failed'
[[ -f "$generated_receipt" ]] || fail_test 'receipt generation did not return a regular receipt path'
[[ "$generated_receipt" =~ /rollback-${fixture_same_sha}-[0-9a-f]{64}\.receipt$ ]] \
  || fail_test 'generated receipt does not use the canonical context identity'
generated_receipt_id="${generated_receipt##*/}"
generated_receipt_id="${generated_receipt_id%.receipt}"
[[ "$generated_receipt_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] \
  || fail_test 'generated receipt ID violates the allowed identity regex'
[[ "${#generated_receipt_id}" -le 128 ]] || fail_test 'generated receipt ID exceeds the allowed length'
pass 'generated receipt ID satisfies the allowed regex and length'
pass 'generates and immediately validates a safe rollback receipt'

migration_tampered_original="$tmp_root/migration-tampered-original.receipt"
migration_tampered_payload="$tmp_root/migration-tampered.receipt"
cp "$generated_receipt" "$migration_tampered_original"
awk '$0 == "migration_count=97" { print "migration_count=98"; next } { print }' \
  "$generated_receipt" > "$migration_tampered_payload"
chmod 600 "$migration_tampered_payload"
mv "$migration_tampered_payload" "$generated_receipt"
expect_failure 'rejects a deterministic receipt when only migration count changes' \
  validate_receipt "$generated_receipt" "$fixture_same_sha" "$fixture_base_sha" "$API_DIGEST" "$WEB_DIGEST"
cp "$migration_tampered_original" "$generated_receipt"

reused_receipt="$(env \
  TEST_MODE=1 \
  ROLLBACK_PROTECTED_DIR="$protected_dir" \
  ROLLBACK_EXPECTED_OWNER="$current_owner" \
  ROLLBACK_EXPECTED_GROUP="$current_group" \
  PATH="$mock_bin:$PATH" \
  MOCK_COMPATIBILITY=UNSAFE \
  bash -c 'cd "$1"; source "$2"; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4" >&2; generate_rollback_compatibility_receipt "$4" "$3" "$5" "$6" 97' _ \
  "$fixture_repo" "$VALIDATOR" "$fixture_base_sha" "$fixture_same_sha" "$API_DIGEST" "$WEB_DIGEST")" \
  || fail_test 'valid receipt reuse failed'
[[ "$reused_receipt" == "$generated_receipt" ]] || fail_test 'receipt reuse returned a different path'
pass 'reuses a matching receipt after a retry'

incident_a_to_b_receipt="$(generate_receipt_for_context "$fixture_same_sha" "$fixture_base_sha" "$API_DIGEST" "$WEB_DIGEST")" \
  || fail_test 'historical A-to-B receipt generation failed'
incident_a_to_b_snapshot="$tmp_root/incident-a-to-b.receipt"
cp "$incident_a_to_b_receipt" "$incident_a_to_b_snapshot"
pass 'historical A-to-B receipt generation passes'
incident_b_to_b_receipt="$(generate_receipt_for_context "$fixture_same_sha" "$fixture_same_sha" "$API_DIGEST" "$WEB_DIGEST")" \
  || fail_test 'same-SHA B-to-B receipt generation failed'
pass 'same-SHA B-to-B receipt generation passes'
[[ "$incident_a_to_b_receipt" != "$incident_b_to_b_receipt" ]] \
  || fail_test 'A-to-B and B-to-B receipts have the same path'
cmp -s "$incident_a_to_b_snapshot" "$incident_a_to_b_receipt" \
  || fail_test 'A-to-B receipt changed after B-to-B generation'
[[ "$(awk -F= '$1 == "previous_sha" { print $2 }' "$incident_b_to_b_receipt")" == "$fixture_same_sha" ]] \
  || fail_test 'B-to-B receipt does not record previous SHA B'
expect_success 'validates the same-SHA B-to-B incident receipt' \
  validate_receipt "$incident_b_to_b_receipt" "$fixture_same_sha" "$fixture_same_sha" "$API_DIGEST" "$WEB_DIGEST"
pass 'A-to-B then B-to-B incident regression preserves both receipts'

alternate_previous_sha='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
alternate_receipt="$(env \
  TEST_MODE=1 \
  ROLLBACK_PROTECTED_DIR="$protected_dir" \
  ROLLBACK_EXPECTED_OWNER="$current_owner" \
  ROLLBACK_EXPECTED_GROUP="$current_group" \
  bash -c 'source "$1"; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 97' _ \
  "$VALIDATOR" "$fixture_same_sha" "$alternate_previous_sha" "$API_DIGEST" "$WEB_DIGEST")" \
  || fail_test 'receipt generation with a different previous SHA failed'
[[ "$alternate_receipt" != "$generated_receipt" ]] || fail_test 'receipt identity ignored the previous SHA'
expect_success 'validates distinct receipts for distinct rollback contexts' \
  validate_receipt "$alternate_receipt" "$fixture_same_sha" "$alternate_previous_sha" "$API_DIGEST" "$WEB_DIGEST"

alternate_api_digest='sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
digest_receipt="$(env \
  TEST_MODE=1 \
  ROLLBACK_PROTECTED_DIR="$protected_dir" \
  ROLLBACK_EXPECTED_OWNER="$current_owner" \
  ROLLBACK_EXPECTED_GROUP="$current_group" \
  bash -c 'source "$1"; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 97' _ \
  "$VALIDATOR" "$fixture_same_sha" "$fixture_base_sha" "$alternate_api_digest" "$WEB_DIGEST")" \
  || fail_test 'receipt generation with a different API digest failed'
[[ "$digest_receipt" != "$generated_receipt" ]] || fail_test 'receipt identity ignored an image digest'
expect_success 'validates distinct receipts for distinct image contexts' \
  validate_receipt "$digest_receipt" "$fixture_same_sha" "$fixture_base_sha" "$alternate_api_digest" "$WEB_DIGEST"
expect_failure 'rejects a generated receipt with changed immutable inputs' \
  validate_receipt "$generated_receipt" "$fixture_same_sha" "$fixture_base_sha" "$alternate_api_digest" "$WEB_DIGEST"

alternate_web_digest='sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
web_receipt="$(generate_receipt_for_context "$fixture_same_sha" "$fixture_base_sha" "$API_DIGEST" "$alternate_web_digest")" \
  || fail_test 'receipt generation with a different Web digest failed'
[[ "$web_receipt" != "$generated_receipt" ]] || fail_test 'receipt identity ignored the Web digest'
expect_success 'validates distinct receipts for distinct Web image contexts' \
  validate_receipt "$web_receipt" "$fixture_same_sha" "$fixture_base_sha" "$API_DIGEST" "$alternate_web_digest"

tampered_original="$tmp_root/generated-original.receipt"
tampered_payload="$tmp_root/generated-tampered.receipt"
cp "$generated_receipt" "$tampered_original"
awk -v replacement="$alternate_previous_sha" \
  '$0 ~ /^previous_sha=/ { print "previous_sha=" replacement; next } { print }' \
  "$generated_receipt" > "$tampered_payload"
chmod 600 "$tampered_payload"
mv "$tampered_payload" "$generated_receipt"
expect_failure 'rejects a tampered pre-existing deterministic receipt fail closed' \
  generate_receipt_for_context "$fixture_same_sha" "$fixture_base_sha" "$API_DIGEST" "$WEB_DIGEST"
cp "$tampered_original" "$generated_receipt"

rollback_consumer_output=''
rollback_consumer_status=0
rollback_consumer_output="$(env \
  TEST_MODE=1 \
  ROLLBACK_PROTECTED_DIR="$protected_dir" \
  ROLLBACK_EXPECTED_OWNER="$current_owner" \
  ROLLBACK_EXPECTED_GROUP="$current_group" \
  PATH="$mock_bin:$PATH" \
  bash "$ROLLBACK" \
    "$fixture_same_sha" "$fixture_same_sha" "$API_DIGEST" "$WEB_DIGEST" "$incident_b_to_b_receipt" \
    https://api.example.test/health https://api.example.test/readyz https://app.example.test/login 2>&1)" \
  || rollback_consumer_status=$?
[[ "$rollback_consumer_status" -ne 0 ]] || fail_test 'rollback consumer unexpectedly completed in the fixture environment'
[[ "$rollback_consumer_output" == *'cd: /opt/pawtech/apps/buildingos/buildingos-app: No such file or directory'* ]] \
  || fail_test 'rollback consumer did not reach the expected post-validation checkout gate'
pass 'rollback consumer validates new-format receipt before the checkout gate'

concurrent_dir="$tmp_root/concurrent-protected"
mkdir -p "$concurrent_dir"
chmod 700 "$concurrent_dir"
concurrent_output_a="$tmp_root/concurrent-a.out"
concurrent_output_b="$tmp_root/concurrent-b.out"
env TEST_MODE=1 ROLLBACK_PROTECTED_DIR="$concurrent_dir" ROLLBACK_EXPECTED_OWNER="$current_owner" ROLLBACK_EXPECTED_GROUP="$current_group" \
  bash -c 'source "$1"; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 97' _ \
  "$VALIDATOR" "$fixture_same_sha" "$fixture_base_sha" "$API_DIGEST" "$WEB_DIGEST" > "$concurrent_output_a" 2>&1 &
concurrent_pid_a=$!
env TEST_MODE=1 ROLLBACK_PROTECTED_DIR="$concurrent_dir" ROLLBACK_EXPECTED_OWNER="$current_owner" ROLLBACK_EXPECTED_GROUP="$current_group" \
  bash -c 'source "$1"; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 97' _ \
  "$VALIDATOR" "$fixture_same_sha" "$fixture_base_sha" "$API_DIGEST" "$WEB_DIGEST" > "$concurrent_output_b" 2>&1 &
concurrent_pid_b=$!
concurrent_status_a=0
concurrent_status_b=0
wait "$concurrent_pid_a" || concurrent_status_a=$?
wait "$concurrent_pid_b" || concurrent_status_b=$?
[[ "$concurrent_status_a" -eq 0 && "$concurrent_status_b" -eq 0 ]] || {
  cat "$concurrent_output_a" "$concurrent_output_b" >&2
  fail_test 'concurrent identical receipt generation is idempotent'
}
concurrent_receipt_a="$(tail -n 1 "$concurrent_output_a")"
concurrent_receipt_b="$(tail -n 1 "$concurrent_output_b")"
[[ "$concurrent_receipt_a" == "$concurrent_receipt_b" ]] || fail_test 'concurrent receipt generation returned different paths'
pass 'concurrent identical receipt generation is idempotent'

expect_failure 'rejects an existing receipt with mismatched immutable inputs' \
  env \
    TEST_MODE=1 \
    ROLLBACK_PROTECTED_DIR="$protected_dir" \
    ROLLBACK_EXPECTED_OWNER="$current_owner" \
    ROLLBACK_EXPECTED_GROUP="$current_group" \
    bash -c 'cd "$1"; source "$2"; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4" >&2; generate_rollback_compatibility_receipt "$4" "$4" "$5" "$6" 97' _ \
    "$fixture_repo" "$VALIDATOR" "$fixture_base_sha" "$fixture_same_sha" "$API_DIGEST" "$WEB_DIGEST"

printf '1..%d\n' "$tests_run"
