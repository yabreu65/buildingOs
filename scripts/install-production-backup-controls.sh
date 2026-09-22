#!/usr/bin/env bash
# Installs one verified, local source release of the independent backup controls.
set -Eeuo pipefail
set +x

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
PATH="$SAFE_PATH"
export PATH
readonly MANIFEST_VERSION=1
readonly RELEASE_DIR='/usr/local/libexec/buildingos-backup-preflight'
readonly OBJECT_EXEC_DIR='/usr/local/libexec/buildingos-backup'
readonly LAUNCHER_PATH='/usr/local/sbin/buildingos-production-backup-preflight'
readonly CONTROL_PATH="$RELEASE_DIR/production-backup-preflight.sh"
readonly HELPER_PATH="$RELEASE_DIR/lib/endpoint-identity.sh"
readonly OBJECT_EXEC_PATH="$OBJECT_EXEC_DIR/backup-object-storage.sh"
readonly MANIFEST_PATH="$RELEASE_DIR/manifest"
readonly SUDOERS_PATH='/etc/sudoers.d/buildingos-production-backup-preflight'
readonly OBJECT_SERVICE_PATH='/etc/systemd/system/pawtech-buildingos-object-backup.service'
readonly OBJECT_TIMER_PATH='/etc/systemd/system/pawtech-buildingos-object-backup.timer'
readonly ROLLBACK_ROOT='/var/lib/buildingos-backup-preflight/rollback'
readonly LEGACY_LAUNCHER_SHA256='0d7fe3ecf70eab0954f92d92dc00bf9a17b7ee24fd704dadef1bece887d14789'
readonly LEGACY_CONTROL_SHA256='54ec38c730f727a626510abd5b905eff2744d51c70a98682ada882183bb4ae70'
readonly LEGACY_HELPER_SHA256='e7799f2c7e6adcdcc38625ce3af99dd41bdea61a27a3c886f03efa8e6720f341'

SOURCE_ROOT=''
DEST_ROOT=''
TOOLING_SOURCE_SHA=''
ACTION='check'
ROLLBACK_SNAPSHOT=''
TEST_MODE=''
TEST_FAIL_AFTER_PUBLISH=false
TEST_FAIL_AFTER_PREPARE_DESTINATION=false
TEST_FAIL_DURING_STAGE_RELEASE=false
TEST_FORCE_CROSS_DEVICE=false
SNAPSHOT=''
EXISTING_LAYOUT=''
TRANSACTION_ACTIVE=false
ROLLBACK_IN_PROGRESS=false
STAGED_LAUNCHER=''
STAGED_CONTROL=''
STAGED_HELPER=''
STAGED_OBJECT_EXEC=''
STAGED_MANIFEST=''
STAGED_SUDOERS=''
STAGED_OBJECT_SERVICE=''
STAGED_OBJECT_TIMER=''
STAGED_ROLLBACK=''
EXPECTED_UID='0'
EXPECTED_GID='0'

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

staged_path() {
  case "$1" in
    launcher) printf '%s\n' "$STAGED_LAUNCHER" ;;
    control) printf '%s\n' "$STAGED_CONTROL" ;;
    helper) printf '%s\n' "$STAGED_HELPER" ;;
    object_exec) printf '%s\n' "$STAGED_OBJECT_EXEC" ;;
    manifest) printf '%s\n' "$STAGED_MANIFEST" ;;
    sudoers) printf '%s\n' "$STAGED_SUDOERS" ;;
    object_service) printf '%s\n' "$STAGED_OBJECT_SERVICE" ;;
    object_timer) printf '%s\n' "$STAGED_OBJECT_TIMER" ;;
    rollback) printf '%s\n' "$STAGED_ROLLBACK" ;;
    *) fail "unknown staged file: $1" ;;
  esac
}

set_staged_path() {
  case "$1" in
    launcher) STAGED_LAUNCHER="$2" ;;
    control) STAGED_CONTROL="$2" ;;
    helper) STAGED_HELPER="$2" ;;
    object_exec) STAGED_OBJECT_EXEC="$2" ;;
    manifest) STAGED_MANIFEST="$2" ;;
    sudoers) STAGED_SUDOERS="$2" ;;
    object_service) STAGED_OBJECT_SERVICE="$2" ;;
    object_timer) STAGED_OBJECT_TIMER="$2" ;;
    rollback) STAGED_ROLLBACK="$2" ;;
    *) fail "unknown staged file: $1" ;;
  esac
}

clear_staged_path() {
  set_staged_path "$1" ''
}

usage() {
  printf '%s\n' "Usage: ${0##*/} --source-root <path> --dest-root <path> --tooling-source-sha <sha> [--check|--apply] [--test-mode local-unprivileged]"
  printf '%s\n' "       ${0##*/} --dest-root <path> --rollback <snapshot> --apply [--test-mode local-unprivileged]"
}

cleanup() {
  local status=$? staged
  for staged in "$STAGED_LAUNCHER" "$STAGED_CONTROL" "$STAGED_HELPER" "$STAGED_OBJECT_EXEC" "$STAGED_MANIFEST" "$STAGED_SUDOERS" "$STAGED_OBJECT_SERVICE" "$STAGED_OBJECT_TIMER" "$STAGED_ROLLBACK"; do
    [[ -z "$staged" || (! -e "$staged" && ! -L "$staged") ]] || rm -f -- "$staged"
  done
  if [[ "$status" -ne 0 && "$TRANSACTION_ACTIVE" == true && "$ROLLBACK_IN_PROGRESS" == false ]]; then
    ROLLBACK_IN_PROGRESS=true
    if ! restore_snapshot; then
      printf 'ERROR: automatic rollback failed; manual rollback is required\n' >&2
      status=1
    fi
    ROLLBACK_IN_PROGRESS=false
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | awk '{print $1}'
  else
    shasum -a 256 -- "$1" | awk '{print $1}'
  fi
}

