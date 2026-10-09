#!/usr/bin/env bash
set -Eeuo pipefail
set +x

readonly RELEASE_ROOT='/opt/buildingos/weekly-recovery-points'
readonly WEEKLY_ENV='/etc/buildingos/recovery-point-weekly.env'
readonly WEEKLY_SERVICE='/etc/systemd/system/pawtech-buildingos-recovery-point-weekly.service'
readonly WEEKLY_TIMER='/etc/systemd/system/pawtech-buildingos-recovery-point-weekly.timer'
readonly RECOVERY_SERVICE='/etc/systemd/system/pawtech-buildingos-recovery-fence-recovery.service'
readonly LOCK_PARENT='/var/lib/buildingos-backup'

source_root=''
release_sha=''
dest_root='/'
action='check'
test_mode=false
stage_dir=''
backup_dir=''
transaction_active=false
lock_parent_created=false

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
path() { printf '%s%s\n' "$dest_root" "$1"; }
sha256_file() { sha256sum "$1" | awk '{print $1}'; }

source_file() {
  local relative="$1"
  git -c safe.directory="$source_root" -C "$source_root" cat-file -e "$release_sha:$relative" 2>/dev/null || fail "release is missing $relative"
  git -c safe.directory="$source_root" -C "$source_root" show "$release_sha:$relative"
}

source_type_is_blob() {
  [[ "$(git -c safe.directory="$source_root" -C "$source_root" cat-file -t "$release_sha:$1" 2>/dev/null)" == blob ]]
}

release_files=(
  scripts/backup-recovery-point-weekly.sh
  scripts/recover-interrupted-recovery-point.sh
  scripts/deploy-production.sh
  scripts/production-security-validate.sh
  scripts/production-storage-cutover-guard.sh
  scripts/lib/production-fence-operation-state.sh
  scripts/lib/production-operation-lock.sh
  scripts/lib/production-rclone-recovery-check.sh
  scripts/lib/production-s3-write-fence.sh
  scripts/lib/recovery-point-capture.sh
  scripts/lib/recovery-point-file-manifest.sh
  scripts/lib/recovery-point-file-object-bundle.sh
  scripts/lib/recovery-point-object-source.sh
  scripts/lib/recovery-point-portable-stat.sh
  scripts/lib/recovery-point-postgres-snapshot.sh
  scripts/lib/recovery-point-s3-helper.cjs
  infra/production/backup-postgres.identity.v1
  infra/production/systemd/pawtech-buildingos-recovery-fence-recovery.service
  infra/production/systemd/pawtech-buildingos-recovery-point-weekly.service
  infra/production/systemd/pawtech-buildingos-recovery-point-weekly.timer
)

executable_files=(
  scripts/backup-recovery-point-weekly.sh
  scripts/recover-interrupted-recovery-point.sh
  scripts/production-security-validate.sh
  scripts/production-storage-cutover-guard.sh
  scripts/lib/production-fence-operation-state.sh
  scripts/lib/production-operation-lock.sh
  scripts/lib/production-rclone-recovery-check.sh
  scripts/lib/production-s3-write-fence.sh
  scripts/lib/recovery-point-capture.sh
  scripts/lib/recovery-point-file-manifest.sh
  scripts/lib/recovery-point-file-object-bundle.sh
  scripts/lib/recovery-point-object-source.sh
  scripts/lib/recovery-point-portable-stat.sh
  scripts/lib/recovery-point-postgres-snapshot.sh
)

is_executable_file() {
  local candidate
  for candidate in "${executable_files[@]}"; do [[ "$candidate" == "$1" ]] && return 0; done
  return 1
}

