#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d "/tmp/buildingos-privctl-receipt.XXXXXX")"
FAKE_ROOT="$TEST_ROOT/root"
SYSTEMCTL_LOG="$TEST_ROOT/systemctl.log"
LOGGER_LOG="$TEST_ROOT/logger.log"
SERVICE_STATE_FILE="$TEST_ROOT/service-state"
FAKE_LAUNCHER="$FAKE_ROOT/usr/local/sbin/buildingos-privctl"
MANIFEST="$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
RECEIPT="$FAKE_ROOT/var/lib/buildingos-object-backup/object-backup-receipt.json"
ACTIVATION_STATE_DIR="$FAKE_ROOT/var/lib/buildingos-backup-preflight"
ACTIVATION_MARKER="$ACTIVATION_STATE_DIR/object-backup-activation.state"
OBJECT_SERVICE_UNIT="$FAKE_ROOT/etc/systemd/system/pawtech-buildingos-object-backup.service"
OBJECT_TIMER_UNIT="$FAKE_ROOT/etc/systemd/system/pawtech-buildingos-object-backup.timer"
OBJECT_TIMER='pawtech-buildingos-object-backup.timer'
ACTIVE_TIMER_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=Wed 2025-06-25 02:15:00 UTC }'
trap 'rm -rf "$TEST_ROOT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok %s - %s\n' "$FAIL_COUNT" "$1" >&2; }
assert_success() { local name="$1"; shift; if "$@" >"$TEST_ROOT/output" 2>&1; then pass "$name"; else fail_test "$name"; cat "$TEST_ROOT/output" >&2; fi; }
assert_failure() { local name="$1"; shift; if "$@" >"$TEST_ROOT/output" 2>&1; then fail_test "$name (unexpected success)"; else pass "$name"; fi; }
assert_contains() { local name="$1" needle="$2" file="$3"; if grep -Fq -- "$needle" "$file"; then pass "$name"; else fail_test "$name"; fi; }
assert_empty() { local name="$1" file="$2"; if [[ ! -s "$file" ]]; then pass "$name"; else fail_test "$name"; fi; }
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | awk '{print $1}'
  else
    shasum -a 256 -- "$1" | awk '{print $1}'
  fi
}
hash_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

make_tools() {
  mkdir -p "$FAKE_ROOT/usr/bin"
  cat > "$FAKE_ROOT/usr/bin/env" <<'EOF'
#!/bin/sh
exec /usr/bin/env "$@"
EOF
  cat > "$FAKE_ROOT/usr/bin/awk" <<'EOF'
#!/bin/sh
exec /usr/bin/awk "$@"
EOF
  cat > "$FAKE_ROOT/usr/bin/cmp" <<'EOF'
#!/bin/sh
exec /usr/bin/cmp "$@"
EOF
  cat > "$FAKE_ROOT/usr/bin/sha256sum" <<'EOF'
#!/bin/sh
if command -v sha256sum >/dev/null 2>&1; then
  exec sha256sum "$@"
fi
exec shasum -a 256 "$@"
EOF
  cat > "$FAKE_ROOT/usr/bin/id" <<'EOF'
#!/bin/sh
case "${1-}" in
  -u) printf '1001\n' ;;
  -g) printf '1001\n' ;;
  *) exit 1 ;;
esac
EOF
  cat > "$FAKE_ROOT/usr/bin/stat" <<'EOF'
#!/bin/sh
for argument do path="$argument"; done
if /usr/bin/stat -c '%a' -- "$path" >/dev/null 2>&1; then
  mode="$(/usr/bin/stat -c '%a' -- "$path")"
else
  mode="$(/usr/bin/stat -f '%Lp' -- "$path")"
fi
case "$path" in
  */var/lib/buildingos-object-backup|*/var/lib/buildingos-object-backup/object-backup-receipt.json) printf '1001:1001:%s\n' "$mode" ;;
  */var/lib/buildingos-backup-preflight/object-backup-activation.state) printf '%s:%s:%s\n' "${MOCK_MARKER_UID:-0}" "${MOCK_MARKER_GID:-0}" "${MOCK_MARKER_MODE:-$mode}" ;;
  */etc/sudoers.d) printf '%s:%s:%s\n' "${MOCK_SUDOERS_DIR_UID:-0}" "${MOCK_SUDOERS_DIR_GID:-0}" "${MOCK_SUDOERS_DIR_MODE:-$mode}" ;;
  *) printf '0:0:%s\n' "$mode" ;;
