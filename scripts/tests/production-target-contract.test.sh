#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly GATE="$ROOT_DIR/scripts/verify-production-target-contract.sh"
readonly WORKFLOW="$ROOT_DIR/.github/workflows/deploy-production.yml"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-target-contract-test.XXXXXX")"
readonly TMP_ROOT

cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

fail_test() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

pass_test() { printf 'ok - %s\n' "$1"; }
line_number() { awk -v pattern="$1" 'index($0, pattern) { print NR; exit }' "$2"; }

old_target="$TMP_ROOT/pre-107"
mkdir -p "$old_target/scripts/manifests"
printf 'manifest_version\t1\nbaseline\t81\t0\ntarget\t98\t0\n' \
  > "$old_target/scripts/manifests/production-migrations-81-to-98.tsv"
if bash "$GATE" "$old_target" >/dev/null 2>&1; then
  fail_test 'pre-107 target contract was accepted'
fi
pass_test 'pre-107 target contract is rejected'

stale_target="$TMP_ROOT/stale-106"
mkdir -p "$stale_target/scripts/manifests" "$stale_target/apps/api/prisma"
cp "$ROOT_DIR/scripts/manifests/production-migrations-81-to-106.tsv" \
  "$stale_target/scripts/manifests/production-migrations-81-to-106.tsv"
cp -R "$ROOT_DIR/apps/api/prisma/migrations" "$stale_target/apps/api/prisma/"
if bash "$GATE" "$stale_target" >/dev/null 2>&1; then
  fail_test 'stale 106 target contract was accepted after validator moved to 107'
fi
pass_test 'stale 106 target contract is rejected after validator moves to 107'

valid_target="$TMP_ROOT/valid-107"
mkdir -p "$valid_target/scripts/manifests" "$valid_target/apps/api/prisma"
cp "$ROOT_DIR/scripts/manifests/production-migrations-81-to-107.tsv" \
  "$valid_target/scripts/manifests/production-migrations-81-to-107.tsv"
cp -R "$ROOT_DIR/apps/api/prisma/migrations" "$valid_target/apps/api/prisma/"
bash "$GATE" "$valid_target" >/dev/null || fail_test 'valid 107 target contract was rejected'
pass_test 'verified 107 target contract is accepted'

grep -F 'readonly TRUSTED_VERIFIER="$SCRIPT_DIR/verify-production-migration-manifest.sh"' "$GATE" >/dev/null
if grep -F 'target_tree/scripts/verify-production-migration-manifest.sh' "$GATE" >/dev/null; then
  fail_test 'target tree verifier is trusted by the gate'
fi
pass_test 'target tree verifier is not trusted by the gate'

manifest_gate_line="$(line_number 'test -f scripts/manifests/production-migrations-81-to-107.tsv && test ! -L scripts/manifests/production-migrations-81-to-107.tsv' "$WORKFLOW")"
target_contract_line="$(line_number 'bash scripts/verify-production-target-contract.sh "$target_tree"' "$WORKFLOW")"
deployment_step_line="$(line_number '- name: Run trusted production deployment' "$WORKFLOW")"
ssh_line="$(line_number 'ssh "${ssh_opts[@]}" "$SSH_USER@$SSH_HOST"' "$WORKFLOW")"
[[ -n "$manifest_gate_line" && -n "$target_contract_line" && -n "$deployment_step_line" && -n "$ssh_line" ]] || fail_test 'workflow manifest gate, target contract gate, or SSH step is missing'
(( manifest_gate_line < target_contract_line && target_contract_line < deployment_step_line && deployment_step_line < ssh_line )) \
  || fail_test 'manifest and target gates must run before the SSH deployment step'
pass_test 'exact 107 manifest and target contract rejection occur before the SSH deployment step'

release_a_manifest="$ROOT_DIR/scripts/manifests/production-migrations-81-to-107.tsv"
[[ -f "$release_a_manifest" ]] || fail_test '107 target manifest is missing'
grep -Fx $'target\t107\t0' "$release_a_manifest" >/dev/null \
  || fail_test '107 target manifest does not declare exact target 107'
[[ ! -e "$ROOT_DIR/apps/api/prisma/migrations/20260920000000_release_a_followup" ]] \
  || fail_test 'future migration 108 exists'
pass_test 'Release A inventory targets exactly 107 and has no follow-up migration 108'

