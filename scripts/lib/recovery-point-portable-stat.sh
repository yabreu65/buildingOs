#!/usr/bin/env bash
# Reads a filesystem mode using BSD/macOS or GNU stat without accepting non-mode output.

recovery_point_portable_stat_mode() {
  local path="${1:-}" mode=''
  [[ "$#" -eq 1 ]] || return 1

  mode="$(stat -f '%Lp' "$path" 2>/dev/null)" || mode=''
  if [[ "$mode" =~ ^[0-7]{3,4}$ ]]; then
    printf '%s\n' "$mode"
    return 0
  fi

  mode="$(stat -c '%a' -- "$path" 2>/dev/null)" || mode=''
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  printf '%s\n' "$mode"
}

# Reads a device:inode identity using BSD/macOS or GNU stat without accepting non-identity output.
recovery_point_portable_stat_identity() {
  local path="${1:-}" identity=''
  [[ "$#" -eq 1 ]] || return 1

  identity="$(stat -f '%d:%i' "$path" 2>/dev/null)" || identity=''
  if [[ "$identity" =~ ^[0-9]+:[0-9]+$ ]]; then
    printf '%s\n' "$identity"
    return 0
  fi

  identity="$(stat -c '%d:%i' -- "$path" 2>/dev/null)" || identity=''
  [[ "$identity" =~ ^[0-9]+:[0-9]+$ ]] || return 1
  printf '%s\n' "$identity"
}

# Reads a numeric UID using BSD/macOS or GNU stat without accepting malformed output.
recovery_point_portable_stat_uid() {
  local path="${1:-}" uid=''
  [[ "$#" -eq 1 ]] || return 1

  uid="$(stat -f '%u' "$path" 2>/dev/null)" || uid=''
  if [[ "$uid" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$uid"
    return 0
  fi

  uid="$(stat -c '%u' -- "$path" 2>/dev/null)" || uid=''
  [[ "$uid" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$uid"
}
