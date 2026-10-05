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
readonly PREVIOUS_PRODUCTION_APP_SHA='db82d3d37fc6184a6d4063709b9a15b923371695'
readonly PR_CANDIDATE_SHA='d07b1695f2c1c9acc593787ac21a605247f09802'
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
query_marker="$tmp_root/compatibility-query"
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
  query="\$(cat)"
  if [[ "\$query" == *'ExchangeRate'* ]]; then
    printf 'broad\n' > '$query_marker'
  else
    printf 'snapshot-only\n' > '$query_marker'
  fi
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

git -C "$fixture_repo" switch --quiet --detach "$fixture_base_sha"
mkdir -p "$fixture_repo/apps/api/prisma/migrations/20260831000000_add_payment_receipt_issuance_snapshot"
printf '%s\n' \
  '  receiptSnapshot           Json?             // Immutable semantic/display snapshot for receipt issuance' \
  '  receiptSnapshotVersion    String?           // Renderer/snapshot version' \
  '  receiptSnapshotHash       String?           // SHA-256 of canonical receiptSnapshot JSON' \
  '  receiptSnapshotCreatedAt  DateTime?         // When the issuance snapshot was created' \
  '  receiptGenerationToken   String?           // Durable owner of the current storage attempt' \
  '  receiptGenerationLeaseUntil DateTime?      // Expiration for the current storage attempt' >> "$fixture_repo/apps/api/prisma/schema.prisma"
cp "$ROOT_DIR/apps/api/prisma/migrations/20260831000000_add_payment_receipt_issuance_snapshot/migration.sql" \
  "$fixture_repo/apps/api/prisma/migrations/20260831000000_add_payment_receipt_issuance_snapshot/migration.sql"
git -C "$fixture_repo" add apps/api/prisma
git -C "$fixture_repo" commit -qm 'fixture: receipt snapshot migration contract'
fixture_snapshot_sha="$(git -C "$fixture_repo" rev-parse HEAD)"

run_contract_validation() {
  local previous_sha="$1"
  local target_sha="$2"
  local mock_compatibility="$3"

  env \
    PATH="$mock_bin:$PATH" \
    MOCK_COMPATIBILITY="$mock_compatibility" \
    bash -c 'cd "$1"; source "$2"; MIGRATION_TARGET_APPLIED=99; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4"' \
    _ "$fixture_repo" "$VALIDATOR" "$previous_sha" "$target_sha"
}

run_db107_compatibility() {
  local previous_sha="$1"
  local target_sha="$2"
  local verifier_path="${3:-$ROOT_DIR/scripts/verify-production-migration-manifest.sh}"
  bash -c '
    source "$1"
    SCRIPT_DIR="$2"
    expected_verifier="$3"
    calls_file="$4"
    MIGRATION_TARGET_APPLIED=107
    bash() {
      [[ "$1" == "$expected_verifier" ]] || return 91
      printf "%s\\n" "$1" >> "$calls_file"
      if [[ "$2" == verify-files ]]; then
        printf "status=ok\\ttarget=107\\n"
      elif [[ "$2" == verify-db && "$3" == post ]]; then
        printf "status=ok\\tphase=post\\ttarget=107\\n"
      else
        return 92
      fi
    }
    env() {
      if [[ "$1" == POSTGRES_CONTAINER=* && "$2" == DATABASE_NAME=* ]]; then
        shift 3
        bash "$@"
      else
        command env "$@"
      fi
    }
    validate_application_rollback_compatibility mock-postgres buildingos_db "$5" "$6"
  ' _ "$VALIDATOR" "$ROOT_DIR/scripts" "$verifier_path" "$tmp_root/verifier-calls" "$previous_sha" "$target_sha"
}

