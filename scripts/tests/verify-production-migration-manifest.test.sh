#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly TEST_DIR
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
readonly REPO_ROOT
readonly VERIFIER="$REPO_ROOT/scripts/verify-production-migration-manifest.sh"
readonly MANIFEST="$REPO_ROOT/scripts/manifests/production-migrations-81-to-97.tsv"
readonly MIGRATIONS="$REPO_ROOT/apps/api/prisma/migrations"
readonly TAB=$'\t'

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/migration-manifest-test.XXXXXX")"
PASS_COUNT=0

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

fail_test() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

pass_test() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'ok %s - %s\n' "$PASS_COUNT" "$1"
}

checksum_for() {
  local file="$1"
  local output

  if command -v sha256sum >/dev/null 2>&1; then
    output="$(sha256sum "$file")"
    printf '%s\n' "${output%% *}"
  elif command -v shasum >/dev/null 2>&1; then
    output="$(shasum -a 256 "$file")"
    printf '%s\n' "${output%% *}"
  else
    output="$(openssl dgst -sha256 "$file")"
    printf '%s\n' "${output##* }"
  fi
}

write_fixture() {
  local destination="$1"
  local limit="$2"
  local paths=()
  local migration_dirs=()
  local path
  local name
  local checksum
  local index=0

  shopt -s nullglob
  paths=("$MIGRATIONS"/*)
  shopt -u nullglob

  : > "$destination"
  for path in "${paths[@]}"; do
    [[ -d "$path" ]] || continue
    migration_dirs[${#migration_dirs[@]}]="$path"
  done

  while (( index < limit )); do
    path="${migration_dirs[$index]}"
    name="${path##*/}"
    checksum="$(checksum_for "$path/migration.sql")"
    printf '%s\t%s\tfinished\tactive\t1\n' "$name" "$checksum" >> "$destination"
    index=$((index + 1))
  done
}

run_fixture() {
  local fixture="$1"
  local phase="$2"
  local output="$3"

  TEST_MODE=1 \
    MIGRATION_STATE_FILE="$fixture" \
    MANIFEST_FILE="$MANIFEST" \
    MIGRATIONS_DIR="$MIGRATIONS" \
    bash "$VERIFIER" verify-db "$phase" > "$output" 2>&1
}

assert_failure_code() {
  local name="$1"
  local fixture="$2"
  local phase="$3"
  local code="$4"
  local output="$TMP_DIR/output.tsv"

  if run_fixture "$fixture" "$phase" "$output"; then
    fail_test "$name unexpectedly passed"
  fi
  if ! grep -F "code=$code" "$output" >/dev/null; then
    fail_test "$name returned the wrong failure: $(tr '\n' ' ' < "$output")"
  fi
  pass_test "$name"
}

write_fixture "$TMP_DIR/pre.tsv" 81
if ! run_fixture "$TMP_DIR/pre.tsv" pre "$TMP_DIR/output.tsv"; then
  fail_test "exact pre state failed: $(tr '\n' ' ' < "$TMP_DIR/output.tsv")"
fi
grep -F $'status=ok\tmode=verify-db\tphase=pre\tmanifest_version=1\tapplied=81\tfailed=0\tpending=16\ttarget=97' \
  "$TMP_DIR/output.tsv" >/dev/null || fail_test "exact pre state output mismatch: $(tr '\n' ' ' < "$TMP_DIR/output.tsv")"
pass_test 'exact pre state passes'

write_fixture "$TMP_DIR/post.tsv" 97
if ! run_fixture "$TMP_DIR/post.tsv" post "$TMP_DIR/output.tsv"; then
  fail_test "exact post state failed: $(tr '\n' ' ' < "$TMP_DIR/output.tsv")"
fi
grep -F $'status=ok\tmode=verify-db\tphase=post\tmanifest_version=1\tapplied=97\tfailed=0\tpending=0\ttarget=97' \
  "$TMP_DIR/output.tsv" >/dev/null || fail_test "exact post state output mismatch: $(tr '\n' ' ' < "$TMP_DIR/output.tsv")"
pass_test 'exact post state passes'

