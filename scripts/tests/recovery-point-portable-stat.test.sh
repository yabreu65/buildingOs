#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORTABLE="$ROOT/scripts/lib/recovery-point-portable-stat.sh"
FENCE="$ROOT/scripts/lib/production-s3-write-fence.sh"
CAPTURE="$ROOT/scripts/lib/recovery-point-capture.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/recovery-point-portable-stat.XXXXXX")"
trap 'rm -rf -- "$T"' EXIT
BIN="$T/bin"
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf 'ok %s - %s\n' "$PASS" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'not ok %s - %s\n' "$FAIL" "$1" >&2; }
ok() { local name="$1"; shift; if "$@" >"$T/audit" 2>&1; then pass "$name"; else fail "$name"; fi; }
bad() { local name="$1"; shift; if "$@" >"$T/audit" 2>&1; then fail "$name (unexpected success)"; else pass "$name"; fi; }

mkdir -p "$BIN"
cat >"$BIN/stat" <<'STAT'
#!/usr/bin/env bash
set -Eeuo pipefail
case "${FAKE_STAT_SCENARIO:-}" in
  bsd-malformed-gnu-600)
    [[ "$1" == -f ]] && { printf 'Filesystem     1024-blocks Used Available Capacity iused ifree %%iused Mounted on\n'; exit 0; }
    [[ "$1" == -c && "$2" == '%a' && "$3" == -- ]] && { printf '600\n'; exit 0; }
    ;;
  gnu-fails-bsd-600)
    [[ "$1" == -c && "$2" == '%a' && "$3" == -- ]] && exit 1
    [[ "$1" == -f && "$2" == '%Lp' ]] && { printf '600\n'; exit 0; }
    ;;
  both-malformed)
    [[ "$1" == -f || "$1" == -c ]] && { printf 'not-a-mode\n'; exit 0; }
    ;;
  gnu-700)
    [[ "$1" == -f ]] && { printf 'not-a-mode\n'; exit 0; }
    [[ "$1" == -c && "$2" == '%a' && "$3" == -- ]] && { printf '700\n'; exit 0; }
    ;;
  *)
    [[ "$1" == -f ]] && { printf 'not-a-mode\n'; exit 0; }
    [[ "$1" == -c && "$2" == '%a' && "$3" == -- ]] && { printf '%s\n' "${FAKE_STAT_SCENARIO:-600}"; exit 0; }
    ;;
esac
exit 2
STAT
chmod +x "$BIN/stat"
export PATH="$BIN:/usr/bin:/bin"

# Every mode decision below is independent of the host stat implementation.
source "$PORTABLE"
source "$CAPTURE"

PRIVATE_FILE="$T/private-file"
printf 'private\n' >"$PRIVATE_FILE"
chmod 0600 "$PRIVATE_FILE"
PRIVATE_DIRECTORY="$T/private-directory"
mkdir -m 0700 "$PRIVATE_DIRECTORY"

mode_output() { recovery_point_portable_stat_mode "$1"; }

ok 'malformed successful BSD stat output falls through to GNU mode' env FAKE_STAT_SCENARIO=bsd-malformed-gnu-600 bash -c 'source "$1"; [[ "$(recovery_point_portable_stat_mode "$2")" == 600 ]]' _ "$PORTABLE" "$PRIVATE_FILE"
ok 'failed GNU stat falls through to BSD mode' env FAKE_STAT_SCENARIO=gnu-fails-bsd-600 bash -c 'source "$1"; [[ "$(recovery_point_portable_stat_mode "$2")" == 600 ]]' _ "$PORTABLE" "$PRIVATE_FILE"
bad 'two malformed successful stat outputs fail closed' env FAKE_STAT_SCENARIO=both-malformed bash -c 'source "$1"; recovery_point_portable_stat_mode "$2"' _ "$PORTABLE" "$PRIVATE_FILE"
ok '0600 regular file remains accepted' env FAKE_STAT_SCENARIO=600 bash -c 'source "$1"; source "$2"; s3_fence_private_readable_file "$3"' _ "$PORTABLE" "$FENCE" "$PRIVATE_FILE"
bad '0640 regular file remains rejected' env FAKE_STAT_SCENARIO=640 bash -c 'source "$1"; source "$2"; s3_fence_private_readable_file "$3"' _ "$PORTABLE" "$FENCE" "$PRIVATE_FILE"
bad '0644 regular file remains rejected' env FAKE_STAT_SCENARIO=644 bash -c 'source "$1"; source "$2"; s3_fence_private_readable_file "$3"' _ "$PORTABLE" "$FENCE" "$PRIVATE_FILE"
ln -s "$PRIVATE_FILE" "$T/private-file-link"
bad 'symlink remains rejected before the mode reader' env FAKE_STAT_SCENARIO=600 bash -c 'source "$1"; source "$2"; s3_fence_private_readable_file "$3"' _ "$PORTABLE" "$FENCE" "$T/private-file-link"
ok 'recovery-point capture uses the corrected fallback reader' env FAKE_STAT_SCENARIO=gnu-700 bash -c 'source "$1"; source "$2"; recovery_point_capture_private_empty_root "$3"' _ "$PORTABLE" "$CAPTURE" "$PRIVATE_DIRECTORY"

(( FAIL == 0 )) || exit 1
printf 'PASSED: %s assertions\n' "$PASS"
