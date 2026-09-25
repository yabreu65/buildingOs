#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDIT_SCRIPT="$ROOT_DIR/scripts/production-readonly-audit.sh"
readonly DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy-production.sh"
readonly ROLLBACK_SCRIPT="$ROOT_DIR/scripts/rollback-production.sh"
TEST_TEMP_ROOT="${TMPDIR:-/tmp}"
TEST_TEMP_ROOT="$(cd -P -- "${TEST_TEMP_ROOT%/}" && pwd -P)"
TEST_ROOT="$(mktemp -d "$TEST_TEMP_ROOT/buildingos-audit-selector.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

# The selector parser is intentionally called with test-local explicit roots. Production
# callers use only the fixed production constants defined in the audit script.
source "$AUDIT_SCRIPT"

declare -F validate_current_successful_deployment_selector >/dev/null || {
  printf 'FAIL: audit selector parser is unavailable\n' >&2
  exit 1
}

readonly TEST_DEPLOYMENTS_ROOT="$TEST_ROOT/deployments"
readonly TEST_RECOVERY_ROOT="$TEST_ROOT/recovery-points"
readonly SELECTOR="$TEST_DEPLOYMENTS_ROOT/current-successful-deployment.v1"
readonly TARGET_SHA='0123456789abcdef0123456789abcdef01234567'
readonly SOURCE_SHA='89abcdef0123456789abcdef0123456789abcdef'
readonly RECOVERY_ID='89abcdef0123-20260901t000000z-aaaaaaaaaaaaaaaaaaaaaaaa'
readonly RECORD="$TEST_DEPLOYMENTS_ROOT/deploy-$TARGET_SHA.txt"
readonly BUNDLE="$TEST_RECOVERY_ROOT/$RECOVERY_ID"
readonly RECEIPT="$BUNDLE/metadata/recovery-point-receipt.json"
readonly OBJECT_IDENTITY='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
readonly OBJECT_PATH="$BUNDLE/objects/$OBJECT_IDENTITY.blob"

pass=0
fail=0
ok() { local name="$1"; shift; if "$@"; then pass=$((pass + 1)); printf 'ok %s - %s\n' "$pass" "$name"; else fail=$((fail + 1)); printf 'not ok %s - %s\n' "$fail" "$name" >&2; fi; }
bad() { local name="$1"; shift; if "$@"; then fail=$((fail + 1)); printf 'not ok %s - %s (unexpected success)\n' "$fail" "$name" >&2; else pass=$((pass + 1)); printf 'ok %s - %s\n' "$pass" "$name"; fi; }
sha256() { sha256sum -- "$1" | awk '{print $1}'; }

mkdir -m 700 "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$BUNDLE"
mkdir -m 700 "$BUNDLE/metadata" "$BUNDLE/postgresql" "$BUNDLE/objects"
printf '[]\n' >"$BUNDLE/file-manifest.json"
printf '[]\n' >"$BUNDLE/metadata/reference-content-manifest.json"
printf 'test recovery dump\n' >"$BUNDLE/postgresql/buildingos_${RECOVERY_ID}.dump"
chmod 600 "$BUNDLE/file-manifest.json" "$BUNDLE/metadata/reference-content-manifest.json" "$BUNDLE/postgresql/buildingos_${RECOVERY_ID}.dump"

BIN="$TEST_ROOT/bin"
mkdir -m 700 "$BIN"
cat >"$BIN/pg_restore" <<'PG_RESTORE'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == '--list' && -f "$2" ]]
PG_RESTORE
chmod 700 "$BIN/pg_restore"
export PATH="$BIN:$PATH"

