#!/usr/bin/env bash
# Fetches one recovery-point object into private staging through the pinned API image SDK.
# Usage: recovery_point_object_source_fetch API_IMAGE API_ENV_FILE DOCKER_NETWORK BUCKET KEY VERSION_ID SIZE STAGING OUTPUT
# On success, RECOVERY_POINT_OBJECT_SOURCE_BYTES, _SHA256, and _OBSERVED_VERSION_ID are set.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-point-portable-stat.sh"
# shellcheck source=production-s3-write-fence.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/production-s3-write-fence.sh"

recovery_point_object_source_error() {
  printf 'ERROR: recovery-point object fetch failed\n' >&2
  return 1
}
recovery_point_object_source_mode() { recovery_point_portable_stat_mode "$1"; }
recovery_point_object_source_inode() { recovery_point_portable_stat_identity "$1"; }
recovery_point_object_source_private_directory() {
  local directory="$1" mode
  [[ -n "$directory" && -d "$directory" && ! -L "$directory" ]] || return 1
  mode="$(recovery_point_object_source_mode "$directory")" || return 1
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#077) == 0 ))
}
recovery_point_object_source_cleanup_owned() {
  local output="$1" inode="$2" current
  current="$(recovery_point_object_source_inode "$output")" || return 0
  [[ "$current" == "$inode" ]] && rm -f -- "$output" >/dev/null 2>&1 || true
}

recovery_point_object_source_fetch() {
  local image env network bucket key version expected_size staging output staging_real output_parent output_parent_real output_name
  local response request actual_size digest observed output_inode
  RECOVERY_POINT_OBJECT_SOURCE_BYTES=''
  RECOVERY_POINT_OBJECT_SOURCE_SHA256=''
  RECOVERY_POINT_OBJECT_SOURCE_OBSERVED_VERSION_ID=''
  [[ "$#" -eq 9 ]] || { recovery_point_object_source_error; return 1; }
  image="$1"; env="$2"; network="$3"; bucket="$4"; key="$5"; version="$6"; expected_size="$7"; staging="$8"; output="$9"
  s3_fence_image "$image" && s3_fence_private_readable_file "$env" && s3_fence_network "$network" && s3_fence_bucket "$bucket" || { recovery_point_object_source_error; return 1; }
  [[ -n "$key" && "$expected_size" =~ ^(0|[1-9][0-9]*)$ ]] || { recovery_point_object_source_error; return 1; }
  command -v jq >/dev/null 2>&1 || { recovery_point_object_source_error; return 1; }
  recovery_point_object_source_private_directory "$staging" || { recovery_point_object_source_error; return 1; }
  staging_real="$(cd -P -- "$staging" && pwd -P)" || { recovery_point_object_source_error; return 1; }
  if [[ "$output" == */* ]]; then output_parent="${output%/*}"; output_name="${output##*/}"; else output_parent='.'; output_name="$output"; fi
  [[ -n "$output_parent" ]] || output_parent='/'
  output_parent_real="$(cd -P -- "$output_parent" && pwd -P)" || { recovery_point_object_source_error; return 1; }
  [[ "$output_parent_real" == "$staging_real" && "$output_name" != . && "$output_name" != .. && "$output_name" =~ ^[A-Za-z0-9.][A-Za-z0-9._-]{0,127}$ && ! -e "$output" && ! -L "$output" ]] || { recovery_point_object_source_error; return 1; }
  request="$(jq -cn --arg bucket "$bucket" --arg key "$key" --arg version "$version" --arg output "$output_name" --argjson bytes "$expected_size" '{action:"object-get",bucket:$bucket,key:$key,versionId:(if $version=="" then null else $version end),expectedBytes:$bytes,outputBasename:$output}')" || { recovery_point_object_source_error; return 1; }
  response="$(mktemp "$staging_real/.recovery-point-object-response.XXXXXX")" || { recovery_point_object_source_error; return 1; }
  chmod 0600 "$response" || { rm -f -- "$response"; recovery_point_object_source_error; return 1; }
  if ! s3_fence_object_get "$image" "$env" "$network" "$staging_real" "$request" "$response" || ! s3_fence_ok "$response"; then
    rm -f -- "$response" "$response.stderr"
    recovery_point_object_source_error
    return 1
  fi
  [[ -f "$output" && ! -L "$output" ]] || { rm -f -- "$response" "$response.stderr"; recovery_point_object_source_error; return 1; }
  output_inode="$(recovery_point_object_source_inode "$output")" || { rm -f -- "$response" "$response.stderr"; recovery_point_object_source_error; return 1; }
  [[ "$(recovery_point_object_source_mode "$output")" == 600 ]] || { recovery_point_object_source_cleanup_owned "$output" "$output_inode"; rm -f -- "$response" "$response.stderr"; recovery_point_object_source_error; return 1; }
  actual_size="$(wc -c < "$output")"; actual_size="${actual_size//[[:space:]]/}"
  digest="$(s3_fence_hash "$output")" || { recovery_point_object_source_cleanup_owned "$output" "$output_inode"; rm -f -- "$response" "$response.stderr"; recovery_point_object_source_error; return 1; }
  observed="$(jq -r 'if .versionId == null then "" else .versionId end' "$response")" || { recovery_point_object_source_cleanup_owned "$output" "$output_inode"; rm -f -- "$response" "$response.stderr"; recovery_point_object_source_error; return 1; }
  if ! [[ "$actual_size" == "$expected_size" && "$digest" =~ ^[0-9a-f]{64}$ ]] || ! jq -e --arg bucket "$bucket" --argjson bytes "$actual_size" --arg digest "$digest" --arg version "$version" '
    .ok == true and .bucket == $bucket and .bytes == $bytes and .sha256 == $digest
    and (if $version == "" then (.versionId == null or (.versionId|type == "string" and length > 0)) else .versionId == $version end)
  ' "$response" >/dev/null 2>&1; then
    recovery_point_object_source_cleanup_owned "$output" "$output_inode"
    rm -f -- "$response" "$response.stderr"
    recovery_point_object_source_error
    return 1
  fi
  rm -f -- "$response" "$response.stderr"
  RECOVERY_POINT_OBJECT_SOURCE_BYTES="$actual_size"
  RECOVERY_POINT_OBJECT_SOURCE_SHA256="$digest"
  RECOVERY_POINT_OBJECT_SOURCE_OBSERVED_VERSION_ID="$observed"
}
