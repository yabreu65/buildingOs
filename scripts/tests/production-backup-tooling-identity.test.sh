#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly HELPER="$ROOT_DIR/scripts/lib/production-backup-tooling-identity.sh"
readonly WORKFLOW="$ROOT_DIR/.github/workflows/production-backup-tooling-identity.yml"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/backup-tooling-identity.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok %s - %s\n' "$((FAIL_COUNT + 1))" "$1" >&2; }
assert_eq() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail_test "$1"; fi; }
assert_contains() { if [[ "$2" == *"$3"* ]]; then pass "$1"; else fail_test "$1"; fi; }
assert_absent() { if [[ "$2" != *"$3"* ]]; then pass "$1"; else fail_test "$1"; fi; }
assert_failure_without_output() {
  local label="$1"; shift
  local output='' rc=0
  output="$($@ 2>/dev/null)" || rc=$?
  if (( rc != 0 )) && [[ -z "$output" ]]; then pass "$label"; else fail_test "$label"; fi
}

readonly TOOLING_SHA='1111111111111111111111111111111111111111'
readonly RELEASE_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
manifest() {
  printf 'manifest_version=1\ntooling_source_sha=%s\nlauncher_path=/secret/launcher\nlauncher_sha256=%064d\napi_key=super-secret-value\nsudoers_content=private-sudoers\nenvironment_file=private-env\ndatabase_password=private-db-password\nproduction_database_url=postgres://private\nrelease_sha256=%s\n' "$TOOLING_SHA" 1 "$RELEASE_SHA"
}

readonly EXPECTED_OUTPUT=$'PRODUCTION_BACKUP_TOOLING_IDENTITY\nMANIFEST_VERSION=1\nTOOLING_SOURCE_SHA='"$TOOLING_SHA"$'\nRELEASE_SHA256='"$RELEASE_SHA"$'\nMANIFEST_REGULAR_FILE=YES\nMANIFEST_SYMLINK=NO\nPRODUCTION_WRITES=0\nBACKUP_STARTED=NO\nIDENTITY_STATUS=PASS'
readonly FIXTURE="$TEST_ROOT/manifest"
manifest > "$FIXTURE"
valid_output="$(bash "$HELPER" --test-fixture-identity "$FIXTURE")"
assert_eq 'valid remote identity emits approved fields and safety markers only' "$valid_output" "$EXPECTED_OUTPUT"
assert_absent 'arbitrary manifest fields are not emitted' "$valid_output" 'launcher_path'
assert_absent 'manifest secrets are not emitted' "$valid_output" 'super-secret-value'
assert_absent 'database content is not emitted' "$valid_output" 'postgres://private'
assert_absent 'sudoers content is not emitted' "$valid_output" 'private-sudoers'
assert_absent 'environment content is not emitted' "$valid_output" 'private-env'
assert_absent 'database password is not emitted' "$valid_output" 'private-db-password'
assert_contains 'regular manifest file is accepted' "$valid_output" 'MANIFEST_REGULAR_FILE=YES'
assert_contains 'manifest is not a symlink' "$valid_output" 'MANIFEST_SYMLINK=NO'
assert_failure_without_output 'runner rejects arbitrary remote output' bash -c 'printf "%s\\n" "$1" unexpected=secret | bash "$2" --validate-identity' _ "$valid_output" "$HELPER"
canonical_output="$(printf '%s\n' "$valid_output" | bash "$HELPER" --validate-identity)"
assert_eq 'runner emits only the exact canonical marker shape' "$canonical_output" "$EXPECTED_OUTPUT"
assert_failure_without_output 'production remote mode rejects caller-selected paths' bash "$HELPER" --remote-identity "$FIXTURE"
assert_failure_without_output 'fixture mode requires exactly one path' bash "$HELPER" --test-fixture-identity "$FIXTURE" extra