write_receipt() {
  local input_hash content_hash dump_hash dump_bytes receipt_hash references unique
  input_hash="$(sha256 "$BUNDLE/file-manifest.json")"
  content_hash="$(sha256 "$BUNDLE/metadata/reference-content-manifest.json")"
  dump_hash="$(sha256 "$BUNDLE/postgresql/buildingos_${RECOVERY_ID}.dump")"
  dump_bytes="$(wc -c < "$BUNDLE/postgresql/buildingos_${RECOVERY_ID}.dump")"; dump_bytes="${dump_bytes//[[:space:]]/}"
  references="$(jq 'length' "$BUNDLE/file-manifest.json")"
  unique="$(jq '[.[].identitySha256] | unique | length' "$BUNDLE/metadata/reference-content-manifest.json")"
  jq -cnS --arg source "$SOURCE_SHA" --arg id "$RECOVERY_ID" --arg input "$input_hash" --arg content "$content_hash" --arg dump "$dump_hash" --argjson bytes "$dump_bytes" --argjson references "$references" --argjson unique "$unique" \
    '{format:"buildingos-recovery-point/v1",status:"PASS",sourceAppSha:$source,backupSetId:$id,startedAtUtc:"2026-09-01T00:00:00Z",completedAtUtc:"2026-09-01T00:01:00Z",inputManifestSha256:$input,contentManifestSha256:$content,databaseDump:{sha256:$dump,bytes:$bytes},referenceCount:$references,uniqueObjectCount:$unique,remoteRoot:"backup:recovery/buildingos/recovery-points/test",statuses:{databaseArchive:"PASS",referenceCount:"PASS",contentIdentity:"PASS",remoteDump:"PASS",inputManifest:"PASS",contentManifest:"PASS",hashes:"PASS"}}' >"$RECEIPT"
  chmod 600 "$RECEIPT"
  receipt_hash="$(sha256 "$RECEIPT")"
  printf '%s\n' "$receipt_hash" >"$BUNDLE/metadata/recovery-point-receipt.sha256"
  printf '%s\n' "$input_hash" >"$BUNDLE/file-manifest.sha256"
  printf '%s\n' "$content_hash" >"$BUNDLE/metadata/reference-content-manifest.sha256"
  chmod 600 "$BUNDLE/metadata/recovery-point-receipt.sha256" "$BUNDLE/file-manifest.sha256" "$BUNDLE/metadata/reference-content-manifest.sha256"
}

write_record_and_selector() {
  local receipt_hash
  receipt_hash="$(sha256 "$RECEIPT")"
  cat >"$RECORD" <<RECORD
status=SUCCESS
target_sha=$TARGET_SHA
recovery_point_id=$RECOVERY_ID
recovery_point_receipt_path=$RECEIPT
recovery_point_bundle_path=$BUNDLE
recovery_point_receipt_sha256=$receipt_hash
recovery_point_source_sha=$SOURCE_SHA
recovery_point_remote_root=backup:recovery/buildingos/recovery-points/test
RECORD
  chmod 600 "$RECORD"
  cat >"$SELECTOR" <<SELECTOR
format=buildingos-current-successful-deployment/v1
record_path=$RECORD
target_sha=$TARGET_SHA
SELECTOR
  chmod 600 "$SELECTOR"
}

write_reference_content() {
  local content_hash content_bytes
  printf 'referenced object payload\n' >"$OBJECT_PATH"
  chmod 600 "$OBJECT_PATH"
  content_hash="$(sha256 "$OBJECT_PATH")"
  content_bytes="$(wc -c < "$OBJECT_PATH")"; content_bytes="${content_bytes//[[:space:]]/}"
  jq -cnS --arg id file-1 --arg tenant tenant-1 --arg identity "$OBJECT_IDENTITY" --arg hash "$content_hash" --argjson bytes "$content_bytes" \
    '[{id:$id,tenantId:$tenant,bucket:"buildingos-production",objectKey:"receipt.pdf",objectVersionId:null,size:$bytes,checksum:null,destinationObjectPath:("objects/" + $identity + ".blob"),identitySha256:$identity,sourceContentSha256:$hash,sourceContentBytes:$bytes,capturedObjectVersionId:null}]' >"$BUNDLE/metadata/reference-content-manifest.json"
  jq -cnS --arg id file-1 --arg tenant tenant-1 --argjson bytes "$content_bytes" \
    '[{id:$id,tenantId:$tenant,bucket:"buildingos-production",objectKey:"receipt.pdf",objectVersionId:null,size:$bytes,checksum:null}]' >"$BUNDLE/file-manifest.json"
  chmod 600 "$BUNDLE/metadata/reference-content-manifest.json" "$BUNDLE/file-manifest.json"
}

