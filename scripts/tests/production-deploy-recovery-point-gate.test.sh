#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy-production.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-production-recovery-gate.XXXXXX")"
trap '[[ -n "${KEEP:-}" ]] || rm -rf -- "$TEST_ROOT"' EXIT
BIN="$TEST_ROOT/bin"
AUDIT="$TEST_ROOT/audit"
STATE="$TEST_ROOT/api-state"
EVIDENCE="$TEST_ROOT/evidence"
DIGEST='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
SHA='0123456789abcdef0123456789abcdef01234567'
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf 'ok %s - %s\n' "$PASS" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'not ok %s - %s\n' "$FAIL" "$1" >&2; }
ok() { local name="$1"; shift; if "$@" >>"$AUDIT" 2>&1; then pass "$name"; else fail "$name"; fi; }
bad() { local name="$1"; shift; if "$@" >>"$AUDIT" 2>&1; then fail "$name (unexpected success)"; else pass "$name"; fi; }
line_number() { awk -v pattern="$1" 'index($0, pattern) { print NR; exit }' "$DEPLOY_SCRIPT"; }

mkdir -p "$BIN" "$EVIDENCE/policy-snapshot"
: >"$AUDIT"
printf true >"$STATE"
cat >"$BIN/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >>"$FAKE_AUDIT"
case "${1:-}" in
  stop) printf false >"$FAKE_API_STATE" ;;
  start) printf true >"$FAKE_API_STATE" ;;
  inspect)
    case "${2:-}" in
      --format)
        case "${3:-}" in
              '{{range .Config.Env}}{{println .}}{{end}}') cat "$FAKE_CONTAINER_ENV" ;;
          '{{.State.Running}}') cat "$FAKE_API_STATE" ;;
          '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}') printf healthy ;;
          '{{.Image}}') printf '%s' "$FAKE_DIGEST" ;;
          *) exit 81 ;;
        esac
        ;;
      *) exit 82 ;;
    esac
    ;;
  *) exit 83 ;;
esac
DOCKER
chmod +x "$BIN/docker"

preflight_line="$(line_number "PHASE='recovery-point-preflight'")"
quiesce_line="$(line_number 's3_fence_run_recovery_point')"
capture_line="$(line_number 'recovery_point_capture_under_fence')"
gate_line="$(line_number "recovery_point_validate_capture || fail 'Recovery-point receipt did not prove every required component'")"
checkpoint_line="$(line_number 'write_record IN_PROGRESS')"
backup_line="$(line_number "PHASE='backup'")"
migration_line="$(line_number "PHASE='migrations'")"
[[ -n "$preflight_line" && -n "$quiesce_line" && -n "$capture_line" && -n "$gate_line" && -n "$checkpoint_line" && -n "$backup_line" && -n "$migration_line" ]] && pass 'recovery-point stages are explicit' || fail 'recovery-point stages are explicit'
(( preflight_line < quiesce_line && quiesce_line < gate_line && gate_line < checkpoint_line && checkpoint_line < backup_line && backup_line < migration_line )) && pass 'preflight and fenced capture precede checkpoint backup and migrations' || fail 'preflight and fenced capture precede checkpoint backup and migrations'
grep -F 'recovery_point_preflight || fail' "$DEPLOY_SCRIPT" >/dev/null && grep -F 'recovery_point_capture_under_fence recovery_point_resume_api' "$DEPLOY_SCRIPT" >/dev/null && pass 'capture is only the deny-fence callback' || fail 'capture is only the deny-fence callback'
grep -F 'recovery_point_postgres_snapshot_require_runtime' "$DEPLOY_SCRIPT" >/dev/null && grep -F 'recovery_point_rclone_require_download_check' "$DEPLOY_SCRIPT" >/dev/null && grep -F 's3_fence_preflight "$PREVIOUS_API_DIGEST"' "$DEPLOY_SCRIPT" >/dev/null && pass 'all SDK rclone and PostgreSQL capabilities preflight before quiescence' || fail 'all SDK rclone and PostgreSQL capabilities preflight before quiescence'
grep -F 'recovery_point_read_container_env buildingos-api S3_BUCKET' "$DEPLOY_SCRIPT" >/dev/null && ! grep -Fq 'source "$ENV_FILE"' "$DEPLOY_SCRIPT" && pass 'source bucket is selected from runtime without sourcing API env' || fail 'source bucket is selected from runtime without sourcing API env'

