#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly INSTALLER="$ROOT_DIR/scripts/install-production-backup-controls.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-backup-controls.XXXXXX")"
readonly SOURCE_ROOT="$TEST_ROOT/source"
readonly DEST_ROOT="$TEST_ROOT/dest"
trap 'rm -rf "$TEST_ROOT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok %s - %s\n' "$FAIL_COUNT" "$1" >&2; }
assert_success() { local name="$1"; shift; if "$@" >"$TEST_ROOT/output" 2>&1; then pass "$name"; else fail_test "$name"; command cat "$TEST_ROOT/output" >&2; fi; }
assert_failure() { local name="$1"; shift; if "$@" >"$TEST_ROOT/output" 2>&1; then fail_test "$name (unexpected success)"; else pass "$name"; fi; }
assert_equal() { local name="$1" actual="$2" expected="$3"; [[ "$actual" == "$expected" ]] && pass "$name" || fail_test "$name"; }
assert_contains() { local name="$1" value="$2" file="$3"; grep -Fq -- "$value" "$file" && pass "$name" || fail_test "$name"; }

make_source() {
  mkdir -p "$SOURCE_ROOT/infra/production/launchers" "$SOURCE_ROOT/infra/production/sudoers" "$SOURCE_ROOT/infra/production/systemd" "$SOURCE_ROOT/scripts/lib"
  cp "$ROOT_DIR/infra/production/launchers/buildingos-production-backup-preflight" "$SOURCE_ROOT/infra/production/launchers/"
  cp "$ROOT_DIR/infra/production/sudoers/buildingos-production-backup-preflight" "$SOURCE_ROOT/infra/production/sudoers/"
  cp "$ROOT_DIR/infra/production/systemd/pawtech-buildingos-object-backup.service" "$SOURCE_ROOT/infra/production/systemd/"
  cp "$ROOT_DIR/infra/production/systemd/pawtech-buildingos-object-backup.timer" "$SOURCE_ROOT/infra/production/systemd/"
  cp "$ROOT_DIR/scripts/lib/endpoint-identity.sh" "$SOURCE_ROOT/scripts/lib/"
      cp "$ROOT_DIR/scripts/backup-object-storage.sh" "$SOURCE_ROOT/scripts/"
  cat > "$SOURCE_ROOT/scripts/production-backup-preflight.sh" <<'CONTROL'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == 1111111111111111111111111111111111111111 ]] || exit 1
printf 'CONTROL_INVOKED=%s\n' "$1"
CONTROL
  chmod 0755 "$SOURCE_ROOT/scripts/production-backup-preflight.sh"
  git -C "$SOURCE_ROOT" init -q
  git -C "$SOURCE_ROOT" config user.email local@example.invalid
  git -C "$SOURCE_ROOT" config user.name 'Local Test'
  git -C "$SOURCE_ROOT" add .
  git -c core.hooksPath=/dev/null -C "$SOURCE_ROOT" commit -qm 'initial controls'
}

source_sha() {
  git -c safe.directory="$SOURCE_ROOT" -C "$SOURCE_ROOT" rev-parse HEAD
}

run_install() {
  "$INSTALLER" --source-root "$SOURCE_ROOT" --dest-root "$DEST_ROOT" --tooling-source-sha "$1" --test-mode local-unprivileged --apply "${@:2}"
}

run_check() {
  "$INSTALLER" --source-root "$SOURCE_ROOT" --dest-root "$DEST_ROOT" --tooling-source-sha "$1" --test-mode local-unprivileged --check
}

hashes() {
  for path in \
    "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest" \
        "$DEST_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh" \
    "$DEST_ROOT/etc/sudoers.d/buildingos-production-backup-preflight" \
    "$DEST_ROOT/etc/systemd/system/pawtech-buildingos-object-backup.service" \
    "$DEST_ROOT/etc/systemd/system/pawtech-buildingos-object-backup.timer"; do
    shasum -a 256 "$path" | awk '{print $1}'
  done
}

