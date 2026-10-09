#!/usr/bin/env bash

# One non-blocking lock shared by deploy, rollback, daily backups, and weekly
# Recovery Point capture. The lock path is configurable for isolated tests.

readonly production_operation_lock_fd=9
production_operation_lock_backend=''
production_operation_lock_dir=''
production_operation_lock_path=''

production_operation_lock_acquire() {
  local path="${BUILDINGOS_OPERATION_LOCK_PATH:-}" parent
  if [[ -z "$path" ]]; then
    if command -v flock >/dev/null 2>&1; then
      path='/var/lib/buildingos-backup/production-operations.lock'
    else
      # macOS development hosts do not ship flock; mkdir is atomic and leaves
      # a fail-closed stale marker after an unclean process termination.
      path="${TMPDIR:-/tmp}/buildingos-production-operations.lock"
    fi
  fi

  [[ "$path" == /* && "$path" != */ && "$path" != *$'\n'* && "$path" != *$'\r'* ]] || {
    printf 'ERROR: invalid production operation lock path\n' >&2
    return 1
  }
  parent="${path%/*}"
  [[ -d "$parent" && ! -L "$parent" ]] || {
    printf 'ERROR: production operation lock directory is unavailable\n' >&2
    return 1
  }
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$path" || return 1
    if ! flock -n "$production_operation_lock_fd"; then
      exec 9>&-
      printf 'ERROR: another production operation is active\n' >&2
      return 1
    fi
    chmod 0600 "$path" || {
      production_operation_lock_release
      return 1
    }
    production_operation_lock_backend='flock'
  else
    production_operation_lock_dir="$path.d"
    if ! mkdir "$production_operation_lock_dir" 2>/dev/null; then
      printf 'ERROR: another production operation is active\n' >&2
      production_operation_lock_dir=''
      return 1
    fi
    chmod 0700 "$production_operation_lock_dir" || {
      rmdir "$production_operation_lock_dir" 2>/dev/null || true
      production_operation_lock_dir=''
      return 1
    }
    printf '%s\n' "$$" >"$production_operation_lock_dir/pid" || {
      rmdir "$production_operation_lock_dir" 2>/dev/null || true
      production_operation_lock_dir=''
      return 1
    }
    chmod 0600 "$production_operation_lock_dir/pid" || return 1
    production_operation_lock_backend='mkdir'
  fi
  production_operation_lock_path="$path"
}

production_operation_lock_release() {
  if [[ "$production_operation_lock_backend" == flock ]]; then
    flock -u "$production_operation_lock_fd" 2>/dev/null || true
    exec 9>&- 2>/dev/null || true
  elif [[ "$production_operation_lock_backend" == mkdir && -n "$production_operation_lock_dir" ]]; then
    rm -f -- "$production_operation_lock_dir/pid" 2>/dev/null || true
    rmdir -- "$production_operation_lock_dir" 2>/dev/null || true
  fi
  production_operation_lock_backend=''
  production_operation_lock_dir=''
  production_operation_lock_path=''
}
