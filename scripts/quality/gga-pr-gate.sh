#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

fail() {
  printf 'GGA gate failed: %s\n' "$*" >&2
  exit 1
}

external_blocker() {
  local message="$1"
  local status="${2:-1}"
  printf 'EXTERNAL_BLOCKER: %s\n' "$message" >&2
  printf 'READY_FOR_PM_REVIEW and READY_FOR_MERGE are blocked until the external condition is resolved.\n' >&2
  exit "$status"
}

reject_dirty_tree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    fail 'tracked changes are present; the exact-head GGA gate requires a clean tree'
  fi

  local untracked
  untracked="$(git ls-files --others --exclude-standard | awk '$0 !~ /^\.codegraph(\/|$)/')"
  if [[ -n "$untracked" ]]; then
    printf 'Unexpected untracked files:\n%s\n' "$untracked" >&2
    fail 'the exact-head GGA gate requires no unexpected untracked files'
  fi
}

provider="${GGA_PROVIDER:-}"
if [[ -z "$provider" ]]; then
  if command -v codex >/dev/null 2>&1; then
    provider="codex"
  elif [[ -r "${HOME:-}/.config/gga/config" ]]; then
    provider="$(awk -F= '
      $1 ~ /^[[:space:]]*[Pp][Rr][Oo][Vv][Ii][Dd][Ee][Rr][[:space:]]*$/ {
        value = $2
        sub(/[[:space:]#;].*$/, "", value)
        gsub(/[\"[:space:]]/, "", value)
        print value
        exit
      }
    ' "${HOME:-}/.config/gga/config")"
  fi
fi

if [[ -z "$provider" ]]; then
  external_blocker 'GGA provider is not configured through GGA_PROVIDER, an installed codex CLI, or ~/.config/gga/config PROVIDER'
fi
export GGA_PROVIDER="$provider"

reject_dirty_tree

if ! git fetch origin; then
  external_blocker 'unable to fetch origin for exact-head verification'
fi

if ! branch="$(git symbolic-ref --quiet --short HEAD)"; then
  fail 'HEAD is detached; exact-head verification requires a branch'
fi

if ! git rev-parse --verify --quiet main >/dev/null; then
  fail 'main is unavailable'
fi
if ! git rev-parse --verify --quiet origin/main >/dev/null; then
  fail 'origin/main is unavailable'
fi
if ! remote_head="$(git rev-parse --verify --quiet "origin/$branch")"; then
  fail "origin/$branch is unavailable"
fi
local_head="$(git rev-parse HEAD)"
if [[ "$local_head" != "$remote_head" ]]; then
  fail "HEAD does not equal origin/$branch; push the exact candidate before GGA review"
fi

export PR_BASE_BRANCH=main
printf '+ gga run --pr-mode --no-cache (provider: %s)\n' "$provider"
output_file="$(mktemp "${TMPDIR:-/tmp}/buildingos-gga.XXXXXX")"
trap 'rm -f "$output_file"' EXIT

if gga run --pr-mode --no-cache >"$output_file" 2>&1; then
  sed -n '1,200p' "$output_file"
  printf 'PASS: exact-head GGA PR gate completed.\n'
  exit 0
else
  status=$?
fi

sed -n '1,200p' "$output_file" >&2
if grep -Eiq 'provider|auth|authentication|authorization|credential|token|quota|rate[ -]?limit' "$output_file"; then
  external_blocker 'GGA provider, authentication, or quota failure; resolve it and rerun the exact-head gate' "$status"
fi
printf 'GGA gate failed: valid reported issues block READY states.\n' >&2
exit "$status"