CONTAINER_ENV="$TEST_ROOT/container-env"
: >"$CONTAINER_ENV"
export PATH="$BIN:/usr/bin:/bin" FAKE_AUDIT="$AUDIT" FAKE_API_STATE="$STATE" FAKE_DIGEST="$DIGEST" FAKE_EVIDENCE="$EVIDENCE" FAKE_CONTAINER_ENV="$CONTAINER_ENV" DEPLOY_SCRIPT
run_callback_case() {
  local scenario="$1"
  env SCENARIO="$scenario" BUILDINGOS_DEPLOY_RECOVERY_POINT_LIBRARY_ONLY=true \
    PATH="$PATH" FAKE_AUDIT="$AUDIT" FAKE_API_STATE="$STATE" FAKE_DIGEST="$DIGEST" FAKE_EVIDENCE="$EVIDENCE" DEPLOY_SCRIPT="$DEPLOY_SCRIPT" \
    bash -c '
      set -- 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 https://api.example/health https://api.example/readyz https://web.example/login
      source "$DEPLOY_SCRIPT"
      PREVIOUS_API_DIGEST="$FAKE_DIGEST"
      write_record(){ printf "record:%s\n" "$1" >>"$FAKE_AUDIT"; }
      case "$SCENARIO" in
        running)
          RECOVERY_POINT_API_WAS_RUNNING=true; RECOVERY_POINT_API_QUIESCED=false; RECOVERY_POINT_POLICY_RESTORED=false
          recovery_point_quiesce_api
          printf "capture-under-deny\n" >>"$FAKE_AUDIT"
          recovery_point_resume_api
          ;;
        stopped)
          RECOVERY_POINT_API_WAS_RUNNING=false; RECOVERY_POINT_API_QUIESCED=false; RECOVERY_POINT_POLICY_RESTORED=false
          recovery_point_quiesce_api; recovery_point_resume_api
          ;;
        stopped-fence)
              RECOVERY_POINT_API_WAS_RUNNING=false; RECOVERY_POINT_API_QUIESCED=false; RECOVERY_POINT_POLICY_RESTORED=false; RECOVERY_POINT_FENCE_EVIDENCE="$FAKE_EVIDENCE"
              s3_fence_restore_policy(){ printf "restore\n" >>"$FAKE_AUDIT"; return 0; }
              recovery_point_restore_and_resume
              ;;
            restore)
          RECOVERY_POINT_API_WAS_RUNNING=true; RECOVERY_POINT_API_QUIESCED=true; RECOVERY_POINT_POLICY_RESTORED=false; RECOVERY_POINT_FENCE_EVIDENCE="$FAKE_EVIDENCE"
          s3_fence_restore_policy(){ printf "restore\n" >>"$FAKE_AUDIT"; return 0; }
          recovery_point_restore_and_resume
          ;;
        ambiguous)
          RECOVERY_POINT_API_WAS_RUNNING=true; RECOVERY_POINT_API_QUIESCED=true; RECOVERY_POINT_POLICY_RESTORED=false; RECOVERY_POINT_FENCE_EVIDENCE="$FAKE_EVIDENCE"
          s3_fence_restore_policy(){ printf "restore-failed\n" >>"$FAKE_AUDIT"; return 1; }
          recovery_point_restore_and_resume
          ;;
        error)
          RECOVERY_POINT_API_WAS_RUNNING=true; RECOVERY_POINT_API_QUIESCED=true; RECOVERY_POINT_POLICY_RESTORED=false; RECOVERY_POINT_FENCE_EVIDENCE="$FAKE_EVIDENCE"
          s3_fence_restore_policy(){ printf "restore\n" >>"$FAKE_AUDIT"; return 0; }
          set +e; false; on_error
          ;;
        signal)
          RECOVERY_POINT_API_WAS_RUNNING=true; RECOVERY_POINT_API_QUIESCED=true; RECOVERY_POINT_POLICY_RESTORED=false; RECOVERY_POINT_FENCE_EVIDENCE="$FAKE_EVIDENCE"
          s3_fence_restore_policy(){ printf "restore\n" >>"$FAKE_AUDIT"; return 0; }
          on_signal INT
          ;;
      esac
    '
}