run_streamed_control_db107_compatibility() {
  local previous_sha="$1"
  local target_sha="$2"
  local control_dir="$tmp_root/streamed-control/scripts"
  local verifier_path="$ROOT_DIR/scripts/verify-production-migration-manifest.sh"
  mkdir -p "$control_dir"
  cp "$VALIDATOR" "$control_dir/production-security-validate.sh"
  [[ ! -e "$control_dir/verify-production-migration-manifest.sh" ]] \
    || fail_test 'streamed control fixture unexpectedly contains the migration verifier'
  [[ -f "$verifier_path" && ! -L "$verifier_path" ]] || fail_test 'target checkout verifier fixture must be a regular file'
  bash -c '
    source "$1"
    SCRIPT_DIR="$2"
    expected_verifier="$3"
    calls_file="$4"
    PRODUCTION_DB107_MIGRATION_VERIFIER="$expected_verifier"
    MIGRATION_TARGET_APPLIED=107
    bash() {
      [[ "$1" == "$expected_verifier" && -f "$1" && ! -L "$1" ]] || return 91
      printf "%s\\n" "$1" >> "$calls_file"
      if [[ "$2" == verify-files ]]; then
        printf "status=ok\\ttarget=107\\n"
      elif [[ "$2" == verify-db && "$3" == post ]]; then
        printf "status=ok\\tphase=post\\ttarget=107\\n"
      else
        return 92
      fi
    }
    env() {
      if [[ "$1" == POSTGRES_CONTAINER=* && "$2" == DATABASE_NAME=* ]]; then
        shift 3
        bash "$@"
      else
        command env "$@"
      fi
    }
    validate_application_rollback_compatibility mock-postgres buildingos_db "$5" "$6"
  ' _ "$control_dir/production-security-validate.sh" "$control_dir" "$verifier_path" "$tmp_root/streamed-verifier-calls" "$previous_sha" "$target_sha"
}