make_source
CANDIDATE_ONE="$(source_sha)"
printf 'untracked\n' > "$SOURCE_ROOT/untracked-source-artifact"
assert_failure 'dirty source checkout is rejected before installation' run_check "$CANDIDATE_ONE"
rm "$SOURCE_ROOT/untracked-source-artifact"
mv "$SOURCE_ROOT/scripts" "$SOURCE_ROOT/scripts.real"
ln -s scripts.real "$SOURCE_ROOT/scripts"
assert_failure 'source path symlink component is rejected before installation' run_check "$CANDIDATE_ONE"
rm "$SOURCE_ROOT/scripts"
mv "$SOURCE_ROOT/scripts.real" "$SOURCE_ROOT/scripts"
assert_failure 'isolated test mode cannot target the production root' \
  "$INSTALLER" --source-root "$SOURCE_ROOT" --dest-root / --tooling-source-sha "$CANDIDATE_ONE" --test-mode local-unprivileged --apply
CHECK_DEST="$TEST_ROOT/check-dest"
assert_success 'read-only check accepts a valid source release without creating destination' \
  "$INSTALLER" --source-root "$SOURCE_ROOT" --dest-root "$CHECK_DEST" --tooling-source-sha "$CANDIDATE_ONE" --test-mode local-unprivileged --check
[[ ! -e "$CHECK_DEST" ]] && pass 'read-only check does not create destination paths' || fail_test 'read-only check does not create destination paths'

assert_success 'initial isolated install publishes a coherent release' run_install "$CANDIDATE_ONE"
assert_contains 'installed manifest records tooling identity' "tooling_source_sha=$CANDIDATE_ONE" "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
CROSS_DEVICE_HASHES="$(hashes)"
assert_failure 'cross-filesystem fixture fails before publication' run_install "$CANDIDATE_ONE" --test-force-cross-device
assert_equal 'cross-filesystem failure leaves release unchanged' "$(hashes)" "$CROSS_DEVICE_HASHES"
assert_success 'older runtime identity reaches controls built from newer tooling' \
  env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
  "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" 1111111111111111111111111111111111111111
assert_failure 'malformed runtime identity is rejected by the protected launcher' \
      env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
      "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" not-a-runtime-sha
    MANIFEST="$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
printf '\n' >> "$MANIFEST"
assert_failure 'non-canonical manifest trailing bytes are rejected' \
  env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
  "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" "$CANDIDATE_ONE"
assert_success 'reinstall repairs non-canonical manifest bytes' run_install "$CANDIDATE_ONE"
assert_failure 'wrong runtime identity is rejected by the protected control' \
  env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
  "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

CONTROL="$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh"
HELPER="$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh"
printf '\n# modified\n' >> "$CONTROL"
assert_failure 'modified installed control is rejected before execution' \
  env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
  "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" "$CANDIDATE_ONE"
assert_success 'reinstall repairs modified control' run_install "$CANDIDATE_ONE"
OBJECT_EXEC="$DEST_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh"
printf '\n# modified object executable\n' >> "$OBJECT_EXEC"
assert_failure 'modified protected Object Storage executable is rejected before execution' \
  env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
  "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" 1111111111111111111111111111111111111111
assert_success 'reinstall repairs modified Object Storage executable' run_install "$CANDIDATE_ONE"
mv "$OBJECT_EXEC" "$OBJECT_EXEC.saved"
assert_failure 'missing protected Object Storage executable is rejected before execution' \
  env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
  "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" 1111111111111111111111111111111111111111
mv "$OBJECT_EXEC.saved" "$OBJECT_EXEC"
mv "$HELPER" "$HELPER.saved"
assert_failure 'missing installed helper is rejected before execution' \
  env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
  "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" "$CANDIDATE_ONE"
