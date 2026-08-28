#!/usr/bin/env bash
set -Eeuo pipefail
set +x

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
[[ $# -eq 6 ]] || fail "usage: $0 --environment <development|rehearsal|test> --endpoint-identity <host[:port]> --bucket <name>"

environment=''
endpoint_identity=''
bucket=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment) environment="${2:-}"; shift 2 ;;
    --endpoint-identity) endpoint_identity="${2:-}"; shift 2 ;;
    --bucket) bucket="${2:-}"; shift 2 ;;
    *) fail "unsupported argument" ;;
  esac
done

[[ "$environment" =~ ^(development|rehearsal|test)$ ]] || fail "restore environment must be non-production"
[[ "$endpoint_identity" =~ ^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$ ]] || fail "unsafe endpoint identity"
[[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe restore bucket"
[[ "$bucket" != *production* && "$bucket" != *-prod-* && "$bucket" != prod-* ]] || fail "production restore targets are forbidden"
command -v jq >/dev/null 2>&1 || fail "jq is required"

jq -n --arg environment "$environment" --arg endpoint "$endpoint_identity" --arg bucket "$bucket" \
  '{($environment):{endpoint_identity:$endpoint,bucket:$bucket}}'
