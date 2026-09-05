#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"
readonly WORKFLOW="$ROOT_DIR/.github/workflows/production-readonly-audit.yml"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-readonly-audit.XXXXXX")"
readonly RECEIPT="$TEST_ROOT/object-backup-receipt.json"
readonly OUTPUT="$TEST_ROOT/output"
trap 'rm -rf "$TEST_ROOT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok %s - %s\n' "$FAIL_COUNT" "$1" >&2; }

assert_contains() {
  local name="$1" value="$2" text="$3"
  if [[ "$text" == *"$value"* ]]; then pass "$name"; else fail_test "$name"; fi
}

assert_absent() {
  local name="$1" value="$2" text="$3"
  if [[ "$text" != *"$value"* ]]; then pass "$name"; else fail_test "$name"; fi
}

assert_valid_receipt() {
  local name="$1"
  if validate_object_backup_receipt "$RECEIPT"; then pass "$name"; else fail_test "$name"; fi
}

assert_invalid_receipt() {
  local name="$1"
  if validate_object_backup_receipt "$RECEIPT"; then fail_test "$name"; else pass "$name"; fi
}

source "$AUDITOR"

write_receipt() {
  local source="${1-prod:buildingos-production}"
  local destination="${2-backup:buildingos-production-backup}"
  local copy_status="${3-PASS}"
  local verification_status="${4-PASS}"
  local recovery_point_valid="${5-NOT_EVALUATED}"
  local completed_at="${6-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  jq -n \
    --arg source "$source" \
    --arg destination "$destination" \
    --arg copy_status "$copy_status" \
    --arg verification_status "$verification_status" \
    --arg recovery_point_valid "$recovery_point_valid" \
    --arg completed_at "$completed_at" \
    '{receipt_version:1,started_at_utc:$completed_at,completed_at_utc:$completed_at,source:$source,destination:$destination,copy_status:$copy_status,verification_status:$verification_status,status:"PASS",recovery_point_valid:$recovery_point_valid}' > "$RECEIPT"
  chmod 0600 "$RECEIPT"
}

write_receipt
assert_valid_receipt 'valid Object Storage PASS receipt is accepted'
AUDIT_EVIDENCE_FAILURES=0
report_object_backup_receipt "$RECEIPT" > "$OUTPUT"
REPORT_OUTPUT="$(< "$OUTPUT")"
assert_contains 'valid receipt reports PASS' 'OBJECT_BACKUP_RECEIPT=PASS' "$REPORT_OUTPUT"
assert_contains 'valid receipt reports copy PASS' 'OBJECT_BACKUP_COPY=PASS' "$REPORT_OUTPUT"
assert_contains 'reference reconciliation remains unimplemented' 'DB_OBJECT_REFERENCE_RECONCILIATION=NOT_IMPLEMENTED' "$REPORT_OUTPUT"
assert_contains 'content identity remains unimplemented' 'DB_OBJECT_CONTENT_IDENTITY=NOT_IMPLEMENTED' "$REPORT_OUTPUT"
assert_contains 'recovery point remains unevaluated' 'RECOVERY_POINT_VALID=NOT_EVALUATED' "$REPORT_OUTPUT"
assert_contains 'backup readiness remains incomplete' 'BACKUP_READINESS=INCOMPLETE' "$REPORT_OUTPUT"
[[ "$AUDIT_EVIDENCE_FAILURES" -gt 0 ]] && pass 'valid copy does not clear fail-closed evidence failure' || fail_test 'valid copy does not clear fail-closed evidence failure'

printf '{malformed\n' > "$RECEIPT"
assert_invalid_receipt 'malformed receipt fails closed'
REPORT_OUTPUT="$(report_object_backup_receipt "$RECEIPT")"
assert_contains 'malformed receipt is incomplete' 'OBJECT_BACKUP_RECEIPT=INCOMPLETE' "$REPORT_OUTPUT"

write_receipt prod:buildingos-production backup:buildingos-production-backup PASS PASS NOT_EVALUATED 2010-01-01T00:00:00Z
assert_invalid_receipt 'stale receipt fails closed'

write_receipt prod:buildingos-production backup:buildingos-production-backup FAIL PASS
assert_invalid_receipt 'copy failure receipt fails closed'
write_receipt prod:buildingos-production backup:buildingos-production-backup PASS FAIL
assert_invalid_receipt 'verification failure receipt fails closed'
write_receipt ':s3,access_key_id=FAKE_SECRET,secret_access_key=FAKE_SECRET:bucket' backup:buildingos-production-backup
assert_invalid_receipt 'unsafe source location fails closed'
write_receipt prod:buildingos-production backup:buildingos-production
assert_invalid_receipt 'same bucket names fail closed'
write_receipt prod:buildingos-production backup:buildingos-production-backup PASS PASS YES
assert_invalid_receipt 'receipt claiming recovery validity fails closed'

