#!/usr/bin/env bash
# Normalizes the private PostgreSQL File export used by recovery-point capture.
# Usage: recovery_point_file_manifest_normalize INPUT_JSON EXPECTED_BUCKET PRIVATE_DIRECTORY
# Successful calls create PRIVATE_DIRECTORY/file-manifest.json and file-manifest.sha256.

recovery_point_file_manifest_error() {
  printf 'ERROR: recovery-point file manifest %s\n' "$1" >&2
  return 1
}

recovery_point_file_manifest_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null
}

recovery_point_file_manifest_private_directory() {
  local directory="$1" mode
  [[ -n "$directory" && -d "$directory" && ! -L "$directory" ]] || {
    recovery_point_file_manifest_error 'directory is unavailable'
    return 1
  }
  mode="$(recovery_point_file_manifest_mode "$directory")" || {
    recovery_point_file_manifest_error 'directory mode is unavailable'
    return 1
  }
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#077) == 0 )) || {
    recovery_point_file_manifest_error 'directory must be private'
    return 1
  }
}

recovery_point_file_manifest_sha256() {
  local file="$1" digest
  if command -v sha256sum >/dev/null 2>&1; then
    digest="$(sha256sum "$file" 2>/dev/null | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    digest="$(shasum -a 256 "$file" 2>/dev/null | awk '{print $1}')"
  else
    recovery_point_file_manifest_error 'requires SHA-256 utility'
    return 1
  fi
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || {
    recovery_point_file_manifest_error 'SHA-256 computation failed'
    return 1
  }
  printf '%s\n' "$digest"
}

recovery_point_file_manifest_validate() {
  local input="$1" expected_bucket="$2"
  command -v jq >/dev/null 2>&1 || {
    recovery_point_file_manifest_error 'requires jq'
    return 1
  }
  [[ -f "$input" && ! -L "$input" && -r "$input" ]] || {
    recovery_point_file_manifest_error 'input is unavailable'
    return 1
  }
  [[ -n "$expected_bucket" && "$expected_bucket" != *$'\n'* && "$expected_bucket" != *$'\r'* ]] || {
    recovery_point_file_manifest_error 'expected bucket is invalid'
    return 1
  }
  jq -e --arg expected_bucket "$expected_bucket" '
    def nonempty_string: type == "string" and length > 0;
    type == "array"
    and all(.[];
      type == "object"
      and has("id") and has("tenantId") and has("bucket") and has("objectKey")
      and has("objectVersionId") and has("size") and has("checksum")
      and (.id | nonempty_string)
      and (.tenantId | nonempty_string)
      and (.bucket | nonempty_string)
      and (.bucket == $expected_bucket)
      and (.objectKey | nonempty_string)
      and (.objectVersionId == null or (.objectVersionId | nonempty_string))
      and (.size | type == "number" and floor == . and . >= 0)
      and (.checksum == null or (.checksum | type == "string"))
    )
    and (. as $files | ([ $files[].id ] | unique | length) == ($files | length))
  ' "$input" >/dev/null 2>&1 || {
    recovery_point_file_manifest_error 'input is invalid'
    return 1
  }
}

recovery_point_file_manifest_normalize() {
  local input expected_bucket directory manifest hash temporary_manifest temporary_hash
  [[ "$#" -eq 3 ]] || {
    recovery_point_file_manifest_error 'requires input, expected bucket, and private directory'
    return 1
  }
  input="$1"
  expected_bucket="$2"
  directory="$3"
  manifest="$directory/file-manifest.json"
  hash="$directory/file-manifest.sha256"

  recovery_point_file_manifest_private_directory "$directory" || return 1
  recovery_point_file_manifest_validate "$input" "$expected_bucket" || return 1
  [[ ! -e "$manifest" && ! -L "$manifest" && ! -e "$hash" && ! -L "$hash" ]] || {
    recovery_point_file_manifest_error 'output already exists or is a symlink'
    return 1
  }
  temporary_manifest="$(mktemp "$directory/.file-manifest.json.XXXXXX")" || {
    recovery_point_file_manifest_error 'unable to create temporary manifest'
    return 1
  }
  temporary_hash="$(mktemp "$directory/.file-manifest.sha256.XXXXXX")" || {
    rm -f "$temporary_manifest"
    recovery_point_file_manifest_error 'unable to create temporary SHA-256'
    return 1
  }
  chmod 0600 "$temporary_manifest" "$temporary_hash" || {
    rm -f "$temporary_manifest" "$temporary_hash"
    recovery_point_file_manifest_error 'unable to protect temporary output'
    return 1
  }
  jq -cS '
    sort_by(.id)
    | map({
        id: .id,
        tenantId: .tenantId,
        bucket: .bucket,
        objectKey: .objectKey,
        objectVersionId: .objectVersionId,
        size: .size,
        checksum: .checksum
      })
  ' "$input" > "$temporary_manifest" 2>/dev/null || {
    rm -f "$temporary_manifest" "$temporary_hash"
    recovery_point_file_manifest_error 'canonicalization failed'
    return 1
  }
  recovery_point_file_manifest_sha256 "$temporary_manifest" > "$temporary_hash" || {
    rm -f "$temporary_manifest" "$temporary_hash"
    recovery_point_file_manifest_error 'unable to write SHA-256'
    return 1
  }
  [[ ! -e "$manifest" && ! -L "$manifest" && ! -e "$hash" && ! -L "$hash" ]] || {
    rm -f "$temporary_manifest" "$temporary_hash"
    recovery_point_file_manifest_error 'output already exists or is a symlink'
    return 1
  }
  ln "$temporary_manifest" "$manifest" 2>/dev/null || {
    rm -f "$temporary_manifest" "$temporary_hash"
    recovery_point_file_manifest_error 'unable to publish manifest without replacement'
    return 1
  }
  if ! ln "$temporary_hash" "$hash" 2>/dev/null; then
    cmp -s "$temporary_manifest" "$manifest" && rm -f "$manifest"
    rm -f "$temporary_manifest" "$temporary_hash"
    recovery_point_file_manifest_error 'unable to publish SHA-256; partial manifest removed'
    return 1
  fi
  rm -f "$temporary_manifest" "$temporary_hash"
}
