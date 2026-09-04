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
export POSTGRES_CONTAINER='pawtech-postgres'
export POSTGRES_DATABASE='buildingos_db'
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
  backend)
    [[ "$2" == head ]] || exit 1
    object_path="${@: -1}"
    if [[ -n "${MOCK_RCLONE_MISSING_SSE_MATCH:-}" && "$object_path" == *"$MOCK_RCLONE_MISSING_SSE_MATCH"* ]]; then
      printf '{}\n'
    else
      printf '{"X-Amz-Server-Side-Encryption":"AES256"}\n'
    fi
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
if [[ ! -e "$POSTGRES_BACKUP_ROOT/postgres-20260828t121000z-pgreceipt" ]]; then pass "successful PostgreSQL backup removes invocation scratch directory"; else fail_test "successful PostgreSQL backup removes invocation scratch directory"; fi

pg_dump_sse_receipt="$TEST_ROOT/postgres-dump-sse-failure.json"
PATH="$TEST_ROOT/bin:$PATH" MOCK_RCLONE_MISSING_SSE_MATCH='.dump' BACKUP_SET_ID='20260828t121010z-pgdumpsse' APP_SHA="$MOCK_APP_SHA" POSTGRES_RECEIPT_FILE="$pg_dump_sse_receipt" \
  assert_failure "PostgreSQL dump with correct SHA but missing SSE fails" "$ROOT_DIR/scripts/backup-postgres-paired.sh"
assert_absent "PostgreSQL dump SSE failure emits no PASS marker" 'POSTGRES_BACKUP_COMPLETE' "$TEST_ROOT/output"
if [[ ! -e "$pg_dump_sse_receipt" ]]; then pass "PostgreSQL dump SSE failure creates no PASS receipt"; else fail_test "PostgreSQL dump SSE failure creates no PASS receipt"; fi
if [[ ! -e "$POSTGRES_BACKUP_ROOT/postgres-20260828t121010z-pgdumpsse" ]]; then pass "failure after dump creation removes invocation scratch directory"; else fail_test "failure after dump creation removes invocation scratch directory"; fi

pg_checksum_sse_receipt="$TEST_ROOT/postgres-checksum-sse-failure.json"
PATH="$TEST_ROOT/bin:$PATH" MOCK_RCLONE_MISSING_SSE_MATCH='.dump.sha256' BACKUP_SET_ID='20260828t121020z-pgchecksse' APP_SHA="$MOCK_APP_SHA" POSTGRES_RECEIPT_FILE="$pg_checksum_sse_receipt" \
  assert_failure "PostgreSQL checksum with correct content but missing SSE fails" "$ROOT_DIR/scripts/backup-postgres-paired.sh"
assert_absent "PostgreSQL checksum SSE failure emits no PASS marker" 'POSTGRES_BACKUP_COMPLETE' "$TEST_ROOT/output"
if [[ ! -e "$pg_checksum_sse_receipt" ]]; then pass "PostgreSQL checksum SSE failure creates no PASS receipt"; else fail_test "PostgreSQL checksum SSE failure creates no PASS receipt"; fi

pg_receipt_sse_failure="$TEST_ROOT/postgres-receipt-sse-failure.json"
PATH="$TEST_ROOT/bin:$PATH" MOCK_RCLONE_MISSING_SSE_MATCH='postgres-backup-receipt.json' BACKUP_SET_ID='20260828t121030z-pgreceiptsse' APP_SHA="$MOCK_APP_SHA" POSTGRES_RECEIPT_FILE="$pg_receipt_sse_failure" \
  assert_failure "PostgreSQL receipt with correct content but missing SSE fails" "$ROOT_DIR/scripts/backup-postgres-paired.sh"
assert_absent "PostgreSQL receipt SSE failure emits no PASS marker" 'POSTGRES_BACKUP_COMPLETE' "$TEST_ROOT/output"
if [[ ! -e "$pg_receipt_sse_failure" ]]; then pass "PostgreSQL receipt SSE failure publishes no local PASS receipt"; else fail_test "PostgreSQL receipt SSE failure publishes no local PASS receipt"; fi

preexisting_set_id='20260828t121040z-preexisting'
preexisting_run_dir="$POSTGRES_BACKUP_ROOT/postgres-$preexisting_set_id"
mkdir "$preexisting_run_dir"
printf 'preserve\n' > "$preexisting_run_dir/operator-marker"
PATH="$TEST_ROOT/bin:$PATH" BACKUP_SET_ID="$preexisting_set_id" APP_SHA="$MOCK_APP_SHA" POSTGRES_RECEIPT_FILE="$TEST_ROOT/preexisting-receipt.json" \
  assert_failure "pre-existing PostgreSQL run directory fails closed" "$ROOT_DIR/scripts/backup-postgres-paired.sh"