rm -f "$RECEIPT"
ln -s "$TEST_ROOT/missing-receipt.json" "$RECEIPT"
assert_invalid_receipt 'symlink receipt fails closed'
rm -f "$RECEIPT"

auditor_text="$(< "$AUDITOR")"
workflow_text="$(< "$WORKFLOW")"
assert_contains 'workflow is manually dispatched' 'workflow_dispatch:' "$workflow_text"
assert_contains 'workflow uses read-only permissions' 'contents: read' "$workflow_text"
assert_contains 'workflow uses production environment' 'environment: production' "$workflow_text"
assert_contains 'workflow uses operations concurrency' 'production-operations' "$workflow_text"
assert_contains 'workflow uses strict host key checking' 'StrictHostKeyChecking=yes' "$workflow_text"
assert_contains 'workflow uses batch mode' 'BatchMode=yes' "$workflow_text"
assert_contains 'workflow streams the auditor read-only' 'bash -s -- ${remote_args[*]}' "$workflow_text"
assert_absent 'workflow has no push trigger' 'push:' "$workflow_text"
assert_absent 'workflow has no scheduled trigger' 'schedule:' "$workflow_text"
assert_absent 'workflow has no deployment invocation' 'bash "$control_dir/scripts/deploy-production.sh"' "$workflow_text"

for forbidden in \
  'docker compose up' \
  'docker compose run' \
  'docker restart' \
  'prisma migrate deploy' \
  'FOR UPDATE' \
  'aws s3 sync' \
  'aws s3 cp' \
  'curl POST' \
  'curl PUT' \
  'curl PATCH' \
  'curl DELETE' \
  'printenv'; do
  assert_absent "audit excludes mutation construct $forbidden" "$forbidden" "$auditor_text"
done
for marker in \
  'readonly_query_stdin' \
  'BEGIN READ ONLY;' \
  'COMMIT;' \
  'pg_restore --list' \
  'S3_DEEP_AUDIT_UNAVAILABLE' \
  'require.resolve("minio")' \
  'nextContinuationToken' \
  'isTruncated' \
  'EXPECTED_AUTHORITATIVE_BUCKET' \
  'TARGET_MIGRATION_STATUS' \
  'PUBLIC_READYZ_STATUS' \
  'ALLOWED_IGNORED_RUNTIME_ENV' \
  'AUDIT_INTERNAL_FAILURES' \
  'FAILED_STAGE' \
  'FAILURE_CLASS' \
  'RUNTIME_APP_SHA' \
  'validate_backup_mechanism' \
  'validate_backup_manifest' \
  'validate_backup_script_file'; do
  assert_contains "audit preserves safety marker $marker" "$marker" "$auditor_text"
done
for metric in \
  'OVER_ALLOCATIONS_DEFINITE' \
  'OVER_ALLOCATIONS_UNVERIFIABLE' \
  'INCONSISTENT_SAME_CURRENCY_SHARES' \
  'OVER_ALLOCATIONS_FUNCTIONAL_DEFINITE' \
  'OVER_ALLOCATIONS_FUNCTIONAL_UNVERIFIABLE' \
  'CURRENCY_MISMATCHES_DEFINITE' \
  'CURRENCY_MISMATCHES_UNVERIFIABLE' \
  'NEGATIVE_PAYMENT_ALLOCATIONS' \
  'NEGATIVE_PAYMENT_ORIGINAL_ALLOCATIONS' \
  'CHARGE_OVER_ALLOCATIONS'; do
  assert_contains "audit preserves financial metric $metric" "$metric" "$auditor_text"
done
assert_contains 'audit keeps current PostgreSQL mechanism path' '/opt/pawtech/backups/scripts/backup-postgres.sh' "$auditor_text"
assert_contains 'audit keeps PostgreSQL identity manifest' 'infra/production/backup-postgres.identity.v1' "$auditor_text"
assert_contains 'audit uses the Object Storage receipt path' '/var/lib/buildingos-object-backup/object-backup-receipt.json' "$auditor_text"
assert_contains 'audit exposes Object Storage receipt marker' 'OBJECT_BACKUP_RECEIPT=%s' "$auditor_text"
assert_contains 'audit keeps PostgreSQL fresh evidence incomplete' 'POSTGRES_BACKUP_EVIDENCE=INCOMPLETE' "$auditor_text"
assert_absent 'audit no longer requires paired receipt' 'paired-$backup_set_id.json' "$auditor_text"
assert_absent 'audit no longer requires MinIO verification flag' 'minio_verified' "$auditor_text"
assert_absent 'audit does not claim recovery validity' 'RECOVERY_POINT_VALID=YES' "$auditor_text"

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s failed, %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
