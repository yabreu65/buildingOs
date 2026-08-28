#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-backup-activation-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
PASS_COUNT=0
FAIL_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok - %s\n' "$1" >&2; }
assert_success() { local name="$1"; shift; if "$@" > "$TEST_ROOT/output" 2>&1; then pass "$name"; else fail_test "$name"; command cat "$TEST_ROOT/output" >&2; fi; }
assert_failure() { local name="$1"; shift; if "$@" > "$TEST_ROOT/output" 2>&1; then fail_test "$name (unexpected success)"; else pass "$name"; fi; }
assert_contains() { local name="$1" value="$2" file="$3"; if grep -Fq -- "$value" "$file"; then pass "$name"; else fail_test "$name"; fi; }
assert_absent() { local name="$1" value="$2" file="$3"; if grep -Fq -- "$value" "$file"; then fail_test "$name"; else pass "$name"; fi; }

mkdir -p "$TEST_ROOT/coordinator" "$TEST_ROOT/state" "$TEST_ROOT/bin" "$TEST_ROOT/pg-root" "$TEST_ROOT/remote"
cp "$ROOT_DIR/scripts/backup-buildingos-production.sh" "$TEST_ROOT/coordinator/"

cat > "$TEST_ROOT/coordinator/validate-sse-capability.sh" <<'MOCK'
#!/usr/bin/env bash
[[ "${MOCK_SSE_RESULT:-PASS}" == PASS ]] || exit 1
printf 'SSE_S3_SUPPORTED\nSTATUS=PASS\n'
MOCK
cat > "$TEST_ROOT/coordinator/resolve-production-app-sha.sh" <<'MOCK'
#!/usr/bin/env bash
[[ "${MOCK_APP_RESULT:-PASS}" == PASS ]] || exit 1
printf '%s\n' "${MOCK_APP_SHA:?}"
MOCK
cat > "$TEST_ROOT/coordinator/backup-postgres-paired.sh" <<'MOCK'
#!/usr/bin/env bash
printf 'postgres:%s:%s\n' "$BACKUP_SET_ID" "$APP_SHA" >> "$MOCK_LOG"
[[ "${MOCK_PG_RESULT:-PASS}" == PASS ]] || exit 1
jq -n --arg setId "$BACKUP_SET_ID" --arg appSha "$APP_SHA" '{version:1,status:"PASS",backup_set_id:$setId,app_sha:$appSha,postgres_backup_id:("postgres-"+$setId),postgres_sha256:("a"*64),dump_filename:"buildingos.dump",remote_object_prefix:("postgresql/"+$setId),encryption:"SSE-S3",completed_at:"2026-08-28T12:00:00Z"}' > "$POSTGRES_RECEIPT_FILE"
printf 'POSTGRES_BACKUP_COMPLETE\nSTATUS=PASS\n'
MOCK
cat > "$TEST_ROOT/coordinator/backup-minio.sh" <<'MOCK'
#!/usr/bin/env bash
printf 'minio:%s:%s\n' "$BACKUP_SET_ID" "$APP_SHA" >> "$MOCK_LOG"
jq -e --arg setId "$BACKUP_SET_ID" --arg appSha "$APP_SHA" '.status == "PASS" and .backup_set_id == $setId and .app_sha == $appSha' "$POSTGRES_BACKUP_RECEIPT_FILE" >/dev/null
[[ "${MOCK_MINIO_RESULT:-PASS}" == PASS ]] || exit 1
printf 'MINIO_BACKUP_COMPLETE\nSTATUS=PASS\n'
MOCK
cat > "$TEST_ROOT/coordinator/verify-minio-backup.sh" <<'MOCK'
#!/usr/bin/env bash
printf 'verify:%s:%s\n' "$BACKUP_SET_ID" "$EXPECTED_APP_SHA" >> "$MOCK_LOG"
[[ "${MOCK_VERIFY_RESULT:-PASS}" == PASS ]] || exit 1
printf 'MINIO_BACKUP_VERIFY_COMPLETE\nSTATUS=PASS\nBACKUP_SET_ID=%s\nAPP_SHA=%s\n' "$BACKUP_SET_ID" "$EXPECTED_APP_SHA"
MOCK
chmod +x "$TEST_ROOT/coordinator/"*.sh

