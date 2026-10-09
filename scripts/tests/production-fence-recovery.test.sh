#!/usr/bin/env bash
set -Eeuo pipefail
set +x

ROOT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-fence-recovery-test.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/lib"
cp "$ROOT_DIR/scripts/recover-interrupted-recovery-point.sh" "$TEST_ROOT/"
cp "$ROOT_DIR/scripts/lib/production-operation-lock.sh" "$TEST_ROOT/lib/"
cp "$ROOT_DIR/scripts/lib/production-fence-operation-state.sh" "$TEST_ROOT/lib/"

cat >"$TEST_ROOT/deploy-production.sh" <<'MOCK_DEPLOY'
#!/usr/bin/env bash
recovery_point_restore_and_resume() {
  printf 'restore-attempt\n' >> "${MOCK_RECOVERY_LOG:?}"
  [[ "${MOCK_POLICY:-temporary}" == temporary || "${MOCK_POLICY:-temporary}" == original ]] || return 1
  if [[ "${RECOVERY_POINT_API_WAS_RUNNING:-false}" == true ]]; then
    printf 'api-resumed\n' >> "$MOCK_RECOVERY_LOG"
  fi
}
MOCK_DEPLOY

cat >"$TEST_ROOT/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
case "${1:-}" in
  inspect)
    if [[ "${3:-}" == *State.Running* ]]; then printf '%s\n' "${MOCK_DOCKER_RUNNING:-false}";
    elif [[ "${3:-}" == *Image* ]]; then printf '%s\n' "${MOCK_IMAGE:?}";
    else exit 2; fi
    ;;
  start) printf 'api-started\n' >> "${MOCK_RECOVERY_LOG:?}" ;;
  *) exit 2 ;;
esac
MOCK_DOCKER
chmod 0755 "$TEST_ROOT/bin/docker" "$TEST_ROOT/deploy-production.sh"

make_state() {
  local root="$1" api_running="${2:-true}" api_quiesced="${3:-true}"
  mkdir -p "$root/policy-snapshot"
  bash -c 'source "$1/lib/production-fence-operation-state.sh"; production_fence_state_write "$2/fence-operation-state.json" FENCE_PREPARED recovery-test-1 1234567890123456789012345678901234567890 sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa /opt/pawtech/env/buildingos.env pawtech_public "$2" "$3" "$4"' _ "$TEST_ROOT" "$root" "$api_running" "$api_quiesced"
}

run_recovery() {
  local root="$1"
  BUILDINGOS_OPERATION_LOCK_PATH="$TEST_ROOT/operation.lock" MOCK_RECOVERY_LOG="$TEST_ROOT/recovery.log" \
    MOCK_IMAGE='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    PATH="$TEST_ROOT/bin:$PATH" bash "$TEST_ROOT/recover-interrupted-recovery-point.sh" --state-root "$root"
}

abrupt_root="$TEST_ROOT/abrupt"
mkdir -p "$abrupt_root/policy-snapshot"
(bash -c 'source "$1/lib/production-fence-operation-state.sh"; production_fence_state_write "$2/fence-operation-state.json" FENCE_PREPARED recovery-test-1 1234567890123456789012345678901234567890 sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa /opt/pawtech/env/buildingos.env pawtech_public "$2" true true; kill -KILL $$' _ "$TEST_ROOT" "$abrupt_root") >/dev/null 2>&1 & abrupt_pid=$!
wait "$abrupt_pid" 2>/dev/null || true
[[ "$(jq -r .status "$abrupt_root/fence-operation-state.json")" == FENCE_PREPARED ]]
printf 'PASS SIGKILL leaves recoverable state\n'

success_root="$TEST_ROOT/success"
make_state "$success_root"
: >"$TEST_ROOT/recovery.log"
MOCK_POLICY=temporary run_recovery "$success_root" >"$TEST_ROOT/success.out"
grep -Fxq 'RECOVERY_FENCE_RECOVERY=PASS' "$TEST_ROOT/success.out"
grep -Fxq 'api-resumed' "$TEST_ROOT/recovery.log"
jq -e '.status == "RECOVERED" and .apiQuiesced == false' "$success_root/fence-operation-state.json" >/dev/null
printf 'PASS recovery after interrupted state\n'

foreign_root="$TEST_ROOT/foreign"
make_state "$foreign_root"
: >"$TEST_ROOT/recovery.log"
if MOCK_POLICY=foreign run_recovery "$foreign_root" >"$TEST_ROOT/foreign.out" 2>&1; then exit 1; fi
grep -Fxq 'RECOVERY_FENCE_RECOVERY=NEEDS_MANUAL_RECOVERY' "$TEST_ROOT/foreign.out"
! grep -Fxq 'api-resumed' "$TEST_ROOT/recovery.log"
jq -e '.status == "NEEDS_MANUAL_RECOVERY"' "$foreign_root/fence-operation-state.json" >/dev/null
printf 'PASS foreign policy requires manual recovery\n'

running_root="$TEST_ROOT/running"
make_state "$running_root" true true
: >"$TEST_ROOT/recovery.log"
if MOCK_DOCKER_RUNNING=true MOCK_POLICY=temporary run_recovery "$running_root" >"$TEST_ROOT/running.out" 2>&1; then exit 1; fi
grep -Fq 'api_running_during_recovery' "$TEST_ROOT/running.out"
! grep -Fxq 'api-resumed' "$TEST_ROOT/recovery.log"
printf 'PASS premature API reactivation rejected\n'

lock_root="$TEST_ROOT/locked"
make_state "$lock_root"
mkdir "$TEST_ROOT/operation.lock.d"
if MOCK_POLICY=temporary run_recovery "$lock_root" >"$TEST_ROOT/locked.out" 2>&1; then exit 1; fi
grep -Fxq 'RECOVERY_FENCE_RECOVERY=NEEDS_MANUAL_RECOVERY' "$TEST_ROOT/locked.out"
printf 'PASS shared lock conflict rejected\n'

printf 'PRODUCTION_FENCE_RECOVERY_TESTS=PASS\n'
