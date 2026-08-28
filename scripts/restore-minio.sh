#!/usr/bin/env bash
set -Eeuo pipefail
set +x

readonly OPERATIONAL_RESTORE_TARGET_POLICY_FILE='/etc/buildingos/minio-restore-target-policy.json'

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
require() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }
safe_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]]; }
endpoint_identity() { local value="${1#*://}"; printf '%s\n' "${value%%/*}"; }
validate_prefix() {
  local prefix="$1"
  [[ -z "$prefix" ]] && return 0
  [[ "$prefix" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] || fail "unsafe BACKUP_PREFIX"
  local segment
  local -a segments
  IFS='/' read -r -a segments <<< "$prefix"
  for segment in "${segments[@]}"; do
    [[ "$segment" != "." && "$segment" != ".." ]] || fail "unsafe BACKUP_PREFIX"
  done
}
hash_object() {
  local object_path="$1"
  local sha256
  if ! sha256="$(mc cat "$object_path" < /dev/null | sha256sum | cut -d ' ' -f1)"; then
    fail "unable to hash object: $object_path"
  fi
  [[ "$sha256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "invalid object SHA-256: $object_path"
  printf '%s\n' "$sha256"
}
assert_sse_s3_object() {
  local object_path="$1"
  mc stat --json "$object_path" | jq -e '(.metadata // {}) | to_entries | any((.key | ascii_downcase) == "x-amz-server-side-encryption" and ((.value | if type == "array" then .[0] else . end) | ascii_downcase) == "aes256")' >/dev/null || fail "backup object is missing required SSE-S3 evidence"
}
create_manifest() {
  local listing_file="$1"
  local object_root="$2"
  local manifest_file="$3"
  local entries_file sorted_manifest_file
  entries_file="$TEMP_DIR/$(basename "$manifest_file").entries"
  sorted_manifest_file="$TEMP_DIR/$(basename "$manifest_file").sorted"
  local key size sha256 record

  if ! jq -s -e 'all(.[]; ((.type // "file") != "file") or (((.key // .name) | type) == "string" and ((.size // 0) | type) == "number" and ((.size // 0) >= 0) and (((.size // 0) | floor) == (.size // 0))))' "$listing_file" >/dev/null; then
    fail "invalid MinIO listing"
  fi
  jq -r 'select((.type // "file") == "file") | [((.key // .name) | sub("^.*?/objects/"; "")), (.size // 0)] | @tsv' "$listing_file" > "$entries_file" || fail "unable to normalize MinIO listing"

  : > "$manifest_file"
  while IFS=$'\t' read -r key size; do
    [[ -n "$key" ]] || fail "MinIO listing contains an empty object key"
    sha256="$(hash_object "$object_root/$key")"
    record="$(jq -cn --arg key "$key" --argjson size "$size" --arg sha256 "$sha256" '{key:$key,size:$size,sha256:$sha256}')"
    printf '%s\n' "$record" >> "$manifest_file"
  done < "$entries_file"
  jq -s 'sort_by(.key)' "$manifest_file" > "$sorted_manifest_file" || fail "unable to create MinIO manifest"
  mv "$sorted_manifest_file" "$manifest_file"
}
validate_target_policy() {
  local policy_file="$1"
  local expected_owner_uid="$2"
  local owner_uid mode mode_value

  [[ "$policy_file" == /* ]] || fail "restore target policy path must be absolute"
  [[ ! -L "$policy_file" ]] || fail "restore target policy must not be a symlink"
  [[ -f "$policy_file" && -r "$policy_file" ]] || fail "restore target policy is unavailable"
  if owner_uid="$(stat -c '%u' "$policy_file" 2>/dev/null)" && mode="$(stat -c '%a' "$policy_file" 2>/dev/null)"; then
    :
  elif owner_uid="$(stat -f '%u' "$policy_file" 2>/dev/null)" && mode="$(stat -f '%Lp' "$policy_file" 2>/dev/null)"; then
    :
  else
    fail "unable to validate restore target policy ownership and permissions"
  fi
  [[ "$owner_uid" == "$expected_owner_uid" ]] || fail "restore target policy has an untrusted owner"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "restore target policy permissions are invalid"
  mode_value=$((8#$mode))
  (( (mode_value & 0022) == 0 )) || fail "restore target policy must not be group or world writable"
  jq -e '
    type == "object" and length > 0 and
    all(keys[]; test("^(development|rehearsal|test)$")) and
    all(to_entries[];
      (.value | type) == "object" and
      (.value.endpoint_identity | type) == "string" and
      (.value.endpoint_identity | length) > 0 and
      (.value.bucket | type) == "string" and
      (.value.bucket | length) > 0
    )
  ' "$policy_file" >/dev/null || fail "restore target policy is invalid"
  jq -e --arg environment "$TARGET_ENVIRONMENT" 'has($environment)' "$policy_file" >/dev/null || fail "restore target environment is not allowed by policy"
  local policy_endpoint policy_bucket
  policy_endpoint="$(jq -er --arg environment "$TARGET_ENVIRONMENT" '.[$environment].endpoint_identity' "$policy_file")" || fail "restore target endpoint policy is invalid"
  policy_bucket="$(jq -er --arg environment "$TARGET_ENVIRONMENT" '.[$environment].bucket' "$policy_file")" || fail "restore target bucket policy is invalid"
  [[ "$(endpoint_identity "$TARGET_ENDPOINT")" == "$policy_endpoint" ]] || fail "target endpoint does not match restore target policy"
  [[ "$TARGET_BUCKET" == "$policy_bucket" ]] || fail "target bucket does not match restore target policy"
}
is_local_test_endpoint() {
  local identity
  [[ "$1" == http://* ]] || return 1
  identity="$(endpoint_identity "$1")"
  [[ "$identity" =~ ^(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]{1,5})?$ || "$identity" =~ ^\[::1\](:[0-9]{1,5})?$ ]]
}
select_target_policy() {
  [[ -z "${RESTORE_TARGET_POLICY_FILE:-}" ]] || fail "caller-selected RESTORE_TARGET_POLICY_FILE is not supported"
  case "${MINIO_RESTORE_TEST_MODE:-}" in
    '')
      [[ -z "${MINIO_RESTORE_TEST_POLICY_FILE:-}" ]] || fail "test policy requires isolated test mode"
      [[ "$TARGET_ENDPOINT" == https://* ]] || fail "operational restore target must use HTTPS"
      TARGET_POLICY_FILE="$OPERATIONAL_RESTORE_TARGET_POLICY_FILE"
      TARGET_POLICY_OWNER_UID=0
      ;;
    LOCAL_ISOLATED_ONLY)
      [[ "$TARGET_ENVIRONMENT" =~ ^(rehearsal|test)$ ]] || fail "isolated test policy requires rehearsal or test target"
      is_local_test_endpoint "$TARGET_ENDPOINT" || fail "isolated test policy requires a local endpoint"
      [[ "$TARGET_BUCKET" =~ ^buildingos-test-restore-[a-z0-9.-]+$ ]] || fail "isolated test policy requires a dedicated test restore bucket"
      [[ -n "${MINIO_RESTORE_TEST_POLICY_FILE:-}" ]] || fail "MINIO_RESTORE_TEST_POLICY_FILE is required in isolated test mode"
      TARGET_POLICY_FILE="$MINIO_RESTORE_TEST_POLICY_FILE"
      TARGET_POLICY_OWNER_UID="$(id -u)"
      ;;
    *)
      fail "invalid MINIO_RESTORE_TEST_MODE"
      ;;
  esac
}

for variable in BACKUP_ENDPOINT BACKUP_ACCESS_KEY BACKUP_SECRET_KEY BACKUP_BUCKET BACKUP_SET_ID EXPECTED_SOURCE_ENVIRONMENT EXPECTED_APP_SHA BACKUP_SSE_CAPABILITY_FILE TARGET_ENDPOINT TARGET_ACCESS_KEY TARGET_SECRET_KEY TARGET_BUCKET TARGET_ENVIRONMENT RESTORE_CONFIRMATION; do require "$variable"; done
safe_id "$BACKUP_SET_ID" || fail "unsafe BACKUP_SET_ID"
validate_prefix "${BACKUP_PREFIX:-}"
[[ "$EXPECTED_SOURCE_ENVIRONMENT" =~ ^(production|staging|development|rehearsal)$ ]] || fail "unsafe source environment"
[[ "$TARGET_ENVIRONMENT" =~ ^(development|rehearsal|test)$ ]] || fail "restore target must be non-production"
[[ "$EXPECTED_APP_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "EXPECTED_APP_SHA must be a 40-character commit SHA"
[[ "$RESTORE_CONFIRMATION" == "RESTORE TO NON-PRODUCTION" ]] || fail "exact non-production restore confirmation is required"
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ && "$TARGET_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe bucket name"
[[ "$(endpoint_identity "$BACKUP_ENDPOINT")" != "$(endpoint_identity "$TARGET_ENDPOINT")" || "$BACKUP_BUCKET" != "$TARGET_BUCKET" ]] || fail "restore target must not be the backup bucket"
select_target_policy
command -v mc >/dev/null 2>&1 || fail "mc is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
"$(dirname "${BASH_SOURCE[0]}")/validate-sse-capability.sh" >/dev/null || fail "SSE-S3 capability gate failed"
validate_target_policy "$TARGET_POLICY_FILE" "$TARGET_POLICY_OWNER_UID"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-minio-restore.XXXXXX")"
readonly TEMP_DIR
readonly MC_CONFIG_DIR="$TEMP_DIR/mc-config"
readonly PREFIX="${BACKUP_PREFIX:-buildingos/$EXPECTED_SOURCE_ENVIRONMENT}/$BACKUP_SET_ID"
export MC_CONFIG_DIR
trap 'rm -rf "$TEMP_DIR"' EXIT
umask 077
mkdir -p "$MC_CONFIG_DIR"

mc alias set backup "$BACKUP_ENDPOINT" "$BACKUP_ACCESS_KEY" "$BACKUP_SECRET_KEY" >/dev/null
mc stat "backup/$BACKUP_BUCKET" >/dev/null || fail "backup bucket is unavailable"
mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/backup-receipt.json" "$TEMP_DIR/backup-receipt.json" >/dev/null || fail "backup receipt is unavailable"
mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/postgres-backup-receipt.json" "$TEMP_DIR/postgres-backup-receipt.json" >/dev/null || fail "PostgreSQL receipt is unavailable"
jq -er 'select((.backup_set_id | type) == "string") | .backup_set_id' "$TEMP_DIR/backup-receipt.json" > "$TEMP_DIR/receipt-backup-set-id" || fail "backup receipt backup_set_id is missing or invalid"
[[ "$(<"$TEMP_DIR/receipt-backup-set-id")" == "$BACKUP_SET_ID" ]] || fail "backup set identity mismatch"
receipt_source_host="$(jq -er 'select((.source_host | type) == "string" and (.source_host | length > 0)) | .source_host' "$TEMP_DIR/backup-receipt.json")" || fail "backup receipt source host is missing or invalid"
receipt_source_bucket="$(jq -er 'select((.source_bucket | type) == "string" and (.source_bucket | length > 0)) | .source_bucket' "$TEMP_DIR/backup-receipt.json")" || fail "backup receipt source bucket is missing or invalid"

mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.json" "$TEMP_DIR/minio-manifest.json" >/dev/null || fail "manifest is unavailable"
mc cp "backup/$BACKUP_BUCKET/$PREFIX/meta/minio-manifest.sha256" "$TEMP_DIR/minio-manifest.sha256" >/dev/null || fail "manifest checksum is unavailable"
grep -Eq '^[0-9a-fA-F]{64}[[:space:]]+[*]?minio-manifest\.json$' "$TEMP_DIR/minio-manifest.sha256" || fail "invalid manifest checksum file"
(cd "$TEMP_DIR" && sha256sum -c minio-manifest.sha256 >/dev/null) || fail "manifest checksum verification failed"
jq -e --arg environment "$EXPECTED_SOURCE_ENVIRONMENT" --arg appSha "$EXPECTED_APP_SHA" '.version == 1 and .status == "PASS" and .source_env == $environment and .app_sha == $appSha and .deletion_propagation == false and .encryption == "SSE-S3"' "$TEMP_DIR/backup-receipt.json" >/dev/null || fail "backup receipt identity, application revision, encryption, or deletion guard is invalid"
receipt_manifest_sha256="$(jq -er 'select((.minio_manifest_sha256 | type) == "string") | .minio_manifest_sha256' "$TEMP_DIR/backup-receipt.json")" || fail "backup receipt manifest SHA-256 is missing or invalid"
[[ "$receipt_manifest_sha256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "backup receipt manifest SHA-256 is invalid"
receipt_object_count="$(jq -er 'select((.object_count | type) == "number" and .object_count >= 0 and ((.object_count | floor) == .object_count)) | .object_count' "$TEMP_DIR/backup-receipt.json")" || fail "backup receipt object count is missing or invalid"
receipt_total_bytes="$(jq -er 'select((.total_bytes | type) == "number" and .total_bytes >= 0 and ((.total_bytes | floor) == .total_bytes)) | .total_bytes' "$TEMP_DIR/backup-receipt.json")" || fail "backup receipt byte total is missing or invalid"
if ! jq -e 'type == "array" and all(.[]; (.key | type == "string" and length > 0) and (.size | type == "number" and . >= 0 and floor == .) and (.sha256 | type == "string" and test("^[0-9a-fA-F]{64}$")))' "$TEMP_DIR/minio-manifest.json" >/dev/null; then
  fail "manifest schema is invalid"
fi
actual_manifest_sha256="$(sha256sum "$TEMP_DIR/minio-manifest.json" | cut -d ' ' -f1)"
actual_object_count="$(jq 'length' "$TEMP_DIR/minio-manifest.json")"
actual_total_bytes="$(jq '[.[].size] | add // 0' "$TEMP_DIR/minio-manifest.json")"
[[ "$actual_manifest_sha256" == "$receipt_manifest_sha256" ]] || fail "manifest SHA-256 does not match backup receipt"
[[ "$actual_object_count" == "$receipt_object_count" ]] || fail "manifest object count does not match backup receipt"
[[ "$actual_total_bytes" == "$receipt_total_bytes" ]] || fail "manifest byte total does not match backup receipt"
postgres_receipt_sha256="$(sha256sum "$TEMP_DIR/postgres-backup-receipt.json" | cut -d ' ' -f1)"
jq -e --arg setId "$BACKUP_SET_ID" --arg appSha "$EXPECTED_APP_SHA" --arg receiptSha "$postgres_receipt_sha256" --slurpfile postgres "$TEMP_DIR/postgres-backup-receipt.json" '
  .postgres_receipt_sha256 == $receiptSha and
  .postgres_backup_id == $postgres[0].postgres_backup_id and
  .postgres_sha256 == $postgres[0].postgres_sha256 and
  .postgres_dump_filename == $postgres[0].dump_filename and
  .postgres_remote_object_prefix == $postgres[0].remote_object_prefix and
  $postgres[0].version == 1 and $postgres[0].status == "PASS" and
  $postgres[0].backup_set_id == $setId and $postgres[0].app_sha == $appSha and $postgres[0].encryption == "SSE-S3"
' "$TEMP_DIR/backup-receipt.json" >/dev/null || fail "PostgreSQL receipt is invalid or not bound to the MinIO receipt"
postgres_dump_filename="$(jq -er '.postgres_dump_filename | select(test("^[A-Za-z0-9._-]+$"))' "$TEMP_DIR/backup-receipt.json")" || fail "PostgreSQL dump filename is invalid"
postgres_remote_object_prefix="$(jq -er '.postgres_remote_object_prefix | select(test("^postgresql/[a-z0-9][a-z0-9._-]{0,95}$"))' "$TEMP_DIR/backup-receipt.json")" || fail "PostgreSQL remote prefix is invalid"
postgres_sha256="$(jq -er '.postgres_sha256 | select(test("^[0-9a-f]{64}$"))' "$TEMP_DIR/backup-receipt.json")" || fail "PostgreSQL receipt SHA-256 is invalid"
actual_postgres_sha256="$(hash_object "backup/$BACKUP_BUCKET/$postgres_remote_object_prefix/$postgres_dump_filename")"
[[ "$actual_postgres_sha256" == "$postgres_sha256" ]] || fail "off-host PostgreSQL dump SHA-256 does not match paired receipt"
assert_sse_s3_object "backup/$BACKUP_BUCKET/$postgres_remote_object_prefix/$postgres_dump_filename"
if ! mc ls --recursive --json "backup/$BACKUP_BUCKET/$PREFIX/objects" > "$TEMP_DIR/backup-listing.json"; then
  fail "backup object listing is unavailable"
fi
create_manifest "$TEMP_DIR/backup-listing.json" "backup/$BACKUP_BUCKET/$PREFIX/objects" "$TEMP_DIR/backup-actual-manifest.json" true
if ! jq -S 'map({key,size,sha256})' "$TEMP_DIR/minio-manifest.json" | cmp -s - <(jq -S 'map({key,size,sha256})' "$TEMP_DIR/backup-actual-manifest.json"); then
  fail "backup object keys, sizes, or SHA-256 values do not match the approved manifest"
fi
[[ "$(endpoint_identity "$TARGET_ENDPOINT")" != "$receipt_source_host" || "$TARGET_BUCKET" != "$receipt_source_bucket" ]] || fail "restore target matches backup source identity"

mc alias set target "$TARGET_ENDPOINT" "$TARGET_ACCESS_KEY" "$TARGET_SECRET_KEY" >/dev/null
mc stat "target/$TARGET_BUCKET" >/dev/null || fail "target bucket is unavailable"
if ! mc ls --recursive --json "target/$TARGET_BUCKET" > "$TEMP_DIR/target-listing.json"; then
  fail "target listing is unavailable"
fi
if ! target_has_objects="$(jq -s 'any(.[]; ((.type // "file") == "file"))' "$TEMP_DIR/target-listing.json")"; then
  fail "target listing is invalid"
fi
if [[ "$target_has_objects" == true ]]; then
  fail "target bucket is not empty; restore will not overwrite or delete existing objects"
fi

# Restore is additive into a proven-empty bucket; no delete or mirror removal is used.
mc cp --recursive "backup/$BACKUP_BUCKET/$PREFIX/objects/" "target/$TARGET_BUCKET/" >/dev/null
if ! mc ls --recursive --json "target/$TARGET_BUCKET" > "$TEMP_DIR/target-listing.json"; then
  fail "restored object listing is unavailable"
fi
create_manifest "$TEMP_DIR/target-listing.json" "target/$TARGET_BUCKET" "$TEMP_DIR/actual-manifest.json" true
if ! jq -S 'map({key,size,sha256})' "$TEMP_DIR/minio-manifest.json" | cmp -s - <(jq -S 'map({key,size,sha256})' "$TEMP_DIR/actual-manifest.json"); then
  fail "restored object keys, sizes, or SHA-256 values do not match the approved manifest"
fi

restored_object_count="$actual_object_count"
restored_total_bytes="$actual_total_bytes"
printf 'MINIO_RESTORE_COMPLETE\nSTATUS=PASS\nBACKUP_SET_ID=%s\nTARGET_ENV=%s\nTARGET_BUCKET=%s\nRESTORED_OBJECT_COUNT=%s\nRESTORED_TOTAL_BYTES=%s\n' \
  "$BACKUP_SET_ID" "$TARGET_ENVIRONMENT" "$TARGET_BUCKET" "$restored_object_count" "$restored_total_bytes"