PRODUCTION_COMPOSE="$ROOT_DIR/infra/docker/docker-compose.production.yml"
STAGING_COMPOSE="$ROOT_DIR/infra/docker/docker-compose.staging.yml"
RELEASE_STAGING_COMPOSE="$ROOT_DIR/infra/docker/docker-compose.release-staging.yml"
grep -F 'RELEASE_A_WRITE_BARRIER_ENABLED: "true"' "$PRODUCTION_COMPOSE" >/dev/null \
  || fail_test 'production API does not explicitly enable the write barrier'
grep -F 'RELEASE_A_WRITE_BARRIER_PATH: /run/buildingos-release-control/CLOSED' "$PRODUCTION_COMPOSE" >/dev/null \
  || fail_test 'production API does not configure the CLOSED sentinel path'
grep -F '/opt/pawtech/apps/buildingos/release-control:/run/buildingos-release-control:ro' "$PRODUCTION_COMPOSE" >/dev/null \
  || fail_test 'production API control directory is not mounted read-only'
pass_test 'production API enables the barrier with the CLOSED sentinel and read-only control mount'

assert_read_only_barrier_mount() {
  local compose_file="$1"
  grep -F '/opt/pawtech/apps/buildingos/release-control:/run/buildingos-release-control:ro' "$compose_file" >/dev/null
}
read_only_fixture="$TMP_ROOT/production-compose-readonly.yml"
cp "$PRODUCTION_COMPOSE" "$read_only_fixture"
python3 - "$read_only_fixture" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(path.read_text().replace(
    '/opt/pawtech/apps/buildingos/release-control:/run/buildingos-release-control:ro',
    '/opt/pawtech/apps/buildingos/release-control:/run/buildingos-release-control:rw',
))
PY
if assert_read_only_barrier_mount "$read_only_fixture" >/dev/null 2>&1; then
  fail_test 'writable production API barrier mount fixture was accepted'
fi
assert_read_only_barrier_mount "$PRODUCTION_COMPOSE" || fail_test 'production API control directory mount is not read-only at the exact runtime path'
pass_test 'writable barrier mount negative fixture is rejected'

assert_helper_barrier_modes() {
  local helper="$1" label="$2"
  grep -F 'install -d -m 711 ' "$helper" >/dev/null || return 1
  grep -F 'chmod 711 ' "$helper" >/dev/null || return 1
  grep -F 'recovery_point_portable_stat_mode "$' "$helper" | grep -F '== 711' >/dev/null || return 1
  grep -F 'chmod 600 ' "$helper" >/dev/null || return 1
  grep -F 'recovery_point_portable_stat_mode "$' "$helper" | grep -F '== 600' >/dev/null || return 1
  if grep -E '(^|[^0-9])0?777([^0-9]|$)' "$helper" >/dev/null; then return 1; fi
}
assert_helper_barrier_modes "$ROOT_DIR/scripts/deploy-production.sh" deploy || fail_test 'deploy mode contract is missing'
assert_helper_barrier_modes "$ROOT_DIR/scripts/rollback-production.sh" rollback || fail_test 'rollback mode contract is missing'
assert_release_checks_modes_before_delete() {
  local helper="$1" directory_var="$2" sentinel_var="$3" block
  block="$(awk '/^remove_release_a_barrier\(\) \{/ { in_function=1 } in_function { print } in_function && /^}/ { exit }' "$helper")"
  awk -v directory_var="$directory_var" -v sentinel_var="$sentinel_var" '
    /recovery_point_portable_stat_mode/ && index($0, directory_var) { directory_check=NR }
    /recovery_point_portable_stat_mode/ && index($0, sentinel_var) { sentinel_check=NR }
    /rm -f --/ && index($0, sentinel_var) { delete_line=NR }
    END { exit !(directory_check && sentinel_check && delete_line && directory_check < delete_line && sentinel_check < delete_line) }
  ' <<< "$block"
}
assert_release_checks_modes_before_delete "$ROOT_DIR/scripts/deploy-production.sh" RELEASE_A_CONTROL_DIR RELEASE_A_SENTINEL \
  || fail_test 'deploy does not prove both modes before releasing the sentinel'
assert_release_checks_modes_before_delete "$ROOT_DIR/scripts/rollback-production.sh" ROLLBACK_CONTROL_DIR ROLLBACK_SENTINEL \
  || fail_test 'rollback does not prove both modes before releasing the sentinel'
