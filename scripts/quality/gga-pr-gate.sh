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

review_failed() {
  local status="${1:-1}"
  printf 'REVIEW_FAILED: valid reported issues block READY states.\n' >&2
  exit "$status"
}

has_authoritative_review_failure() {
  local output_file="$1"

  grep -Fxq 'CODE REVIEW FAILED' "$output_file"
}

is_external_gga_failure() {
  local output_file="$1"
  local provider_pattern='provider|codex|opencode|transport'
  local transport_pattern='network (error|failure|unavailable|unreachable)|connection (refused|reset|timed out|timeout|failed)|dns.*(lookup|resolution|error|failure|failed|unreachable)|tls.*(handshake|error|failure|failed|unreachable)|socket.*(error|failure|failed|closed|reset|timed out|timeout)|http 5[0-9]{2}'

  if grep -Eiq \
    '((provider|codex|opencode).*(authentication|authorization|credentials?|api[ _-]?key|token).*(failed|failure|error|denied|unauthorized|invalid|expired)|(authentication|authorization|credentials?|api[ _-]?key|token).*(failed|failure|error|denied|unauthorized|invalid|expired).*(provider|codex|opencode))|((provider|codex|opencode).*(quota|rate[ -]?limit|too many requests).*(exceeded|exhausted|failed|failure|error|unavailable)|(quota|rate[ -]?limit|too many requests).*(exceeded|exhausted|failed|failure|error|unavailable).*(provider|codex|opencode))|provider (is )?(unavailable|not available|failed|failure|error|not configured|missing)|failed to (initialize|load|connect to) (the )?provider|unable to (initialize|load|connect to) (the )?provider|((provider|codex|opencode|transport).*(timed out|timeout).*(failed|failure|error|unavailable)|(timed out|timeout).*(failed|failure|error|unavailable).*(provider|codex|opencode|transport))|econn[a-z_]*|service unavailable' \
    "$output_file"; then
    return 0
  fi

  # Generic transport terms can describe a review finding. Require a provider/transport
  # diagnostic context or an explicitly structured failure line before classifying external.
  grep -Eiq "((${provider_pattern})[[:space:]:_-]+(${transport_pattern})|(${provider_pattern})[[:space:]:_-]+(error|failure|failed|unavailable|timed out|timeout)[[:space:]:_-]+(${transport_pattern})|(${transport_pattern})[[:space:]:_-]+(for|from|with|by)[[:space:]]+(the[[:space:]]+)?(${provider_pattern})|^(error|fatal|failed|failure)[[:space:]:_-]+(${transport_pattern}))" "$output_file"
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

if ! command -v gga >/dev/null 2>&1; then
  external_blocker 'GGA CLI is unavailable; install gga and rerun the exact-head gate'
fi

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

if ! local_main="$(git rev-parse --verify --quiet main)"; then
  fail 'main is unavailable'
fi
if ! remote_main="$(git rev-parse --verify --quiet origin/main)"; then
  fail 'origin/main is unavailable'
fi
if [[ "$local_main" != "$remote_main" ]]; then
  fail 'local main does not equal freshly fetched origin/main; update local main before exact-head GGA review'
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
  if has_authoritative_review_failure "$output_file"; then
    review_failed
  fi
  printf 'PASS: exact-head GGA PR gate completed.\n'
  exit 0
else
  status=$?
fi

sed -n '1,200p' "$output_file" >&2
if has_authoritative_review_failure "$output_file"; then
  review_failed "$status"
fi
if is_external_gga_failure "$output_file"; then
  external_blocker 'GGA provider, authentication, quota, or transport failure; resolve it and rerun the exact-head gate' "$status"
fi
review_failed "$status"