if [[ -f "$preexisting_run_dir/operator-marker" ]]; then pass "pre-existing PostgreSQL run directory remains untouched"; else fail_test "pre-existing PostgreSQL run directory remains untouched"; fi

cleanup_escape_sentinel="$TEST_ROOT/cleanup-escape-sentinel"
printf 'preserve\n' > "$cleanup_escape_sentinel"
PATH="$TEST_ROOT/bin:$PATH" BACKUP_SET_ID='../cleanup-escape-sentinel' APP_SHA="$MOCK_APP_SHA" POSTGRES_RECEIPT_FILE="$TEST_ROOT/unsafe-receipt.json" \
  assert_failure "unsafe BACKUP_SET_ID cannot escape PostgreSQL cleanup root" "$ROOT_DIR/scripts/backup-postgres-paired.sh"
if [[ -f "$cleanup_escape_sentinel" ]]; then pass "unsafe cleanup escape leaves external sentinel untouched"; else fail_test "unsafe cleanup escape leaves external sentinel untouched"; fi
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

jq -n '{status:"SSE_S3_SUPPORTED",algorithm:"AES256",endpoint_identity:"backup.example.invalid:443",bucket:"buildingos-prod-backup-test",probed_at:"2026-08-28T12:00:00Z"}' > "$BACKUP_SSE_CAPABILITY_FILE"
chmod 0640 "$BACKUP_SSE_CAPABILITY_FILE"
BUILDINGOS_BACKUP_TEST_MODE=LOCAL_ISOLATED_ONLY assert_success "SSE capability gate accepts matching AES256 proof" "$ROOT_DIR/scripts/validate-sse-capability.sh"
chmod 0600 "$BACKUP_SSE_CAPABILITY_FILE"
BUILDINGOS_BACKUP_TEST_MODE=LOCAL_ISOLATED_ONLY assert_failure "SSE capability gate rejects service-unreadable evidence" "$ROOT_DIR/scripts/validate-sse-capability.sh"
chmod 0660 "$BACKUP_SSE_CAPABILITY_FILE"
BUILDINGOS_BACKUP_TEST_MODE=LOCAL_ISOLATED_ONLY assert_failure "SSE capability gate rejects writable evidence" "$ROOT_DIR/scripts/validate-sse-capability.sh"
chmod 0640 "$BACKUP_SSE_CAPABILITY_FILE"
jq '.status = "SSE_S3_UNKNOWN"' "$BACKUP_SSE_CAPABILITY_FILE" > "$TEST_ROOT/sse-unknown.json"
BUILDINGOS_BACKUP_TEST_MODE=LOCAL_ISOLATED_ONLY BACKUP_SSE_CAPABILITY_FILE="$TEST_ROOT/sse-unknown.json" assert_failure "SSE unknown blocks activation" "$ROOT_DIR/scripts/validate-sse-capability.sh"

for sse_endpoint_case in \
  'https://backup.example.invalid/|backup.example.invalid:443' \
  'https://backup.example.invalid:443|backup.example.invalid:443' \
  'HTTPS://BACKUP.EXAMPLE.INVALID|backup.example.invalid:443' \
  'http://backup.example.invalid|backup.example.invalid:80' \
  'http://backup.example.invalid:80/|backup.example.invalid:80' \
  'https://backup.example.invalid:8443|backup.example.invalid:8443'; do
  endpoint_case="${sse_endpoint_case%%|*}"
  endpoint_identity_case="${sse_endpoint_case#*|}"
  jq -n --arg endpoint "$endpoint_identity_case" '{status:"SSE_S3_SUPPORTED",algorithm:"AES256",endpoint_identity:$endpoint,bucket:"buildingos-prod-backup-test",probed_at:"2026-08-28T12:00:00Z"}' > "$BACKUP_SSE_CAPABILITY_FILE"
  chmod 0640 "$BACKUP_SSE_CAPABILITY_FILE"
  BACKUP_ENDPOINT="$endpoint_case"
  export BACKUP_ENDPOINT
  BUILDINGOS_BACKUP_TEST_MODE=LOCAL_ISOLATED_ONLY assert_success "SSE endpoint parity: $endpoint_case" "$ROOT_DIR/scripts/validate-sse-capability.sh"
done
export BACKUP_ENDPOINT='https://backup.example.invalid'

assert_contains "anonymous policy removal is documented" 'mc anonymous set none' "$ROOT_DIR/docs/runbooks/PRODUCTION_BACKUP_ACTIVATION.md"
assert_contains "anonymous denial requires 403" "returns \`403\`" "$ROOT_DIR/docs/runbooks/PRODUCTION_BACKUP_ACTIVATION.md"
assert_contains "presigned access remains required" 'presigned PUT/GET' "$ROOT_DIR/docs/runbooks/PRODUCTION_BACKUP_ACTIVATION.md"