mode_fixture="$TMP_ROOT/deploy-create-mode-0700.sh"
cp "$ROOT_DIR/scripts/deploy-production.sh" "$mode_fixture"
python3 - "$mode_fixture" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(path.read_text().replace('install -d -m 711 "$RELEASE_A_CONTROL_DIR"', 'install -d -m 700 "$RELEASE_A_CONTROL_DIR"'))
PY
if assert_helper_barrier_modes "$mode_fixture" negative-create-0700 >/dev/null 2>&1; then
  fail_test '0700 directory creation mode negative fixture was accepted'
fi
pass_test 'deploy and rollback prove create/chmod directory 0711 and sentinel 0600; 0700 and 0777 are rejected'

staging_api="$(awk '/^  buildingos-api:/{capture=1} capture{print} capture && /^  [^ ]/{if ($1 != "buildingos-api:") exit}' "$STAGING_COMPOSE")"
release_staging_api="$(awk '/^  buildingos-api:/{capture=1} capture{print} capture && /^  [^ ]/{if ($1 != "buildingos-api:") exit}' "$RELEASE_STAGING_COMPOSE")"
grep -F 'RELEASE_A_WRITE_BARRIER_ENABLED: "false"' <<< "$staging_api" >/dev/null \
  || fail_test 'staging API does not explicitly disable the write barrier'
grep -F 'RELEASE_A_WRITE_BARRIER_ENABLED: "false"' <<< "$release_staging_api" >/dev/null \
  || fail_test 'release-staging API does not explicitly disable the write barrier'
if printf '%s\n%s\n' "$staging_api" "$release_staging_api" | grep -F 'RELEASE_A_WRITE_BARRIER_PATH:' >/dev/null; then
  fail_test 'staging API unexpectedly configures a write-barrier path'
fi
pass_test 'staging APIs explicitly disable the barrier and configure no sentinel path'

FULL_COMPOSE="$ROOT_DIR/infra/docker/docker-compose.full.yml"
full_api="$(awk '/^  buildingos-api:/{capture=1} capture{print} capture && /^  [^ ]/{if ($1 != "buildingos-api:") exit}' "$FULL_COMPOSE")"
assert_api_waits_for_bucket_initializer() {
  local api_block="$1" label="$2"
  if ! awk '
    /^    depends_on:$/ { in_dependencies=1; next }
    in_dependencies && /^    [^ ]/ { in_dependencies=0 }
    in_dependencies && /^      createbuckets:$/ { in_initializer=1; next }
    in_initializer && /^        condition: service_completed_successfully$/ { found=1 }
    in_initializer && /^      [^ ]/ { in_initializer=0 }
    END { exit !found }
  ' <<< "$api_block"; then
    fail_test "$label API does not wait for successful bucket initialization"
  fi
}
assert_api_waits_for_bucket_initializer "$full_api" 'local'
assert_api_waits_for_bucket_initializer "$release_staging_api" 'release-staging'
pass_test 'local and release-staging APIs wait for successful bucket initialization'

LOCAL_COMPOSE="$ROOT_DIR/infra/docker/docker-compose.yml"
for compose_file in "$LOCAL_COMPOSE" "$RELEASE_STAGING_COMPOSE"; do
  create_line="$(line_number 'mc mb --ignore-existing myminio/${S3_BUCKET:?S3_BUCKET is required}' "$compose_file")"
  version_line="$(line_number 'mc version enable myminio/${S3_BUCKET:?S3_BUCKET is required}' "$compose_file")"
  private_line="$(line_number 'mc anonymous set private myminio/${S3_BUCKET:?S3_BUCKET is required}' "$compose_file")"
  [[ -n "$create_line" && -n "$version_line" && -n "$private_line" ]] \
    || fail_test "bucket initializer in $compose_file is missing its create, versioning, or private-policy step"
  (( create_line < version_line && version_line < private_line )) \
    || fail_test "bucket initializer in $compose_file must enforce private access after create and versioning"
  if grep -E 'mc anonymous set (download|upload|public)|mc policy set (download|upload|public)' "$compose_file" >/dev/null; then
    fail_test "bucket initializer in $compose_file grants public/download/upload access"
  fi
done
pass_test 'local and release-staging bucket initializers enforce private anonymous access without public grants'

printf '1..12\n'