write_receipt
write_record_and_selector
ok 'exact selector record and receipt validate for the current runtime' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"

write_reference_content
write_receipt
write_record_and_selector
ok 'referenced content blob validates with its exact manifest identity' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
printf 'wrong bytes\n' >"$OBJECT_PATH"
chmod 600 "$OBJECT_PATH"
bad 'referenced content blob hash or size mismatch is rejected' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
write_reference_content
write_receipt
write_record_and_selector
rm -f -- "$OBJECT_PATH"
bad 'missing referenced content blob is rejected' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
write_reference_content
write_receipt
write_record_and_selector
rm -f -- "$OBJECT_PATH"
ln -s "$BUNDLE/file-manifest.json" "$OBJECT_PATH"
bad 'symlinked referenced content blob is rejected' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
rm -f -- "$OBJECT_PATH"
write_reference_content
write_receipt
write_record_and_selector

printf 'unrelated newer receipt\n' >"$TEST_RECOVERY_ROOT/unrelated-receipt.json"
chmod 600 "$TEST_RECOVERY_ROOT/unrelated-receipt.json"
touch "$TEST_RECOVERY_ROOT/unrelated-receipt.json"
ok 'newer unrelated receipt is ignored because only the selector path binds evidence' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"

printf 'status=FAILED\ntarget_sha=%s\n' "$TARGET_SHA" >"$TEST_DEPLOYMENTS_ROOT/deploy-failed.txt"
chmod 600 "$TEST_DEPLOYMENTS_ROOT/deploy-failed.txt"
ok 'failed deployment record is ignored because the selector binds one successful record' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"

stale_source_sha='fedcba9876543210fedcba9876543210fedcba98'
stale_recovery_id='fedcba987654-20260901t000000z-bbbbbbbbbbbbbbbbbbbbbbbb'
sed -i.bak "s/^recovery_point_id=.*/recovery_point_id=$stale_recovery_id/; s/^recovery_point_source_sha=.*/recovery_point_source_sha=$stale_source_sha/" "$RECORD"
rm -f -- "$RECORD.bak"
bad 'selected receipt from a different recovery ID and source SHA is rejected' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
write_record_and_selector

rollback_record="$TEST_DEPLOYMENTS_ROOT/rollback-$TARGET_SHA.txt"
receipt_hash="$(sha256 "$RECEIPT")"
cat >"$rollback_record" <<RECORD
status=SUCCESS
target_sha=$TARGET_SHA
recovery_point_id=$RECOVERY_ID
recovery_point_receipt_path=$RECEIPT
recovery_point_bundle_path=$BUNDLE
recovery_point_receipt_sha256=$receipt_hash
recovery_point_source_sha=$SOURCE_SHA
recovery_point_remote_root=backup:recovery/buildingos/recovery-points/test
RECORD
chmod 600 "$rollback_record"
printf 'format=buildingos-current-successful-deployment/v1\nrecord_path=%s\ntarget_sha=%s\n' "$rollback_record" "$TARGET_SHA" >"$SELECTOR"
chmod 600 "$SELECTOR"
ok 'successful rollback selector identifies its auditable active target SHA' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
write_record_and_selector

rollback_publisher_failure_case() {
  env BUILDINGOS_ROLLBACK_SELECTOR_LIBRARY_ONLY=true ROLLBACK_SCRIPT="$ROLLBACK_SCRIPT" CASE_ROOT="$TEST_ROOT/rollback-publisher" TARGET_SHA="$TARGET_SHA" bash -c '
    set -Eeuo pipefail
    source "$ROLLBACK_SCRIPT"
    mkdir -m 700 -p "$CASE_ROOT/deployments" "$CASE_ROOT/bin"
    record="$CASE_ROOT/deployments/rollback-$TARGET_SHA.txt"
    selector="$CASE_ROOT/deployments/current-successful-deployment.v1"
    printf "old-selector\n" > "$selector"; chmod 600 "$selector"
    cat > "$CASE_ROOT/bin/mktemp" <<'"'"'MK'"'"'
#!/usr/bin/env bash
exit 1
MK
    chmod 700 "$CASE_ROOT/bin/mktemp"
    PATH="$CASE_ROOT/bin:$PATH" publish_current_successful_selector "$CASE_ROOT/deployments" "$record" "$TARGET_SHA" "$selector" && exit 1
    [[ "$(<"$selector")" == old-selector ]]
  '
}
ok 'failed rollback selector publish leaves the prior selector bytes unchanged' rollback_publisher_failure_case