esac
EOF
  cat > "$FAKE_ROOT/usr/bin/mktemp" <<'EOF'
#!/bin/sh
[ "${MOCK_MARKER_PUBLICATION_FAIL:-}" = mktemp ] && exit 1
exec /usr/bin/mktemp "$@"
EOF
  cat > "$FAKE_ROOT/usr/bin/chmod" <<'EOF'
#!/bin/sh
[ "${MOCK_MARKER_PUBLICATION_FAIL:-}" = chmod ] && exit 1
exec /bin/chmod "$@"
EOF
  cat > "$FAKE_ROOT/usr/bin/mv" <<'EOF'
#!/bin/sh
[ "${MOCK_MARKER_PUBLICATION_FAIL:-}" = mv ] && exit 1
exec /bin/mv "$@"
EOF
  cat > "$FAKE_ROOT/usr/bin/rm" <<'EOF'
#!/bin/sh
exec /bin/rm "$@"
EOF
  cat > "$FAKE_ROOT/usr/bin/logger" <<EOF
#!/bin/sh
printf 'argv:' >> '$LOGGER_LOG'
printf ' <%s>' "\$@" >> '$LOGGER_LOG'
printf '\\n' >> '$LOGGER_LOG'
EOF
  cat > "$FAKE_ROOT/usr/bin/systemctl" <<EOF
#!/bin/sh
if [ "\${1-}" = show ]; then
  property="\${2-}"
  case "\$property" in
    --property=ActiveState) cat '$SERVICE_STATE_FILE' ;;
    --property=LoadState) printf 'loaded\\n' ;;
    --property=FragmentPath)
      case "\${4-}" in
        pawtech-buildingos-object-backup.timer) printf '%s\\n' '$OBJECT_TIMER_UNIT' ;;
        pawtech-buildingos-object-backup.service) printf '%s\\n' '$OBJECT_SERVICE_UNIT' ;;
        *) exit 1 ;;
      esac
      ;;
    --property=DropInPaths) : ;;
    --property=Unit) printf 'pawtech-buildingos-object-backup.service\\n' ;;
    --property=User|--property=Group) printf 'yoryi\\n' ;;
    --property=Type) printf 'oneshot\\n' ;;
    --property=EnvironmentFiles) printf '%s\\n' '$FAKE_ROOT/etc/buildingos/object-backup.env' ;;
    --property=WorkingDirectory) printf '%s\\n' '$FAKE_ROOT/var/lib/buildingos-object-backup' ;;
    --property=ExecStart) printf '{ path=%s ; argv[]=%s ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=0 ; status=0 }\\n' '$FAKE_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh' '$FAKE_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh' ;;
    --property=TimeoutStartUSec) printf '21600000000\\n' ;;
    --property=ExecCondition|--property=ExecStartPre|--property=ExecStartPost) : ;;
    --property=TimersCalendar) printf '%s\\n' "\${MOCK_TIMERS_CALENDAR:-*-*-* 02:15:00}" ;;
    --property=RandomizedDelayUSec) printf '900000000\\n' ;;
    --property=Persistent) printf 'yes\\n' ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [ -r '$TEST_ROOT/systemctl-fail-operation' ]; then
      IFS= read -r failed_operation < '$TEST_ROOT/systemctl-fail-operation'
      [ "\$failed_operation" = "\${1-}" ] && exit 1
    fi
    printf 'argv:' >> '$SYSTEMCTL_LOG'
  [ "\${MOCK_SYSTEMCTL_FAIL_OPERATION:-}" = "\${1-}" ] && exit 1
