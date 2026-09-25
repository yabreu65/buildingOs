#!/usr/bin/env bash
# Bounded rclone transfer and downloaded-byte verification for recovery artifacts.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-point-portable-stat.sh"

recovery_point_rclone_error() {
  printf 'ERROR: recovery-point rclone check failed\n' >&2
  return 1
}

recovery_point_rclone_mode() {
  recovery_point_portable_stat_mode "$1"
}

recovery_point_rclone_private_file() {
  local path="$1" mode
  [[ -r "$path" && -f "$path" && ! -L "$path" ]] || return 1
  mode="$(recovery_point_rclone_mode "$path")" || return 1
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#077) == 0 ))
}

recovery_point_rclone_private_directory() {
  local path="$1" mode
  [[ -d "$path" && ! -L "$path" ]] || return 1
  mode="$(recovery_point_rclone_mode "$path")" || return 1
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#077) == 0 ))
}

recovery_point_rclone_safe_relative_path() {
  local path="$1"
  [[ "$path" != *..* && "$path" != *[[:space:]]* ]] || return 1
  [[ "$path" =~ ^objects/[0-9a-f]{64}\.blob$ || "$path" =~ ^(postgresql|metadata)/[A-Za-z0-9][A-Za-z0-9._-]*$ ]]
}

recovery_point_rclone_safe_remote_root() {
  local remote_root="$1" remote_path segment
  [[ "$remote_root" =~ ^[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$ ]] || return 1
  remote_path="${remote_root#*:}"
  [[ "$remote_path" != /* && "$remote_path" != */ && "$remote_path" != *//* && "$remote_path" != *..* ]] || return 1
  IFS='/' read -r -a segments <<< "$remote_path"
  for segment in "${segments[@]}"; do
    [[ "$segment" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ && "$segment" != . && "$segment" != .. ]] || return 1
  done
}

# Verifies only local rclone help surfaces; it does not contact a remote.
recovery_point_rclone_require_download_check() {
  local rclone_bin config check_help flags_help
  [[ "$#" -eq 2 ]] || { recovery_point_rclone_error; return 1; }
  rclone_bin="$1"; config="$2"
  [[ -x "$rclone_bin" && -f "$rclone_bin" && ! -L "$rclone_bin" ]] || { recovery_point_rclone_error; return 1; }
  recovery_point_rclone_private_file "$config" || { recovery_point_rclone_error; return 1; }
  check_help="$("$rclone_bin" check --help 2>/dev/null)" || { recovery_point_rclone_error; return 1; }
  flags_help="$("$rclone_bin" help flags 2>/dev/null)" || { recovery_point_rclone_error; return 1; }
  [[ "$check_help" =~ (^|[[:space:],])--download([[:space:],]|$) && "$flags_help" =~ (^|[[:space:],])--files-from-raw([=[:space:],]|$) ]] || { recovery_point_rclone_error; return 1; }
}

recovery_point_rclone_remove_list() {
  rm -f -- "$1" >/dev/null 2>&1 || true
}

# Copies one safe recovery artifact, then verifies downloaded bytes for that exact relative path.
recovery_point_rclone_copy_check() {
  local rclone_bin config local_root relative_path remote_root list_file source source_parent root_real source_parent_real
  [[ "$#" -eq 6 ]] || { recovery_point_rclone_error; return 1; }
  rclone_bin="$1"; config="$2"; local_root="$3"; relative_path="$4"; remote_root="$5"; list_file="$6"
  recovery_point_rclone_require_download_check "$rclone_bin" "$config" || return 1
  recovery_point_rclone_safe_relative_path "$relative_path" || { recovery_point_rclone_error; return 1; }
  recovery_point_rclone_safe_remote_root "$remote_root" || { recovery_point_rclone_error; return 1; }
  root_real="$(cd -P -- "$local_root" 2>/dev/null && pwd -P)" || { recovery_point_rclone_error; return 1; }
  [[ -d "$root_real" && ! -L "$local_root" ]] || { recovery_point_rclone_error; return 1; }
  source="$local_root/$relative_path"
  source_parent="$(dirname -- "$source")"
  source_parent_real="$(cd -P -- "$source_parent" 2>/dev/null && pwd -P)" || { recovery_point_rclone_error; return 1; }
  [[ "$source_parent_real" == "$root_real"/* && -f "$source" && ! -L "$source" ]] || { recovery_point_rclone_error; return 1; }
  [[ ! -e "$list_file" && ! -L "$list_file" ]] || { recovery_point_rclone_error; return 1; }
  recovery_point_rclone_private_directory "$(dirname -- "$list_file")" || { recovery_point_rclone_error; return 1; }
  if ! (umask 077; set -C; : > "$list_file") 2>/dev/null || ! chmod 0600 "$list_file" 2>/dev/null || ! printf '%s\n' "$relative_path" > "$list_file" || ! recovery_point_rclone_private_file "$list_file"; then
    recovery_point_rclone_remove_list "$list_file"
    recovery_point_rclone_error
    return 1
  fi
  if ! "$rclone_bin" --config "$config" copyto "$source" "${remote_root%/}/$relative_path" >/dev/null 2>&1; then
    recovery_point_rclone_remove_list "$list_file"
    recovery_point_rclone_error
    return 1
  fi
  if ! "$rclone_bin" --config "$config" check --download --one-way --files-from-raw "$list_file" "$local_root" "$remote_root" >/dev/null 2>&1; then
    recovery_point_rclone_remove_list "$list_file"
    recovery_point_rclone_error
    return 1
  fi
  recovery_point_rclone_remove_list "$list_file"
}