missing_output=''
assert_failure_without_output 'actual missing manifest file fails without output' bash "$HELPER" --test-fixture-identity "$TEST_ROOT/missing"
ln -s "$FIXTURE" "$TEST_ROOT/manifest-symlink"
assert_failure_without_output 'symlink manifest fails without output' bash "$HELPER" --test-fixture-identity "$TEST_ROOT/manifest-symlink"
valid_stderr=''
bash "$HELPER" --test-fixture-identity "$FIXTURE" >/dev/null 2> "$TEST_ROOT/stderr"
valid_stderr="$(< "$TEST_ROOT/stderr")"
assert_eq 'valid remote identity emits no stderr diagnostics' "$valid_stderr" ''
invalid_stderr=''
if bash "$HELPER" --test-fixture-identity "$TEST_ROOT/missing" > "$TEST_ROOT/stdout" 2> "$TEST_ROOT/stderr"; then
  fail_test 'remote failures use only a generic diagnostic'
else
  invalid_stderr="$(< "$TEST_ROOT/stderr")"
  assert_eq 'remote failures use only a generic diagnostic' "$invalid_stderr" 'IDENTITY_STATUS=FAIL'
fi

# Each approved identity field must occur exactly once and satisfy its format.
for field in manifest_version tooling_source_sha release_sha256; do
  value=1
  [[ "$field" == tooling_source_sha ]] && value="$TOOLING_SHA"
  [[ "$field" == release_sha256 ]] && value="$RELEASE_SHA"
  sed "/^${field}=/d" "$FIXTURE" > "$TEST_ROOT/without-field"
  assert_failure_without_output "missing $field fails without partial output" bash "$HELPER" --test-fixture-identity "$TEST_ROOT/without-field"
  { cat "$FIXTURE"; printf '%s=%s\n' "$field" "$value"; } > "$TEST_ROOT/duplicate-field"
  assert_failure_without_output "duplicate $field fails without partial output" bash "$HELPER" --test-fixture-identity "$TEST_ROOT/duplicate-field"
done

for malformed in \
  'manifest_version=2' \
  'manifest_version=01' \
  'tooling_source_sha=ABCDEF' \
  'tooling_source_sha=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' \
  'release_sha256=xyz' \
  'not-an-assignment'; do
  field="${malformed%%=*}"
  if [[ "$malformed" == 'not-an-assignment' ]]; then
    { cat "$FIXTURE"; printf '%s\n' "$malformed"; } > "$TEST_ROOT/malformed"
  else
    sed "s|^${field}=.*|${malformed}|" "$FIXTURE" > "$TEST_ROOT/malformed"
  fi
  assert_failure_without_output "rejects malformed $field without partial output" bash "$HELPER" --test-fixture-identity "$TEST_ROOT/malformed"
done

# Verify unreadability with an unprivileged reader when available; otherwise the
# helper's explicit readability guard is still covered statically.
unreadable="$TEST_ROOT/unreadable"
manifest > "$unreadable"
chmod 000 "$unreadable"
if command -v runuser >/dev/null 2>&1 && id nobody >/dev/null 2>&1; then
  assert_failure_without_output 'unreadable manifest fails without partial output as nobody' runuser -u nobody -- bash "$HELPER" --test-fixture-identity "$unreadable"
elif command -v su >/dev/null 2>&1 && id nobody >/dev/null 2>&1; then
  assert_failure_without_output 'unreadable manifest fails without partial output as nobody' su nobody -s /bin/bash -c 'bash "$1" --test-fixture-identity "$2"' _ "$HELPER" "$unreadable"
else
  assert_contains 'helper explicitly rejects unreadable manifest files' "$(< "$HELPER")" '&& -r "$manifest_path"'
fi
chmod 600 "$unreadable"

