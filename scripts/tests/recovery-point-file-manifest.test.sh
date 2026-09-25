#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/recovery-point-file-manifest.sh"
PORTABLE="$ROOT/scripts/lib/recovery-point-portable-stat.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-recovery-point-manifest.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT
AUDIT="$TEST_ROOT/audit.log"
BUCKET='authoritative-bucket'
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf 'ok %s - %s\n' "$PASS" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'not ok %s - %s\n' "$FAIL" "$1" >&2; }
ok() { local name="$1"; shift; if "$@" >> "$AUDIT" 2>&1; then pass "$name"; else fail "$name"; fi; }
bad() { local name="$1"; shift; if "$@" >> "$AUDIT" 2>&1; then fail "$name (unexpected success)"; else pass "$name"; fi; }
mode() { recovery_point_portable_stat_mode "$1"; }
private_file() { [[ -f "$1" && ! -L "$1" && "$(mode "$1")" == 600 ]]; }
private_directory() { [[ -d "$1" && ! -L "$1" && "$(mode "$1")" == 700 ]]; }
private_artifacts() { private_file "$1" && private_file "$2" && private_directory "$3"; }
sha256_digest_file() { [[ "$(< "$1")" =~ ^[0-9a-f]{64}$ ]]; }
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
sha256_matches_manifest() { [[ "$(sha256_of "$1")" == "$(< "$2")" ]]; }

