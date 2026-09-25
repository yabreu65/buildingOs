#!/usr/bin/env bash
# Captures each canonical PostgreSQL File reference into a bounded recovery bundle.
# Usage: recovery_point_file_object_bundle_capture MANIFEST_JSON MANIFEST_SHA256 API_IMAGE API_ENV_FILE DOCKER_NETWORK SOURCE_BUCKET RCLONE_BIN RCLONE_CONFIG UNIQUE_REMOTE_ROOT PRIVATE_STAGING_ROOT
# Success globals: RECOVERY_POINT_FILE_OBJECT_BUNDLE_{REFERENCE_COUNT,UNIQUE_OBJECT_COUNT,INPUT_MANIFEST_SHA256,CONTENT_MANIFEST_SHA256,REMOTE_ROOT,MANIFEST_PASS,CONTENT_PASS}.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-point-file-manifest.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-point-object-source.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/production-rclone-recovery-check.sh"

recovery_point_file_object_bundle_error() { printf 'ERROR: recovery-point file object bundle failed\n' >&2; return 1; }
recovery_point_file_object_bundle_remote_incomplete() { printf 'ERROR: recovery bundle remote unique namespace is incomplete; remote residue may remain; operator cleanup is required; do not retry.\n' >&2; return 1; }
recovery_point_file_object_bundle_decode() { local decoded; decoded="$(printf '%s' "$1" | { base64 --decode 2>/dev/null || base64 -D || exit; printf '\001'; })" || return 1; REPLY="${decoded%$'\001'}"; }
recovery_point_file_object_bundle_inode() { stat -f '%d:%i' "$1" 2>/dev/null || stat -c '%d:%i' "$1" 2>/dev/null; }
recovery_point_file_object_bundle_remember() { local inode; inode="$(recovery_point_file_object_bundle_inode "$1")" || return 1; owned_paths+=("$1"); owned_inodes+=("$inode"); }
recovery_point_file_object_bundle_cleanup() {
  local path inode index
  for path in "$@"; do
    for ((index=0; index<${#owned_paths[@]}; index++)); do
      [[ "${owned_paths[index]}" == "$path" ]] || continue
      inode="$(recovery_point_file_object_bundle_inode "$path")" || break
      [[ "$inode" == "${owned_inodes[index]}" ]] && rm -f -- "$path" >/dev/null 2>&1 || true
      break
    done
  done
}
recovery_point_file_object_bundle_remove_owned_dir() { local path="$1" inode="$2" current; [[ -n "$inode" ]] || return 0; current="$(recovery_point_file_object_bundle_inode "$path")" || return 0; [[ "$current" == "$inode" ]] && rmdir -- "$path" >/dev/null 2>&1 || true; }
recovery_point_file_object_bundle_abort() { local root="$1"; recovery_point_file_object_bundle_cleanup "${owned_paths[@]}"; recovery_point_file_object_bundle_remove_owned_dir "$root/metadata" "${metadata_inode:-}"; recovery_point_file_object_bundle_remove_owned_dir "$root/objects" "${objects_inode:-}"; if [[ "${remote_write_attempted:-false}" == true ]]; then recovery_point_file_object_bundle_remote_incomplete || true; else recovery_point_file_object_bundle_error || true; fi; }
recovery_point_file_object_bundle_private_root() { recovery_point_rclone_private_directory "$1"; }

recovery_point_file_object_bundle_capture() {
  local manifest="$1" manifest_hash="$2" image="$3" env="$4" network="$5" bucket="$6" rclone="$7" rclone_config="$8" remote="$9" root="${10}"
  local canonical listing rows unique identity_tmp identity id size key64 bucket64 version64 is_null key version out dest record actual64 known known_size line content bytes final final_hash list content_tmp hash_tmp objects_inode='' metadata_inode='' remote_write_attempted=false
  local -a owned_paths=() owned_inodes=()
  RECOVERY_POINT_FILE_OBJECT_BUNDLE_REFERENCE_COUNT=0; RECOVERY_POINT_FILE_OBJECT_BUNDLE_UNIQUE_OBJECT_COUNT=0
  RECOVERY_POINT_FILE_OBJECT_BUNDLE_INPUT_MANIFEST_SHA256=''; RECOVERY_POINT_FILE_OBJECT_BUNDLE_CONTENT_MANIFEST_SHA256=''; RECOVERY_POINT_FILE_OBJECT_BUNDLE_REMOTE_ROOT=''
  RECOVERY_POINT_FILE_OBJECT_BUNDLE_MANIFEST_PASS=false; RECOVERY_POINT_FILE_OBJECT_BUNDLE_CONTENT_PASS=false
  [[ "$#" -eq 10 ]] || { recovery_point_file_object_bundle_error; return 1; }
  recovery_point_file_object_bundle_private_root "$root" || { recovery_point_file_object_bundle_error; return 1; }
  [[ -f "$manifest_hash" && ! -L "$manifest_hash" && -r "$manifest_hash" && "$(recovery_point_file_manifest_mode "$manifest_hash")" == 600 && ! -e "$root/objects" && ! -L "$root/objects" && ! -e "$root/metadata" && ! -L "$root/metadata" ]] || { recovery_point_file_object_bundle_error; return 1; }
  recovery_point_file_manifest_validate "$manifest" "$bucket" >/dev/null 2>&1 && s3_fence_image "$image" && s3_fence_private_readable_file "$env" && s3_fence_network "$network" && s3_fence_bucket "$bucket" || { recovery_point_file_object_bundle_error; return 1; }
  canonical="$(mktemp "$root/.bundle-canonical.XXXXXX")" || { recovery_point_file_object_bundle_error; return 1; }
  recovery_point_file_object_bundle_remember "$canonical" || { recovery_point_file_object_bundle_error; return 1; }
  chmod 0600 "$canonical" || { recovery_point_file_object_bundle_cleanup "$canonical"; recovery_point_file_object_bundle_error; return 1; }
  jq -cS 'sort_by(.id)|map({id,tenantId,bucket,objectKey,objectVersionId,size,checksum})' "$manifest" >"$canonical" 2>/dev/null || { recovery_point_file_object_bundle_cleanup "$canonical"; recovery_point_file_object_bundle_error; return 1; }
  cmp -s "$manifest" "$canonical" || { recovery_point_file_object_bundle_cleanup "$canonical"; recovery_point_file_object_bundle_error; return 1; }
  RECOVERY_POINT_FILE_OBJECT_BUNDLE_INPUT_MANIFEST_SHA256="$(recovery_point_file_manifest_sha256 "$manifest")" || { recovery_point_file_object_bundle_cleanup "$canonical"; recovery_point_file_object_bundle_error; return 1; }
  cmp -s <(printf '%s\n' "$RECOVERY_POINT_FILE_OBJECT_BUNDLE_INPUT_MANIFEST_SHA256") "$manifest_hash" || { recovery_point_file_object_bundle_cleanup "$canonical"; recovery_point_file_object_bundle_error; return 1; }
  recovery_point_rclone_require_download_check "$rclone" "$rclone_config" || { recovery_point_file_object_bundle_cleanup "$canonical"; recovery_point_file_object_bundle_error; return 1; }
  recovery_point_rclone_safe_remote_root "$remote" || { recovery_point_file_object_bundle_cleanup "$canonical"; recovery_point_file_object_bundle_error; return 1; }
  listing="$(mktemp "$root/.bundle-lsf.XXXXXX")" || { recovery_point_file_object_bundle_cleanup "$canonical"; recovery_point_file_object_bundle_error; return 1; }
  recovery_point_file_object_bundle_remember "$listing" || { recovery_point_file_object_bundle_cleanup "$canonical"; recovery_point_file_object_bundle_error; return 1; }
  chmod 0600 "$listing" || { recovery_point_file_object_bundle_cleanup "$canonical" "$listing"; recovery_point_file_object_bundle_error; return 1; }
  "$rclone" --config "$rclone_config" lsf "$remote" >"$listing" 2>/dev/null || { recovery_point_file_object_bundle_cleanup "$canonical" "$listing"; recovery_point_file_object_bundle_error; return 1; }
  [[ ! -s "$listing" ]] || { recovery_point_file_object_bundle_cleanup "$canonical" "$listing"; recovery_point_file_object_bundle_error; return 1; }
  recovery_point_file_object_bundle_cleanup "$canonical" "$listing"
  mkdir -m 0700 "$root/objects" || { recovery_point_file_object_bundle_abort "$root"; return 1; }
  objects_inode="$(recovery_point_file_object_bundle_inode "$root/objects")" || { recovery_point_file_object_bundle_abort "$root"; return 1; }
  mkdir -m 0700 "$root/metadata" || { recovery_point_file_object_bundle_abort "$root"; return 1; }
  metadata_inode="$(recovery_point_file_object_bundle_inode "$root/metadata")" || { recovery_point_file_object_bundle_abort "$root"; return 1; }
  rows="$(mktemp "$root/.bundle-rows.XXXXXX")" || { recovery_point_file_object_bundle_abort "$root"; return 1; }
  recovery_point_file_object_bundle_remember "$rows" || { recovery_point_file_object_bundle_abort "$root"; return 1; }
  unique="$(mktemp "$root/.bundle-unique.XXXXXX")" || { recovery_point_file_object_bundle_abort "$root" "$rows"; return 1; }
  recovery_point_file_object_bundle_remember "$unique" || { recovery_point_file_object_bundle_abort "$root" "$rows"; return 1; }
  record="$(mktemp "$root/.bundle-records.XXXXXX")" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique"; return 1; }
  recovery_point_file_object_bundle_remember "$record" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique"; return 1; }
  chmod 0600 "$rows" "$unique" "$record" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
  jq -r '.[]|[(.bucket|@base64),(.objectKey|@base64),(if .objectVersionId==null then "-" else .objectVersionId|@base64 end),((.objectVersionId==null)|tostring),(.size|tostring),(.|tojson|@base64)]|join("\t")' "$manifest" >"$rows" 2>/dev/null || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
  while IFS=$'\t' read -r bucket64 key64 version64 is_null size line; do
    ((RECOVERY_POINT_FILE_OBJECT_BUNDLE_REFERENCE_COUNT+=1))
    identity_tmp="$(mktemp "$root/.bundle-identity.XXXXXX")" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
    recovery_point_file_object_bundle_remember "$identity_tmp" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
    chmod 0600 "$identity_tmp" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$identity_tmp"; return 1; }
    printf '%s\t%s\t%s\t%s\n' "$bucket64" "$key64" "$is_null" "$version64" | jq -R 'split("\t") as $p|[($p[0]|@base64d),($p[1]|@base64d),(if $p[2]=="true" then null else $p[3]|@base64d end)]' >"$identity_tmp" 2>/dev/null || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$identity_tmp"; return 1; }
    identity="$(recovery_point_file_manifest_sha256 "$identity_tmp")" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$identity_tmp"; return 1; }
    recovery_point_file_object_bundle_cleanup "$identity_tmp"
    [[ "$identity" =~ ^[0-9a-f]{64}$ ]] || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
    known="$(awk -F '\t' -v i="$identity" '$1==i{print;exit}' "$unique")" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
    if [[ -n "$known" ]]; then known_size="${known#*$'\t'}"; known_size="${known_size%%$'\t'*}"; [[ "$known_size" == "$size" ]] || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }; IFS=$'\t' read -r _ _ dest content bytes actual64 <<<"$known"
    else
      recovery_point_file_object_bundle_decode "$bucket64" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
      [[ "$REPLY" == "$bucket" ]] || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
      recovery_point_file_object_bundle_decode "$key64" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
      key="$REPLY"; version=''; [[ "$is_null" == true ]] || { recovery_point_file_object_bundle_decode "$version64" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }; version="$REPLY"; }
      dest="objects/$identity.blob"; out="$root/.bundle-object.$identity"
      [[ ! -e "$out" && ! -L "$out" ]] || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
      recovery_point_object_source_fetch "$image" "$env" "$network" "$bucket" "$key" "$version" "$size" "$root" "$out" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$out"; return 1; }
      recovery_point_file_object_bundle_remember "$out" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$out"; return 1; }
      ln "$out" "$root/$dest" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$out" "$root/$dest"; return 1; }
      recovery_point_file_object_bundle_remember "$root/$dest" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$out" "$root/$dest"; return 1; }
      content="$RECOVERY_POINT_OBJECT_SOURCE_SHA256"; bytes="$RECOVERY_POINT_OBJECT_SOURCE_BYTES"; actual64='-'
      if [[ -n "$RECOVERY_POINT_OBJECT_SOURCE_OBSERVED_VERSION_ID" ]]; then actual64="$(printf '%s' "$RECOVERY_POINT_OBJECT_SOURCE_OBSERVED_VERSION_ID" | base64)" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }; actual64="${actual64//$'\n'/}"; fi
      list="$root/.bundle-list.$RANDOM"
      remote_write_attempted=true
          recovery_point_rclone_copy_check "$rclone" "$rclone_config" "$root" "$dest" "$remote" "$list" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$out" "$root/$dest" "$list"; return 1; }
      recovery_point_file_object_bundle_cleanup "$out"
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$identity" "$size" "$dest" "$content" "$bytes" "$actual64" >>"$unique" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
      RECOVERY_POINT_FILE_OBJECT_BUNDLE_UNIQUE_OBJECT_COUNT=$((RECOVERY_POINT_FILE_OBJECT_BUNDLE_UNIQUE_OBJECT_COUNT+1))
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$line" "$dest" "$identity" "$content" "$bytes" "$actual64" | jq -Rc 'split("\t") as $p|($p[0]|@base64d|fromjson)+{destinationObjectPath:$p[1],identitySha256:$p[2],sourceContentSha256:$p[3],sourceContentBytes:($p[4]|tonumber),capturedObjectVersionId:(if $p[5]=="-" then null else $p[5]|@base64d end)}' >>"$record" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
  done <"$rows"
  final="$root/metadata/reference-content-manifest.json"; final_hash="$root/metadata/reference-content-manifest.sha256"
  content_tmp="$(mktemp "$root/.bundle-content.XXXXXX")" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
  recovery_point_file_object_bundle_remember "$content_tmp" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record"; return 1; }
  hash_tmp="$(mktemp "$root/.bundle-content-sha.XXXXXX")" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp"; return 1; }
  recovery_point_file_object_bundle_remember "$hash_tmp" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp"; return 1; }
  chmod 0600 "$content_tmp" "$hash_tmp" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp" "$hash_tmp"; return 1; }
  jq -scS . "$record" >"$content_tmp" 2>/dev/null || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp" "$hash_tmp"; return 1; }
  RECOVERY_POINT_FILE_OBJECT_BUNDLE_CONTENT_MANIFEST_SHA256="$(recovery_point_file_manifest_sha256 "$content_tmp")" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp" "$hash_tmp"; return 1; }
  printf '%s\n' "$RECOVERY_POINT_FILE_OBJECT_BUNDLE_CONTENT_MANIFEST_SHA256" >"$hash_tmp" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp" "$hash_tmp"; return 1; }
  ln "$content_tmp" "$final" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp" "$hash_tmp"; return 1; }
  recovery_point_file_object_bundle_remember "$final" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp" "$hash_tmp"; return 1; }
  ln "$hash_tmp" "$final_hash" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp" "$hash_tmp"; return 1; }
  recovery_point_file_object_bundle_remember "$final_hash" || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp" "$hash_tmp"; return 1; }
  [[ -f "$final" && ! -L "$final" && "$(recovery_point_file_manifest_mode "$final")" == 600 && -f "$final_hash" && ! -L "$final_hash" && "$(recovery_point_file_manifest_mode "$final_hash")" == 600 ]] || { recovery_point_file_object_bundle_abort "$root" "$rows" "$unique" "$record" "$content_tmp" "$hash_tmp"; return 1; }
  recovery_point_file_object_bundle_cleanup "$content_tmp" "$hash_tmp" "$rows" "$unique" "$record"
  list="$root/.bundle-list.$RANDOM"
  remote_write_attempted=true
      if ! recovery_point_rclone_copy_check "$rclone" "$rclone_config" "$root" 'metadata/reference-content-manifest.json' "$remote" "$list" || ! recovery_point_rclone_copy_check "$rclone" "$rclone_config" "$root" 'metadata/reference-content-manifest.sha256' "$remote" "$list"; then

    recovery_point_file_object_bundle_abort "$root" "$list"
    return 1
  fi
  RECOVERY_POINT_FILE_OBJECT_BUNDLE_REMOTE_ROOT="$remote"; RECOVERY_POINT_FILE_OBJECT_BUNDLE_MANIFEST_PASS=true; RECOVERY_POINT_FILE_OBJECT_BUNDLE_CONTENT_PASS=true
}