workflow_text="$(< "$WORKFLOW")"
helper_text="$(< "$HELPER")"
assert_contains 'workflow dispatch is manual only' "$workflow_text" 'workflow_dispatch:'
assert_absent 'workflow has no push trigger' "$workflow_text" $'\npush:'
assert_absent 'workflow has no scheduled trigger' "$workflow_text" 'schedule:'
assert_contains 'workflow has requested display name' "$workflow_text" 'name: Production backup tooling identity'
assert_contains 'workflow has read-only contents permission' "$workflow_text" $'permissions:\n  contents: read'
assert_contains 'workflow serializes production operations' "$workflow_text" 'group: production-operations'
assert_contains 'workflow uses production environment' "$workflow_text" 'environment: production'
assert_contains 'workflow disables checkout credentials' "$workflow_text" 'persist-credentials: false'
assert_contains 'workflow disables SSH config loading' "$workflow_text" '-F /dev/null'
assert_contains 'workflow uses strict host verification' "$workflow_text" 'StrictHostKeyChecking=yes'
assert_contains 'workflow uses noninteractive SSH' "$workflow_text" 'BatchMode=yes'
assert_contains 'workflow is guarded to main ref' "$workflow_text" '[[ "$GITHUB_REF" == refs/heads/main ]]'
assert_contains 'workflow streams helper source to remote bash identity mode' "$workflow_text" 'bash -s -- --remote-identity'
assert_contains 'workflow uses helper source as SSH stdin' "$workflow_text" '< scripts/lib/production-backup-tooling-identity.sh'
assert_absent 'workflow does not stream manifest contents to runner' "$workflow_text" 'cat /usr/local/libexec/buildingos-backup-preflight/manifest'
assert_absent 'workflow does not parse the full manifest on runner' "$workflow_text" '--parse'
assert_contains 'workflow suppresses remote diagnostics' "$workflow_text" '2>/dev/null'
assert_contains 'workflow reports only a generic failure' "$workflow_text" "printf 'IDENTITY_STATUS=FAIL\\n' >&2"
assert_contains 'workflow disables shell tracing before handling secrets' "$workflow_text" 'set +x'
assert_contains 'workflow sources existing production SSH private key secret' "$workflow_text" 'secrets.PRODUCTION_SSH_PRIVATE_KEY'
assert_contains 'workflow validates remote output before printing it' "$workflow_text" '--validate-identity'
assert_contains 'helper reads only the fixed production manifest by default' "$helper_text" "readonly MANIFEST_PATH='/usr/local/libexec/buildingos-backup-preflight/manifest'"
assert_contains 'remote helper redirects manifest parsing from one path' "$helper_text" 'done < "$manifest_path"'
assert_contains 'production remote mode takes no caller-selected path' "$helper_text" '--remote-identity)'
assert_contains 'test fixture has a distinct explicit mode' "$helper_text" '--test-fixture-identity)'
assert_contains 'helper rejects unreadable manifests before parsing' "$helper_text" '&& -r "$manifest_path"'
for marker in 'PRODUCTION_BACKUP_TOOLING_IDENTITY' 'MANIFEST_VERSION=' 'TOOLING_SOURCE_SHA=' 'RELEASE_SHA256=' 'MANIFEST_REGULAR_FILE=YES' 'MANIFEST_SYMLINK=NO' 'PRODUCTION_WRITES=0' 'BACKUP_STARTED=NO' 'IDENTITY_STATUS=PASS'; do
  assert_contains "canonical output includes $marker" "$valid_output" "$marker"
done
for prohibited in 'systemctl ' 'docker ' 'psql ' 'createdb' 'dropdb' 'rclone copy' 'rclone sync' 'pg_dump' 'pg_restore' 'chown ' 'backup-preflight ' 'deploy' 'migration'; do
  assert_absent "workflow has no production mutation or operation command: $prohibited" "$workflow_text" "$prohibited"
  assert_absent "remote reader has no production mutation or operation command: $prohibited" "$helper_text" "$prohibited"
done
assert_absent 'remote reader does not mutate file permissions' "$helper_text" 'chmod '
assert_contains 'workflow chmod is limited to the local ephemeral SSH key' "$workflow_text" 'chmod 600 "$key_file" "$known_hosts_file"'
assert_contains 'workflow invokes only fixed-path remote identity mode' "$workflow_text" "bash -s -- --remote-identity"
assert_absent 'workflow does not echo private key material' "$workflow_text" 'echo "$SSH_PRIVATE_KEY"'
assert_absent 'workflow does not echo known-host material' "$workflow_text" 'echo "$SSH_KNOWN_HOSTS"'
assert_absent 'workflow does not invoke sudo or preflight launcher' "$workflow_text" 'sudo '
for prohibited in '.ssh/config' 'DATABASE_URL' 'postgres://' 'PGPASSWORD' '/etc/sudoers' '/etc/environment' '/etc/profile'; do
  assert_absent "workflow excludes prohibited secret/config content: $prohibited" "$workflow_text" "$prohibited"
done

if (( FAIL_COUNT > 0 )); then
  printf 'FAIL: %s of %s assertions failed\n' "$FAIL_COUNT" "$((PASS_COUNT + FAIL_COUNT))" >&2
  exit 1
fi
printf 'PASS: %s production backup tooling identity assertions\n' "$PASS_COUNT"