export MOCK_LOG="$TEST_ROOT/mock.log"
export MOCK_APP_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export BACKUP_ENDPOINT='https://backup.example.invalid'
export BACKUP_BUCKET='buildingos-prod-backup-test'
export BACKUP_WRITE_ACCESS_KEY='WRITE_ACCESS_SENTINEL'
export BACKUP_WRITE_SECRET_KEY='WRITE_SECRET_SENTINEL'
export BACKUP_VERIFY_ACCESS_KEY='VERIFY_ACCESS_SENTINEL'
export BACKUP_VERIFY_SECRET_KEY='VERIFY_SECRET_SENTINEL'
export BACKUP_SSE_CAPABILITY_FILE="$TEST_ROOT/sse.json"
export BACKUP_STATE_DIR="$TEST_ROOT/state"
export SOURCE_ENVIRONMENT='production'
export EXPECTED_SOURCE_ENVIRONMENT='production'
export SOURCE_ENDPOINT='https://source.example.invalid'
export SOURCE_ACCESS_KEY='SOURCE_ACCESS_SENTINEL'
export SOURCE_SECRET_KEY='SOURCE_SECRET_SENTINEL'
export SOURCE_BUCKET='buildingos'
export POSTGRES_CONTAINER='buildingos-postgres'
export POSTGRES_DATABASE='buildingos'
export POSTGRES_USER='buildingos'
export POSTGRES_BACKUP_ROOT="$TEST_ROOT/pg-root"
export POSTGRES_RCLONE_DESTINATION='contabowrite:buildingos-prod-backup-test/postgresql'
export POSTGRES_VERIFY_RCLONE_DESTINATION='contaboverify:buildingos-prod-backup-test/postgresql'
export POSTGRES_SSE_MODE='SSE-S3'
printf '{}\n' > "$BACKUP_SSE_CAPABILITY_FILE"

BACKUP_SET_ID='20260828t120000z-testset' assert_success "paired coordinator succeeds" "$TEST_ROOT/coordinator/backup-buildingos-production.sh"
cp "$TEST_ROOT/output" "$TEST_ROOT/success-output"
assert_contains "paired success marker emitted" 'BUILDINGOS_PAIRED_BACKUP_COMPLETE' "$TEST_ROOT/success-output"
assert_contains "shared backup set reaches PostgreSQL" 'postgres:20260828t120000z-testset' "$MOCK_LOG"
assert_contains "shared backup set reaches MinIO" 'minio:20260828t120000z-testset' "$MOCK_LOG"
assert_contains "APP_SHA binds verification" "verify:20260828t120000z-testset:$MOCK_APP_SHA" "$MOCK_LOG"
for sentinel in SOURCE_ACCESS_SENTINEL SOURCE_SECRET_SENTINEL WRITE_ACCESS_SENTINEL WRITE_SECRET_SENTINEL VERIFY_ACCESS_SENTINEL VERIFY_SECRET_SENTINEL; do
  assert_absent "secret $sentinel is absent from output" "$sentinel" "$TEST_ROOT/success-output"
done

: > "$MOCK_LOG"
MOCK_PG_RESULT=FAIL BACKUP_SET_ID='20260828t120100z-pgfail' assert_failure "PostgreSQL failure fails coordinator" "$TEST_ROOT/coordinator/backup-buildingos-production.sh"
assert_absent "PostgreSQL failure does not invoke MinIO" 'minio:' "$MOCK_LOG"
assert_absent "PostgreSQL failure emits no paired PASS" 'BUILDINGOS_PAIRED_BACKUP_COMPLETE' "$TEST_ROOT/output"

: > "$MOCK_LOG"
MOCK_APP_RESULT=FAIL BACKUP_SET_ID='20260828t120200z-appfail' assert_failure "APP SHA resolution failure stops backup" "$TEST_ROOT/coordinator/backup-buildingos-production.sh"
assert_absent "APP SHA failure does not invoke PostgreSQL" 'postgres:' "$MOCK_LOG"

: > "$MOCK_LOG"
MOCK_MINIO_RESULT=FAIL BACKUP_SET_ID='20260828t120300z-miniofail' assert_failure "MinIO failure fails coordinator" "$TEST_ROOT/coordinator/backup-buildingos-production.sh"
assert_absent "MinIO failure emits no paired PASS" 'BUILDINGOS_PAIRED_BACKUP_COMPLETE' "$TEST_ROOT/output"

: > "$MOCK_LOG"
MOCK_VERIFY_RESULT=FAIL BACKUP_SET_ID='20260828t120400z-verifyfail' assert_failure "verification failure fails coordinator" "$TEST_ROOT/coordinator/backup-buildingos-production.sh"
assert_absent "verification failure emits no paired PASS" 'BUILDINGOS_PAIRED_BACKUP_COMPLETE' "$TEST_ROOT/output"

