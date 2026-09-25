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