run_invalid_db107_verifier() {
  local verifier_path="$1"
  local script_dir="$2"
  bash -c '
    source "$1"
    SCRIPT_DIR="$2"
    PRODUCTION_DB107_MIGRATION_VERIFIER="$3"
    MIGRATION_TARGET_APPLIED=107
    bash() { return 90; }
    validate_application_rollback_compatibility mock-postgres buildingos_db "$4" "$5"
  ' _ "$VALIDATOR" "$script_dir" "$verifier_path" "$PREVIOUS_PRODUCTION_APP_SHA" "$(git -C "$ROOT_DIR" rev-parse HEAD)"
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
migration_count=98
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
    bash -c 'source "$1"; MIGRATION_TARGET_APPLIED=99; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 99' _ \
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
    bash -c 'cd "$1"; source "$2"; MIGRATION_TARGET_APPLIED=99; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4"' _ \
    "$fixture_repo" "$VALIDATOR" "$fixture_base_sha" "$fixture_schema_changed_sha"

expect_failure 'shared compatibility guard rejects unsafe data' \
  run_contract_validation "$fixture_base_sha" "$fixture_schema_changed_sha" UNSAFE

old_liquidation_writer="$(git show "$PREVIOUS_PRODUCTION_APP_SHA:apps/api/src/finanzas/liquidation-publication.use-case.ts")"
old_prisma_schema="$(git show "$PREVIOUS_PRODUCTION_APP_SHA:apps/api/prisma/schema.prisma")"
[[ "$old_liquidation_writer" == *'tx.liquidation.create({'* ]] \
  || fail_test 'known previous production app no longer resolves to the liquidation insert path'
[[ "$old_liquidation_writer" != *publicationIntegrityVersion* ]] \
  || fail_test 'known previous production app unexpectedly writes publication integrity version'
[[ "$old_prisma_schema" != *publicationIntegrityVersion* ]] \
  || fail_test 'known previous production Prisma schema unexpectedly exposes publicationIntegrityVersion'
pass 'known previous production API Liquidation INSERT omits publicationIntegrityVersion and its Prisma schema lacks the field'
[[ "$old_liquidation_writer" == *'incomeOffsetSnapshot: (input.incomeOffsetSnapshot ??'* \
  && "$old_liquidation_writer" == *'buildLiquidationPublicationSnapshotV3({'* \
  && "$old_liquidation_writer" == *'snapshotVersion = 3;'* ]] \
  || fail_test 'pinned previous production API no longer proves nullable legacy rows and V3 publication'
pass 'pinned previous production API retains nullable legacy write and V3 publication behavior'

compatibility_migration="$ROOT_DIR/apps/api/prisma/migrations/20260919000000_release_a_dual_liquidation_compatibility/migration.sql"
[[ -f "$compatibility_migration" ]] || fail_test 'migration 107 compatibility SQL is missing'
compatibility_sql="$(<"$compatibility_migration")"
[[ "$compatibility_sql" == *'Release A compatibility is a surgical transition over the hardened DB106'* \
  && "$compatibility_sql" == *'hardened DB106 V4 publication contract markers are missing'* \
  && "$compatibility_sql" == *'expected DB106 legacy V1/V2 publication-version clause was not found exactly once'* \
  && "$compatibility_sql" == *'expected DB106 new-NULL-insert rejection was not found exactly once'* \
  && "$compatibility_sql" == *'expenseSourceEvidence'* \
  && "$compatibility_sql" == *'publicationExpenseEvidence'* \
  && "$compatibility_sql" == *'allocationChargeEvidence'* \
  && "$compatibility_sql" == *'distributionAllocationEvidence'* \
  && "$compatibility_sql" == *'publicationAllocationEvidence'* \
  && "$compatibility_sql" == *'generatedChargeEvidence'* \
  && "$compatibility_sql" == *'modern liquidation publication requires complete matching V4 evidence'* \
  && "$compatibility_sql" == *"AND (NEW.\"publicationSnapshot\" -> 'version') IS DISTINCT FROM '3'::jsonb THEN"* \
  && "$compatibility_sql" == *'modern liquidation distribution recipients must belong to the liquidation tenant and building'* \
  && "$compatibility_sql" == *'validate_liquidation_distribution_snapshot('* \
  && "$compatibility_sql" != *'CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity('* \
  && "$compatibility_sql" != *'UPDATE "Liquidation"'* \
  && "$compatibility_sql" != *'SET "publicationIntegrityVersion"'* ]] \
  || fail_test 'migration 107 does not preserve legacy and modern publication contracts via guarded rewrites'
pass 'migration 107 surgically adds legacy V3/NULL compatibility while preserving DB106 V4 validation'

origin_trigger="$(git show "$PR_CANDIDATE_SHA:apps/api/prisma/migrations/20260918000000_enforce_modern_distribution_unit_ownership/migration.sql")"
[[ "$origin_trigger" == *'IF TG_OP = '\''INSERT'\'' AND NEW."publicationIntegrityVersion" IS NULL THEN'* \
  && "$origin_trigger" == *'RAISE EXCEPTION '\''new liquidations require publication integrity v1'\'';'* ]] \
  || fail_test 'migration 106 does not prove rejection of the previous app insert'
pass 'migration 106 rejects inserts that omit the required publication integrity version'

rm -f "$docker_marker"
expect_failure '106 trigger rejects incompatible previous production app even when its data predicate reports zero' \
  env \
    PATH="$mock_bin:$PATH" \
    MOCK_COMPATIBILITY=SAFE \
    bash -c 'cd "$1"; source "$2"; MIGRATION_TARGET_APPLIED=106; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4"' _ \
    "$ROOT_DIR" "$VALIDATOR" "$PREVIOUS_PRODUCTION_APP_SHA" "$PR_CANDIDATE_SHA"
[[ ! -e "$docker_marker" ]] || fail_test 'schema-incompatible app reached the row-only data predicate'
pass 'incompatible app rejected before zero-row predicate can authorize rollback'

expect_failure 'DB107 rejects an unknown runtime instead of using generic row-only compatibility' \
  env \
    PATH="$mock_bin:$PATH" \
    bash -c 'cd "$1"; source "$2"; MIGRATION_TARGET_APPLIED=107; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4"' _ \
    "$fixture_repo" "$VALIDATOR" "$fixture_base_sha" "$fixture_schema_changed_sha"
[[ ! -e "$docker_marker" ]] || fail_test 'unknown DB107 runtime reached a generic compatibility query'
pass 'unknown DB107 runtime rejected before any application or database compatibility bypass'

current_candidate_sha="$(git -C "$ROOT_DIR" rev-parse HEAD)"
expect_output_contains 'DB107 accepts only the pinned previous runtime after both manifest verifiers pass' \
  'basis=DB107_PINNED_RUNTIME' \
  run_db107_compatibility "$PREVIOUS_PRODUCTION_APP_SHA" "$current_candidate_sha"
[[ "$(<"$tmp_root/verifier-calls")" == "$ROOT_DIR/scripts/verify-production-migration-manifest.sh"$'\n'"$ROOT_DIR/scripts/verify-production-migration-manifest.sh" ]] \
  || fail_test 'default DB107 verifier path was not reused for both phases'
pass 'DB107 default verifier path is reused for both phases'

: > "$tmp_root/streamed-verifier-calls"
expect_output_contains 'streamed control validator accepts the explicit target-checkout verifier' \
  'basis=DB107_PINNED_RUNTIME' \
  run_streamed_control_db107_compatibility "$PREVIOUS_PRODUCTION_APP_SHA" "$current_candidate_sha"
[[ "$(<"$tmp_root/streamed-verifier-calls")" == "$ROOT_DIR/scripts/verify-production-migration-manifest.sh"$'\n'"$ROOT_DIR/scripts/verify-production-migration-manifest.sh" ]] \
  || fail_test 'streamed control validation did not use one explicit verifier path for both phases'
pass 'streamed control validation uses the identical explicit target-checkout verifier for both phases'

missing_default_dir="$tmp_root/missing-default/scripts"
mkdir -p "$missing_default_dir"
expect_failure 'DB107 rejects a missing default verifier' \
  run_invalid_db107_verifier '' "$missing_default_dir"
symlink_verifier="$tmp_root/symlink-verifier.sh"
ln -s "$ROOT_DIR/scripts/verify-production-migration-manifest.sh" "$symlink_verifier"
expect_failure 'DB107 rejects an explicit symlink verifier' \
  run_invalid_db107_verifier "$symlink_verifier" "$ROOT_DIR/scripts"
non_regular_verifier="$tmp_root/non-regular-verifier"
mkdir -p "$non_regular_verifier"
expect_failure 'DB107 rejects a non-regular verifier path' \
  run_invalid_db107_verifier "$non_regular_verifier" "$ROOT_DIR/scripts"
expect_output_contains 'DB107 accepts the exact Release A candidate runtime after both manifest verifiers pass' \
  'basis=DB107_PINNED_RUNTIME' \
  run_db107_compatibility "$current_candidate_sha" "$current_candidate_sha"
pass 'DB107 compatibility positive cases are bound to the pinned old SHA or exact candidate SHA'

expect_output_contains '106 application contract keeps SAME_DB_CONTRACT valid for a capable previous app' \
  'basis=SAME_DB_CONTRACT' \
  env \
    PATH="$mock_bin:$PATH" \
    bash -c 'cd "$1"; source "$2"; MIGRATION_TARGET_APPLIED=106; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4"' _ \
    "$ROOT_DIR" "$VALIDATOR" "$PR_CANDIDATE_SHA" "$PR_CANDIDATE_SHA"

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

: > "$query_marker"
expect_failure 'receipt snapshot delta checks only new receipt state' \
  run_contract_validation "$fixture_base_sha" "$fixture_snapshot_sha" UNSAFE
[[ "$(<"$query_marker")" == 'snapshot-only' ]] || fail_test 'receipt snapshot delta used the broad compatibility predicate'
pass 'receipt snapshot delta uses the narrow compatibility predicate'

for receipt_field in receiptSnapshot receiptSnapshotVersion receiptSnapshotHash receiptSnapshotCreatedAt receiptGenerationToken receiptGenerationLeaseUntil; do
  grep -F "\"$receipt_field\" IS NOT NULL" "$VALIDATOR" >/dev/null \
    || fail_test "rollback compatibility does not guard $receipt_field"
done
pass 'rollback compatibility guards all migration-98 receipt state fields'

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
    bash -c 'cd "$1"; source "$2"; MIGRATION_TARGET_APPLIED=99; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4"' _ \
    "$fixture_repo" "$VALIDATOR" "$fixture_base_sha" "$fixture_same_sha"

expect_failure 'receipt generation rejects unvalidated compatibility' \
  env \
    TEST_MODE=1 \
    ROLLBACK_PROTECTED_DIR="$protected_dir" \
    ROLLBACK_EXPECTED_OWNER="$current_owner" \
    ROLLBACK_EXPECTED_GROUP="$current_group" \
    bash -c 'source "$1"; MIGRATION_TARGET_APPLIED=99; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 99' _ \
    "$VALIDATOR" "$TARGET_SHA" "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST"

expect_failure 'receipt generation rejects a migration target different from the verified target' \
  env \
    TEST_MODE=1 \
    ROLLBACK_PROTECTED_DIR="$protected_dir" \
    ROLLBACK_EXPECTED_OWNER="$current_owner" \
    ROLLBACK_EXPECTED_GROUP="$current_group" \
    bash -c 'source "$1"; MIGRATION_TARGET_APPLIED=105; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 106' _ \
    "$VALIDATOR" "$TARGET_SHA" "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST"

generated_receipt="$(env \
  TEST_MODE=1 \
  ROLLBACK_PROTECTED_DIR="$protected_dir" \
  ROLLBACK_EXPECTED_OWNER="$current_owner" \
  ROLLBACK_EXPECTED_GROUP="$current_group" \
  PATH="$mock_bin:$PATH" \
  MOCK_COMPATIBILITY=UNSAFE \
  bash -c 'cd "$1"; source "$2"; MIGRATION_TARGET_APPLIED=99; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4" >&2; generate_rollback_compatibility_receipt "$4" "$3" "$5" "$6" 99' _ \
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

generated_current_target_receipt="$(env \
  TEST_MODE=1 \
  ROLLBACK_PROTECTED_DIR="$protected_dir" \
  ROLLBACK_EXPECTED_OWNER="$current_owner" \
  ROLLBACK_EXPECTED_GROUP="$current_group" \
  bash -c 'source "$1"; MIGRATION_TARGET_APPLIED=107; ROLLBACK_COMPATIBILITY_BASIS=DB107_PINNED_RUNTIME; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 107' _ \
  "$VALIDATOR" "$TARGET_SHA" "$PREVIOUS_SHA" "$API_DIGEST" "$WEB_DIGEST")" \
  || fail_test 'current-target receipt generation failed'
grep -F 'migration_count=107' "$generated_current_target_receipt" >/dev/null \
  || fail_test 'current-target receipt did not record the verified DB107 target count'
pass 'generates rollback receipt for the verified current migration target'

migration_tampered_original="$tmp_root/migration-tampered-original.receipt"
migration_tampered_payload="$tmp_root/migration-tampered.receipt"
cp "$generated_receipt" "$migration_tampered_original"
awk '$0 == "migration_count=99" { print "migration_count=98"; next } { print }' \
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
  bash -c 'cd "$1"; source "$2"; MIGRATION_TARGET_APPLIED=99; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4" >&2; generate_rollback_compatibility_receipt "$4" "$3" "$5" "$6" 99' _ \
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
  bash -c 'source "$1"; MIGRATION_TARGET_APPLIED=99; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 99' _ \
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
  bash -c 'source "$1"; MIGRATION_TARGET_APPLIED=99; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 99' _ \
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
[[ "$rollback_consumer_output" == *'Application rollback requires the verified DB107 compatibility contract'* ]] \
  || fail_test 'rollback consumer did not reject a non-DB107 receipt before production access'
pass 'rollback consumer rejects receipts without the verified DB107 contract before the checkout gate'

grep -F "previous_sha" "$VALIDATOR" | grep -F 'db82d3d37fc6184a6d4063709b9a15b923371695' >/dev/null \
  || fail_test 'DB107 old-runtime compatibility is not pinned to the approved SHA'
grep -F "previous_sha\" == \"\$target_sha\"" "$VALIDATOR" >/dev/null \
  || fail_test 'DB107 compatibility does not explicitly permit the candidate itself'
pass 'DB107 compatibility is limited to the pinned old runtime or exact candidate SHA'

concurrent_dir="$tmp_root/concurrent-protected"
mkdir -p "$concurrent_dir"
chmod 700 "$concurrent_dir"
concurrent_output_a="$tmp_root/concurrent-a.out"
concurrent_output_b="$tmp_root/concurrent-b.out"
env TEST_MODE=1 ROLLBACK_PROTECTED_DIR="$concurrent_dir" ROLLBACK_EXPECTED_OWNER="$current_owner" ROLLBACK_EXPECTED_GROUP="$current_group" \
  bash -c 'source "$1"; MIGRATION_TARGET_APPLIED=99; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 99' _ \
  "$VALIDATOR" "$fixture_same_sha" "$fixture_base_sha" "$API_DIGEST" "$WEB_DIGEST" > "$concurrent_output_a" 2>&1 &
concurrent_pid_a=$!
env TEST_MODE=1 ROLLBACK_PROTECTED_DIR="$concurrent_dir" ROLLBACK_EXPECTED_OWNER="$current_owner" ROLLBACK_EXPECTED_GROUP="$current_group" \
  bash -c 'source "$1"; MIGRATION_TARGET_APPLIED=99; ROLLBACK_COMPATIBILITY_BASIS=SAME_DB_CONTRACT; ROLLBACK_COMPATIBILITY_TARGET_SHA="$2"; ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$3"; generate_rollback_compatibility_receipt "$2" "$3" "$4" "$5" 99' _ \
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
    bash -c 'cd "$1"; source "$2"; MIGRATION_TARGET_APPLIED=99; validate_application_rollback_compatibility mock-postgres buildingos_db "$3" "$4" >&2; generate_rollback_compatibility_receipt "$4" "$4" "$5" "$6" 99' _ \
    "$fixture_repo" "$VALIDATOR" "$fixture_base_sha" "$fixture_same_sha" "$API_DIGEST" "$WEB_DIGEST"

printf '1..%d\n' "$tests_run"
