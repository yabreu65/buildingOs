#!/usr/bin/env bash
set -Eeuo pipefail
set +x

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
require() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }
endpoint_identity() {
  local value="$1" scheme authority path default_port host port
  if [[ "$value" =~ ^([A-Za-z][A-Za-z0-9+.-]*)://([^/]+) ]]; then
    scheme="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
    authority="${BASH_REMATCH[2]}"
    path="${value#*://$authority}"
  else
    scheme='https'
    authority="${value%%/*}"
    path="${value#"$authority"}"
  fi
  [[ -z "$path" || "$path" == '/' ]] || return 1
  case "$scheme" in
    https) default_port=443 ;;
    http) default_port=80 ;;
    *) return 1 ;;
  esac
  [[ "$authority" =~ ^([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:([0-9]+))?$ ]] || return 1
  host="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
  port="${BASH_REMATCH[4]:-$default_port}"
  (( port >= 1 && port <= 65535 )) || return 1
  printf '%s:%s\n' "$host" "$port"
}

for variable in BACKUP_ENDPOINT BACKUP_BUCKET BACKUP_SSE_CAPABILITY_FILE; do require "$variable"; done
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe BACKUP_BUCKET"
[[ "$BACKUP_SSE_CAPABILITY_FILE" == /* ]] || fail "SSE capability path must be absolute"
[[ ! -L "$BACKUP_SSE_CAPABILITY_FILE" && -f "$BACKUP_SSE_CAPABILITY_FILE" && -r "$BACKUP_SSE_CAPABILITY_FILE" ]] || fail "SSE capability evidence is unavailable"
command -v jq >/dev/null 2>&1 || fail "jq is required"

mode="$(stat -c '%a' "$BACKUP_SSE_CAPABILITY_FILE" 2>/dev/null || stat -f '%Lp' "$BACKUP_SSE_CAPABILITY_FILE" 2>/dev/null)" || fail "unable to inspect SSE capability evidence"
owner_uid="$(stat -c '%u' "$BACKUP_SSE_CAPABILITY_FILE" 2>/dev/null || stat -f '%u' "$BACKUP_SSE_CAPABILITY_FILE" 2>/dev/null)" || fail "unable to inspect SSE capability evidence owner"
owner_group="$(stat -c '%G' "$BACKUP_SSE_CAPABILITY_FILE" 2>/dev/null || stat -f '%Sg' "$BACKUP_SSE_CAPABILITY_FILE" 2>/dev/null)" || fail "unable to inspect SSE capability evidence group"
case "${BUILDINGOS_BACKUP_TEST_MODE:-}" in
  '') expected_owner_uid=0; expected_owner_group='yoryi' ;;
  LOCAL_ISOLATED_ONLY) expected_owner_uid="$(id -u)"; expected_owner_group="$(id -gn)" ;;
  *) fail "invalid BUILDINGOS_BACKUP_TEST_MODE" ;;
esac
[[ "$owner_uid" == "$expected_owner_uid" ]] || fail "SSE capability evidence has an untrusted owner"
[[ "$owner_group" == "$expected_owner_group" ]] || fail "SSE capability evidence has an untrusted group"
[[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "SSE capability evidence permissions are invalid"
mode_value=$((8#$mode))
(( mode_value == 416 )) || fail "SSE capability evidence must be mode 0640"

jq -e \
  --arg bucket "$BACKUP_BUCKET" \
  --arg endpoint "$(endpoint_identity "$BACKUP_ENDPOINT")" \
  '.status == "SSE_S3_SUPPORTED" and .algorithm == "AES256" and .bucket == $bucket and .endpoint_identity == $endpoint and (.probed_at | type == "string" and length > 0)' \
  "$BACKUP_SSE_CAPABILITY_FILE" >/dev/null || fail "SSE-S3 capability is unsupported, unknown, or does not match the backup destination"

printf 'SSE_S3_SUPPORTED\nSTATUS=PASS\nBUCKET=%s\n' "$BACKUP_BUCKET"