printf 'tampered\n' >"$RECEIPT"
chmod 600 "$RECEIPT"
bad 'stale or tampered selected receipt is rejected instead of falling back' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
write_receipt
write_record_and_selector

printf 'target_sha=%s\n' "$TARGET_SHA" >>"$SELECTOR"
bad 'ambiguous selector fields are rejected' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
write_record_and_selector

printf 'format=tampered\nrecord_path=%s\ntarget_sha=%s\n' "$RECORD" "$TARGET_SHA" >"$SELECTOR"
chmod 600 "$SELECTOR"
bad 'tampered selector is rejected' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
write_record_and_selector

rm -f -- "$RECEIPT"
bad 'missing selected receipt is rejected' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
write_receipt
write_record_and_selector

bad 'runtime SHA mismatch rejects the selected record' \
  validate_current_successful_deployment_selector "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" 'fedcba9876543210fedcba9876543210fedcba98'

selector_publish_line="$(awk '/if ! publish_current_successful_selector/ { print NR; exit }' "$DEPLOY_SCRIPT")"
success_record_line="$(awk '/write_record SUCCESS/ { print NR; exit }' "$DEPLOY_SCRIPT")"
if [[ -n "$selector_publish_line" && -n "$success_record_line" && "$success_record_line" -lt "$selector_publish_line" ]]; then
  pass=$((pass + 1)); printf 'ok %s - deployment publishes selector only after the success record\n' "$pass"
else
  fail=$((fail + 1)); printf 'not ok %s - deployment publishes selector only after the success record\n' "$fail" >&2
fi

if grep -F 'mktemp "$DEPLOYMENTS_DIR/.current-successful-deployment.v1.tmp.XXXXXX"' "$DEPLOY_SCRIPT" >/dev/null \
  && grep -F 'mv -f -- "$temporary_selector" "$CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR"' "$DEPLOY_SCRIPT" >/dev/null; then
  pass=$((pass + 1)); printf 'ok %s - failed deploy cannot replace the old selector before atomic publish\n' "$pass"
else
  fail=$((fail + 1)); printf 'not ok %s - failed deploy cannot replace the old selector before atomic publish\n' "$fail" >&2
fi

