#!/usr/bin/env bash
# Creates one locally durable, independently verified recovery point.
# Usage: recovery_point_capture_create POSTGRES_CONTAINER DATABASE_NAME POSTGRES_USER API_IMAGE API_ENV_FILE DOCKER_NETWORK SOURCE_BUCKET RCLONE_BIN RCLONE_CONFIG UNIQUE_REMOTE_ROOT PRIVATE_ROOT EXPECTED_APP_SHA BACKUP_SET_ID

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-point-portable-stat.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-point-postgres-snapshot.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-point-file-manifest.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-point-file-object-bundle.sh"

recovery_point_capture_error() {
  if [[ "${recovery_point_capture_remote_started:-false}" == true ]]; then
    recovery_point_capture_remote_incomplete
  else
    printf 'ERROR: recovery-point capture failed\n' >&2
  fi
  return 1
}
recovery_point_capture_remote_incomplete() { printf 'ERROR: recovery bundle remote unique namespace is incomplete; remote residue may remain; operator cleanup is required; do not retry into it\n' >&2; return 1; }
recovery_point_capture_inode() { stat -f '%d:%i' "$1" 2>/dev/null || stat -c '%d:%i' "$1" 2>/dev/null; }
recovery_point_capture_mode() { recovery_point_portable_stat_mode "$1"; }
recovery_point_capture_reset() {
  RECOVERY_POINT_VALID=''; RECOVERY_POINT_CAPTURE_BACKUP_SET_ID=''; RECOVERY_POINT_CAPTURE_RECEIPT_SHA256=''
  RECOVERY_POINT_FILE_OBJECT_BUNDLE_MANIFEST_PASS=false; RECOVERY_POINT_FILE_OBJECT_BUNDLE_CONTENT_PASS=false
}
recovery_point_capture_remember() {
  local path="$1" inode
  [[ -e "$path" && ! -L "$path" ]] || return 1
  inode="$(recovery_point_capture_inode "$path")" || return 1
  recovery_point_capture_owned_paths+=("$path"); recovery_point_capture_owned_inodes+=("$inode")
}
recovery_point_capture_remove_owned() {
  local path="$1" index current
  for ((index=0; index<${#recovery_point_capture_owned_paths[@]}; index++)); do
    [[ "${recovery_point_capture_owned_paths[index]}" == "$path" ]] || continue
    current="$(recovery_point_capture_inode "$path")" || return 0
    [[ "$current" == "${recovery_point_capture_owned_inodes[index]}" ]] || return 0
    if [[ -d "$path" && ! -L "$path" ]]; then rmdir -- "$path" 2>/dev/null || true
    elif [[ -f "$path" && ! -L "$path" ]]; then rm -f -- "$path" 2>/dev/null || true; fi
    return 0
  done
}
recovery_point_capture_cleanup() {
  local index
  for ((index=${#recovery_point_capture_owned_paths[@]}-1; index>=0; index--)); do recovery_point_capture_remove_owned "${recovery_point_capture_owned_paths[index]}"; done
}
recovery_point_capture_abort() {
  recovery_point_capture_cleanup
  recovery_point_capture_reset
  if [[ "${recovery_point_capture_remote_started:-false}" == true ]]; then recovery_point_capture_remote_incomplete || true; else recovery_point_capture_error || true; fi
  return 1
}
recovery_point_capture_private_empty_root() {
  local root="$1"
  [[ -d "$root" && ! -L "$root" && "$(recovery_point_capture_mode "$root")" == 700 ]] || return 1
  [[ -z "$(find "$root" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]
}
recovery_point_capture_hash_pair() {
  local file="$1" sidecar="$2" actual expected
  [[ -f "$file" && ! -L "$file" && "$(recovery_point_capture_mode "$file")" == 600 && -f "$sidecar" && ! -L "$sidecar" && "$(recovery_point_capture_mode "$sidecar")" == 600 ]] || return 1
  actual="$(recovery_point_file_manifest_sha256 "$file")" || return 1; expected="$(< "$sidecar")"
  [[ "$expected" =~ ^[0-9a-f]{64}$ && "$actual" == "$expected" ]]
}
recovery_point_capture_content_valid() {
  local manifest="$1" content="$2" references="$3" unique="$4"
  jq -ne --slurpfile manifest "$manifest" --slurpfile content "$content" --argjson references "$references" --argjson unique "$unique" '
    ($manifest[0] as $m | $content[0] as $c
      | ($c | type == "array" and length == $references)
      and ($m | type == "array" and length == $references)
      and all($m[]; . as $row | [$c[] | select(.id == $row.id)] as $matches
        | ($matches | length == 1)
        and ($matches[0] | {id,tenantId,bucket,objectKey,objectVersionId,size,checksum}) == ($row | {id,tenantId,bucket,objectKey,objectVersionId,size,checksum}))
      and ([ $c[].identitySha256 ] | unique | length == $unique)
      and all($c[]; (.identitySha256|type == "string" and test("^[0-9a-f]{64}$")) and (.sourceContentSha256|type == "string" and test("^[0-9a-f]{64}$")) and (.sourceContentBytes|type == "number" and floor == . and . >= 0) and .destinationObjectPath == ("objects/" + .identitySha256 + ".blob")))
  ' >/dev/null 2>&1
}
recovery_point_capture_create() {
  local container database user image env network bucket rclone config remote root app_sha backup started completed
  local dump manifest manifest_hash content content_hash receipt receipt_hash dump_hash source_dump_hash dump_bytes references unique list receipt_tmp hash_tmp
  local recovery_point_capture_remote_started=false
  local -a recovery_point_capture_owned_paths=() recovery_point_capture_owned_inodes=()
  recovery_point_capture_reset
  [[ "$#" -eq 13 ]] || { recovery_point_capture_error; return 1; }
  container="$1"; database="$2"; user="$3"; image="$4"; env="$5"; network="$6"; bucket="$7"; rclone="$8"; config="$9"; remote="${10}"; root="${11}"; app_sha="${12}"; backup="${13}"
  [[ "$app_sha" =~ ^[0-9a-f]{40}$ && "$backup" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]] || { recovery_point_capture_error; return 1; }
  recovery_point_capture_private_empty_root "$root" && command -v jq >/dev/null 2>&1 && command -v date >/dev/null 2>&1 || { recovery_point_capture_error; return 1; }
  recovery_point_postgres_snapshot_require_runtime "$container" && recovery_point_rclone_require_download_check "$rclone" "$config" || { recovery_point_capture_error; return 1; }
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)" || { recovery_point_capture_error; return 1; }
  if ! recovery_point_postgres_snapshot_capture "$container" "$database" "$user" "$root"; then recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; fi
  for receipt in "$root/postgres.dump" "$root/file-rows.json"; do recovery_point_capture_remember "$receipt" || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }; done
  if ! recovery_point_file_manifest_normalize "$root/file-rows.json" "$bucket" "$root"; then recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; fi
  manifest="$root/file-manifest.json"; manifest_hash="$root/file-manifest.sha256"
  for receipt in "$manifest" "$manifest_hash"; do recovery_point_capture_remember "$receipt" || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }; done
  if ! recovery_point_file_object_bundle_capture "$manifest" "$manifest_hash" "$image" "$env" "$network" "$bucket" "$rclone" "$config" "$remote" "$root"; then recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; fi
  recovery_point_capture_remote_started=true
  for receipt in "$root/objects" "$root/metadata" "$root/metadata/reference-content-manifest.json" "$root/metadata/reference-content-manifest.sha256"; do recovery_point_capture_remember "$receipt" || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }; done
  content="$root/metadata/reference-content-manifest.json"; content_hash="$root/metadata/reference-content-manifest.sha256"
  references="$(jq 'length' "$manifest" 2>/dev/null)"; unique="$RECOVERY_POINT_FILE_OBJECT_BUNDLE_UNIQUE_OBJECT_COUNT"
  [[ "$references" =~ ^[0-9]+$ && "$unique" =~ ^[0-9]+$ && "$RECOVERY_POINT_FILE_OBJECT_BUNDLE_REFERENCE_COUNT" == "$references" && "$RECOVERY_POINT_FILE_OBJECT_BUNDLE_REMOTE_ROOT" == "$remote" && "$RECOVERY_POINT_FILE_OBJECT_BUNDLE_MANIFEST_PASS" == true && "$RECOVERY_POINT_FILE_OBJECT_BUNDLE_CONTENT_PASS" == true ]] && recovery_point_file_manifest_validate "$manifest" "$bucket" >/dev/null 2>&1 && recovery_point_capture_hash_pair "$manifest" "$manifest_hash" && recovery_point_capture_hash_pair "$content" "$content_hash" && recovery_point_capture_content_valid "$manifest" "$content" "$references" "$unique" || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }
  mkdir -m 0700 "$root/postgresql" && recovery_point_capture_remember "$root/postgresql" || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }
  dump="$root/postgresql/buildingos_${backup}.dump"; [[ ! -e "$dump" && ! -L "$dump" ]] && { ln "$root/postgres.dump" "$dump" 2>/dev/null || cp -p "$root/postgres.dump" "$dump"; } && chmod 0600 "$dump" && recovery_point_capture_remember "$dump" || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }
  timeout 6h docker exec -i "$container" pg_restore --list <"$dump" >/dev/null 2>&1 || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }
  dump_hash="$(recovery_point_file_manifest_sha256 "$dump")"; source_dump_hash="$(recovery_point_file_manifest_sha256 "$root/postgres.dump")"; dump_bytes="$(wc -c <"$dump")"; dump_bytes="${dump_bytes//[[:space:]]/}"; [[ "$dump_hash" =~ ^[0-9a-f]{64}$ && "$dump_hash" == "$source_dump_hash" && "$dump_bytes" =~ ^[0-9]+$ ]] || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }
  list="$root/.recovery-point-dump-list.$$"; if ! recovery_point_rclone_copy_check "$rclone" "$config" "$root" "postgresql/buildingos_${backup}.dump" "$remote" "$list"; then recovery_point_capture_remote_incomplete || true; recovery_point_capture_cleanup; recovery_point_capture_reset; return 1; fi
  completed="$(date -u +%Y-%m-%dT%H:%M:%SZ)" || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }
  receipt="$root/metadata/recovery-point-receipt.json"; receipt_hash="$root/metadata/recovery-point-receipt.sha256"; receipt_tmp="$(mktemp "$root/.recovery-point-receipt.XXXXXX")" || { recovery_point_capture_abort; return 1; }; recovery_point_capture_remember "$receipt_tmp" || { recovery_point_capture_abort; return 1; }
  hash_tmp="$(mktemp "$root/.recovery-point-receipt-sha.XXXXXX")" || { recovery_point_capture_abort; return 1; }; recovery_point_capture_remember "$hash_tmp" || { recovery_point_capture_abort; return 1; }
  chmod 0600 "$receipt_tmp" "$hash_tmp" && jq -cnS --arg app "$app_sha" --arg backup "$backup" --arg started "$started" --arg completed "$completed" --arg input "$(<"$manifest_hash")" --arg content "$(<"$content_hash")" --arg dump "$dump_hash" --argjson bytes "$dump_bytes" --argjson references "$references" --argjson unique "$unique" --arg remote "$remote" '{format:"buildingos-recovery-point/v1",status:"PASS",sourceAppSha:$app,backupSetId:$backup,startedAtUtc:$started,completedAtUtc:$completed,inputManifestSha256:$input,contentManifestSha256:$content,databaseDump:{sha256:$dump,bytes:$bytes},referenceCount:$references,uniqueObjectCount:$unique,remoteRoot:$remote,statuses:{databaseArchive:"PASS",referenceCount:"PASS",contentIdentity:"PASS",remoteDump:"PASS",inputManifest:"PASS",contentManifest:"PASS",hashes:"PASS"}}' >"$receipt_tmp" && recovery_point_file_manifest_sha256 "$receipt_tmp" >"$hash_tmp" && ln "$receipt_tmp" "$receipt" && recovery_point_capture_remember "$receipt" && ln "$hash_tmp" "$receipt_hash" && recovery_point_capture_remember "$receipt_hash" && recovery_point_capture_hash_pair "$receipt" "$receipt_hash" || { recovery_point_capture_cleanup; recovery_point_capture_reset; recovery_point_capture_error; return 1; }
  recovery_point_capture_remove_owned "$receipt_tmp"; recovery_point_capture_remove_owned "$hash_tmp"
  list="$root/.recovery-point-receipt-list.$$"; if ! recovery_point_rclone_copy_check "$rclone" "$config" "$root" 'metadata/recovery-point-receipt.json' "$remote" "$list" || ! recovery_point_rclone_copy_check "$rclone" "$config" "$root" 'metadata/recovery-point-receipt.sha256' "$remote" "$list"; then recovery_point_capture_remote_incomplete || true; recovery_point_capture_cleanup; recovery_point_capture_reset; return 1; fi
  RECOVERY_POINT_CAPTURE_BACKUP_SET_ID="$backup"; RECOVERY_POINT_CAPTURE_RECEIPT_SHA256="$(<"$receipt_hash")"; RECOVERY_POINT_VALID=PASS
}