: > "$MOCK_LOG"
MOCK_SSE_RESULT=FAIL BACKUP_SET_ID='20260828t120500z-ssefail' assert_failure "unsupported SSE stops activation before backup" "$TEST_ROOT/coordinator/backup-buildingos-production.sh"
assert_absent "SSE failure does not invoke PostgreSQL" 'postgres:' "$MOCK_LOG"

cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == exec ]]; then
  [[ "${MOCK_PG_DUMP_RESULT:-PASS}" == PASS ]] || exit 1
  printf 'PGDMP mock custom archive\n'
elif [[ "$1 $2" == 'inspect --type' ]]; then
  case "${@: -1}" in
    buildingos-api) printf 'sha256:%064d\n' 1 ;;
    buildingos-web) printf 'sha256:%064d\n' 2 ;;
  esac
elif [[ "$1 $2" == 'image inspect' ]]; then
  case "$3" in
    sha256:*1) printf '%040d\n' 1 ;;
    sha256:*2) printf '%040d\n' "${MOCK_WEB_REVISION:-1}" ;;
  esac
fi
MOCK
cat > "$TEST_ROOT/bin/pg_restore" <<'MOCK'
#!/usr/bin/env bash
[[ "${MOCK_PG_RESTORE_RESULT:-PASS}" == PASS ]] || exit 1
printf '; mock custom archive TOC\n'
MOCK
cat > "$TEST_ROOT/bin/rclone" <<'MOCK'
#!/usr/bin/env bash
remote_path() { printf '%s/%s\n' "$MOCK_REMOTE" "${1#*:}"; }
case "$1" in
  copyto)
    source_value="${@: -2:1}"
    destination_value="${@: -1}"
    destination="$(remote_path "$destination_value")"
    /bin/mkdir -p "$(dirname "$destination")"
    /bin/cp "$source_value" "$destination"
    ;;
  cat)
    /bin/cat "$(remote_path "$2")"
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$TEST_ROOT/bin/docker" "$TEST_ROOT/bin/pg_restore" "$TEST_ROOT/bin/rclone"
PATH="$TEST_ROOT/bin:$PATH" assert_success "deployed SHA resolver accepts matching API/Web labels" "$ROOT_DIR/scripts/resolve-production-app-sha.sh"
PATH="$TEST_ROOT/bin:$PATH" MOCK_WEB_REVISION=2 assert_failure "API/Web SHA disagreement fails closed" "$ROOT_DIR/scripts/resolve-production-app-sha.sh"

export MOCK_REMOTE="$TEST_ROOT/remote"
pg_receipt="$TEST_ROOT/postgres-success.json"
PATH="$TEST_ROOT/bin:$PATH" \
  BACKUP_SET_ID='20260828t121000z-pgreceipt' \
  APP_SHA="$MOCK_APP_SHA" \
  POSTGRES_RECEIPT_FILE="$pg_receipt" \
  assert_success "PostgreSQL backup emits PASS receipt after remote verification" "$ROOT_DIR/scripts/backup-postgres-paired.sh"
assert_contains "PostgreSQL completion marker emitted" 'POSTGRES_BACKUP_COMPLETE' "$TEST_ROOT/output"
if jq -e --arg setId '20260828t121000z-pgreceipt' --arg appSha "$MOCK_APP_SHA" '.status == "PASS" and .backup_set_id == $setId and .app_sha == $appSha and (.postgres_sha256 | test("^[0-9a-f]{64}$"))' "$pg_receipt" >/dev/null; then
  pass "PostgreSQL receipt binds backup set, APP_SHA, and SHA-256"
else
  fail_test "PostgreSQL receipt binds backup set, APP_SHA, and SHA-256"
fi
failed_pg_receipt="$TEST_ROOT/postgres-failure.json"
PATH="$TEST_ROOT/bin:$PATH" \
  MOCK_PG_DUMP_RESULT=FAIL \
  BACKUP_SET_ID='20260828t121100z-pgfailure' \
  APP_SHA="$MOCK_APP_SHA" \
  POSTGRES_RECEIPT_FILE="$failed_pg_receipt" \
  assert_failure "PostgreSQL dump failure emits no PASS receipt" "$ROOT_DIR/scripts/backup-postgres-paired.sh"
assert_absent "PostgreSQL failure has no completion marker" 'POSTGRES_BACKUP_COMPLETE' "$TEST_ROOT/output"
if [[ ! -e "$failed_pg_receipt" ]]; then pass "PostgreSQL failure creates no PASS receipt"; else fail_test "PostgreSQL failure creates no PASS receipt"; fi