sha256_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

file_metadata() {
  stat -c '%u:%g:%a' -- "$1" 2>/dev/null || stat -f '%u:%g:%Lp' -- "$1"
}

filesystem_device() {
  stat -c '%d' -- "$1" 2>/dev/null || stat -f '%d' -- "$1"
}

assert_same_filesystem() {
  local staged="$1" target_parent="$2"
  [[ "$TEST_FORCE_CROSS_DEVICE" == false ]] || fail 'cross-filesystem publication is not allowed'
  [[ "$(filesystem_device "$staged")" == "$(filesystem_device "$target_parent")" ]] || fail 'cross-filesystem publication is not allowed'
}

assert_not_symlink_path() {
  local path="$1" relative component current
  [[ "$path" == "$DEST_ROOT" || "$path" == "$DEST_ROOT"/* ]] || fail 'destination path escapes dest root'
  [[ ! -L "$DEST_ROOT" ]] || fail "symlink destination component is not allowed: $DEST_ROOT"
  relative="${path#"$DEST_ROOT"}"
  relative="${relative#/}"
  current="$DEST_ROOT"
  while [[ -n "$relative" ]]; do
    component="${relative%%/*}"
    relative="${relative#*/}"
    [[ "$component" == "$relative" ]] && relative=''
    [[ -n "$component" ]] || continue
    current="$current/$component"
    [[ ! -L "$current" ]] || fail "symlink destination component is not allowed: $current"
  done
}

assert_source_path_has_no_symlinks() {
  local path="$1" relative component current
  [[ "$path" == "$SOURCE_ROOT"/* ]] || fail 'source path escapes source root'
  [[ ! -L "$SOURCE_ROOT" ]] || fail 'source root must not be a symlink'
  relative="${path#"$SOURCE_ROOT"/}"
  current="$SOURCE_ROOT"
  while [[ -n "$relative" ]]; do
    component="${relative%%/*}"
    relative="${relative#*/}"
    [[ "$component" == "$relative" ]] && relative=''
    current="$current/$component"
    [[ ! -L "$current" ]] || fail "source path contains a symlink component: $current"
  done
}

assert_regular_file() {
  local path="$1" label="$2"
  [[ -f "$path" && ! -L "$path" ]] || fail "$label must be a regular non-symlink file"
}

assert_safe_source_file() {
  local path="$1" label="$2" metadata mode
  assert_regular_file "$path" "$label"
  metadata="$(file_metadata "$path")"
  mode="${metadata##*:}"
  (( (8#$mode & 0022) == 0 )) || fail "$label source mode is writable by group or world"
}

set_file_policy() {
  local path="$1" mode="$2"
  chmod "$mode" "$path"
  chown "$EXPECTED_UID:$EXPECTED_GID" "$path"
}

assert_file_policy() {
  local path="$1" mode="$2" label="$3"
  assert_regular_file "$path" "$label"
  [[ "$(file_metadata "$path")" == "$EXPECTED_UID:$EXPECTED_GID:$mode" ]] || fail "unsafe $label owner or mode"
}

assert_dir_policy() {
  local path="$1" label="$2"
  [[ -d "$path" && ! -L "$path" ]] || fail "$label must be a directory, not a symlink"
  [[ "$(file_metadata "$path")" == "$EXPECTED_UID:$EXPECTED_GID:755" ]] || fail "unsafe $label owner or mode"
}

assert_sha256() {
  local path="$1" expected="$2" label="$3"
  [[ "$(sha256_file "$path")" == "$expected" ]] || fail "$label bytes do not match the audited legacy release"
}

source_path() {
  printf '%s/%s\n' "$SOURCE_ROOT" "$1"
}

destination_path() {
  printf '%s%s\n' "$DEST_ROOT" "$1"
}

release_payload() {
  local tooling_source_sha="$1" launcher_hash="$2" control_hash="$3" helper_hash="$4" object_exec_hash="$5" sudoers_hash="$6" service_hash="$7" timer_hash="$8"
  printf 'manifest_version=%s\n' "$MANIFEST_VERSION"
  printf 'tooling_source_sha=%s\n' "$tooling_source_sha"
  printf 'launcher_path=%s\n' "$LAUNCHER_PATH"
  printf 'launcher_sha256=%s\n' "$launcher_hash"
  printf 'control_path=%s\n' "$CONTROL_PATH"
  printf 'control_sha256=%s\n' "$control_hash"
  printf 'helper_path=%s\n' "$HELPER_PATH"
  printf 'helper_sha256=%s\n' "$helper_hash"
  printf 'object_exec_path=%s\n' "$OBJECT_EXEC_PATH"
  printf 'object_exec_sha256=%s\n' "$object_exec_hash"
  printf 'sudoers_path=%s\n' "$SUDOERS_PATH"
  printf 'sudoers_sha256=%s\n' "$sudoers_hash"
  printf 'object_service_path=%s\n' "$OBJECT_SERVICE_PATH"
  printf 'object_service_sha256=%s\n' "$service_hash"
  printf 'object_timer_path=%s\n' "$OBJECT_TIMER_PATH"
  printf 'object_timer_sha256=%s\n' "$timer_hash"
}

write_manifest() {
  local manifest="$1" tooling_source_sha="$2" launcher="$3" control="$4" helper="$5" object_exec="$6" sudoers="$7" service="$8" timer="$9"
  local launcher_hash control_hash helper_hash object_exec_hash sudoers_hash service_hash timer_hash release_hash
  launcher_hash="$(sha256_file "$launcher")"
  control_hash="$(sha256_file "$control")"
  helper_hash="$(sha256_file "$helper")"
  object_exec_hash="$(sha256_file "$object_exec")"
  sudoers_hash="$(sha256_file "$sudoers")"
  service_hash="$(sha256_file "$service")"
  timer_hash="$(sha256_file "$timer")"
  release_hash="$(release_payload "$tooling_source_sha" "$launcher_hash" "$control_hash" "$helper_hash" "$object_exec_hash" "$sudoers_hash" "$service_hash" "$timer_hash" | sha256_text)"
  {
    release_payload "$tooling_source_sha" "$launcher_hash" "$control_hash" "$helper_hash" "$object_exec_hash" "$sudoers_hash" "$service_hash" "$timer_hash"
    printf 'release_sha256=%s\n' "$release_hash"
  } > "$manifest"
}

validate_manifest() {
  local manifest="$1" tooling_source_sha="$2" launcher="$3" control="$4" helper="$5" object_exec="$6" sudoers="$7" service="$8" timer="$9"
  local launcher_hash control_hash helper_hash object_exec_hash sudoers_hash service_hash timer_hash release_hash
  assert_regular_file "$manifest" 'manifest'
  launcher_hash="$(sha256_file "$launcher")"
  control_hash="$(sha256_file "$control")"
  helper_hash="$(sha256_file "$helper")"
  object_exec_hash="$(sha256_file "$object_exec")"
  sudoers_hash="$(sha256_file "$sudoers")"
  service_hash="$(sha256_file "$service")"
  timer_hash="$(sha256_file "$timer")"
  release_hash="$(release_payload "$tooling_source_sha" "$launcher_hash" "$control_hash" "$helper_hash" "$object_exec_hash" "$sudoers_hash" "$service_hash" "$timer_hash" | sha256_text)"
  if ! {
    release_payload "$tooling_source_sha" "$launcher_hash" "$control_hash" "$helper_hash" "$object_exec_hash" "$sudoers_hash" "$service_hash" "$timer_hash"
    printf 'release_sha256=%s\n' "$release_hash"
  } | cmp -s - "$manifest"; then
    fail 'manifest is missing, stale, malformed, or does not match installed artifacts'
  fi
}

validate_source() {
  local source_launcher source_control source_helper source_object_exec source_sudoers source_service source_timer source_head
  [[ -d "$SOURCE_ROOT" && ! -L "$SOURCE_ROOT" ]] || fail 'source root must be a directory, not a symlink'
  source_launcher="$(source_path infra/production/launchers/buildingos-production-backup-preflight)"
  source_control="$(source_path scripts/production-backup-preflight.sh)"
  source_helper="$(source_path scripts/lib/endpoint-identity.sh)"
  source_object_exec="$(source_path scripts/backup-object-storage.sh)"
  source_sudoers="$(source_path infra/production/sudoers/buildingos-production-backup-preflight)"
  source_service="$(source_path infra/production/systemd/pawtech-buildingos-object-backup.service)"
  source_timer="$(source_path infra/production/systemd/pawtech-buildingos-object-backup.timer)"
  for source in "$source_launcher" "$source_control" "$source_helper" "$source_object_exec" "$source_sudoers" "$source_service" "$source_timer"; do
    assert_source_path_has_no_symlinks "$source"
    assert_safe_source_file "$source" "source artifact $source"
  done
  sh -n "$source_launcher" || fail 'source launcher has invalid sh syntax'
  bash -n "$source_control" || fail 'source control has invalid bash syntax'
  bash -n "$source_helper" || fail 'source helper has invalid bash syntax'
  bash -n "$source_object_exec" || fail 'source Object Storage executable has invalid bash syntax'
  command -v git >/dev/null 2>&1 || fail 'git is required to validate tooling source SHA'
  source_head="$(git -c safe.directory="$SOURCE_ROOT" --no-optional-locks -C "$SOURCE_ROOT" rev-parse HEAD 2>/dev/null)" || fail 'source root does not resolve a Git HEAD with its exact safe.directory'
  [[ "$source_head" == "$TOOLING_SOURCE_SHA" ]] || fail 'tooling source SHA does not match source Git HEAD'
  [[ -z "$(git -c safe.directory="$SOURCE_ROOT" --no-optional-locks -C "$SOURCE_ROOT" status --porcelain --untracked-files=all 2>/dev/null)" ]] || fail 'source checkout must be clean with no tracked or untracked files'
  if command -v visudo >/dev/null 2>&1; then
    visudo -cf "$source_sudoers" >/dev/null || fail 'source sudoers policy fails visudo validation'
  fi
}

path_is_present() {
  [[ -e "$1" || -L "$1" ]]
}

validate_existing_layout() {
  local launcher control helper object_exec manifest sudoers service timer
  launcher="$(destination_path "$LAUNCHER_PATH")"
  control="$(destination_path "$CONTROL_PATH")"
  helper="$(destination_path "$HELPER_PATH")"
  object_exec="$(destination_path "$OBJECT_EXEC_PATH")"
  manifest="$(destination_path "$MANIFEST_PATH")"
  sudoers="$(destination_path "$SUDOERS_PATH")"
  service="$(destination_path "$OBJECT_SERVICE_PATH")"
  timer="$(destination_path "$OBJECT_TIMER_PATH")"

  if ! path_is_present "$launcher" && ! path_is_present "$control" && ! path_is_present "$helper" &&
    ! path_is_present "$object_exec" && ! path_is_present "$manifest" && ! path_is_present "$sudoers" &&
    ! path_is_present "$service" && ! path_is_present "$timer"; then
    EXISTING_LAYOUT='empty'
    return 0
  fi

  if path_is_present "$launcher" && path_is_present "$control" && path_is_present "$helper" &&
    ! path_is_present "$object_exec" && ! path_is_present "$manifest" && ! path_is_present "$sudoers" &&
    ! path_is_present "$service" && ! path_is_present "$timer"; then
    assert_file_policy "$launcher" 755 'legacy launcher'
    assert_file_policy "$control" 755 'legacy control'
    assert_file_policy "$helper" 644 'legacy helper'
    assert_sha256 "$launcher" "$LEGACY_LAUNCHER_SHA256" 'legacy launcher'
    assert_sha256 "$control" "$LEGACY_CONTROL_SHA256" 'legacy control'
    assert_sha256 "$helper" "$LEGACY_HELPER_SHA256" 'legacy helper'
    assert_dir_policy "$(destination_path "$RELEASE_DIR")" 'legacy control directory'
    assert_dir_policy "$(destination_path "$RELEASE_DIR/lib")" 'legacy control library directory'
    EXISTING_LAYOUT='legacy'
    return 0
  fi

  if path_is_present "$launcher" && path_is_present "$control" && path_is_present "$helper" &&
    path_is_present "$object_exec" && path_is_present "$manifest" && path_is_present "$sudoers" &&
    path_is_present "$service" && path_is_present "$timer"; then
    assert_file_policy "$launcher" 755 'installed launcher'
    assert_file_policy "$control" 755 'installed control'
    assert_file_policy "$helper" 644 'installed helper'
    assert_file_policy "$object_exec" 755 'installed Object Storage executable'
    assert_file_policy "$manifest" 644 'installed manifest'
    assert_file_policy "$sudoers" 440 'installed sudoers policy'
    assert_file_policy "$service" 644 'installed Object Storage service'
    assert_file_policy "$timer" 644 'installed Object Storage timer'
    assert_dir_policy "$(destination_path "$RELEASE_DIR")" 'installed control directory'
    assert_dir_policy "$(destination_path "$RELEASE_DIR/lib")" 'installed control library directory'
    assert_dir_policy "$(destination_path "$OBJECT_EXEC_DIR")" 'installed Object Storage executable directory'
    EXISTING_LAYOUT='canonical'
    return 0
  fi

  fail 'destination contains an unrecognized partial protected release'
}

validate_destination_readonly() {
  assert_not_symlink_path "$DEST_ROOT"
  for path in "$LAUNCHER_PATH" "$CONTROL_PATH" "$HELPER_PATH" "$OBJECT_EXEC_PATH" "$MANIFEST_PATH" "$SUDOERS_PATH" "$OBJECT_SERVICE_PATH" "$OBJECT_TIMER_PATH"; do
    assert_not_symlink_path "$(destination_path "$path")"
  done
  validate_existing_layout
}

validate_published_release() {
  local launcher control helper object_exec manifest sudoers service timer
  validate_existing_layout
  launcher="$(destination_path "$LAUNCHER_PATH")"
  control="$(destination_path "$CONTROL_PATH")"
  helper="$(destination_path "$HELPER_PATH")"
  object_exec="$(destination_path "$OBJECT_EXEC_PATH")"
  manifest="$(destination_path "$MANIFEST_PATH")"
  sudoers="$(destination_path "$SUDOERS_PATH")"
  service="$(destination_path "$OBJECT_SERVICE_PATH")"
  timer="$(destination_path "$OBJECT_TIMER_PATH")"
  validate_manifest "$manifest" "$TOOLING_SOURCE_SHA" "$launcher" "$control" "$helper" "$object_exec" "$sudoers" "$service" "$timer"
  if command -v visudo >/dev/null 2>&1; then
    visudo -cf "$sudoers" >/dev/null || fail 'installed sudoers policy fails visudo validation'
  fi
}

stage_file_in_target_directory() {
  local label="$1" source="$2" destination="$3" mode="$4" staged
  staged="$(mktemp "${destination%/*}/.${label}.XXXXXX")" || fail "unable to create staging file for $label"
  set_staged_path "$label" "$staged"
  assert_same_filesystem "$staged" "${destination%/*}"
  cp -- "$source" "$staged" || fail "unable to stage $label"
  set_file_policy "$staged" "$mode" || fail "unable to set staged $label policy"
  assert_file_policy "$staged" "$mode" "staged $label" || fail "staged $label policy validation failed"
}

stage_release() {
  local source_launcher source_control source_helper source_object_exec source_sudoers source_service source_timer
  source_launcher="$(source_path infra/production/launchers/buildingos-production-backup-preflight)"
  source_control="$(source_path scripts/production-backup-preflight.sh)"
  source_helper="$(source_path scripts/lib/endpoint-identity.sh)"
  source_object_exec="$(source_path scripts/backup-object-storage.sh)"
  source_sudoers="$(source_path infra/production/sudoers/buildingos-production-backup-preflight)"
  source_service="$(source_path infra/production/systemd/pawtech-buildingos-object-backup.service)"
  source_timer="$(source_path infra/production/systemd/pawtech-buildingos-object-backup.timer)"
  stage_file_in_target_directory launcher "$source_launcher" "$(destination_path "$LAUNCHER_PATH")" 755
  stage_file_in_target_directory control "$source_control" "$(destination_path "$CONTROL_PATH")" 755
  [[ "$TEST_FAIL_DURING_STAGE_RELEASE" == false ]] || fail 'injected stage release failure'
  stage_file_in_target_directory helper "$source_helper" "$(destination_path "$HELPER_PATH")" 644
  stage_file_in_target_directory object_exec "$source_object_exec" "$(destination_path "$OBJECT_EXEC_PATH")" 755
  stage_file_in_target_directory sudoers "$source_sudoers" "$(destination_path "$SUDOERS_PATH")" 440
  stage_file_in_target_directory object_service "$source_service" "$(destination_path "$OBJECT_SERVICE_PATH")" 644
  stage_file_in_target_directory object_timer "$source_timer" "$(destination_path "$OBJECT_TIMER_PATH")" 644
  stage_file_in_target_directory manifest /dev/null "$(destination_path "$MANIFEST_PATH")" 644
  write_manifest "$(staged_path manifest)" "$TOOLING_SOURCE_SHA" "$(staged_path launcher)" "$(staged_path control)" "$(staged_path helper)" "$(staged_path object_exec)" "$(staged_path sudoers)" "$(staged_path object_service)" "$(staged_path object_timer)" || fail 'unable to write staged manifest'
  assert_file_policy "$(staged_path manifest)" 644 'staged manifest' || fail 'staged manifest policy validation failed'
  validate_manifest "$(staged_path manifest)" "$TOOLING_SOURCE_SHA" "$(staged_path launcher)" "$(staged_path control)" "$(staged_path helper)" "$(staged_path object_exec)" "$(staged_path sudoers)" "$(staged_path object_service)" "$(staged_path object_timer)" || fail 'staged manifest validation failed'
  if command -v visudo >/dev/null 2>&1; then
    visudo -cf "$(staged_path sudoers)" >/dev/null || fail 'staged sudoers policy fails visudo validation'
  fi
}

snapshot_node() {
  local label="$1" path="$2" metadata digest
  if [[ -f "$path" && ! -L "$path" ]]; then
    cp -p -- "$path" "$SNAPSHOT/$label"
    metadata="$(file_metadata "$path")"
    digest="$(sha256_file "$path")"
    printf 'present=1\ntype=file\nmetadata=%s\nsha256=%s\n' "$metadata" "$digest" > "$SNAPSHOT/$label.meta"
  elif [[ -d "$path" && ! -L "$path" ]]; then
    metadata="$(file_metadata "$path")"
    printf 'present=1\ntype=directory\nmetadata=%s\n' "$metadata" > "$SNAPSHOT/$label.meta"
  elif [[ -L "$path" ]]; then
    fail "cannot snapshot symlink destination: $path"
  else
    printf 'present=0\n' > "$SNAPSHOT/$label.meta"
  fi
}

snapshot_labels=(launcher control helper object_exec manifest sudoers object_service object_timer control_dir control_lib_dir object_exec_dir)

snapshot_layout_from_entries() {
  local launcher control helper object_exec manifest sudoers service timer
  launcher="$(awk -F= '$1 == "present" { print $2 }' "$SNAPSHOT/launcher.meta")"
  control="$(awk -F= '$1 == "present" { print $2 }' "$SNAPSHOT/control.meta")"
  helper="$(awk -F= '$1 == "present" { print $2 }' "$SNAPSHOT/helper.meta")"
  object_exec="$(awk -F= '$1 == "present" { print $2 }' "$SNAPSHOT/object_exec.meta")"
  manifest="$(awk -F= '$1 == "present" { print $2 }' "$SNAPSHOT/manifest.meta")"
  sudoers="$(awk -F= '$1 == "present" { print $2 }' "$SNAPSHOT/sudoers.meta")"
  service="$(awk -F= '$1 == "present" { print $2 }' "$SNAPSHOT/object_service.meta")"
  timer="$(awk -F= '$1 == "present" { print $2 }' "$SNAPSHOT/object_timer.meta")"
  case "$launcher:$control:$helper:$object_exec:$manifest:$sudoers:$service:$timer" in
    0:0:0:0:0:0:0:0) printf 'empty\n' ;;
    1:1:1:0:0:0:0:0) printf 'legacy\n' ;;
    1:1:1:1:1:1:1:1) printf 'canonical\n' ;;
    *) fail 'rollback snapshot contains an unrecognized protected release layout' ;;
  esac
}

create_snapshot() {
  local rollback_dir
  rollback_dir="$(destination_path "$ROLLBACK_ROOT")"
  assert_not_symlink_path "$rollback_dir"
  mkdir -p -- "$rollback_dir"
  chown "$EXPECTED_UID:$EXPECTED_GID" "$(destination_path /var/lib/buildingos-backup-preflight)" "$rollback_dir"
  chmod 755 "$(destination_path /var/lib/buildingos-backup-preflight)" "$rollback_dir"
  SNAPSHOT="$(mktemp -d "$rollback_dir/release.XXXXXX")"
  snapshot_node launcher "$(destination_path "$LAUNCHER_PATH")"
  snapshot_node control "$(destination_path "$CONTROL_PATH")"
  snapshot_node helper "$(destination_path "$HELPER_PATH")"
  snapshot_node object_exec "$(destination_path "$OBJECT_EXEC_PATH")"
  snapshot_node manifest "$(destination_path "$MANIFEST_PATH")"
  snapshot_node sudoers "$(destination_path "$SUDOERS_PATH")"
  snapshot_node object_service "$(destination_path "$OBJECT_SERVICE_PATH")"
  snapshot_node object_timer "$(destination_path "$OBJECT_TIMER_PATH")"
  printf 'layout=%s\n' "$EXISTING_LAYOUT" > "$SNAPSHOT/layout"
  snapshot_node control_dir "$(destination_path "$RELEASE_DIR")"
  snapshot_node control_lib_dir "$(destination_path "$RELEASE_DIR/lib")"
  snapshot_node object_exec_dir "$(destination_path "$OBJECT_EXEC_DIR")"
}

snapshot_real_path() {
  cd -P -- "$1" && pwd -P
}

validate_snapshot_path() {
  local rollback_base base_real snapshot_real
  rollback_base="$(destination_path "$ROLLBACK_ROOT")"
  [[ -d "$rollback_base" && ! -L "$rollback_base" ]] || fail 'rollback directory is unavailable'
  [[ -d "$SNAPSHOT" && ! -L "$SNAPSHOT" ]] || fail 'rollback snapshot is unavailable'
  assert_not_symlink_path "$SNAPSHOT"
  base_real="$(snapshot_real_path "$rollback_base")"
  snapshot_real="$(snapshot_real_path "$SNAPSHOT")"
  [[ "$snapshot_real" == "$base_real"/* ]] || fail 'rollback snapshot is outside the canonical rollback directory'
}

validate_snapshot() {
  local label metadata type present expected_digest actual_digest expected_layout actual_layout
  validate_snapshot_path
  [[ -f "$SNAPSHOT/layout" && ! -L "$SNAPSHOT/layout" ]] || fail 'rollback layout classification is unavailable'
  for label in "${snapshot_labels[@]}"; do
    metadata="$SNAPSHOT/$label.meta"
    [[ -f "$metadata" && ! -L "$metadata" ]] || fail "rollback metadata is unavailable for $label"
    present="$(awk -F= '$1 == "present" { print $2 }' "$metadata")"
    case "$present" in
      0) [[ ! -e "$SNAPSHOT/$label" && ! -L "$SNAPSHOT/$label" ]] || fail "absent rollback entry has payload: $label" ;;
      1)
        type="$(awk -F= '$1 == "type" { print $2 }' "$metadata")"
        [[ "$type" == file || "$type" == directory ]] || fail "rollback type is invalid for $label"
        if [[ "$type" == file ]]; then
          assert_regular_file "$SNAPSHOT/$label" "rollback $label"
          expected_digest="$(awk -F= '$1 == "sha256" { print $2 }' "$metadata")"
          actual_digest="$(sha256_file "$SNAPSHOT/$label")"
          [[ "$expected_digest" == "$actual_digest" ]] || fail "rollback bytes are corrupt for $label"
        else
          [[ ! -e "$SNAPSHOT/$label" && ! -L "$SNAPSHOT/$label" ]] || fail "rollback directory snapshot has unexpected payload: $label"
        fi
        ;;
      *) fail "rollback presence marker is invalid for $label" ;;
    esac
  done
  expected_layout="$(awk -F= '$1 == "layout" { count++; value=$2 } END { if (count == 1 && value ~ /^(empty|legacy|canonical)$/) print value; else exit 1 }' "$SNAPSHOT/layout")" || fail 'rollback layout classification is malformed'
  actual_layout="$(snapshot_layout_from_entries)"
  [[ "$expected_layout" == "$actual_layout" ]] || fail 'rollback layout classification does not match artifact states'
}

restore_file_entry() {
  local label="$1" destination="$2" metadata uid gid mode present type staged
  metadata="$SNAPSHOT/$label.meta"
  present="$(awk -F= '$1 == "present" { print $2 }' "$metadata")"
  if [[ "$present" == 0 ]]; then
    [[ ! -L "$destination" ]] || fail "refusing to remove symlink destination during rollback: $destination"
    [[ ! -d "$destination" ]] || fail "rollback destination unexpectedly became a directory: $destination"
    rm -f -- "$destination"
    return
  fi
  type="$(awk -F= '$1 == "type" { print $2 }' "$metadata")"
  [[ "$type" == file ]] || return 0
  metadata="$(awk -F= '$1 == "metadata" { print $2 }' "$SNAPSHOT/$label.meta")"
  [[ "$metadata" =~ ^([0-9]+):([0-9]+):([0-7]{3,4})$ ]] || fail "rollback metadata is malformed for $label"
  uid="${BASH_REMATCH[1]}"; gid="${BASH_REMATCH[2]}"; mode="${BASH_REMATCH[3]}"
  staged="$(mktemp "${destination%/*}/.rollback-${label}.XXXXXX")" || fail "unable to create rollback staging file for $label"
  STAGED_ROLLBACK="$staged"
  assert_same_filesystem "$staged" "${destination%/*}"
  cp -- "$SNAPSHOT/$label" "$staged"
  chown "$uid:$gid" "$staged"
  chmod "$mode" "$staged"
  mv -f -- "$staged" "$destination"
  STAGED_ROLLBACK=''
}

restore_directory_entry() {
  local label="$1" destination="$2" metadata uid gid mode present type
  metadata="$SNAPSHOT/$label.meta"
  present="$(awk -F= '$1 == "present" { print $2 }' "$metadata")"
  if [[ "$present" == 0 ]]; then
    [[ ! -L "$destination" ]] || fail "refusing to remove symlink directory during rollback: $destination"
    rmdir -- "$destination" 2>/dev/null || fail "rollback directory is not empty: $destination"
    return
  fi
  type="$(awk -F= '$1 == "type" { print $2 }' "$metadata")"
  [[ "$type" == directory ]] || return 0
  metadata="$(awk -F= '$1 == "metadata" { print $2 }' "$SNAPSHOT/$label.meta")"
  [[ "$metadata" =~ ^([0-9]+):([0-9]+):([0-7]{3,4})$ ]] || fail "rollback directory metadata is malformed for $label"
  uid="${BASH_REMATCH[1]}"; gid="${BASH_REMATCH[2]}"; mode="${BASH_REMATCH[3]}"
  mkdir -p -- "$destination"
  chown "$uid:$gid" "$destination"
  chmod "$mode" "$destination"
}

restore_snapshot() {
  local launcher control helper object_exec manifest sudoers service timer
  validate_snapshot
  launcher="$(destination_path "$LAUNCHER_PATH")"
  control="$(destination_path "$CONTROL_PATH")"
  helper="$(destination_path "$HELPER_PATH")"
  object_exec="$(destination_path "$OBJECT_EXEC_PATH")"
  manifest="$(destination_path "$MANIFEST_PATH")"
  sudoers="$(destination_path "$SUDOERS_PATH")"
  service="$(destination_path "$OBJECT_SERVICE_PATH")"
  timer="$(destination_path "$OBJECT_TIMER_PATH")"
  for path in "$launcher" "$control" "$helper" "$object_exec" "$manifest" "$sudoers" "$service" "$timer"; do
    assert_not_symlink_path "$path"
  done
  restore_file_entry launcher "$launcher"
  restore_file_entry control "$control"
  restore_file_entry helper "$helper"
  restore_file_entry object_exec "$object_exec"
  restore_file_entry manifest "$manifest"
  restore_file_entry sudoers "$sudoers"
  restore_file_entry object_service "$service"
  restore_file_entry object_timer "$timer"
  restore_directory_entry control_lib_dir "$(destination_path "$RELEASE_DIR/lib")"
  restore_directory_entry control_dir "$(destination_path "$RELEASE_DIR")"
  restore_directory_entry object_exec_dir "$(destination_path "$OBJECT_EXEC_DIR")"
}

publish_stage() {
  local label destination
  for label in launcher control helper object_exec sudoers object_service object_timer; do
    case "$label" in
      launcher) destination="$(destination_path "$LAUNCHER_PATH")" ;;
      control) destination="$(destination_path "$CONTROL_PATH")" ;;
      helper) destination="$(destination_path "$HELPER_PATH")" ;;
      object_exec) destination="$(destination_path "$OBJECT_EXEC_PATH")" ;;
      sudoers) destination="$(destination_path "$SUDOERS_PATH")" ;;
      object_service) destination="$(destination_path "$OBJECT_SERVICE_PATH")" ;;
      object_timer) destination="$(destination_path "$OBJECT_TIMER_PATH")" ;;
    esac
    assert_same_filesystem "$(staged_path "$label")" "${destination%/*}" || return 1
    mv -f -- "$(staged_path "$label")" "$destination" || return 1
    clear_staged_path "$label"
  done
  [[ "$TEST_FAIL_AFTER_PUBLISH" == false ]] || return 1
  # Publish the manifest last: an interrupted update therefore fails closed as mixed.
  destination="$(destination_path "$MANIFEST_PATH")"
  assert_same_filesystem "$(staged_path manifest)" "${destination%/*}" || return 1
  mv -f -- "$(staged_path manifest)" "$destination" || return 1
  clear_staged_path manifest
}

prepare_destination() {
  assert_not_symlink_path "$DEST_ROOT"
  for path in "$LAUNCHER_PATH" "$CONTROL_PATH" "$HELPER_PATH" "$OBJECT_EXEC_PATH" "$MANIFEST_PATH" "$SUDOERS_PATH" "$OBJECT_SERVICE_PATH" "$OBJECT_TIMER_PATH" "$ROLLBACK_ROOT"; do
    assert_not_symlink_path "$(destination_path "$path")"
  done
  mkdir -p -- "$DEST_ROOT" || fail 'unable to create destination root'
  mkdir -p -- \
    "$(destination_path "$RELEASE_DIR/lib")" \
    "$(destination_path "$OBJECT_EXEC_DIR")" \
    "$(destination_path /usr/local/sbin)" \
    "$(destination_path /etc/sudoers.d)" \
    "$(destination_path /etc/systemd/system)" || fail 'unable to prepare destination directories'
  chown "$EXPECTED_UID:$EXPECTED_GID" "$(destination_path "$RELEASE_DIR")" "$(destination_path "$RELEASE_DIR/lib")" "$(destination_path "$OBJECT_EXEC_DIR")" || fail 'unable to set destination directory ownership'
  chmod 755 "$(destination_path "$RELEASE_DIR")" "$(destination_path "$RELEASE_DIR/lib")" "$(destination_path "$OBJECT_EXEC_DIR")" || fail 'unable to set destination directory modes'
}

systemd_reload_required() {
  local service_meta timer_meta old_service old_timer new_service new_timer
  service_meta="$SNAPSHOT/object_service.meta"
  timer_meta="$SNAPSHOT/object_timer.meta"
  old_service="$(awk -F= '$1 == "sha256" { print $2 }' "$service_meta" 2>/dev/null || true)"
  old_timer="$(awk -F= '$1 == "sha256" { print $2 }' "$timer_meta" 2>/dev/null || true)"
  new_service="$(sha256_file "$(destination_path "$OBJECT_SERVICE_PATH")")"
  new_timer="$(sha256_file "$(destination_path "$OBJECT_TIMER_PATH")")"
  [[ "$old_service" == "$new_service" && "$old_timer" == "$new_timer" ]] && printf 'NO' || printf 'YES'
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --source-root) SOURCE_ROOT="${2:-}"; shift 2 ;;
      --dest-root) DEST_ROOT="${2:-}"; shift 2 ;;
      --tooling-source-sha) TOOLING_SOURCE_SHA="${2:-}"; shift 2 ;;
      --test-force-cross-device) TEST_FORCE_CROSS_DEVICE=true; shift ;;
      --test-fail-after-prepare-destination) TEST_FAIL_AFTER_PREPARE_DESTINATION=true; shift ;;
      --test-fail-during-stage-release) TEST_FAIL_DURING_STAGE_RELEASE=true; shift ;;
      --check) ACTION='check'; shift ;;
      --apply) ACTION='apply'; shift ;;
      --rollback) ROLLBACK_SNAPSHOT="${2:-}"; shift 2 ;;
      --test-mode) TEST_MODE="${2:-}"; shift 2 ;;
      --test-fail-after-publish) TEST_FAIL_AFTER_PUBLISH=true; shift ;;
      --help) usage; exit 0 ;;
      *) fail "unknown argument: $1" ;;
    esac
  done
  [[ "$DEST_ROOT" == /* ]] || fail 'dest root must be an absolute path'
  if [[ -n "$TEST_MODE" ]]; then
    [[ "$TEST_MODE" == local-unprivileged ]] || fail 'unsupported test mode'
    [[ "$DEST_ROOT" != / ]] || fail 'test mode cannot use dest-root=/'
    EXPECTED_UID="$(id -u)"
    EXPECTED_GID="$(id -g)"
  else
    [[ "$EXPECTED_UID:$EXPECTED_GID" == '0:0' ]] || fail 'production owner policy is root:root'
    [[ "$ACTION" != apply || "$(id -u)" -eq 0 ]] || fail 'production apply requires root'
  fi
  if [[ -n "$ROLLBACK_SNAPSHOT" ]]; then
    [[ "$ACTION" == apply ]] || fail 'rollback requires --apply'
    [[ -z "$SOURCE_ROOT" && -z "$TOOLING_SOURCE_SHA" ]] || fail 'rollback does not accept source release arguments'
    [[ "$TEST_FAIL_AFTER_PUBLISH" == false && "$TEST_FAIL_AFTER_PREPARE_DESTINATION" == false && "$TEST_FAIL_DURING_STAGE_RELEASE" == false && "$TEST_FORCE_CROSS_DEVICE" == false ]] || fail 'test publication flags are not valid for rollback'
  else
    [[ -n "$SOURCE_ROOT" && -n "$TOOLING_SOURCE_SHA" ]] || fail 'source root and tooling source SHA are required'
    [[ "$TOOLING_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'tooling source SHA must be exactly 40 lowercase hexadecimal characters'
    [[ "$TEST_FORCE_CROSS_DEVICE" == false || "$TEST_MODE" == local-unprivileged ]] || fail 'cross-device fixture is limited to isolated test mode'
    [[ "$TEST_FAIL_AFTER_PREPARE_DESTINATION" == false && "$TEST_FAIL_DURING_STAGE_RELEASE" == false || "$TEST_MODE" == local-unprivileged ]] || fail 'failure fixtures are limited to isolated test mode'
  fi
}

main() {
  local daemon_reload_required
  parse_args "$@"
  if [[ -n "$ROLLBACK_SNAPSHOT" ]]; then
    SNAPSHOT="$ROLLBACK_SNAPSHOT"
    validate_snapshot
    prepare_destination
    restore_snapshot
    printf 'ROLLBACK_STATUS=PASS\n'
    return
  fi
  validate_source
  validate_destination_readonly
  if [[ "$ACTION" == check ]]; then
    printf 'CHECK_STATUS=PASS\n'
    return
  fi
  create_snapshot
  TRANSACTION_ACTIVE=true
  if ! prepare_destination; then
    fail 'destination preparation failed; previous release restored'
  fi
  [[ "$TEST_FAIL_AFTER_PREPARE_DESTINATION" == false ]] || fail 'injected destination preparation failure'
  if ! stage_release; then
    fail 'release staging failed; previous release restored'
  fi
  if ! validate_existing_layout; then
    fail 'pre-publication validation failed; previous release restored'
  fi
  if ! publish_stage; then
    fail 'publish failed; previous release restored'
  fi
  if ! validate_published_release; then
    fail 'post-publish validation failed; previous release restored'
  fi
  daemon_reload_required="$(systemd_reload_required)" || fail 'unable to determine whether a daemon reload is required'
  printf 'INSTALL_STATUS=PASS\nROLLBACK_SNAPSHOT=%s\nDAEMON_RELOAD_REQUIRED=%s\n' "$SNAPSHOT" "$daemon_reload_required"
  TRANSACTION_ACTIVE=false
}

main "$@"
