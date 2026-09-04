#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-minio-paired-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok - %s\n' "$1" >&2; }
assert_success() { local name="$1"; shift; if "$@" > "$TEST_ROOT/output" 2>&1; then pass "$name"; else fail_test "$name"; command cat "$TEST_ROOT/output" >&2; fi; }
assert_failure() { local name="$1"; shift; if "$@" > "$TEST_ROOT/output" 2>&1; then fail_test "$name (unexpected success)"; else pass "$name"; fi; }
assert_contains() { local name="$1" value="$2" file="$3"; if grep -Fq -- "$value" "$file"; then pass "$name"; else fail_test "$name"; fi; }
assert_absent() { local name="$1" value="$2" file="$3"; if grep -Fq -- "$value" "$file"; then fail_test "$name"; else pass "$name"; fi; }

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/source/buildingos/tenant-test/documents" "$TEST_ROOT/backup/buildingos-prod-backup-test" "$TEST_ROOT/target/buildingos-test-restore-minio"
printf 'non-sensitive test object\n' > "$TEST_ROOT/source/buildingos/tenant-test/documents/test.txt"
export MOCK_SOURCE="$TEST_ROOT/source"
export MOCK_BACKUP="$TEST_ROOT/backup"
export MOCK_TARGET="$TEST_ROOT/target"
export MOCK_MC_LOG="$TEST_ROOT/mc.log"

cat > "$TEST_ROOT/bin/mc" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'mc' >> "$MOCK_MC_LOG"
printf ' %q' "$@" >> "$MOCK_MC_LOG"
printf '\n' >> "$MOCK_MC_LOG"

map_path() {
  local value="$1" alias="${1%%/*}" remainder="${1#*/}"
  case "$alias" in
    source) printf '%s/%s\n' "$MOCK_SOURCE" "$remainder" ;;
    backup|probe-write|probe-read) printf '%s/%s\n' "$MOCK_BACKUP" "$remainder" ;;
    target) printf '%s/%s\n' "$MOCK_TARGET" "$remainder" ;;
    *) return 1 ;;
  esac
}