cp "$TMP_DIR/post.tsv" "$TMP_DIR/missing.tsv"
missing_name="$(tail -n 1 "$TMP_DIR/missing.tsv" | cut -f 1)"
sed "/^${missing_name}${TAB}/d" "$TMP_DIR/missing.tsv" > "$TMP_DIR/missing-with-extra.tsv"
printf '20990101000000_unexpected\t%s\tfinished\tactive\t1\n' \
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' >> "$TMP_DIR/missing-with-extra.tsv"
assert_failure_code 'missing row is rejected' "$TMP_DIR/missing-with-extra.tsv" post 'database_missing_row'

cp "$TMP_DIR/pre.tsv" "$TMP_DIR/extra.tsv"
printf '20990101000000_unexpected\t%s\tfinished\tactive\t1\n' \
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' >> "$TMP_DIR/extra.tsv"
assert_failure_code 'extra row is rejected' "$TMP_DIR/extra.tsv" pre 'database_extra_row'

sed '$s/[0-9a-f]\{64\}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' \
  "$TMP_DIR/post.tsv" > "$TMP_DIR/checksum.tsv"
assert_failure_code 'pending checksum mismatch is rejected' "$TMP_DIR/checksum.tsv" post 'database_pending_checksum_mismatch'

sed '1s/finished/failed/' "$TMP_DIR/pre.tsv" > "$TMP_DIR/failed.tsv"
assert_failure_code 'failed row is rejected' "$TMP_DIR/failed.tsv" pre 'database_failed_row'

cp "$TMP_DIR/pre.tsv" "$TMP_DIR/rolled-back.tsv"
sed '1s/active/rolled_back/' "$TMP_DIR/rolled-back.tsv" > "$TMP_DIR/rolled-back-state.tsv"
assert_failure_code 'rolled-back row is rejected' "$TMP_DIR/rolled-back-state.tsv" pre 'database_rolled_back_row'

cp "$TMP_DIR/pre.tsv" "$TMP_DIR/duplicate.tsv"
IFS= read -r duplicate_row < "$TMP_DIR/pre.tsv"
printf '%s\n' "$duplicate_row" >> "$TMP_DIR/duplicate.tsv"
assert_failure_code 'duplicate row is rejected' "$TMP_DIR/duplicate.tsv" pre 'database_duplicate_row'

write_fixture "$TMP_DIR/wrong-baseline.tsv" 80
assert_failure_code 'wrong baseline is rejected' "$TMP_DIR/wrong-baseline.tsv" pre 'database_missing_row'

write_fixture "$TMP_DIR/wrong-final-count.tsv" 96
assert_failure_code 'wrong final count is rejected' "$TMP_DIR/wrong-final-count.tsv" post 'database_missing_row'

if MIGRATION_STATE_FILE="$TMP_DIR/pre.tsv" MANIFEST_FILE="$MANIFEST" MIGRATIONS_DIR="$MIGRATIONS" \
  bash "$VERIFIER" verify-db pre > "$TMP_DIR/output.tsv" 2>&1; then
  fail_test 'fixture boundary unexpectedly passed without TEST_MODE=1'
fi
grep -F 'code=test_fixture_forbidden' "$TMP_DIR/output.tsv" >/dev/null || fail_test 'fixture boundary returned the wrong failure'
pass_test 'fixture input is forbidden outside explicit test mode'

cp -R "$MIGRATIONS" "$TMP_DIR/migrations-checksum-mismatch"
printf '\n-- test mutation\n' >> "$TMP_DIR/migrations-checksum-mismatch/20260816000004_legacy_income_application_provenance/migration.sql"
if MANIFEST_FILE="$MANIFEST" MIGRATIONS_DIR="$TMP_DIR/migrations-checksum-mismatch" \
  bash "$VERIFIER" verify-files > "$TMP_DIR/output.tsv" 2>&1; then
  fail_test 'local checksum mismatch unexpectedly passed'
fi
grep -F 'code=local_pending_checksum_mismatch' "$TMP_DIR/output.tsv" >/dev/null || fail_test 'local checksum mismatch returned the wrong failure'
pass_test 'local pending checksum mismatch is rejected'

printf '1..%s\n' "$PASS_COUNT"