assert_success "restore policy generator accepts rehearsal target" "$ROOT_DIR/scripts/render-minio-restore-target-policy.sh" --environment rehearsal --endpoint-identity restore.example.invalid:443 --bucket buildingos-rehearsal-restore-test
assert_absent "restore policy excludes production" 'production' "$TEST_ROOT/output"
assert_failure "restore policy generator rejects production" "$ROOT_DIR/scripts/render-minio-restore-target-policy.sh" --environment production --endpoint-identity prod.example.invalid:443 --bucket buildingos-production

jq -n '{status:"SSE_S3_SUPPORTED",algorithm:"AES256",endpoint_identity:"backup.example.invalid",bucket:"buildingos-prod-backup-test",probed_at:"2026-08-28T12:00:00Z"}' > "$BACKUP_SSE_CAPABILITY_FILE"
chmod 0600 "$BACKUP_SSE_CAPABILITY_FILE"
BUILDINGOS_BACKUP_TEST_MODE=LOCAL_ISOLATED_ONLY assert_success "SSE capability gate accepts matching AES256 proof" "$ROOT_DIR/scripts/validate-sse-capability.sh"
jq '.status = "SSE_S3_UNKNOWN"' "$BACKUP_SSE_CAPABILITY_FILE" > "$TEST_ROOT/sse-unknown.json"
BUILDINGOS_BACKUP_TEST_MODE=LOCAL_ISOLATED_ONLY BACKUP_SSE_CAPABILITY_FILE="$TEST_ROOT/sse-unknown.json" assert_failure "SSE unknown blocks activation" "$ROOT_DIR/scripts/validate-sse-capability.sh"

assert_contains "anonymous policy removal is documented" 'mc anonymous set none' "$ROOT_DIR/docs/runbooks/PRODUCTION_BACKUP_ACTIVATION.md"
assert_contains "anonymous denial requires 403" "returns \`403\`" "$ROOT_DIR/docs/runbooks/PRODUCTION_BACKUP_ACTIVATION.md"
assert_contains "presigned access remains required" 'presigned PUT/GET' "$ROOT_DIR/docs/runbooks/PRODUCTION_BACKUP_ACTIVATION.md"

policy_controls_valid=true
for policy_file in "$ROOT_DIR"/infra/production/policies/*.json; do
  if ! jq -e '[.Statement[].Action[]] | all(. != "s3:DeleteObject" and . != "s3:BypassGovernanceRetention" and . != "s3:PutObjectRetention" and . != "s3:PutBucketPolicy")' "$policy_file" >/dev/null; then policy_controls_valid=false; fi
  if ! jq -e '[.Statement[].Resource] | all(. != "*")' "$policy_file" >/dev/null; then policy_controls_valid=false; fi
done
if [[ "$policy_controls_valid" == true ]]; then pass "least-privilege policies exclude delete, retention bypass, policy admin, and broad resources"; else fail_test "least-privilege policies exclude dangerous actions"; fi

systemd_controls_valid=true
for timer_file in "$ROOT_DIR"/infra/production/systemd/*.timer; do grep -Fxq 'Persistent=true' "$timer_file" || systemd_controls_valid=false; done
for service_file in "$ROOT_DIR"/infra/production/systemd/*.service; do grep -Fxq 'NoNewPrivileges=true' "$service_file" || systemd_controls_valid=false; done
if grep -REq '(ACCESS_KEY|SECRET_KEY|PASSWORD)=' "$ROOT_DIR/infra/production/systemd"; then systemd_controls_valid=false; fi
if [[ "$systemd_controls_valid" == true ]]; then pass "systemd units are persistent, hardened, and contain no embedded credentials"; else fail_test "systemd units are persistent, hardened, and contain no embedded credentials"; fi

freshness_state="$TEST_ROOT/freshness.env"
printf 'COMPLETED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$freshness_state"
BACKUP_STATE_FILE="$freshness_state" MAX_BACKUP_AGE_SECONDS=3600 assert_success "fresh paired backup evidence passes age check" "$ROOT_DIR/scripts/check-production-backup-freshness.sh"
printf 'COMPLETED_AT=2020-01-01T00:00:00Z\n' > "$freshness_state"
BACKUP_STATE_FILE="$freshness_state" MAX_BACKUP_AGE_SECONDS=3600 assert_failure "stale paired backup evidence fails age check" "$ROOT_DIR/scripts/check-production-backup-freshness.sh"

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s test(s) failed; %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