validate_source() {
  [[ -d "$source_root/.git" ]] || fail 'source root must be a Git checkout'
  [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'release SHA must be 40 lowercase hexadecimal characters'
  [[ "$(git -c safe.directory="$source_root" -C "$source_root" rev-parse HEAD)" == "$release_sha" ]] || fail 'source HEAD does not match release SHA'
  [[ -z "$(git -c safe.directory="$source_root" -C "$source_root" status --porcelain --untracked-files=all)" ]] || fail 'source checkout must be clean'
  local relative
  for relative in "${release_files[@]}"; do
    source_type_is_blob "$relative" || fail "release entry is not a regular file: $relative"
  done
}

render_unit() {
  local relative="$1" output="$2" release_path="$3"
  source_file "$relative" | sed "s|/opt/pawtech/apps/buildingos/buildingos-app|$release_path|g" > "$output"
  grep -Fq '/opt/pawtech/apps/buildingos/buildingos-app' "$output" && fail "unit retains production checkout path: $relative"
  if [[ "$relative" != *.timer ]]; then
    grep -Fq "$release_path" "$output" || fail "unit does not reference installed release: $relative"
  fi
}

write_manifest() {
  local release_path="$1" output relative installed hash
  output="$release_path/release-manifest.sha256"
  {
    printf 'format=buildingos-weekly-recovery-point-install/v1\nrelease_sha=%s\n' "$release_sha"
    for relative in "${release_files[@]}"; do
      installed="$release_path/$relative"
      hash="$(sha256_file "$installed")"
      printf '%s  %s\n' "$hash" "$relative"
    done
  } > "$output"
  chmod 0600 "$output"
}

validate_manifest() {
  local release_path="$1" manifest relative expected actual
  manifest="$release_path/release-manifest.sha256"
  [[ -f "$manifest" && ! -L "$manifest" ]] || fail 'installed release manifest is missing'
  grep -Fxq "format=buildingos-weekly-recovery-point-install/v1" "$manifest" || fail 'installed release format is invalid'
  grep -Fxq "release_sha=$release_sha" "$manifest" || fail 'installed release SHA is invalid'
  for relative in "${release_files[@]}"; do
    expected="$(awk -v file="$relative" '$2 == file {print $1}' "$manifest")"
    actual="$(sha256_file "$release_path/$relative")"
    [[ -n "$expected" && "$expected" == "$actual" ]] || fail "installed release hash mismatch: $relative"
  done
}

set_permissions() {
  local release_path="$1" relative mode
  chmod 0755 "$release_path" "$release_path/scripts" "$release_path/scripts/lib" "$release_path/infra" "$release_path/infra/production"
  for relative in "${release_files[@]}"; do
    if is_executable_file "$relative"; then mode=0755; else mode=0644; fi
    chmod "$mode" "$release_path/$relative"
  done
}

validate_installed_layout() {
  local release_path="$(path "$RELEASE_ROOT/releases/$release_sha")"
  validate_manifest "$release_path"
  [[ -f "$(path "$WEEKLY_SERVICE")" && -f "$(path "$WEEKLY_TIMER")" && -f "$(path "$RECOVERY_SERVICE")" ]] || fail 'systemd units are incomplete'
  [[ -f "$(path "$WEEKLY_ENV")" && ! -L "$(path "$WEEKLY_ENV")" ]] || fail 'weekly environment file is missing'
  grep -Fxq 'BUILDINGOS_WEEKLY_RECOVERY_POINT_ENABLE=NO' "$(path "$WEEKLY_ENV")" || fail 'weekly environment is not disabled'
  grep -Fq "$release_path/scripts/backup-recovery-point-weekly.sh" "$(path "$WEEKLY_SERVICE")" || fail 'weekly service path is invalid'
  grep -Fxq 'Persistent=false' "$(path "$WEEKLY_TIMER")" || fail 'weekly timer is not non-persistent'
  [[ -d "$(path "$LOCK_PARENT")" && ! -L "$(path "$LOCK_PARENT")" ]] || fail 'shared lock parent is missing'
}

ensure_lock_parent() {
  local parent="$(path "$LOCK_PARENT")"
  [[ ! -L "$parent" ]] || fail 'shared lock parent must not be a symlink'
  if [[ ! -e "$parent" ]]; then
    mkdir -p -- "$parent"
    lock_parent_created=true
  else
    [[ -d "$parent" ]] || fail 'shared lock parent is not a directory'
  fi
  chmod 0750 "$parent"
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$transaction_active" == true && -n "$backup_dir" && -d "$backup_dir" ]]; then
    rm -rf -- "$(path "$RELEASE_ROOT/releases/$release_sha")"
    local target
    for item in service timer recovery-service env; do
      case "$item" in
        service) target="$(path "$WEEKLY_SERVICE")" ;;
        timer) target="$(path "$WEEKLY_TIMER")" ;;
        recovery-service) target="$(path "$RECOVERY_SERVICE")" ;;
        env) target="$(path "$WEEKLY_ENV")" ;;
      esac
      if [[ -e "$backup_dir/$item" || -L "$backup_dir/$item" ]]; then
        mv -- "$backup_dir/$item" "$target"
      else
        rm -f -- "$target"
      fi
    done
  fi
  [[ -z "$stage_dir" ]] || rm -rf -- "$stage_dir"
  [[ -z "$backup_dir" ]] || rm -rf -- "$backup_dir"
  if [[ "$status" -ne 0 && "$lock_parent_created" == true ]]; then rmdir -- "$(path "$LOCK_PARENT")" 2>/dev/null || true; fi
  exit "$status"
}
trap cleanup EXIT

