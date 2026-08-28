#!/usr/bin/env bash
set -Eeuo pipefail
set +x

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
require() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }
endpoint_identity() { local value="${1#*://}"; printf '%s\n' "${value%%/*}"; }

for variable in BACKUP_ENDPOINT BACKUP_WRITE_ACCESS_KEY BACKUP_WRITE_SECRET_KEY BACKUP_VERIFY_ACCESS_KEY BACKUP_VERIFY_SECRET_KEY BACKUP_BUCKET SSE_CAPABILITY_OUTPUT; do require "$variable"; done
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "unsafe BACKUP_BUCKET"
[[ "$SSE_CAPABILITY_OUTPUT" == /* ]] || fail "SSE_CAPABILITY_OUTPUT must be absolute"
[[ ! -e "$SSE_CAPABILITY_OUTPUT" ]] || fail "SSE capability output already exists"
for command_name in mc jq; do command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"; done

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-sse-probe.XXXXXX")"
readonly temp_dir
export MC_CONFIG_DIR="$temp_dir/mc-config"
trap 'rm -rf "$temp_dir"' EXIT
umask 077
mkdir -p "$MC_CONFIG_DIR"

probe_id="$(date -u +%Y%m%dt%H%M%Sz)-$$"
probe_key="_capability-probes/sse-s3-$probe_id.txt"
printf 'BuildingOS non-sensitive SSE-S3 capability probe\n' > "$temp_dir/probe.txt"
mc alias set probe-write "$BACKUP_ENDPOINT" "$BACKUP_WRITE_ACCESS_KEY" "$BACKUP_WRITE_SECRET_KEY" >/dev/null
mc alias set probe-read "$BACKUP_ENDPOINT" "$BACKUP_VERIFY_ACCESS_KEY" "$BACKUP_VERIFY_SECRET_KEY" >/dev/null
mc stat "probe-write/$BACKUP_BUCKET" >/dev/null || fail "backup bucket is unavailable to the write identity"

if ! mc cp --enc-s3 "probe-write/$BACKUP_BUCKET" "$temp_dir/probe.txt" "probe-write/$BACKUP_BUCKET/$probe_key" >/dev/null; then
  printf 'SSE_S3_UNSUPPORTED\nSTATUS=FAIL\n' >&2
  exit 1
fi
mc stat --json "probe-read/$BACKUP_BUCKET/$probe_key" > "$temp_dir/stat.json" || fail "unable to inspect SSE probe object with the independent read identity"
if ! jq -e '(.metadata // {}) | to_entries | any((.key | ascii_downcase) == "x-amz-server-side-encryption" and ((.value | if type == "array" then .[0] else . end) | ascii_downcase) == "aes256")' "$temp_dir/stat.json" >/dev/null; then
  printf 'SSE_S3_UNKNOWN\nSTATUS=FAIL\n' >&2
  exit 1
fi

jq -n \
  --arg endpoint "$(endpoint_identity "$BACKUP_ENDPOINT")" \
  --arg bucket "$BACKUP_BUCKET" \
  --arg probedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg probeObject "$probe_key" \
  '{status:"SSE_S3_SUPPORTED",algorithm:"AES256",endpoint_identity:$endpoint,bucket:$bucket,probed_at:$probedAt,probe_object:$probeObject}' \
  > "$SSE_CAPABILITY_OUTPUT"
chmod 0600 "$SSE_CAPABILITY_OUTPUT"
printf 'SSE_S3_SUPPORTED\nSTATUS=PASS\nBUCKET=%s\nCAPABILITY_FILE=%s\n' "$BACKUP_BUCKET" "$SSE_CAPABILITY_OUTPUT"
