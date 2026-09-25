#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/production-rclone-recovery-check.sh"
PORTABLE="$ROOT/scripts/lib/recovery-point-portable-stat.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-rclone-recovery.XXXXXX")"
cleanup() { chmod 0700 "$TEST_ROOT" 2>/dev/null || true; rm -rf -- "$TEST_ROOT"; }
trap cleanup EXIT
BIN="$TEST_ROOT/bin"
RCLONE_BIN="$BIN/rclone"
LOCAL_ROOT="$TEST_ROOT/local"
PRIVATE_PARENT="$TEST_ROOT/private"
CONFIG="$PRIVATE_PARENT/rclone.conf"
LIST="$PRIVATE_PARENT/one-path.list"
LOG="$TEST_ROOT/rclone.log"
AUDIT="$TEST_ROOT/audit.log"
HASH='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
OBJECT_PATH="objects/$HASH.blob"
DUMP_PATH='postgresql/buildingos-20250101.dump'
METADATA_PATH='metadata/manifest.json'
REMOTE_ROOT='archive:recovery-point'
CREDENTIAL='credential-never-in-argv-or-output'
PASS=0 FAIL=0

pass() { PASS=$((PASS + 1)); printf 'ok %s - %s\n' "$PASS" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'not ok %s - %s\n' "$FAIL" "$1" >&2; }
ok() { local name="$1"; shift; if "$@" >> "$AUDIT" 2>&1; then pass "$name"; else fail "$name"; fi; }
bad() { local name="$1"; shift; if "$@" >> "$AUDIT" 2>&1; then fail "$name (unexpected success)"; else pass "$name"; fi; }
mode() { recovery_point_portable_stat_mode "$1"; }
no_list() { [[ ! -e "$LIST" && ! -L "$LIST" ]]; }

mkdir -p "$BIN" "$LOCAL_ROOT/objects" "$LOCAL_ROOT/postgresql" "$LOCAL_ROOT/metadata" "$PRIVATE_PARENT"
printf 'credential = %s\n' "$CREDENTIAL" > "$CONFIG"
printf 'object bytes\n' > "$LOCAL_ROOT/$OBJECT_PATH"
printf 'dump bytes\n' > "$LOCAL_ROOT/$DUMP_PATH"
printf 'metadata bytes\n' > "$LOCAL_ROOT/$METADATA_PATH"
chmod 0700 "$PRIVATE_PARENT"
chmod 0600 "$CONFIG"
: > "$LOG"
: > "$AUDIT"
chmod 0600 "$LOG" "$AUDIT"
cat > "$BIN/rclone" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
for arg in "$@"; do [[ "$arg" != *"$FAKE_CREDENTIAL"* ]] || exit 87; done
source "$FAKE_PORTABLE"
printf '%s\n' "$@" >> "$FAKE_LOG"
case "${1:-}" in
  check)
    [[ "${2:-}" == --help ]] || exit 88
    case "${FAKE_DOWNLOAD_HELP:-exact}" in
      absent) exit 2 ;;
      prefix) printf '%s\n' '--download-rate' ;;
      *) printf '%s\n' '--download' ;;
    esac
    ;;
  help)
    [[ "${2:-}" == flags ]] || exit 89
    case "${FAKE_FILES_HELP:-exact}" in
      absent) exit 2 ;;
      prefix) printf '%s\n' '--files-from-raw-extra' ;;
      *) printf '%s\n' '--files-from-raw' ;;
    esac
    ;;
  --config)
    [[ "${2:-}" == "$FAKE_CONFIG" ]] || exit 90
    case "${3:-}" in
      copyto)
        [[ "${FAKE_COPY_FAIL:-false}" != true ]] || exit 3
        [[ "$#" == 5 && "$4" == "$FAKE_OBJECT" && "$5" == "$FAKE_REMOTE/$FAKE_PATH" ]] || exit 91
        ;;
      check)
        [[ "${FAKE_CHECK_FAIL:-false}" != true ]] || exit 4
        [[ "$#" == 9 && "$4" == --download && "$5" == --one-way && "$6" == --files-from-raw && "$8" == "$FAKE_LOCAL" && "$9" == "$FAKE_REMOTE" ]] || exit 92
        [[ "$(recovery_point_portable_stat_mode "$7")" == 600 && ! -L "$7" ]] || exit 93
        cmp -s <(printf '%s\n' "$FAKE_PATH") "$7" || exit 94
        cp "$7" "$FAKE_CAPTURED_LIST"
        ;;
      *) exit 95 ;;
    esac
    ;;
  *) exit 96 ;;
esac
MOCK
chmod +x "$BIN/rclone"
export PATH="$BIN:/usr/bin:/bin" FAKE_LOG="$LOG" FAKE_CONFIG="$CONFIG" FAKE_LOCAL="$LOCAL_ROOT" FAKE_REMOTE="$REMOTE_ROOT" FAKE_PATH="$OBJECT_PATH" FAKE_OBJECT="$LOCAL_ROOT/$OBJECT_PATH" FAKE_CAPTURED_LIST="$TEST_ROOT/captured.list" FAKE_CREDENTIAL="$CREDENTIAL" FAKE_PORTABLE="$PORTABLE"
source "$PORTABLE"
source "$LIB"

