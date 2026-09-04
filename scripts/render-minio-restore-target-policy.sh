#!/usr/bin/env bash
set -Eeuo pipefail
set +x

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
source "$(dirname "${BASH_SOURCE[0]}")/lib/endpoint-identity.sh"
[[ $# -eq 6 ]] || fail "usage: $0 --environment <development|rehearsal|test> --endpoint-identity <host[:port]> --bucket <name>"

environment=''
requested_endpoint_identity=''
bucket=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment) environment="${2:-}"; shift 2 ;;
    --endpoint-identity) requested_endpoint_identity="${2:-}"; shift 2 ;;
    --bucket) bucket="${2:-}"; shift 2 ;;
    *) fail "unsupported argument" ;;
  esac
done

[[ "$environment" =~ ^(development|rehearsal|test)$ ]] || fail "restore environment must be non-production"
[[ "$requested_endpoint_identity" != *://* ]] || fail "unsafe endpoint identity"
endpoint_identity "$requested_endpoint_identity" >/dev/null || fail "unsafe endpoint identity"
[[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe restore bucket"
[[ "$bucket" != *production* && "$bucket" != *-prod-* && "$bucket" != prod-* ]] || fail "production restore targets are forbidden"
command -v jq >/dev/null 2>&1 || fail "jq is required"

jq -n --arg environment "$environment" --arg endpoint "$requested_endpoint_identity" --arg bucket "$bucket" \
  '{($environment):{endpoint_identity:$endpoint,bucket:$bucket}}'