mv "$HELPER.saved" "$HELPER"
mv "$CONTROL" "$CONTROL.real"
ln -s "$CONTROL.real" "$CONTROL"
assert_failure 'symlinked protected control is rejected before execution' \
  env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
  "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" "$CANDIDATE_ONE"
assert_failure 'installer rejects a symlink protected destination before publishing' run_install "$CANDIDATE_ONE"
assert_failure 'read-only installer check rejects a symlink protected destination' run_check "$CANDIDATE_ONE"
rm "$CONTROL"
mv "$CONTROL.real" "$CONTROL"
chmod 0777 "$CONTROL"
assert_failure 'unsafe existing control mode blocks an upgrade' run_install "$CANDIDATE_ONE"
chmod 0755 "$CONTROL"

OLD_HASHES="$(hashes)"
printf '\n# release two\n' >> "$SOURCE_ROOT/scripts/production-backup-preflight.sh"
git -C "$SOURCE_ROOT" add scripts/production-backup-preflight.sh
git -c core.hooksPath=/dev/null -C "$SOURCE_ROOT" commit -qm 'release two'
CANDIDATE_TWO="$(source_sha)"
assert_failure 'post-publish failure restores the previous coherent release' run_install "$CANDIDATE_TWO" --test-fail-after-publish
assert_equal 'partial publish leaves every protected artifact unchanged' "$(hashes)" "$OLD_HASHES"
assert_success 'upgrade publishes the next coherent release' run_install "$CANDIDATE_TWO"
SNAPSHOT="$(awk -F= '/^ROLLBACK_SNAPSHOT=/{print $2}' "$TEST_ROOT/output")"
[[ -n "$SNAPSHOT" && -d "$SNAPSHOT" ]] && pass 'upgrade emits a rollback snapshot path' || fail_test 'upgrade emits a rollback snapshot path'
CORRUPT_SNAPSHOT="${SNAPSHOT}.corrupt"
cp -a "$SNAPSHOT" "$CORRUPT_SNAPSHOT"
printf 'corrupt\n' >> "$CORRUPT_SNAPSHOT/launcher"
assert_failure 'corrupt rollback snapshot is rejected before restore' \
  "$INSTALLER" --dest-root "$DEST_ROOT" --test-mode local-unprivileged --apply --rollback "$CORRUPT_SNAPSHOT"
assert_failure 'rollback snapshot outside canonical directory is rejected' \
  "$INSTALLER" --dest-root "$DEST_ROOT" --test-mode local-unprivileged --apply --rollback "$TEST_ROOT/external-snapshot"
assert_success 'explicit rollback restores exact previous bytes' \
  "$INSTALLER" --dest-root "$DEST_ROOT" --test-mode local-unprivileged --apply --rollback "$SNAPSHOT"
assert_equal 'rollback restores every protected artifact exactly' "$(hashes)" "$OLD_HASHES"

SERVICE="$ROOT_DIR/infra/production/systemd/pawtech-buildingos-object-backup.service"
TIMER="$ROOT_DIR/infra/production/systemd/pawtech-buildingos-object-backup.timer"
assert_contains 'Object Storage service uses the protected backup command' 'ExecStart=/usr/local/libexec/buildingos-backup/backup-object-storage.sh' "$SERVICE"
assert_contains 'Object Storage service keeps its independent environment' 'EnvironmentFile=/etc/buildingos/object-backup.env' "$SERVICE"
assert_contains 'Object Storage service keeps independent state storage' 'WorkingDirectory=/var/lib/buildingos-object-backup' "$SERVICE"
assert_contains 'Object Storage timer keeps the canonical daily schedule' 'OnCalendar=*-*-* 02:15:00' "$TIMER"
assert_contains 'Object Storage timer remains bound to its independent service' 'Unit=pawtech-buildingos-object-backup.service' "$TIMER"
assert_contains 'preflight preserves the PostgreSQL timer check' 'inspect_timer POSTGRES_BACKUP_TIMER' "$ROOT_DIR/scripts/production-backup-preflight.sh"

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s failed, %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