ok 'capability check accepts private config and required help flags' recovery_point_rclone_require_download_check "$RCLONE_BIN" "$CONFIG"
ok 'capability check uses only the required local help commands' bash -c 'cmp -s <(printf "check\n--help\nhelp\nflags\n") "$1"' _ "$LOG"
: > "$LOG"
ok 'object copy and download check use exact flags and one raw path' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$OBJECT_PATH" "$REMOTE_ROOT" "$LIST"
ok 'successful transfer removes its private file list' no_list
ok 'fake captured exactly one raw object path' cmp -s <(printf '%s\n' "$OBJECT_PATH") "$FAKE_CAPTURED_LIST"
export FAKE_PATH="$DUMP_PATH" FAKE_OBJECT="$LOCAL_ROOT/$DUMP_PATH"
ok 'postgresql dump path is accepted by the bounded check' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$DUMP_PATH" "$REMOTE_ROOT" "$LIST"
export FAKE_PATH="$METADATA_PATH" FAKE_OBJECT="$LOCAL_ROOT/$METADATA_PATH"
ok 'metadata basename path is accepted by the bounded check' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$METADATA_PATH" "$REMOTE_ROOT" "$LIST"
export FAKE_PATH="$OBJECT_PATH" FAKE_OBJECT="$LOCAL_ROOT/$OBJECT_PATH"

export FAKE_DOWNLOAD_HELP=absent
bad 'missing download capability fails closed before transfer' recovery_point_rclone_require_download_check "$RCLONE_BIN" "$CONFIG"
export FAKE_DOWNLOAD_HELP=prefix
bad 'download-like prefix does not satisfy exact capability' recovery_point_rclone_require_download_check "$RCLONE_BIN" "$CONFIG"
unset FAKE_DOWNLOAD_HELP
export FAKE_FILES_HELP=absent
bad 'missing files-from-raw capability fails closed before transfer' recovery_point_rclone_require_download_check "$RCLONE_BIN" "$CONFIG"
export FAKE_FILES_HELP=prefix
bad 'files-from-raw-like prefix does not satisfy exact capability' recovery_point_rclone_require_download_check "$RCLONE_BIN" "$CONFIG"
unset FAKE_FILES_HELP
chmod 0640 "$CONFIG"
bad 'group-readable config fails closed' recovery_point_rclone_require_download_check "$RCLONE_BIN" "$CONFIG"
chmod 0600 "$CONFIG"
ln -s "$CONFIG" "$PRIVATE_PARENT/config-link"
bad 'symlink config fails closed' recovery_point_rclone_require_download_check "$RCLONE_BIN" "$PRIVATE_PARENT/config-link"
bad 'missing rclone binary fails closed' recovery_point_rclone_require_download_check "$BIN/missing" "$CONFIG"

for invalid in '../escape' '/absolute' 'objects/UPPER.blob' 'objects/not-a-hash.blob' 'postgresql/../dump' 'postgresql/two words.dump' 'metadata/key/name'; do
  bad "unsafe relative path is rejected: $invalid" recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$invalid" "$REMOTE_ROOT" "$LIST"
done
bad 'remote parent traversal fails closed' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$OBJECT_PATH" 'archive:recovery-point/../../escape' "$LIST"
bad 'remote current-directory segment fails closed' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$OBJECT_PATH" 'archive:recovery-point/./objects' "$LIST"
bad 'remote repeated separator fails closed' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$OBJECT_PATH" 'archive:recovery-point//objects' "$LIST"
bad 'missing source file fails closed' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "objects/${HASH%?}0.blob" "$REMOTE_ROOT" "$LIST"
ln -s "$LOCAL_ROOT/$OBJECT_PATH" "$LOCAL_ROOT/metadata/symlink.json"
bad 'symlink source fails closed' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" 'metadata/symlink.json' "$REMOTE_ROOT" "$LIST"
printf existing > "$LIST"
bad 'existing list file is never overwritten' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$OBJECT_PATH" "$REMOTE_ROOT" "$LIST"
ok 'existing list contents remain unchanged' cmp -s <(printf existing) "$LIST"
rm -f "$LIST"
ln -s "$CONFIG" "$LIST"
bad 'symlink list file fails closed' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$OBJECT_PATH" "$REMOTE_ROOT" "$LIST"
rm -f "$LIST"
chmod 0755 "$PRIVATE_PARENT"
bad 'non-private list parent fails closed' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$OBJECT_PATH" "$REMOTE_ROOT" "$LIST"
chmod 0700 "$PRIVATE_PARENT"
export FAKE_COPY_FAIL=true
bad 'copy failure is generic and cleans the file list' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$OBJECT_PATH" "$REMOTE_ROOT" "$LIST"
unset FAKE_COPY_FAIL
ok 'copy failure removes the file list' no_list
export FAKE_CHECK_FAIL=true
bad 'download check failure is generic and cleans the file list' recovery_point_rclone_copy_check "$RCLONE_BIN" "$CONFIG" "$LOCAL_ROOT" "$OBJECT_PATH" "$REMOTE_ROOT" "$LIST"
unset FAKE_CHECK_FAIL
ok 'download check failure removes the file list' no_list
if grep -Fq -- "$CREDENTIAL" "$LOG" "$AUDIT" || grep -Fq -- 'two words.dump' "$LOG" "$AUDIT"; then fail 'credentials and rejected paths never appear in rclone argv or output'; else pass 'credentials and rejected paths never appear in rclone argv or output'; fi

(( FAIL == 0 )) || exit 1
printf 'PASSED: %s assertions\n' "$PASS"
