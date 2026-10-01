#!/usr/bin/env bash
set -Eeuo pipefail

readonly MANIFEST_PATH='/usr/local/libexec/buildingos-backup-preflight/manifest'

fail() {
  printf 'IDENTITY_STATUS=FAIL\n' >&2
  exit 1
}

emit_identity() {
  local manifest_path="$1"
  local line key value
  local manifest_version='' tooling_source_sha='' release_sha256=''
  local seen_manifest_version=0 seen_tooling_source_sha=0 seen_release_sha256=0

  [[ -f "$manifest_path" && ! -L "$manifest_path" && -r "$manifest_path" ]] || fail

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" != *$'\r'* ]] || fail
    [[ -z "$line" || "$line" == *=* ]] || fail
    [[ -n "$line" ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      manifest_version)
        (( seen_manifest_version == 0 )) || fail
        seen_manifest_version=1
        manifest_version="$value"
        ;;
      tooling_source_sha)
        (( seen_tooling_source_sha == 0 )) || fail
        seen_tooling_source_sha=1
        tooling_source_sha="$value"
        ;;
      release_sha256)
        (( seen_release_sha256 == 0 )) || fail
        seen_release_sha256=1
        release_sha256="$value"
        ;;
      *) ;;
    esac
  done < "$manifest_path" 2>/dev/null

  (( seen_manifest_version == 1 && seen_tooling_source_sha == 1 && seen_release_sha256 == 1 )) || fail
  [[ "$manifest_version" == 1 ]] || fail
  [[ "$tooling_source_sha" =~ ^[0-9a-f]{40}$ ]] || fail
  [[ "$release_sha256" =~ ^[0-9a-f]{64}$ ]] || fail

  printf 'PRODUCTION_BACKUP_TOOLING_IDENTITY\n'
  printf 'MANIFEST_VERSION=%s\n' "$manifest_version"
  printf 'TOOLING_SOURCE_SHA=%s\n' "$tooling_source_sha"
  printf 'RELEASE_SHA256=%s\n' "$release_sha256"
  printf 'MANIFEST_REGULAR_FILE=YES\n'
  printf 'MANIFEST_SYMLINK=NO\n'
  printf 'PRODUCTION_WRITES=0\n'
  printf 'BACKUP_STARTED=NO\n'
  printf 'IDENTITY_STATUS=PASS\n'
}

validate_identity() {
  local -a lines=()
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    lines+=("$line")
  done

  (( ${#lines[@]} == 9 )) || fail
  [[ "${lines[0]}" == 'PRODUCTION_BACKUP_TOOLING_IDENTITY' ]] || fail
  [[ "${lines[1]}" == 'MANIFEST_VERSION=1' ]] || fail
  [[ "${lines[2]}" =~ ^TOOLING_SOURCE_SHA=([0-9a-f]{40})$ ]] || fail
  [[ "${lines[3]}" =~ ^RELEASE_SHA256=([0-9a-f]{64})$ ]] || fail
  [[ "${lines[4]}" == 'MANIFEST_REGULAR_FILE=YES' ]] || fail
  [[ "${lines[5]}" == 'MANIFEST_SYMLINK=NO' ]] || fail
  [[ "${lines[6]}" == 'PRODUCTION_WRITES=0' ]] || fail
  [[ "${lines[7]}" == 'BACKUP_STARTED=NO' ]] || fail
  [[ "${lines[8]}" == 'IDENTITY_STATUS=PASS' ]] || fail
  printf '%s\n' "${lines[@]}"
}

case "${1:-}" in
  --remote-identity)
    [[ "$#" -eq 1 ]] || fail
    emit_identity "$MANIFEST_PATH"
    ;;
  --test-fixture-identity)
    [[ "$#" -eq 2 ]] || fail
    emit_identity "$2"
    ;;
  --validate-identity)
    [[ "$#" -eq 1 ]] || fail
    validate_identity
    ;;
  *) fail ;;
esac