policy_controls_valid=true
for policy_file in "$ROOT_DIR"/infra/production/policies/*.json; do
  if ! jq -e '[.Statement[].Action[]] | all(. != "s3:DeleteObject" and . != "s3:BypassGovernanceRetention" and . != "s3:PutObjectRetention" and . != "s3:PutBucketPolicy")' "$policy_file" >/dev/null; then policy_controls_valid=false; fi
  if ! jq -e '[.Statement[].Resource] | all(. != "*")' "$policy_file" >/dev/null; then policy_controls_valid=false; fi
done
if [[ "$policy_controls_valid" == true ]]; then pass "least-privilege policies exclude delete, retention bypass, policy admin, and broad resources"; else fail_test "least-privilege policies exclude dangerous actions"; fi

backup_write_policy="$ROOT_DIR/infra/production/policies/backup-write.json"
verify_read_policy="$ROOT_DIR/infra/production/policies/verify-read.json"
if jq -e '
  any(.Statement[]; (.Action | index("s3:ListBucket")) != null and (.Condition.StringLike["s3:prefix"] | index("_capability-probes/*")) != null) and
  any(.Statement[]; (.Action | index("s3:PutObject")) != null and ((.Resource | arrays) | index("arn:aws:s3:::BUILDINGOS_BACKUP_BUCKET/_capability-probes/*")) != null)
' "$backup_write_policy" >/dev/null; then pass "BACKUP_WRITE can list and write only the capability probe prefix"; else fail_test "BACKUP_WRITE can list and write only the capability probe prefix"; fi
if jq -e '
  all(.Statement[]; ((.Resource | arrays) // []) | all(. == "arn:aws:s3:::BUILDINGOS_BACKUP_BUCKET/buildingos/production/*" or . == "arn:aws:s3:::BUILDINGOS_BACKUP_BUCKET/postgresql/*" or . == "arn:aws:s3:::BUILDINGOS_BACKUP_BUCKET/_capability-probes/*")) and
  ([.Statement[].Action[]] | index("s3:DeleteObject")) == null and
  ([.Statement[].Action[]] | index("s3:GetObject")) == null
' "$backup_write_policy" >/dev/null; then pass "BACKUP_WRITE cannot access unrelated prefixes, read, or delete"; else fail_test "BACKUP_WRITE cannot access unrelated prefixes, read, or delete"; fi
if jq -e '
  any(.Statement[]; (.Action | index("s3:ListBucket")) != null and (.Condition.StringLike["s3:prefix"] | index("_capability-probes/*")) != null) and
  any(.Statement[]; (.Action | index("s3:GetObject")) != null and ((.Resource | arrays) | index("arn:aws:s3:::BUILDINGOS_BACKUP_BUCKET/_capability-probes/*")) != null) and
  ([.Statement[].Action[]] | all(. != "s3:PutObject" and . != "s3:DeleteObject"))
' "$verify_read_policy" >/dev/null; then pass "VERIFY_READ can inspect probes but cannot write or delete"; else fail_test "VERIFY_READ can inspect probes but cannot write or delete"; fi

production_env_example="$ROOT_DIR/infra/production/buildingos-backup.env.example"
if grep -Fxq 'POSTGRES_CONTAINER=pawtech-postgres' "$production_env_example" &&
  grep -Fxq 'POSTGRES_DATABASE=buildingos_db' "$production_env_example" &&
  grep -Fxq 'POSTGRES_USER=buildingos' "$production_env_example" &&
  grep -Fxq 'SOURCE_BUCKET=buildingos-production' "$production_env_example" &&
  ! grep -Fxq 'SOURCE_BUCKET=buildingos' "$production_env_example" &&
  grep -Fq "export SOURCE_BUCKET='buildingos-production'" "$ROOT_DIR/docs/runbooks/MINIO_BACKUP_RECOVERY.md" &&
  grep -Fq "readonly POSTGRES_CONTAINER='pawtech-postgres'" "$ROOT_DIR/scripts/deploy-production.sh" &&
  grep -Fq "readonly POSTGRES_CONTAINER='pawtech-postgres'" "$ROOT_DIR/scripts/rollback-production.sh" &&
  grep -Fq 'DATABASE_NAME=buildingos_db' "$ROOT_DIR/scripts/deploy-production.sh" &&
  grep -Fq -- "-U \"\$POSTGRES_USER\" -d buildingos_db" "$ROOT_DIR/scripts/rollback-production.sh"; then
  pass "production backup identifiers match canonical deploy and rollback evidence"
else
  fail_test "production backup identifiers match canonical deploy and rollback evidence"
fi

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