printf ' <%s>' "\$@" >> '$SYSTEMCTL_LOG'
printf '\\n' >> '$SYSTEMCTL_LOG'
EOF
  chmod 0755 "$FAKE_ROOT/usr/bin"/*
}

make_fixture() {
  rm -rf "$FAKE_ROOT"
  mkdir -p \
    "$FAKE_ROOT/usr/local/sbin" \
    "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/lib" \
    "$FAKE_ROOT/usr/local/libexec/buildingos-backup" \
    "$FAKE_ROOT/etc/buildingos" \
    "$FAKE_ROOT/etc/sudoers.d" \
    "$FAKE_ROOT/etc/systemd/system" \
    "$FAKE_ROOT/var/lib/buildingos-object-backup" \
    "$ACTIVATION_STATE_DIR"
  make_tools
  : > "$SYSTEMCTL_LOG"
  : > "$LOGGER_LOG"
  rm -f "$TEST_ROOT/systemctl-fail-operation"
  printf 'inactive\n' > "$SERVICE_STATE_FILE"
  chmod 0755 "$FAKE_ROOT/usr/local" "$FAKE_ROOT/usr/local/sbin" "$FAKE_ROOT/usr/local/libexec" \
    "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight" "$FAKE_ROOT/usr/local/libexec/buildingos-backup" \
    "$FAKE_ROOT/etc" "$FAKE_ROOT/etc/buildingos" "$FAKE_ROOT/etc/sudoers.d" \
    "$FAKE_ROOT/etc/systemd" "$FAKE_ROOT/etc/systemd/system" "$FAKE_ROOT/var" "$FAKE_ROOT/var/lib" "$ACTIVATION_STATE_DIR"
  chmod 0700 "$FAKE_ROOT/var/lib/buildingos-object-backup"

  sed \
    -e "s|/usr/local|$FAKE_ROOT/usr/local|g" \
    -e "s|/usr/bin|$FAKE_ROOT/usr/bin|g" \
    -e "s|/etc|$FAKE_ROOT/etc|g" \
    -e "s|/var|$FAKE_ROOT/var|g" \
    "$ROOT_DIR/infra/production/launchers/buildingos-privctl" > "$FAKE_LAUNCHER"
  chmod 0755 "$FAKE_LAUNCHER"

  printf 'protected\n' > "$FAKE_ROOT/usr/local/sbin/buildingos-production-backup-preflight"
  printf 'protected\n' > "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh"
  printf 'protected\n' > "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh"
  printf 'protected\n' > "$FAKE_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh"
  printf 'protected\n' > "$FAKE_ROOT/etc/sudoers.d/buildingos-production-backup-preflight"
  printf 'protected\n' > "$FAKE_ROOT/etc/sudoers.d/buildingos-privctl"
  printf 'protected\n' > "$OBJECT_SERVICE_UNIT"
  printf 'protected\n' > "$OBJECT_TIMER_UNIT"
  printf 'OBJECT_BACKUP_SOURCE=prod:buildingos-production\nOBJECT_BACKUP_DESTINATION=backup:buildingos-production-backup\n' > "$FAKE_ROOT/etc/buildingos/object-backup.env"
  chmod 0755 "$FAKE_ROOT/usr/local/sbin/buildingos-production-backup-preflight" "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh" "$FAKE_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh"
  chmod 0644 "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh" "$OBJECT_SERVICE_UNIT" "$OBJECT_TIMER_UNIT" "$FAKE_ROOT/etc/buildingos/object-backup.env"
  chmod 0440 "$FAKE_ROOT/etc/sudoers.d/buildingos-production-backup-preflight" "$FAKE_ROOT/etc/sudoers.d/buildingos-privctl"

  launcher_hash="$(hash_file "$FAKE_ROOT/usr/local/sbin/buildingos-production-backup-preflight")"
  control_hash="$(hash_file "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh")"
  helper_hash="$(hash_file "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh")"
  object_exec_hash="$(hash_file "$FAKE_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh")"
  sudoers_hash="$(hash_file "$FAKE_ROOT/etc/sudoers.d/buildingos-production-backup-preflight")"
  service_hash="$(hash_file "$OBJECT_SERVICE_UNIT")"
  timer_hash="$(hash_file "$OBJECT_TIMER_UNIT")"
  privctl_launcher_hash="$(hash_file "$FAKE_LAUNCHER")"
  privctl_sudoers_hash="$(hash_file "$FAKE_ROOT/etc/sudoers.d/buildingos-privctl")"
  payload() {
    printf 'manifest_version=1\n'
    printf 'tooling_source_sha=%s\n' '1111111111111111111111111111111111111111'
    printf 'launcher_path=%s\nlauncher_sha256=%s\n' "$FAKE_ROOT/usr/local/sbin/buildingos-production-backup-preflight" "$launcher_hash"
    printf 'control_path=%s\ncontrol_sha256=%s\n' "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh" "$control_hash"
    printf 'helper_path=%s\nhelper_sha256=%s\n' "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh" "$helper_hash"
    printf 'object_exec_path=%s\nobject_exec_sha256=%s\n' "$FAKE_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh" "$object_exec_hash"
    printf 'sudoers_path=%s\nsudoers_sha256=%s\n' "$FAKE_ROOT/etc/sudoers.d/buildingos-production-backup-preflight" "$sudoers_hash"
    printf 'object_service_path=%s\nobject_service_sha256=%s\n' "$OBJECT_SERVICE_UNIT" "$service_hash"
    printf 'object_timer_path=%s\nobject_timer_sha256=%s\n' "$OBJECT_TIMER_UNIT" "$timer_hash"
    printf 'privctl_launcher_path=%s\nprivctl_launcher_sha256=%s\n' "$FAKE_LAUNCHER" "$privctl_launcher_hash"
    printf 'privctl_sudoers_path=%s\nprivctl_sudoers_sha256=%s\n' "$FAKE_ROOT/etc/sudoers.d/buildingos-privctl" "$privctl_sudoers_hash"
  }
  release_hash="$(payload | hash_stdin)"
  {
    payload
    printf 'release_sha256=%s\n' "$release_hash"
  } > "$MANIFEST"
  chmod 0644 "$MANIFEST"
}

write_receipt() {
  local source="$1" destination="$2"
  printf '{"receipt_version":1,"source":"%s","destination":"%s","copy_status":"PASS","verification_status":"PASS","status":"PASS"}\n' "$source" "$destination" > "$RECEIPT"
  chmod 0600 "$RECEIPT"
}

write_activation_marker() {
  printf 'buildingos-object-backup-activation-v1\n' > "$ACTIVATION_MARKER"
  chmod 0444 "$ACTIVATION_MARKER"
}

set_service_state() {
  printf '%s\n' "$1" > "$SERVICE_STATE_FILE"
}

make_fixture
set_service_state failed
assert_success 'failed service allows manual object-backup-start' "$FAKE_LAUNCHER" object-backup-start
assert_contains 'failed service manual retry starts only the fixed service' "argv: <start> <pawtech-buildingos-object-backup.service>" "$SYSTEMCTL_LOG"

make_fixture
set_service_state active
assert_failure 'active service rejects manual object-backup-start' "$FAKE_LAUNCHER" object-backup-start
assert_empty 'active service rejection emits no systemctl mutation' "$SYSTEMCTL_LOG"

make_fixture
set_service_state failed
assert_success 'failed service allows timer stop containment' "$FAKE_LAUNCHER" object-backup-timer-stop
assert_contains 'failed service timer stop uses the fixed timer' "argv: <stop> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
set_service_state failed
assert_success 'failed service allows timer disable containment' "$FAKE_LAUNCHER" object-backup-timer-disable
assert_contains 'failed service timer disable uses the fixed timer' "argv: <disable> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
set_service_state failed
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
assert_failure 'failed service rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'failed service timer enable rejection emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
set_service_state failed
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
assert_failure 'failed service rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'failed service timer start rejection emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
assert_failure 'missing receipt rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'missing receipt timer enable emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
mv "$FAKE_ROOT/var/lib/buildingos-object-backup" "$FAKE_ROOT/var/lib/buildingos-object-backup.real"
ln -s "$FAKE_ROOT/var/lib/buildingos-object-backup.real" "$FAKE_ROOT/var/lib/buildingos-object-backup"
assert_failure 'symlink receipt parent rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'symlink receipt parent rejection emits no systemctl mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'unexpected:buildingos-production' 'backup:buildingos-production-backup'
assert_failure 'unexpected source remote rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'unexpected source timer enable emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
assert_success 'first timer activation creates the durable marker after enable succeeds' "$FAKE_LAUNCHER" object-backup-timer-enable
[[ -f "$ACTIVATION_MARKER" ]] && pass 'first timer activation publishes a marker file' || fail_test 'first timer activation publishes a marker file'
printf 'buildingos-object-backup-activation-v1\n' | cmp -s - "$ACTIVATION_MARKER" && pass 'first timer activation marker content is deterministic' || fail_test 'first timer activation marker content is deterministic'
assert_contains 'valid receipt timer enable uses the fixed timer' "argv: <enable> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
write_activation_marker
assert_success 'active marker and receipt allow timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_contains 'active marker timer start uses the fixed timer' "argv: <start> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_activation_marker
assert_success 'timer stop preserves an existing activation marker' "$FAKE_LAUNCHER" object-backup-timer-stop
[[ -f "$ACTIVATION_MARKER" ]] && pass 'timer stop did not remove the activation marker' || fail_test 'timer stop did not remove the activation marker'
assert_success 'timer disable preserves an existing activation marker' "$FAKE_LAUNCHER" object-backup-timer-disable
[[ -f "$ACTIVATION_MARKER" ]] && pass 'timer disable did not remove the activation marker' || fail_test 'timer disable did not remove the activation marker'

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
printf 'enable\n' > "$TEST_ROOT/systemctl-fail-operation"
assert_failure 'failed timer activation leaves no activation marker' "$FAKE_LAUNCHER" object-backup-timer-enable
[[ ! -e "$ACTIVATION_MARKER" ]] && pass 'failed timer activation did not publish a marker' || fail_test 'failed timer activation did not publish a marker'

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
printf 'start\n' > "$TEST_ROOT/systemctl-fail-operation"
assert_failure 'failed timer start leaves no activation marker' "$FAKE_LAUNCHER" object-backup-timer-start
[[ ! -e "$ACTIVATION_MARKER" ]] && pass 'failed timer start did not publish a marker' || fail_test 'failed timer start did not publish a marker'

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_MARKER_PUBLICATION_FAIL=mktemp assert_failure 'marker publication failure fails closed after activation' "$FAKE_LAUNCHER" object-backup-timer-enable
[[ ! -e "$ACTIVATION_MARKER" ]] && pass 'marker publication failure leaves no marker' || fail_test 'marker publication failure leaves no marker'
assert_contains 'marker publication failure stops the timer' "<stop> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"
assert_contains 'marker publication failure disables the timer' "<disable> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
printf 'malformed\n' > "$ACTIVATION_MARKER"
chmod 0444 "$ACTIVATION_MARKER"
assert_failure 'malformed activation marker rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'malformed activation marker emits no systemctl mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
write_activation_marker
mv "$ACTIVATION_MARKER" "$ACTIVATION_MARKER.real"
ln -s "$ACTIVATION_MARKER.real" "$ACTIVATION_MARKER"
assert_failure 'symlink activation marker rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'symlink activation marker emits no systemctl mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
write_activation_marker
MOCK_MARKER_MODE=644 assert_failure 'unsafe activation marker metadata rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'unsafe activation marker metadata emits no systemctl mutation' "$SYSTEMCTL_LOG"

make_fixture
assert_failure 'missing receipt rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'missing receipt timer start emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'unexpected:buildingos-production' 'backup:buildingos-production-backup'
assert_failure 'unexpected source remote rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'unexpected source timer start emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'unexpected:buildingos-production-backup'
assert_failure 'unexpected destination remote rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'unexpected destination timer start emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
assert_success 'plain TimersCalendar allows valid receipt timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_contains 'plain TimersCalendar timer start uses the fixed timer' "argv: <start> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=(null) }' assert_success 'serialized TimersCalendar allows valid receipt timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_contains 'serialized TimersCalendar timer start uses the fixed timer' "argv: <start> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR="$ACTIVE_TIMER_CALENDAR" assert_success 'active serialized TimersCalendar allows timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_contains 'active serialized TimersCalendar timer enable uses the fixed timer' "argv: <enable> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
write_activation_marker
MOCK_TIMERS_CALENDAR="$ACTIVE_TIMER_CALENDAR" assert_success 'active serialized TimersCalendar allows timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_contains 'active serialized TimersCalendar timer start uses the fixed timer' "argv: <start> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_activation_marker
MOCK_TIMERS_CALENDAR="$ACTIVE_TIMER_CALENDAR" assert_success 'active serialized TimersCalendar allows timer stop' "$FAKE_LAUNCHER" object-backup-timer-stop
assert_contains 'active serialized TimersCalendar timer stop uses the fixed timer' "argv: <stop> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_activation_marker
MOCK_TIMERS_CALENDAR="$ACTIVE_TIMER_CALENDAR" assert_success 'active serialized TimersCalendar allows timer disable' "$FAKE_LAUNCHER" object-backup-timer-disable
assert_contains 'active serialized TimersCalendar timer disable uses the fixed timer' "argv: <disable> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=Mon 2025-06-25 02:15:00 UTC }' assert_failure 'serialized next_elapse with mismatched weekday rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'mismatched serialized next_elapse weekday emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=Wed 2025-06-25 02:15:00 ChST }' assert_success 'mixed-case serialized next_elapse timezone allows timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_contains 'mixed-case serialized next_elapse timezone uses the fixed timer' "argv: <start> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=Wed 2025-06-25 02:15:00 UTC extra }' assert_failure 'multi-field serialized next_elapse timezone rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'multi-field serialized next_elapse timezone emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='prefix *-*-* 02:15:00 suffix' assert_failure 'plain TimersCalendar substring rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'plain TimersCalendar substring emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 03:15:00 ; next_elapse=(null) }' assert_failure 'wrong serialized TimersCalendar rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'wrong serialized TimersCalendar emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=(null)' assert_failure 'malformed serialized TimersCalendar rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'malformed serialized TimersCalendar emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ next_elapse=(null) }' assert_failure 'serialized TimersCalendar without OnCalendar rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'serialized TimersCalendar without OnCalendar emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; OnCalendar=*-*-* 03:15:00 ; next_elapse=(null) }' assert_failure 'multiple conflicting serialized OnCalendar values reject timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'multiple serialized OnCalendar values emit no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=(null) } trailing' assert_failure 'serialized TimersCalendar with extra text rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'serialized TimersCalendar with extra text emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=not-a-systemd-timestamp }' assert_failure 'arbitrary serialized next_elapse rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'arbitrary serialized next_elapse emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=Wed 2025-06-25 24:15:00 UTC }' assert_failure 'out-of-range serialized next_elapse time rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'out-of-range serialized next_elapse time emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=Wed 2025-02-29 02:15:00 UTC }' assert_failure 'invalid serialized next_elapse date rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'invalid serialized next_elapse date emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 }' assert_failure 'serialized TimersCalendar without next_elapse rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'serialized TimersCalendar without next_elapse emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse= }' assert_failure 'serialized TimersCalendar with empty next_elapse rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'serialized TimersCalendar with empty next_elapse emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=(null) ; next_elapse=Wed 2025-06-25 02:15:00 UTC }' assert_failure 'duplicate serialized next_elapse rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'duplicate serialized next_elapse emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; OnCalendar=*-*-* 02:15:00 ; next_elapse=(null) }' assert_failure 'duplicate serialized OnCalendar rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'duplicate serialized OnCalendar emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_TIMERS_CALENDAR='{ OnCalendar=*-*-* 02:15:00 ; next_elapse=(null) ; unexpected=value }' assert_failure 'unexpected serialized TimersCalendar field rejects timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'unexpected serialized TimersCalendar field emits no mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
chmod 0750 "$FAKE_ROOT/etc/sudoers.d"
assert_success 'root-owned 0750 sudoers parent allows timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_contains '0750 sudoers parent reaches the fixed timer enable operation' "argv: <enable> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
chmod 0755 "$FAKE_ROOT/etc/sudoers.d"
assert_success 'root-owned 0755 sudoers parent allows timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_contains '0755 sudoers parent reaches the fixed timer start operation' "argv: <start> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

for unsafe_mode in 0775 0777; do
  make_fixture
  write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
  chmod "$unsafe_mode" "$FAKE_ROOT/etc/sudoers.d"
  assert_failure "unsafe sudoers parent mode $unsafe_mode rejects timer enable" "$FAKE_LAUNCHER" object-backup-timer-enable
  assert_empty "unsafe sudoers parent mode $unsafe_mode emits no systemctl mutation" "$SYSTEMCTL_LOG"
done

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_SUDOERS_DIR_UID=1001 assert_failure 'wrong sudoers parent owner rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'wrong sudoers parent owner emits no systemctl mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
MOCK_SUDOERS_DIR_GID=1001 assert_failure 'wrong sudoers parent group rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'wrong sudoers parent group emits no systemctl mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
mv "$FAKE_ROOT/etc/sudoers.d" "$FAKE_ROOT/etc/sudoers.d.real"
ln -s "$FAKE_ROOT/etc/sudoers.d.real" "$FAKE_ROOT/etc/sudoers.d"
assert_failure 'symlink sudoers parent rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'symlink sudoers parent emits no systemctl mutation' "$SYSTEMCTL_LOG"

make_fixture
write_receipt 'prod:buildingos-production' 'backup:buildingos-production-backup'
chmod 0750 "$FAKE_ROOT/usr/local/libexec/buildingos-backup"
assert_failure 'release payload directory below 0755 rejects timer enable' "$FAKE_LAUNCHER" object-backup-timer-enable
assert_empty 'non-0755 release payload directory emits no systemctl mutation' "$SYSTEMCTL_LOG"

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s failed, %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