rollback_real_writer_case() {
  env BUILDINGOS_ROLLBACK_SELECTOR_LIBRARY_ONLY=true ROLLBACK_SCRIPT="$ROLLBACK_SCRIPT" CASE_ROOT="$TEST_ROOT/rollback-real" \
    TARGET_SHA="$TARGET_SHA" SOURCE_SHA="$SOURCE_SHA" API_DIGEST='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    WEB_DIGEST='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' \
    RECEIPT="$RECEIPT" BUNDLE="$BUNDLE" bash -c '
      set -Eeuo pipefail
      source "$ROLLBACK_SCRIPT"
      mkdir -p -m 700 "$CASE_ROOT/deployments"
      prior="$CASE_ROOT/deployments/deploy-prior.txt"
      receipt_hash="$(sha256sum -- "$RECEIPT" | awk '\''{print $1}'\'')"
      cat > "$prior" <<RECORD
status=SUCCESS
target_sha=$TARGET_SHA
new_api_digest=$API_DIGEST
new_web_digest=$WEB_DIGEST
recovery_point_id=89abcdef0123-20260901t000000z-aaaaaaaaaaaaaaaaaaaaaaaa
recovery_point_receipt_path=$RECEIPT
recovery_point_bundle_path=$BUNDLE
recovery_point_receipt_sha256=$receipt_hash
recovery_point_source_sha=$SOURCE_SHA
recovery_point_remote_root=backup:recovery/buildingos/recovery-points/test
RECORD
      chmod 600 "$prior"
      PREVIOUS_SHA="$TARGET_SHA"
      PREVIOUS_API_DIGEST="$API_DIGEST"
      PREVIOUS_WEB_DIGEST="$WEB_DIGEST"
      bind_unique_prior_success_recovery_point "$CASE_ROOT/deployments"
      RECORD="$CASE_ROOT/deployments/rollback-$TARGET_SHA.txt"
      PHASE=application-recreate
      EXPECTED_CURRENT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      migration_count=99
      ROLLBACK_COMPATIBILITY_BASIS=test
      write_rollback_record SUCCESS
      publish_current_successful_selector "$CASE_ROOT/deployments" "$RECORD" "$TARGET_SHA" "$CASE_ROOT/deployments/current-successful-deployment.v1"
      grep -Fqx "recovery_point_receipt_path=$RECEIPT" "$RECORD"
    '
}
ok 'rollback writer copies the unique exact prior recovery binding and atomically publishes its record' rollback_real_writer_case
ok 'selector validates the rollback record written by the real rollback writer' \
  validate_current_successful_deployment_selector "$TEST_ROOT/rollback-real/deployments/current-successful-deployment.v1" "$TEST_ROOT/rollback-real/deployments" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"
ok 'selector runtime binding validates the rollback API and Web image IDs' \
  validate_current_successful_deployment_selector_binding "$TEST_ROOT/rollback-real/deployments/current-successful-deployment.v1" "$TEST_ROOT/rollback-real/deployments" "$TARGET_SHA" 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'