: >"$AUDIT"; printf true >"$STATE"
ok 'running API is quiesced, captured under deny, then resumed' run_callback_case running
grep -Eq '^stop --timeout 30 buildingos-api$' "$AUDIT" && grep -Eq '^capture-under-deny$' "$AUDIT" && grep -Eq '^start buildingos-api$' "$AUDIT" && (( $(grep -n -m1 '^stop ' "$AUDIT" | cut -d: -f1) < $(grep -n -m1 '^capture-under-deny$' "$AUDIT" | cut -d: -f1) && $(grep -n -m1 '^capture-under-deny$' "$AUDIT" | cut -d: -f1) < $(grep -n -m1 '^start ' "$AUDIT" | cut -d: -f1) )) && pass 'capture is between stop and resume' || fail 'capture is between stop and resume'

: >"$AUDIT"; printf false >"$STATE"
ok 'prior-stopped API remains stopped' run_callback_case stopped
! grep -Eq '^(stop|start) ' "$AUDIT" && pass 'prior-stopped state has no lifecycle mutation' || fail 'prior-stopped state has no lifecycle mutation'

: >"$AUDIT"; printf false >"$STATE"
ok 'ordinary failure restores policy before API resume' run_callback_case restore
restore_line="$(grep -n -m1 '^restore$' "$AUDIT" | cut -d: -f1)"; start_line="$(grep -n -m1 '^start ' "$AUDIT" | cut -d: -f1)"
[[ -n "$restore_line" && -n "$start_line" ]] && (( restore_line < start_line )) && pass 'restoration precedes resume' || fail 'restoration precedes resume'

: >"$AUDIT"; printf false >"$STATE"
ok 'active fence is restored when API was already stopped' run_callback_case stopped-fence
    grep -Eq '^restore$' "$AUDIT" && ! grep -Eq '^start ' "$AUDIT" && [[ "$(<"$STATE")" == false ]] && pass 'prior-stopped active fence restores without starting API' || fail 'prior-stopped active fence restores without starting API'

    : >"$AUDIT"; printf false >"$STATE"
    bad 'ambiguous restoration leaves API stopped' run_callback_case ambiguous
! grep -Eq '^start ' "$AUDIT" && [[ "$(<"$STATE")" == false ]] && pass 'unverified policy restoration never resumes API' || fail 'unverified policy restoration never resumes API'