case "$1" in
  alias)
    exit 0
    ;;
  stat)
    test -e "$(map_path "${@: -1}")" || exit 1
    if [[ "$*" == *'--json'* ]]; then
      object_path="${@: -1}"
      if [[ -n "${MOCK_MC_MISSING_SSE_MATCH:-}" && "$object_path" == *"$MOCK_MC_MISSING_SSE_MATCH"* ]]; then
        printf '{"metadata":{}}\n'
      else
        printf '{"metadata":{"X-Amz-Server-Side-Encryption":"AES256"}}\n'
      fi
    fi
    ;;
  cat)
    /bin/cat "$(map_path "${@: -1}")"
    ;;
  ls)
    requested="${@: -1}"
    root="$(map_path "$requested")"
    [[ -d "$root" ]] || exit 0
    while IFS= read -r file; do
      relative="${file#"$root"/}"
      prefix="${requested#*/}"
      key="$relative"
      if [[ "$requested" == backup/* ]]; then key="$prefix/$relative"; fi
      size="$(wc -c < "$file" | tr -d ' ')"
      printf '{"type":"file","key":"%s","size":%s}\n' "$key" "$size"
    done < <(find "$root" -type f | sort)
    ;;
  mirror)
    source_value="${@: -2:1}"
    destination_value="${@: -1}"
    source_path="$(map_path "$source_value")"
    destination_path="$(map_path "$destination_value")"
    mkdir -p "$destination_path"
    cp -R "$source_path"/. "$destination_path"/
    ;;
  cp)
    source_value="${@: -2:1}"
    destination_value="${@: -1}"
    case "$source_value" in source/*|backup/*|probe-write/*|probe-read/*|target/*) source_path="$(map_path "$source_value")" ;; *) source_path="$source_value" ;; esac
    case "$destination_value" in source/*|backup/*|probe-write/*|probe-read/*|target/*) destination_path="$(map_path "$destination_value")" ;; *) destination_path="$destination_value" ;; esac
    mkdir -p "$(dirname "$destination_path")"
    if [[ "$*" == *'--recursive'* ]]; then
      mkdir -p "$destination_path"
      cp -R "$source_path"/. "$destination_path"/
    else
      cp "$source_path" "$destination_path"
    fi
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$TEST_ROOT/bin/mc"

export PATH="$TEST_ROOT/bin:$PATH"
export BUILDINGOS_BACKUP_TEST_MODE='LOCAL_ISOLATED_ONLY'
export SOURCE_ENVIRONMENT='production'
export EXPECTED_SOURCE_ENVIRONMENT='production'
export SOURCE_ENDPOINT='https://source.example.invalid'
export SOURCE_ACCESS_KEY='SOURCE_ACCESS_SENTINEL'
export SOURCE_SECRET_KEY='SOURCE_SECRET_SENTINEL'
export SOURCE_BUCKET='buildingos'
export BACKUP_ENDPOINT='https://backup.example.invalid'
export BACKUP_ACCESS_KEY='BACKUP_ACCESS_SENTINEL'
export BACKUP_SECRET_KEY='BACKUP_SECRET_SENTINEL'
export BACKUP_WRITE_ACCESS_KEY='PROBE_WRITE_ACCESS_SENTINEL'
export BACKUP_WRITE_SECRET_KEY='PROBE_WRITE_SECRET_SENTINEL'
export BACKUP_VERIFY_ACCESS_KEY='PROBE_READ_ACCESS_SENTINEL'
export BACKUP_VERIFY_SECRET_KEY='PROBE_READ_SECRET_SENTINEL'
export BACKUP_BUCKET='buildingos-prod-backup-test'
export BACKUP_SET_ID='20260828t130000z-minio-test'
export APP_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export EXPECTED_APP_SHA="$APP_SHA"
export POSTGRES_BACKUP_RECEIPT_FILE="$TEST_ROOT/postgres-receipt.json"
export BACKUP_SSE_CAPABILITY_FILE="$TEST_ROOT/sse-capability.json"

SSE_CAPABILITY_OUTPUT="$TEST_ROOT/probe-capability.json" assert_success "SSE probe uses split write/read identities and proves AES256" "$ROOT_DIR/scripts/probe-contabo-sse-s3.sh"
assert_contains "SSE probe emits supported classification" 'SSE_S3_SUPPORTED' "$TEST_ROOT/output"

BACKUP_PREFIX='../archive' assert_failure "MinIO backup rejects unsafe BACKUP_PREFIX" "$ROOT_DIR/scripts/backup-minio.sh"

postgres_remote_dir="$MOCK_BACKUP/$BACKUP_BUCKET/postgresql/$BACKUP_SET_ID"
mkdir -p "$postgres_remote_dir"
printf 'PGDMP paired remote test archive\n' > "$postgres_remote_dir/buildingos.dump"
postgres_sha256="$(sha256sum "$postgres_remote_dir/buildingos.dump" | cut -d ' ' -f1)"
jq -n --arg setId "$BACKUP_SET_ID" --arg appSha "$APP_SHA" --arg postgresSha "$postgres_sha256" '{version:1,status:"PASS",backup_set_id:$setId,started_at:"2026-08-28T12:00:00Z",completed_at:"2026-08-28T12:01:00Z",app_sha:$appSha,postgres_backup_id:("postgres-"+$setId),postgres_sha256:$postgresSha,dump_filename:"buildingos.dump",destination:("contabo:buildingos-prod-backup-test/postgresql/"+$setId),remote_object_prefix:("postgresql/"+$setId),encryption:"SSE-S3"}' > "$POSTGRES_BACKUP_RECEIPT_FILE"
printf '%s  %s\n' "$postgres_sha256" 'buildingos.dump' > "$postgres_remote_dir/buildingos.dump.sha256"
cp "$POSTGRES_BACKUP_RECEIPT_FILE" "$postgres_remote_dir/postgres-backup-receipt.json"
jq -n '{status:"SSE_S3_SUPPORTED",algorithm:"AES256",endpoint_identity:"backup.example.invalid:443",bucket:"buildingos-prod-backup-test",probed_at:"2026-08-28T12:02:00Z"}' > "$BACKUP_SSE_CAPABILITY_FILE"
chmod 0640 "$POSTGRES_BACKUP_RECEIPT_FILE" "$BACKUP_SSE_CAPABILITY_FILE"

assert_success "real MinIO backup script publishes a paired set" "$ROOT_DIR/scripts/backup-minio.sh"
cp "$TEST_ROOT/output" "$TEST_ROOT/backup-output"
assert_contains "MinIO backup completion marker emitted" 'MINIO_BACKUP_COMPLETE' "$TEST_ROOT/backup-output"
assert_contains "all backup writes request SSE-S3" '--enc-s3' "$MOCK_MC_LOG"
receipt="$MOCK_BACKUP/$BACKUP_BUCKET/buildingos/production/$BACKUP_SET_ID/meta/backup-receipt.json"
if jq -e --arg setId "$BACKUP_SET_ID" --arg appSha "$APP_SHA" '.status == "PASS" and .backup_set_id == $setId and .app_sha == $appSha and .encryption == "SSE-S3" and (.postgres_receipt_sha256 | test("^[0-9a-f]{64}$"))' "$receipt" >/dev/null; then
  pass "MinIO receipt binds PostgreSQL evidence, APP_SHA, and SSE-S3"
else
  fail_test "MinIO receipt binds PostgreSQL evidence, APP_SHA, and SSE-S3"
fi

assert_success "real independent verifier validates the paired set" "$ROOT_DIR/scripts/verify-minio-backup.sh"
assert_contains "independent verification completion marker emitted" 'MINIO_BACKUP_VERIFY_COMPLETE' "$TEST_ROOT/output"

for missing_sse_case in \
  'objects/|MinIO data object with same content and SHA but missing SSE' \
  'meta/minio-manifest.json|MinIO manifest with correct content but missing SSE' \
  'meta/minio-manifest.sha256|MinIO manifest checksum with correct content but missing SSE' \
  'meta/backup-receipt.json|MinIO backup receipt with correct content but missing SSE' \
  'meta/postgres-backup-receipt.json|embedded PostgreSQL receipt with correct content but missing SSE'; do
  missing_match="${missing_sse_case%%|*}"
  missing_name="${missing_sse_case#*|}"
  MOCK_MC_MISSING_SSE_MATCH="$missing_match" assert_failure "$missing_name fails verification" "$ROOT_DIR/scripts/verify-minio-backup.sh"
  assert_absent "$missing_name emits no verify PASS marker" 'MINIO_BACKUP_VERIFY_COMPLETE' "$TEST_ROOT/output"
done

restore_policy="$TEST_ROOT/restore-policy.json"
jq -n '{rehearsal:{endpoint_identity:"127.0.0.1:19000",bucket:"buildingos-test-restore-minio"}}' > "$restore_policy"
chmod 0600 "$restore_policy"
export TARGET_ENDPOINT='http://127.0.0.1:19000'
export TARGET_ACCESS_KEY='TARGET_ACCESS_SENTINEL'
export TARGET_SECRET_KEY='TARGET_SECRET_SENTINEL'
export TARGET_BUCKET='buildingos-test-restore-minio'
export TARGET_ENVIRONMENT='rehearsal'
export RESTORE_CONFIRMATION='RESTORE TO NON-PRODUCTION'
export MINIO_RESTORE_TEST_MODE='LOCAL_ISOLATED_ONLY'
export MINIO_RESTORE_TEST_POLICY_FILE="$restore_policy"
assert_success "isolated restore validates paired PostgreSQL evidence before object copy" "$ROOT_DIR/scripts/restore-minio.sh"
assert_contains "isolated restore completion marker emitted" 'MINIO_RESTORE_COMPLETE' "$TEST_ROOT/output"

mkdir -p "$MOCK_TARGET/buildingos-test-restore-ipv6"
ipv6_restore_policy="$TEST_ROOT/restore-policy-ipv6.json"
jq -n '{rehearsal:{endpoint_identity:"[::1]:19000",bucket:"buildingos-test-restore-ipv6"}}' > "$ipv6_restore_policy"
chmod 0600 "$ipv6_restore_policy"
export TARGET_ENDPOINT='http://[::1]:19000'
export TARGET_BUCKET='buildingos-test-restore-ipv6'
export MINIO_RESTORE_TEST_POLICY_FILE="$ipv6_restore_policy"
assert_success "isolated restore accepts supported IPv6 loopback endpoint" "$ROOT_DIR/scripts/restore-minio.sh"
assert_contains "IPv6 isolated restore completion marker emitted" 'MINIO_RESTORE_COMPLETE' "$TEST_ROOT/output"

for sentinel in SOURCE_ACCESS_SENTINEL SOURCE_SECRET_SENTINEL BACKUP_ACCESS_SENTINEL BACKUP_SECRET_SENTINEL TARGET_ACCESS_SENTINEL TARGET_SECRET_SENTINEL; do
  if grep -Fq -- "$sentinel" "$TEST_ROOT/backup-output" "$TEST_ROOT/output"; then fail_test "secret $sentinel is absent from output"; else pass "secret $sentinel is absent from output"; fi
done

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s test(s) failed; %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