parse_args() {
  while (($#)); do
    case "$1" in
      --source-root) source_root="${2:-}"; shift 2 ;;
      --release-sha) release_sha="${2:-}"; shift 2 ;;
      --dest-root) dest_root="${2:-}"; shift 2 ;;
      --apply) action=apply; shift ;;
      --check) action=check; shift ;;
      --test-mode) [[ "${2:-}" == local ]] || fail 'unsupported test mode'; test_mode=true; shift 2 ;;
      *) fail "unknown argument: $1" ;;
    esac
  done
  [[ "$source_root" == /* && "$dest_root" == /* ]] || fail 'source and destination roots must be absolute'
  [[ "$test_mode" == true || "$(id -u)" -eq 0 ]] || fail 'production apply requires root'
}

install_release() {
  local release_path="$(path "$RELEASE_ROOT/releases/$release_sha")" release_stage
  validate_source
  mkdir -p -- "$(path "$RELEASE_ROOT/releases")" "$(path /etc/buildingos)" "$(path /etc/systemd/system)"
  ensure_lock_parent
  [[ ! -e "$release_path" && ! -L "$release_path" ]] || fail 'release SHA is already installed'
  stage_dir="$(mktemp -d "$(path "$RELEASE_ROOT/.stage.$release_sha.XXXXXX")")"
  release_stage="$stage_dir/release"
  mkdir -p -- "$release_stage/scripts/lib" "$release_stage/infra/production"
  local relative
  for relative in "${release_files[@]}"; do
    mkdir -p -- "$release_stage/$(dirname -- "$relative")"
    source_file "$relative" > "$release_stage/$relative"
  done
  set_permissions "$release_stage"
  write_manifest "$release_stage"
  validate_manifest "$release_stage"
  render_unit infra/production/systemd/pawtech-buildingos-recovery-point-weekly.service "$stage_dir/service" "$(path "$RELEASE_ROOT/releases/$release_sha")"
  render_unit infra/production/systemd/pawtech-buildingos-recovery-point-weekly.timer "$stage_dir/timer" "$(path "$RELEASE_ROOT/releases/$release_sha")"
  render_unit infra/production/systemd/pawtech-buildingos-recovery-fence-recovery.service "$stage_dir/recovery-service" "$(path "$RELEASE_ROOT/releases/$release_sha")"
  printf 'BUILDINGOS_WEEKLY_RECOVERY_POINT_ENABLE=NO\n' > "$stage_dir/env"
  chmod 0600 "$stage_dir/env"
  [[ "${WEEKLY_INSTALLER_TEST_FAIL_AFTER_STAGE:-NO}" == YES ]] && fail injected_stage_failure
  backup_dir="$(mktemp -d "$(path "$RELEASE_ROOT/.rollback.$release_sha.XXXXXX")")"
  transaction_active=true
  local existing target item
  for item in service timer recovery-service env; do
    case "$item" in
      service) target="$(path "$WEEKLY_SERVICE")" ;;
      timer) target="$(path "$WEEKLY_TIMER")" ;;
      recovery-service) target="$(path "$RECOVERY_SERVICE")" ;;
      env) target="$(path "$WEEKLY_ENV")" ;;
    esac
    if [[ -e "$target" || -L "$target" ]]; then mv -- "$target" "$backup_dir/$item"; fi
  done
  mv -- "$release_stage" "$release_path"
  mv -- "$stage_dir/service" "$(path "$WEEKLY_SERVICE")"
  mv -- "$stage_dir/timer" "$(path "$WEEKLY_TIMER")"
  mv -- "$stage_dir/recovery-service" "$(path "$RECOVERY_SERVICE")"
  mv -- "$stage_dir/env" "$(path "$WEEKLY_ENV")"
  [[ "${WEEKLY_INSTALLER_TEST_FAIL_AFTER_MOVE:-NO}" == YES ]] && fail injected_post_move_failure
  validate_installed_layout
  transaction_active=false
  printf 'WEEKLY_INSTALLATION=PASS\nRELEASE_SHA=%s\nTIMER=DISABLED\n' "$release_sha"
}

parse_args "$@"
validate_source
if [[ "$action" == check ]]; then
  printf 'WEEKLY_INSTALLATION_CHECK=PASS\nRELEASE_SHA=%s\n' "$release_sha"
else
  install_release
fi