: >"$AUDIT"; printf false >"$STATE"
API_ENV="$TEST_ROOT/api.env"
    run_s3_environment_case() {
      env BUILDINGOS_DEPLOY_RECOVERY_POINT_LIBRARY_ONLY=true PATH="$PATH" FAKE_AUDIT="$AUDIT" FAKE_API_STATE="$STATE" FAKE_DIGEST="$DIGEST" FAKE_EVIDENCE="$EVIDENCE" FAKE_CONTAINER_ENV="$CONTAINER_ENV" DEPLOY_SCRIPT="$DEPLOY_SCRIPT" API_ENV="$1" \
        bash -c '
          set -- 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 https://api.example/health https://api.example/readyz https://web.example/login
          source "$DEPLOY_SCRIPT"
          recovery_point_validate_api_s3_runtime_env "$API_ENV" buildingos-api
        '
    }
    printf '%s\n' 'S3_ENDPOINT=https://objects.internal' 'S3_BUCKET=source-bucket' >"$API_ENV"
    chmod 0600 "$API_ENV"
    printf '%s\n' 'S3_ENDPOINT=https://objects.internal' 'S3_BUCKET=source-bucket' >"$CONTAINER_ENV"
    : >"$AUDIT"
    ok 'effective API S3 settings match with default region and path style' run_s3_environment_case "$API_ENV"
    ! grep -Fq 'objects.internal' "$AUDIT" && ! grep -Fq 'source-bucket' "$AUDIT" && pass 'S3 settings are not printed during comparison' || fail 'S3 settings are not printed during comparison'
    printf '%s\n' 'S3_ENDPOINT=https://different.internal' 'S3_BUCKET=source-bucket' >"$CONTAINER_ENV"
    bad 'mismatched effective S3 endpoint is rejected before quiesce' run_s3_environment_case "$API_ENV"
    printf '%s\n' 'S3_ENDPOINT=https://objects.internal' 'S3_BUCKET=source-bucket' 'S3_BUCKET=duplicate-bucket' >"$CONTAINER_ENV"
    bad 'duplicate selected runtime S3 setting is rejected' run_s3_environment_case "$API_ENV"
    printf '%s\n' 'S3_ENDPOINT=https://objects.internal' 'S3_BUCKET=source-bucket' 'S3_BUCKET=duplicate-bucket' >"$API_ENV"
    printf '%s\n' 'S3_ENDPOINT=https://objects.internal' 'S3_BUCKET=source-bucket' >"$CONTAINER_ENV"
    bad 'duplicate selected protected API S3 setting is rejected' run_s3_environment_case "$API_ENV"
    printf '%s\n' 'S3_BUCKET=source-bucket' >"$API_ENV"
    printf '%s\n' 'S3_ENDPOINT=https://objects.internal' 'S3_BUCKET=source-bucket' >"$CONTAINER_ENV"
    bad 'missing required protected API S3 setting is rejected' run_s3_environment_case "$API_ENV"

    generate_recovery_id_case() {
      env BUILDINGOS_DEPLOY_RECOVERY_POINT_LIBRARY_ONLY=true PATH="$PATH" FAKE_AUDIT="$AUDIT" FAKE_API_STATE="$STATE" FAKE_DIGEST="$DIGEST" FAKE_EVIDENCE="$EVIDENCE" FAKE_CONTAINER_ENV="$CONTAINER_ENV" DEPLOY_SCRIPT="$DEPLOY_SCRIPT" \
        bash -c '
          set -- 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 https://api.example/health https://api.example/readyz https://web.example/login
          source "$DEPLOY_SCRIPT"
          PREVIOUS_SHA=0123456789abcdef0123456789abcdef01234567
          recovery_point_generate_id
          printf "%s" "$RECOVERY_POINT_ID"
        '
    }
    recovery_id="$(generate_recovery_id_case)"
    [[ "$recovery_id" =~ ^0123456789ab-[0-9]{8}t[0-9]{6}z-[a-f0-9]{24}$ && "$recovery_id" != *[A-Z]* ]] && pass 'generated recovery-point ID is lowercase and valid' || fail 'generated recovery-point ID is lowercase and valid'

    validate_destination_case() {
      env BUILDINGOS_DEPLOY_RECOVERY_POINT_LIBRARY_ONLY=true PATH="$PATH" FAKE_AUDIT="$AUDIT" FAKE_API_STATE="$STATE" FAKE_DIGEST="$DIGEST" FAKE_EVIDENCE="$EVIDENCE" FAKE_CONTAINER_ENV="$CONTAINER_ENV" DEPLOY_SCRIPT="$DEPLOY_SCRIPT" SOURCE_BUCKET="$1" DESTINATION="$2" RECOVERY_ROOT="$3" \
        bash -c '
          set -- 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 https://api.example/health https://api.example/readyz https://web.example/login
          source "$DEPLOY_SCRIPT"
          recovery_point_validate_backup_destination "$SOURCE_BUCKET" "$DESTINATION" "$RECOVERY_ROOT"
        '
    }
    ok 'backup destination bucket is isolated and namespace stays under it' validate_destination_case source-bucket backup:recovery-bucket/buildingos backup:recovery-bucket/buildingos/recovery-points/sha/id
    bad 'backup destination bucket cannot equal source bucket' validate_destination_case source-bucket backup:source-bucket/buildingos backup:source-bucket/buildingos/recovery-points/sha/id
    bad 'recovery namespace cannot escape dedicated backup destination' validate_destination_case source-bucket backup:recovery-bucket/buildingos backup:other-bucket/recovery-points/sha/id

    private_parent="$TEST_ROOT/private-parent"
    create_private_state_case() {
      env BUILDINGOS_DEPLOY_RECOVERY_POINT_LIBRARY_ONLY=true PATH="$PATH" FAKE_AUDIT="$AUDIT" FAKE_API_STATE="$STATE" FAKE_DIGEST="$DIGEST" FAKE_EVIDENCE="$EVIDENCE" FAKE_CONTAINER_ENV="$CONTAINER_ENV" DEPLOY_SCRIPT="$DEPLOY_SCRIPT" PRIVATE_PARENT="$1" \
        bash -c '
          set -- 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 https://api.example/health https://api.example/readyz https://web.example/login
          source "$DEPLOY_SCRIPT"
          recovery_point_create_private_state_dir "$PRIVATE_PARENT" 0123456789ab
          stat -f %Lp "$RECOVERY_POINT_STATE_DIR"
        '
    }
    private_mode="$(create_private_state_case "$private_parent")"
    [[ "$private_mode" == 700 && "$(stat -f %Lp "$private_parent")" == 700 ]] && pass 'new private evidence parent and unique root use mode 0700' || fail 'new private evidence parent and unique root use mode 0700'
    unsafe_parent="$TEST_ROOT/unsafe-parent"; mkdir -m 0755 "$unsafe_parent"; printf keep >"$unsafe_parent/sentinel"
    bad 'existing nonprivate evidence parent is rejected without chmod or cleanup' create_private_state_case "$unsafe_parent"
    [[ "$(stat -f %Lp "$unsafe_parent")" == 755 && -f "$unsafe_parent/sentinel" ]] && pass 'unrelated evidence parent remains untouched on preflight failure' || fail 'unrelated evidence parent remains untouched on preflight failure'
    ln -s "$unsafe_parent" "$TEST_ROOT/private-parent-link"
    bad 'symlinked evidence parent is rejected' create_private_state_case "$TEST_ROOT/private-parent-link"

    bad 'ordinary error path restores and records failure safely' run_callback_case error
restore_line="$(grep -n -m1 '^restore$' "$AUDIT" | cut -d: -f1)"; record_line="$(grep -n -m1 '^record:FAILED$' "$AUDIT" | cut -d: -f1)"
[[ -n "$restore_line" && -n "$record_line" ]] && (( restore_line < record_line )) && pass 'error restoration precedes failure record' || fail 'error restoration precedes failure record'

: >"$AUDIT"; printf false >"$STATE"
bad 'INT path restores and records failure safely' run_callback_case signal
restore_line="$(grep -n -m1 '^restore$' "$AUDIT" | cut -d: -f1)"; record_line="$(grep -n -m1 '^record:FAILED$' "$AUDIT" | cut -d: -f1)"
[[ -n "$restore_line" && -n "$record_line" ]] && (( restore_line < record_line )) && pass 'signal restoration precedes failure record' || fail 'signal restoration precedes failure record'

(( FAIL == 0 )) || exit 1
printf 'PASSED: %s assertions\n' "$PASS"
