#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly VERIFIER="$ROOT_DIR/scripts/verify-production-migration-baseline.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/migration-baseline-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/bin"

cat > "$TMP_DIR/bin/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == inspect ]]; then exit 0; fi
if [[ "$1" == exec ]]; then
  query="$(cat)"
  [[ "$query" == *ReceiptSequence* ]] || exit 1
  printf '%s\n' "${BASELINE_RESULT:-OK}"
  exit 0
fi
exit 1
MOCK
chmod 700 "$TMP_DIR/bin/docker"

PATH="$TMP_DIR/bin:$PATH" BASELINE_RESULT=OK bash "$VERIFIER"
printf 'ok 1 - ReceiptSequence baseline invariants pass\n'
if PATH="$TMP_DIR/bin:$PATH" BASELINE_RESULT=FAIL bash "$VERIFIER" >/dev/null 2>&1; then
  printf 'not ok - ReceiptSequence DDL mismatch unexpectedly passed\n' >&2
  exit 1
fi
printf 'ok 2 - ReceiptSequence DDL mismatch fails closed\n1..2\n'
