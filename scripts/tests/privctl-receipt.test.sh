#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d "/tmp/buildingos-privctl-receipt.XXXXXX")"
FAKE_ROOT="$TEST_ROOT/root"
SYSTEMCTL_LOG="$TEST_ROOT/systemctl.log"
LOGGER_LOG="$TEST_ROOT/logger.log"
FAKE_LAUNCHER="$FAKE_ROOT/usr/local/sbin/buildingos-privctl"
MANIFEST="$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
RECEIPT="$FAKE_ROOT/var/lib/buildingos-object-backup/object-backup-receipt.json"
OBJECT_SERVICE_UNIT="$FAKE_ROOT/etc/systemd/system/pawtech-buildingos-object-backup.service"
OBJECT_TIMER_UNIT="$FAKE_ROOT/etc/systemd/system/pawtech-buildingos-object-backup.timer"
OBJECT_TIMER='pawtech-buildingos-object-backup.timer'
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
  *) printf '0:0:%s\n' "$mode" ;;
esac
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
    --property=ActiveState) printf 'inactive\\n' ;;
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
    --property=TimersCalendar) printf '*-*-* 02:15:00\\n' ;;
    --property=RandomizedDelayUSec) printf '900000000\\n' ;;
    --property=Persistent) printf 'yes\\n' ;;
    *) exit 1 ;;
  esac
  exit 0
fi
printf 'argv:' >> '$SYSTEMCTL_LOG'
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
    "$FAKE_ROOT/var/lib/buildingos-object-backup"
  make_tools
  : > "$SYSTEMCTL_LOG"
  : > "$LOGGER_LOG"
  chmod 0755 "$FAKE_ROOT/usr/local" "$FAKE_ROOT/usr/local/sbin" "$FAKE_ROOT/usr/local/libexec" \
    "$FAKE_ROOT/usr/local/libexec/buildingos-backup-preflight" "$FAKE_ROOT/usr/local/libexec/buildingos-backup" \
    "$FAKE_ROOT/etc" "$FAKE_ROOT/etc/buildingos" "$FAKE_ROOT/etc/sudoers.d" \
    "$FAKE_ROOT/etc/systemd" "$FAKE_ROOT/etc/systemd/system" "$FAKE_ROOT/var" "$FAKE_ROOT/var/lib"
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
  printf 'OBJECT_BACKUP_SOURCE=prod:buildingos-production\nOBJECT_BACKUP_DESTINATION=backup-remote:buildingos-production-backup\n' > "$FAKE_ROOT/etc/buildingos/object-backup.env"
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

make_fixture
write_receipt 'prod:buildingos-production' 'backup-remote:buildingos-production-backup'
assert_success 'production receipt remotes are accepted for timer start' "$FAKE_LAUNCHER" object-backup-timer-start
assert_contains 'accepted receipt starts only the fixed object timer' "argv: <start> <$OBJECT_TIMER>" "$SYSTEMCTL_LOG"

: > "$SYSTEMCTL_LOG"
write_receipt 'unexpected:buildingos-production' 'backup-remote:buildingos-production-backup'
assert_failure 'unexpected source remote is rejected' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'rejected source receipt does not start the timer' "$SYSTEMCTL_LOG"

write_receipt 'prod:buildingos-production' 'unexpected:buildingos-production-backup'
assert_failure 'unexpected destination remote is rejected' "$FAKE_LAUNCHER" object-backup-timer-start
assert_empty 'rejected destination receipt does not start the timer' "$SYSTEMCTL_LOG"

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s failed, %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
