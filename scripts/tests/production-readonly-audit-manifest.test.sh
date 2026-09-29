#!/usr/bin/env bash
set -euo pipefail

extract_target_applied() {
  awk -F '\t' '$NF ~ /^target=[0-9]+$/ { sub(/^target=/, "", $NF); print $NF; count++ } END { if (count != 1) exit 1 }'
}

[[ "$(printf 'status=ok\tmode=verify-files\tlocal=106\ttarget=106\n' | extract_target_applied)" == '106' ]]
if printf 'status=ok\tmode=verify-files\ttarget=106\nstatus=ok\tmode=verify-files\ttarget=107\n' | extract_target_applied >/dev/null; then
  printf 'FAIL: duplicate target fields were accepted\n' >&2
  exit 1
fi
if printf 'status=ok\tmode=verify-files\ttarget=invalid\n' | extract_target_applied >/dev/null; then
  printf 'FAIL: malformed target field was accepted\n' >&2
  exit 1
fi

printf 'PASS: structured verifier target is parsed exactly once and rejects malformed/duplicate fields\n'