rollback_missing_binding_case() {
  env BUILDINGOS_ROLLBACK_SELECTOR_LIBRARY_ONLY=true ROLLBACK_SCRIPT="$ROLLBACK_SCRIPT" CASE_ROOT="$TEST_ROOT/rollback-missing" \
    TARGET_SHA="$TARGET_SHA" API_DIGEST='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    WEB_DIGEST='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' bash -c '
      set -Eeuo pipefail
      source "$ROLLBACK_SCRIPT"
      mkdir -p -m 700 "$CASE_ROOT/deployments"
      cat > "$CASE_ROOT/deployments/deploy-prior.txt" <<RECORD
status=SUCCESS
target_sha=$TARGET_SHA
new_api_digest=$API_DIGEST
new_web_digest=$WEB_DIGEST
recovery_point_id=NOT_EVALUATED
recovery_point_receipt_path=NOT_EVALUATED
recovery_point_bundle_path=NOT_EVALUATED
recovery_point_receipt_sha256=NOT_EVALUATED
recovery_point_source_sha=NOT_EVALUATED
recovery_point_remote_root=NOT_EVALUATED
RECORD
      chmod 600 "$CASE_ROOT/deployments/deploy-prior.txt"
      PREVIOUS_SHA="$TARGET_SHA"; PREVIOUS_API_DIGEST="$API_DIGEST"; PREVIOUS_WEB_DIGEST="$WEB_DIGEST"
      declare -F bind_unique_prior_success_recovery_point >/dev/null
      ! bind_unique_prior_success_recovery_point "$CASE_ROOT/deployments"
      [[ "$ROLLBACK_RECOVERY_POINT_ID" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_RECEIPT_PATH" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_BUNDLE_PATH" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_RECEIPT_SHA256" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_SOURCE_SHA" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_REMOTE_ROOT" == NOT_EVALUATED ]]
      RECORD="$CASE_ROOT/deployments/rollback-$TARGET_SHA.txt"
      PHASE=application-recreate
      EXPECTED_CURRENT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      migration_count=99
      ROLLBACK_COMPATIBILITY_BASIS=test
      write_rollback_record SUCCESS
      publish_current_successful_selector "$CASE_ROOT/deployments" "$RECORD" "$TARGET_SHA" "$CASE_ROOT/deployments/current-successful-deployment.v1"
    '
}
ok 'missing prior recovery binding remains explicitly not evaluated' rollback_missing_binding_case

rollback_zero_matching_binding_case() {
  env BUILDINGOS_ROLLBACK_SELECTOR_LIBRARY_ONLY=true ROLLBACK_SCRIPT="$ROLLBACK_SCRIPT" CASE_ROOT="$TEST_ROOT/rollback-zero" \
    TARGET_SHA="$TARGET_SHA" API_DIGEST='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    WEB_DIGEST='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' bash -c '
      set -Eeuo pipefail
      source "$ROLLBACK_SCRIPT"
      mkdir -p -m 700 "$CASE_ROOT/deployments"
      PREVIOUS_SHA="$TARGET_SHA"; PREVIOUS_API_DIGEST="$API_DIGEST"; PREVIOUS_WEB_DIGEST="$WEB_DIGEST"
      ! bind_unique_prior_success_recovery_point "$CASE_ROOT/deployments"
      [[ "$ROLLBACK_RECOVERY_POINT_ID" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_RECEIPT_PATH" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_BUNDLE_PATH" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_RECEIPT_SHA256" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_SOURCE_SHA" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_REMOTE_ROOT" == NOT_EVALUATED ]]
    '
}
ok 'zero exact prior records leave rollback recovery fields not evaluated' rollback_zero_matching_binding_case

ok 'selector binds the rollback runtime even when its recovery proof is not evaluated' \
  validate_current_successful_deployment_selector_binding "$TEST_ROOT/rollback-missing/deployments/current-successful-deployment.v1" "$TEST_ROOT/rollback-missing/deployments" "$TARGET_SHA"
bad 'missing rollback recovery binding keeps recovery proof invalid without selecting another receipt' \
  validate_current_successful_deployment_selector "$TEST_ROOT/rollback-missing/deployments/current-successful-deployment.v1" "$TEST_ROOT/rollback-missing/deployments" "$TEST_RECOVERY_ROOT" "$TARGET_SHA"

rollback_ambiguous_binding_case() {
  env BUILDINGOS_ROLLBACK_SELECTOR_LIBRARY_ONLY=true ROLLBACK_SCRIPT="$ROLLBACK_SCRIPT" CASE_ROOT="$TEST_ROOT/rollback-ambiguous" \
    TARGET_SHA="$TARGET_SHA" SOURCE_SHA="$SOURCE_SHA" API_DIGEST='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    WEB_DIGEST='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' \
    RECEIPT="$RECEIPT" BUNDLE="$BUNDLE" bash -c '
      set -Eeuo pipefail
      source "$ROLLBACK_SCRIPT"
      mkdir -p -m 700 "$CASE_ROOT/deployments"
      receipt_hash="$(sha256sum -- "$RECEIPT" | awk '\''{print $1}'\'')"
      for name in first second; do
        cat > "$CASE_ROOT/deployments/deploy-$name.txt" <<RECORD
status=SUCCESS
target_sha=$TARGET_SHA
new_api_digest=$API_DIGEST
new_web_digest=$WEB_DIGEST
recovery_point_id=89abcdef0123-20260901t000000z-aaaaaaaaaaaaaaaaaaaaaaaa
recovery_point_receipt_path=$RECEIPT
recovery_point_bundle_path=$BUNDLE
recovery_point_receipt_sha256=$receipt_hash
recovery_point_source_sha=$SOURCE_SHA
recovery_point_remote_root=backup:recovery/buildingos/recovery-points/test
RECORD
        chmod 600 "$CASE_ROOT/deployments/deploy-$name.txt"
      done
      PREVIOUS_SHA="$TARGET_SHA"; PREVIOUS_API_DIGEST="$API_DIGEST"; PREVIOUS_WEB_DIGEST="$WEB_DIGEST"
      declare -F bind_unique_prior_success_recovery_point >/dev/null
      ! bind_unique_prior_success_recovery_point "$CASE_ROOT/deployments"
      [[ "$ROLLBACK_RECOVERY_POINT_ID" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_RECEIPT_PATH" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_BUNDLE_PATH" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_RECEIPT_SHA256" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_SOURCE_SHA" == NOT_EVALUATED && "$ROLLBACK_RECOVERY_POINT_REMOTE_ROOT" == NOT_EVALUATED ]]
    '
}
ok 'ambiguous exact prior recovery bindings are never selected by filename or recency' rollback_ambiguous_binding_case

# A complete local fixture must publish independently-derived component statuses and
# aggregate them fail-closed. Production uses the fixed constants by default.
write_reference_content
write_receipt
write_record_and_selector
OBJECT_RECEIPT="$TEST_ROOT/object-backup-receipt.json"
jq -n --arg completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{receipt_version:1,started_at_utc:$completed_at,completed_at_utc:$completed_at,source:"prod:buildingos-production",destination:"backup:buildingos-production-backup",copy_status:"PASS",verification_status:"PASS",status:"PASS",recovery_point_valid:"NOT_EVALUATED"}' >"$OBJECT_RECEIPT"
chmod 600 "$OBJECT_RECEIPT"
MECHANISM_MANIFEST="$TEST_ROOT/backup-postgres.identity.v1"
printf 'path=test-backup-script\nsha256=test-digest\nowner=test-owner\ngroup=test-group\nmode=0775\n' >"$MECHANISM_MANIFEST"
validate_backup_mechanism() { [[ "$1" == "$MECHANISM_MANIFEST" ]]; }
RUNTIME_APP_SHA="$TARGET_SHA"
RUNTIME_API_IMAGE_ID=''
RUNTIME_WEB_IMAGE_ID=''
report_output="$(report_backup_readiness "$SELECTOR" "$TEST_DEPLOYMENTS_ROOT" "$TEST_RECOVERY_ROOT" "$MECHANISM_MANIFEST" "$OBJECT_RECEIPT")"
ok 'complete local recovery fixture reports valid recovery point and backup readiness pass' \
  bash -c '[[ "$1" == *"CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR=PASS"* && "$1" == *"POSTGRES_BACKUP_MECHANISM=PASS"* && "$1" == *"POSTGRES_BACKUP_EVIDENCE=PASS"* && "$1" == *"OBJECT_BACKUP_RECEIPT=PASS"* && "$1" == *"OBJECT_BACKUP_COPY=PASS"* && "$1" == *"DB_OBJECT_REFERENCE_RECONCILIATION=PASS"* && "$1" == *"DB_OBJECT_CONTENT_IDENTITY=PASS"* && "$1" == *"RECOVERY_POINT_VALID=PASS"* && "$1" == *"BACKUP_READINESS=PASS"* ]]' _ "$report_output"

backup_readiness_component_statuses=(
  POSTGRES_BACKUP_MECHANISM
  POSTGRES_BACKUP_EVIDENCE
  OBJECT_BACKUP_RECEIPT
  OBJECT_BACKUP_COPY
  CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR
  DB_OBJECT_REFERENCE_RECONCILIATION
  DB_OBJECT_CONTENT_IDENTITY
  RECOVERY_POINT_VALID
)
for missing_component in "${backup_readiness_component_statuses[@]}"; do
  component_values=()
  for component in "${backup_readiness_component_statuses[@]}"; do
    if [[ "$component" == "$missing_component" ]]; then
      component_values+=("$component=INCOMPLETE")
    else
      component_values+=("$component=PASS")
    fi
  done
  ok "backup readiness is incomplete when $missing_component is non-PASS" \
    bash -c 'source "$1"; [[ "$(backup_readiness_status "${@:2}")" == INCOMPLETE ]]' _ "$AUDIT_SCRIPT" "${component_values[@]}"
  missing_values=()
  for component in "${backup_readiness_component_statuses[@]}"; do
    [[ "$component" == "$missing_component" ]] || missing_values+=("$component=PASS")
  done
  ok "backup readiness is incomplete when $missing_component is missing" \
    bash -c 'source "$1"; [[ "$(backup_readiness_status "${@:2}")" == INCOMPLETE ]]' _ "$AUDIT_SCRIPT" "${missing_values[@]}"
done

(( fail == 0 )) || exit 1
printf 'PASSED: %s assertions\n' "$pass"