mkdir -p "$TEST_ROOT/one" "$TEST_ROOT/two" "$TEST_ROOT/empty" "$TEST_ROOT/duplicate" "$TEST_ROOT/malformed" "$TEST_ROOT/wrong-bucket" "$TEST_ROOT/negative-size" "$TEST_ROOT/fractional-size" "$TEST_ROOT/empty-version" "$TEST_ROOT/bad-id-type" "$TEST_ROOT/empty-id" "$TEST_ROOT/empty-tenant" "$TEST_ROOT/empty-key" "$TEST_ROOT/bad-checksum-type" "$TEST_ROOT/permissive" "$TEST_ROOT/overwrite" "$TEST_ROOT/symlink" "$TEST_ROOT/fail-publish"
chmod 0700 "$TEST_ROOT"/*
: > "$AUDIT"
chmod 0600 "$AUDIT"

cat > "$TEST_ROOT/ordered.json" <<'JSON'
[
  {"id":"file-pinned","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/pinned","objectVersionId":"pinned-version-7","size":0,"checksum":null},
  {"id":"file-null","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/null","objectVersionId":null,"size":42,"checksum":"checksum-42"}
]
JSON
cat > "$TEST_ROOT/reversed.json" <<'JSON'
[
  {"id":"file-null","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/null","objectVersionId":null,"size":42,"checksum":"checksum-42"},
  {"id":"file-pinned","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/pinned","objectVersionId":"pinned-version-7","size":0,"checksum":null}
]
JSON
cat > "$TEST_ROOT/duplicate-reference.json" <<'JSON'
[
  {"id":"file-reference-a","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/shared","objectVersionId":"version-shared","size":7,"checksum":"same"},
  {"id":"file-reference-b","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/shared","objectVersionId":"version-shared","size":7,"checksum":"same"}
]
JSON
cat > "$TEST_ROOT/duplicate-id.json" <<'JSON'
[
  {"id":"duplicate","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/a","objectVersionId":null,"size":1,"checksum":null},
  {"id":"duplicate","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/b","objectVersionId":null,"size":2,"checksum":null}
]
JSON
printf '%s\n' '[{"id":"truncated"' > "$TEST_ROOT/truncated.json"
printf '%s\n' '[{"id":"wrong-bucket","tenantId":"tenant-a","bucket":"other-bucket","objectKey":"private/a","objectVersionId":null,"size":1,"checksum":null}]' > "$TEST_ROOT/wrong-bucket.json"
printf '%s\n' '[{"id":"negative","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/a","objectVersionId":null,"size":-1,"checksum":null}]' > "$TEST_ROOT/negative-size.json"
printf '%s\n' '[{"id":"fractional","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/a","objectVersionId":null,"size":1.5,"checksum":null}]' > "$TEST_ROOT/fractional-size.json"
printf '%s\n' '[{"id":"empty-version","tenantId":"tenant-a","bucket":"authoritative-bucket","objectKey":"private/a","objectVersionId":"","size":1,"checksum":null}]' > "$TEST_ROOT/empty-version.json"
printf '%s\n' '[]' > "$TEST_ROOT/empty.json"

source "$PORTABLE"
source "$LIB"

ok 'pinned and null objectVersionId manifest normalizes' recovery_point_file_manifest_normalize "$TEST_ROOT/ordered.json" "$BUCKET" "$TEST_ROOT/one"
ok 'reversed manifest normalizes' recovery_point_file_manifest_normalize "$TEST_ROOT/reversed.json" "$BUCKET" "$TEST_ROOT/two"
ok 'canonical JSON is deterministic independent of input order' cmp -s "$TEST_ROOT/one/file-manifest.json" "$TEST_ROOT/two/file-manifest.json"
ok 'canonical SHA is deterministic independent of input order' cmp -s "$TEST_ROOT/one/file-manifest.sha256" "$TEST_ROOT/two/file-manifest.sha256"
ok 'pinned objectVersionId is retained exactly' jq -e '.[0].id == "file-null" and .[1].id == "file-pinned" and .[1].objectVersionId == "pinned-version-7"' "$TEST_ROOT/one/file-manifest.json"
ok 'null objectVersionId is retained exactly' jq -e '.[0].objectVersionId == null' "$TEST_ROOT/one/file-manifest.json"
ok 'manifest and SHA files are private' private_artifacts "$TEST_ROOT/one/file-manifest.json" "$TEST_ROOT/one/file-manifest.sha256" "$TEST_ROOT/one"
ok 'SHA file contains only a SHA-256 digest' sha256_digest_file "$TEST_ROOT/one/file-manifest.sha256"
ok 'SHA file hashes the canonical manifest bytes' sha256_matches_manifest "$TEST_ROOT/one/file-manifest.json" "$TEST_ROOT/one/file-manifest.sha256"

ok 'distinct File IDs with duplicate references are preserved' recovery_point_file_manifest_normalize "$TEST_ROOT/duplicate-reference.json" "$BUCKET" "$TEST_ROOT/duplicate"
ok 'duplicate references remain two File rows' jq -e 'length == 2 and [.[].id] == ["file-reference-a", "file-reference-b"] and .[0].objectKey == .[1].objectKey and .[0].objectVersionId == .[1].objectVersionId' "$TEST_ROOT/duplicate/file-manifest.json"
ok 'empty array has an explicit zero-row manifest' recovery_point_file_manifest_normalize "$TEST_ROOT/empty.json" "$BUCKET" "$TEST_ROOT/empty"
ok 'empty manifest invents no references' jq -e 'type == "array" and length == 0' "$TEST_ROOT/empty/file-manifest.json"

bad 'duplicate File IDs fail closed' recovery_point_file_manifest_normalize "$TEST_ROOT/duplicate-id.json" "$BUCKET" "$TEST_ROOT/duplicate-id"
bad 'malformed or truncated JSON fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/truncated.json" "$BUCKET" "$TEST_ROOT/malformed"
bad 'wrong authoritative bucket fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/wrong-bucket.json" "$BUCKET" "$TEST_ROOT/wrong-bucket"
bad 'negative size fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/negative-size.json" "$BUCKET" "$TEST_ROOT/negative-size"
bad 'fractional size fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/fractional-size.json" "$BUCKET" "$TEST_ROOT/fractional-size"
bad 'empty objectVersionId fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/empty-version.json" "$BUCKET" "$TEST_ROOT/empty-version"
jq '.[0].id = 1' "$TEST_ROOT/ordered.json" > "$TEST_ROOT/bad-id-type.json"
bad 'non-string File ID fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/bad-id-type.json" "$BUCKET" "$TEST_ROOT/bad-id-type"
jq '.[0].id = ""' "$TEST_ROOT/ordered.json" > "$TEST_ROOT/empty-id.json"
bad 'empty File ID fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/empty-id.json" "$BUCKET" "$TEST_ROOT/empty-id"
jq '.[0].tenantId = ""' "$TEST_ROOT/ordered.json" > "$TEST_ROOT/empty-tenant.json"
bad 'empty tenant ID fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/empty-tenant.json" "$BUCKET" "$TEST_ROOT/empty-tenant"
jq '.[0].objectKey = ""' "$TEST_ROOT/ordered.json" > "$TEST_ROOT/empty-key.json"
bad 'empty object key fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/empty-key.json" "$BUCKET" "$TEST_ROOT/empty-key"
jq '.[0].checksum = false' "$TEST_ROOT/ordered.json" > "$TEST_ROOT/bad-checksum-type.json"
bad 'non-string checksum fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/bad-checksum-type.json" "$BUCKET" "$TEST_ROOT/bad-checksum-type"

chmod 0755 "$TEST_ROOT/permissive"
bad 'non-private caller directory fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/ordered.json" "$BUCKET" "$TEST_ROOT/permissive"
chmod 0700 "$TEST_ROOT/permissive"
printf 'existing\n' > "$TEST_ROOT/overwrite/file-manifest.json"
chmod 0600 "$TEST_ROOT/overwrite/file-manifest.json"
bad 'existing manifest output is never overwritten' recovery_point_file_manifest_normalize "$TEST_ROOT/ordered.json" "$BUCKET" "$TEST_ROOT/overwrite"
ln -s "$TEST_ROOT/ordered.json" "$TEST_ROOT/symlink/file-manifest.json"
bad 'symlink manifest output fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/ordered.json" "$BUCKET" "$TEST_ROOT/symlink"
LINK_CALL_COUNT=0
ln() {
  LINK_CALL_COUNT=$((LINK_CALL_COUNT + 1))
  if (( LINK_CALL_COUNT == 2 )); then return 1; fi
  command ln "$@"
}
bad 'second artifact publication failure fails closed' recovery_point_file_manifest_normalize "$TEST_ROOT/ordered.json" "$BUCKET" "$TEST_ROOT/fail-publish"
unset -f ln
ok 'failed publication removes both final and temporary artifacts' bash -c '[[ ! -e "$1/file-manifest.json" && ! -e "$1/file-manifest.sha256" ]] && [[ -z "$(find "$1" -maxdepth 1 -name ".file-manifest.*" -print -quit)" ]]' _ "$TEST_ROOT/fail-publish"
if grep -Fq -- 'private/pinned' "$AUDIT"; then fail 'raw object keys are absent from command errors'; else pass 'raw object keys are absent from command errors'; fi

(( FAIL == 0 )) || exit 1
printf 'PASSED: %s assertions\n' "$PASS"
