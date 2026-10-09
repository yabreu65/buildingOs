#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="$ROOT_DIR/scripts/install-weekly-recovery-point.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-weekly-installer.XXXXXX")"
SOURCE_ROOT="$TEST_ROOT/source"
DEST_ROOT="$TEST_ROOT/dest"
trap 'rm -rf "$TEST_ROOT"' EXIT

pass() { printf 'ok - %s\n' "$1"; }
fail() { printf 'not ok - %s\n' "$1" >&2; exit 1; }
assert_success() { local name="$1"; shift; "$@" >/tmp/buildingos-weekly-installer.out 2>&1 || { cat /tmp/buildingos-weekly-installer.out >&2; fail "$name"; }; pass "$name"; }
assert_failure() { local name="$1"; shift; "$@" >/tmp/buildingos-weekly-installer.out 2>&1 && fail "$name" || pass "$name"; }

git clone --quiet --no-local "$ROOT_DIR" "$SOURCE_ROOT"
RELEASE_SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
mkdir -p "$DEST_ROOT"
mkdir -p "$DEST_ROOT/opt/pawtech/backups"
printf 'existing-backup-sentinel\n' > "$DEST_ROOT/opt/pawtech/backups/sentinel"

assert_success 'clean committed source installs into an isolated root' \
  "$INSTALLER" --source-root "$SOURCE_ROOT" --release-sha "$RELEASE_SHA" --dest-root "$DEST_ROOT" --test-mode local --apply

RELEASE_DIR="$DEST_ROOT/opt/buildingos/weekly-recovery-points/releases/$RELEASE_SHA"
[[ -f "$RELEASE_DIR/release-manifest.sha256" ]] || fail 'release manifest exists'
grep -Fxq "release_sha=$RELEASE_SHA" "$RELEASE_DIR/release-manifest.sha256" || fail 'manifest binds release SHA'
grep -Fxq 'BUILDINGOS_WEEKLY_RECOVERY_POINT_ENABLE=NO' "$DEST_ROOT/etc/buildingos/recovery-point-weekly.env" || fail 'capture disabled by default'
grep -Fxq 'Persistent=false' "$DEST_ROOT/etc/systemd/system/pawtech-buildingos-recovery-point-weekly.timer" || fail 'timer is non-persistent'
grep -Fq "$RELEASE_DIR/scripts/backup-recovery-point-weekly.sh" "$DEST_ROOT/etc/systemd/system/pawtech-buildingos-recovery-point-weekly.service" || fail 'service uses versioned release'
! grep -Fq '/opt/pawtech/apps/buildingos/buildingos-app' "$DEST_ROOT/etc/systemd/system/pawtech-buildingos-recovery-point-weekly.service" || fail 'service references production checkout'
pass 'installed units use the versioned release and remain disabled'
[[ -d "$DEST_ROOT/var/lib/buildingos-backup" && ! -L "$DEST_ROOT/var/lib/buildingos-backup" ]] || fail 'shared lock parent exists'
pass 'shared lock parent is protected and available'
grep -Fxq 'existing-backup-sentinel' "$DEST_ROOT/opt/pawtech/backups/sentinel" || fail 'existing backups are preserved'
pass 'existing backup data is preserved'

assert_success 'installed release passes read-only verification' \
  "$INSTALLER" --source-root "$SOURCE_ROOT" --release-sha "$RELEASE_SHA" --dest-root "$DEST_ROOT" --test-mode local --check

touch "$SOURCE_ROOT/dirty-file"
assert_failure 'dirty source is rejected' \
  "$INSTALLER" --source-root "$SOURCE_ROOT" --release-sha "$RELEASE_SHA" --dest-root "$TEST_ROOT/dirty-dest" --test-mode local --apply
rm "$SOURCE_ROOT/dirty-file"

assert_failure 'staging failure leaves no partial release' \
  env WEEKLY_INSTALLER_TEST_FAIL_AFTER_STAGE=YES "$INSTALLER" --source-root "$SOURCE_ROOT" --release-sha "$RELEASE_SHA" --dest-root "$TEST_ROOT/failure-dest" --test-mode local --apply
[[ ! -e "$TEST_ROOT/failure-dest/opt/buildingos/weekly-recovery-points/releases/$RELEASE_SHA" ]] || fail 'failed install left release state'
pass 'failed installation leaves no partial state'

printf 'WEEKLY_INSTALLER_TESTS=PASS\n'
