#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly INSTALLER="$ROOT_DIR/scripts/install-production-backup-controls.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-backup-controls.XXXXXX")"
readonly SOURCE_ROOT="$TEST_ROOT/source"
readonly DEST_ROOT="$TEST_ROOT/dest"
readonly LEGACY_BASE_SHA='26f9f4c44d20aded9639fe473c56850122fc06f6'
readonly LEGACY_CONTROL_COMMIT='a92b615c6978a0b3f4dff76944f44f01b1fdd130'
readonly LEGACY_SUDOERS_SHA='35dbfb9d07a6a0b8a2797bd86f27ea94b0ae991f35653a544da8895be510475c'
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

protected_tree_state() {
  local path metadata
  for path in \
    "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup" \
    "$DEST_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh" \
    "$DEST_ROOT/etc/sudoers.d/buildingos-production-backup-preflight" \
    "$DEST_ROOT/etc/systemd/system/pawtech-buildingos-object-backup.service" \
    "$DEST_ROOT/etc/systemd/system/pawtech-buildingos-object-backup.timer"; do
    if [[ -f "$path" && ! -L "$path" ]]; then
      metadata="$(stat -c '%u:%g:%a' -- "$path" 2>/dev/null || stat -f '%u:%g:%Lp' -- "$path")"
      printf 'file:%s:%s:%s\n' "$path" "$metadata" "$(shasum -a 256 "$path" | awk '{print $1}')"
    elif [[ -d "$path" && ! -L "$path" ]]; then
      metadata="$(stat -c '%u:%g:%a' -- "$path" 2>/dev/null || stat -f '%u:%g:%Lp' -- "$path")"
      printf 'directory:%s:%s\n' "$path" "$metadata"
    elif [[ -L "$path" ]]; then
      printf 'symlink:%s\n' "$path"
    else
      printf 'absent:%s\n' "$path"
    fi
  done
}

run_launcher() {
  local tooling_sha="$1" runtime_sha="$2"
  env BUILDINGOS_BACKUP_PREFLIGHT_TEST_MODE=LOCAL_ISOLATED_ONLY BUILDINGOS_PREFLIGHT_LAUNCHER_TEST_ROOT="$DEST_ROOT" \
    "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" "$tooling_sha" "$runtime_sha"
}

make_legacy_release() {
  mkdir -p "$DEST_ROOT/usr/local/sbin" "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib"
  git -C "$ROOT_DIR" show "$LEGACY_BASE_SHA:infra/production/launchers/buildingos-production-backup-preflight" > "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight"
  git -C "$ROOT_DIR" show "$LEGACY_CONTROL_COMMIT:scripts/production-backup-preflight.sh" > "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh"
  cp "$SOURCE_ROOT/scripts/lib/endpoint-identity.sh" "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh"
  chmod 0755 "$DEST_ROOT/usr/local/sbin/buildingos-production-backup-preflight" "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh"
  chmod 0644 "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh"
  chmod 0755 "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight" "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib"
}

make_legacy_release_with_sudoers() {
  local sudoers="$DEST_ROOT/etc/sudoers.d/buildingos-production-backup-preflight"
  make_legacy_release
  mkdir -p "$DEST_ROOT/etc/sudoers.d"
  git -C "$ROOT_DIR" show "$LEGACY_BASE_SHA:infra/production/sudoers/buildingos-production-backup-preflight" > "$sudoers"
  chmod 0440 "$sudoers"
  [[ "$(shasum -a 256 "$sudoers" | awk '{print $1}')" == "$LEGACY_SUDOERS_SHA" ]] || {
    printf 'legacy sudoers fixture hash mismatch\n' >&2
    exit 1
  }
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

make_legacy_release_with_sudoers
REAL_LEGACY_STATE="$(protected_tree_state)"
assert_success 'real legacy plus sudoers release passes read-only validation' run_check "$CANDIDATE_ONE"
assert_equal 'real legacy sudoers fixture keeps the audited hash' "$(shasum -a 256 "$DEST_ROOT/etc/sudoers.d/buildingos-production-backup-preflight" | awk '{print $1}')" "$LEGACY_SUDOERS_SHA"
assert_equal 'real legacy sudoers fixture keeps root mode 0440' "$(stat -c '%a' "$DEST_ROOT/etc/sudoers.d/buildingos-production-backup-preflight" 2>/dev/null || stat -f '%Lp' "$DEST_ROOT/etc/sudoers.d/buildingos-production-backup-preflight")" '440'
SUDOERS="$DEST_ROOT/etc/sudoers.d/buildingos-production-backup-preflight"
chmod 0644 "$SUDOERS"
printf 'wrong sudoers bytes\n' > "$SUDOERS"
chmod 0440 "$SUDOERS"
assert_failure 'legacy sudoers wrong hash is rejected' run_check "$CANDIDATE_ONE"
chmod 0644 "$SUDOERS"
git -C "$ROOT_DIR" show "$LEGACY_BASE_SHA:infra/production/sudoers/buildingos-production-backup-preflight" > "$SUDOERS"
chmod 0644 "$SUDOERS"
assert_failure 'legacy sudoers wrong mode is rejected' run_check "$CANDIDATE_ONE"
chmod 0440 "$SUDOERS"
mv "$SUDOERS" "$SUDOERS.real"
ln -s "$(basename "$SUDOERS.real")" "$SUDOERS"
assert_failure 'legacy sudoers symlink is rejected' run_check "$CANDIDATE_ONE"
rm "$SUDOERS"
mv "$SUDOERS.real" "$SUDOERS"
printf 'unknown\n' > "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
chmod 0644 "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
assert_failure 'real legacy plus sudoers with an extra artifact is rejected' run_check "$CANDIDATE_ONE"
rm "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
mv "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh" "$TEST_ROOT/helper.saved"
assert_failure 'real legacy plus sudoers missing a required artifact is rejected' run_check "$CANDIDATE_ONE"
mv "$TEST_ROOT/helper.saved" "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh"
assert_success 'real legacy plus sudoers migrates to canonical' run_install "$CANDIDATE_ONE"
REAL_LEGACY_SNAPSHOT="$(awk -F= '/^ROLLBACK_SNAPSHOT=/{print $2}' "$TEST_ROOT/output")"
assert_contains 'real legacy snapshot records explicit layout classification' 'layout=legacy_with_sudoers' "$REAL_LEGACY_SNAPSHOT/layout"
assert_success 'canonical release rolls back to real legacy plus sudoers' "$INSTALLER" --dest-root "$DEST_ROOT" --test-mode local-unprivileged --apply --rollback "$REAL_LEGACY_SNAPSHOT"
assert_equal 'real legacy rollback restores bytes metadata and absence exactly' "$(protected_tree_state)" "$REAL_LEGACY_STATE"
assert_failure 'real legacy failure after destination preparation rolls back exactly' run_install "$CANDIDATE_ONE" --test-fail-after-prepare-destination
assert_equal 'real legacy prepare failure restores exact state' "$(protected_tree_state)" "$REAL_LEGACY_STATE"
assert_failure 'real legacy failure during stage rolls back exactly' run_install "$CANDIDATE_ONE" --test-fail-during-stage-release
assert_equal 'real legacy stage failure restores exact state' "$(protected_tree_state)" "$REAL_LEGACY_STATE"
assert_failure 'real legacy failure after publish rolls back exactly' run_install "$CANDIDATE_ONE" --test-fail-after-publish
assert_equal 'real legacy publish failure restores exact state' "$(protected_tree_state)" "$REAL_LEGACY_STATE"
rm "$SUDOERS"
make_legacy_release
LEGACY_STATE="$(protected_tree_state)"
assert_success 'recognized legacy release passes read-only validation' run_check "$CANDIDATE_ONE"
cp "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh" "$TEST_ROOT/legacy-control.saved"
printf '\n# unknown legacy bytes\n' >> "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh"
assert_failure 'legacy-shaped release with unknown bytes is rejected' run_check "$CANDIDATE_ONE"
mv "$TEST_ROOT/legacy-control.saved" "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh"
printf 'unexpected\n' > "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
chmod 0644 "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
assert_failure 'unknown partial protected release is rejected' run_check "$CANDIDATE_ONE"
rm "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
assert_success 'legacy release migrates to a coherent canonical release' run_install "$CANDIDATE_ONE"
LEGACY_SNAPSHOT="$(awk -F= '/^ROLLBACK_SNAPSHOT=/{print $2}' "$TEST_ROOT/output")"
assert_contains 'legacy snapshot records explicit layout classification' 'layout=legacy' "$LEGACY_SNAPSHOT/layout"
assert_contains 'legacy snapshot binds legacy control metadata' 'metadata=' "$LEGACY_SNAPSHOT/control.meta"
assert_contains 'legacy snapshot binds legacy control hash' 'sha256=' "$LEGACY_SNAPSHOT/control.meta"
assert_contains 'installed manifest records tooling identity' "tooling_source_sha=$CANDIDATE_ONE" "$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
assert_success 'tooling match and older runtime identity reach the protected control' \
  run_launcher "$CANDIDATE_ONE" 1111111111111111111111111111111111111111
assert_failure 'tooling source SHA mismatch fails closed before runtime preflight' \
  run_launcher aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1111111111111111111111111111111111111111
LAUNCHER_TREE_BEFORE="$(protected_tree_state)"
assert_success 'launcher manifest validation is read-only for protected files' \
  run_launcher "$CANDIDATE_ONE" 1111111111111111111111111111111111111111
assert_equal 'launcher validation creates or modifies zero protected files' "$(protected_tree_state)" "$LAUNCHER_TREE_BEFORE"
CROSS_DEVICE_HASHES="$(hashes)"
assert_failure 'cross-filesystem fixture fails before publication' run_install "$CANDIDATE_ONE" --test-force-cross-device
assert_equal 'cross-filesystem failure leaves release unchanged' "$(hashes)" "$CROSS_DEVICE_HASHES"
assert_failure 'malformed runtime identity is rejected by the protected launcher' \
  run_launcher "$CANDIDATE_ONE" not-a-runtime-sha
MANIFEST="$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/manifest"
printf '\n' >> "$MANIFEST"
assert_failure 'non-canonical manifest trailing bytes are rejected' \
  run_launcher "$CANDIDATE_ONE" "$CANDIDATE_ONE"
assert_success 'reinstall repairs non-canonical manifest bytes' run_install "$CANDIDATE_ONE"
assert_failure 'wrong runtime identity is rejected by the protected control' \
  run_launcher "$CANDIDATE_ONE" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

CONTROL="$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/production-backup-preflight.sh"
HELPER="$DEST_ROOT/usr/local/libexec/buildingos-backup-preflight/lib/endpoint-identity.sh"
printf '\n# modified\n' >> "$CONTROL"
assert_failure 'modified installed control is rejected before execution' \
  run_launcher "$CANDIDATE_ONE" "$CANDIDATE_ONE"
assert_success 'reinstall repairs modified control' run_install "$CANDIDATE_ONE"
OBJECT_EXEC="$DEST_ROOT/usr/local/libexec/buildingos-backup/backup-object-storage.sh"
printf '\n# modified object executable\n' >> "$OBJECT_EXEC"
assert_failure 'modified protected Object Storage executable is rejected before execution' \
  run_launcher "$CANDIDATE_ONE" 1111111111111111111111111111111111111111
assert_success 'reinstall repairs modified Object Storage executable' run_install "$CANDIDATE_ONE"
mv "$OBJECT_EXEC" "$OBJECT_EXEC.saved"
assert_failure 'missing protected Object Storage executable is rejected before execution' \
  run_launcher "$CANDIDATE_ONE" 1111111111111111111111111111111111111111
mv "$OBJECT_EXEC.saved" "$OBJECT_EXEC"
mv "$HELPER" "$HELPER.saved"
assert_failure 'missing installed helper is rejected before execution' \
  run_launcher "$CANDIDATE_ONE" "$CANDIDATE_ONE"
mv "$HELPER.saved" "$HELPER"
mv "$CONTROL" "$CONTROL.real"
ln -s "$CONTROL.real" "$CONTROL"
assert_failure 'symlinked protected control is rejected before execution' \
  run_launcher "$CANDIDATE_ONE" "$CANDIDATE_ONE"
assert_failure 'installer rejects a symlink protected destination before publishing' run_install "$CANDIDATE_ONE"
assert_failure 'read-only installer check rejects a symlink protected destination' run_check "$CANDIDATE_ONE"
rm "$CONTROL"
mv "$CONTROL.real" "$CONTROL"
chmod 0777 "$CONTROL"
assert_failure 'unsafe existing control mode blocks an upgrade' run_install "$CANDIDATE_ONE"
chmod 0755 "$CONTROL"
assert_success 'explicit rollback migrates canonical release back to exact legacy layout' \
  "$INSTALLER" --dest-root "$DEST_ROOT" --test-mode local-unprivileged --apply --rollback "$LEGACY_SNAPSHOT"
assert_equal 'canonical-to-legacy rollback restores bytes metadata and absent artifacts exactly' "$(protected_tree_state)" "$LEGACY_STATE"
assert_success 'legacy release can be migrated to canonical again' run_install "$CANDIDATE_ONE"

OLD_STATE="$(protected_tree_state)"
printf '\n# release two\n' >> "$SOURCE_ROOT/scripts/production-backup-preflight.sh"
git -C "$SOURCE_ROOT" add scripts/production-backup-preflight.sh
git -c core.hooksPath=/dev/null -C "$SOURCE_ROOT" commit -qm 'release two'
CANDIDATE_TWO="$(source_sha)"
assert_failure 'failure after destination preparation restores the exact previous release' \
  run_install "$CANDIDATE_TWO" --test-fail-after-prepare-destination
assert_equal 'prepare failure restores protected files directories metadata and absence' "$(protected_tree_state)" "$OLD_STATE"
assert_failure 'failure during stage release restores the exact previous release' \
  run_install "$CANDIDATE_TWO" --test-fail-during-stage-release
assert_equal 'stage failure restores protected files directories metadata and absence' "$(protected_tree_state)" "$OLD_STATE"
assert_failure 'post-publish failure restores the previous coherent release' run_install "$CANDIDATE_TWO" --test-fail-after-publish
assert_equal 'partial publish restores protected files directories metadata and absence' "$(protected_tree_state)" "$OLD_STATE"
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
assert_equal 'rollback restores every protected artifact exactly' "$(protected_tree_state)" "$OLD_STATE"

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
