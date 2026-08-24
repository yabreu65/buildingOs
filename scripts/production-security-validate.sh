#!/usr/bin/env bash
set -Eeuo pipefail

readonly BACKUP_IDENTITY_VERSION='backup-postgres.identity.v1'
readonly BACKUP_SCRIPT_PATH='/opt/pawtech/backups/scripts/backup-postgres.sh'
readonly BACKUP_SCRIPT_SHA256='3cbf2bf191bd9a06e7bbf831848cfa2816cd80fca980593f84d3411cb3b14ff5'
readonly BACKUP_SCRIPT_OWNER='yoryi'
readonly BACKUP_SCRIPT_GROUP='yoryi'
readonly BACKUP_SCRIPT_MODE='0775'
readonly ROLLBACK_RECEIPT_VERSION='rollback-compatibility-receipt.v2'
readonly PRODUCTION_ROLLBACK_PROTECTED_DIR='/opt/pawtech/apps/buildingos/compatibility'
readonly PRODUCTION_ROLLBACK_EXPECTED_OWNER='yoryi'
readonly PRODUCTION_ROLLBACK_EXPECTED_GROUP='yoryi'

ROLLBACK_COMPATIBILITY_BASIS=''
ROLLBACK_COMPATIBILITY_PREVIOUS_SHA=''
ROLLBACK_COMPATIBILITY_TARGET_SHA=''

security_fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

file_owner() {
  if stat -L -c '%U' -- "$1" >/dev/null 2>&1; then
    stat -L -c '%U' -- "$1"
  else
    stat -L -f '%Su' "$1"
  fi
}

file_group() {
  if stat -L -c '%G' -- "$1" >/dev/null 2>&1; then
    stat -L -c '%G' -- "$1"
  else
    stat -L -f '%Sg' "$1"
  fi
}

file_mode() {
  if stat -L -c '%a' -- "$1" >/dev/null 2>&1; then
    stat -L -c '%a' -- "$1"
  else
    stat -L -f '%Lp' "$1"
  fi
}

file_identity() {
  if stat -L -c '%d:%i' -- "$1" >/dev/null 2>&1; then
    stat -L -c '%d:%i' -- "$1"
  else
    # On Darwin, /dev/fd reports the descriptor filesystem device rather than
    # the opened file device, while preserving the opened inode.
    stat -L -f '%i' "$1"
  fi
}

require_canonical_directory_without_symlinks() {
  local directory="$1"
  local label="$2"
  local component current canonical
  local -a components=()

  [[ "$directory" == /* ]] || security_fail "$label must be absolute"
  [[ "$directory" != '/' && "$directory" != *'//'* && "$directory" != *'/./'* && "$directory" != *'/../'* && "$directory" != */. && "$directory" != */.. && "$directory" != */ ]] \
    || security_fail "$label is not lexically canonical"
  [[ -d "$directory" ]] || security_fail "$label is missing"

  IFS='/' read -r -a components <<< "${directory#/}"
  current=''
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || security_fail "$label contains an empty path component"
    current="$current/$component"
    [[ ! -L "$current" ]] || security_fail "$label contains a symbolic link"
  done

  canonical="$(cd -P -- "$directory" && pwd -P)" || security_fail "$label cannot be canonicalized"
  [[ "$canonical" == "$directory" ]] || security_fail "$label does not match its physical canonical path"
}

read_file_snapshot_once() {
  local path="$1"
  local snapshot_with_sentinel

  snapshot_with_sentinel="$(cat -- "$path"; printf '__BUILDINGOS_SNAPSHOT_END__')" \
    || security_fail "Unable to read $path"
  FILE_SNAPSHOT="${snapshot_with_sentinel%__BUILDINGOS_SNAPSHOT_END__}"
}

validate_backup_manifest() {
  local manifest="$1"
  local expected_manifest

  [[ ! -L "$manifest" ]] || security_fail "Backup identity manifest must not be a symbolic link"
  [[ -f "$manifest" ]] || security_fail "Backup identity manifest must be a regular file"
  read_file_snapshot_once "$manifest"

  printf -v expected_manifest '%s\npath=%s\nsha256=%s\nowner=%s\ngroup=%s\nmode=%s\n' \
    "version=$BACKUP_IDENTITY_VERSION" \
    "$BACKUP_SCRIPT_PATH" \
    "$BACKUP_SCRIPT_SHA256" \
    "$BACKUP_SCRIPT_OWNER" \
    "$BACKUP_SCRIPT_GROUP" \
    "$BACKUP_SCRIPT_MODE"
  [[ "$FILE_SNAPSHOT" == "$expected_manifest" ]] \
    || security_fail "Backup identity manifest is not the exact canonical v1 manifest"
}

validate_backup_script_file() {
  local script_path="$1"
  local expected_path="${2:-$BACKUP_SCRIPT_PATH}"
  local expected_digest="${3:-$BACKUP_SCRIPT_SHA256}"
  local expected_owner="${4:-$BACKUP_SCRIPT_OWNER}"
  local expected_group="${5:-$BACKUP_SCRIPT_GROUP}"
  local expected_mode="${6:-$BACKUP_SCRIPT_MODE}"
  local parent expected_parent owner group mode digest identity_before identity_after owner_after group_after mode_after

  [[ "$script_path" == "$expected_path" ]] || security_fail "Backup script path is not the expected path"
  parent="${script_path%/*}"
  expected_parent="${expected_path%/*}"
  [[ "$parent" == "$expected_parent" ]] || security_fail "Backup script parent is not the expected directory"
  require_canonical_directory_without_symlinks "$parent" 'Backup script parent'
  [[ ! -L "$script_path" ]] || security_fail "Backup script must not be a symbolic link"
  [[ -f "$script_path" ]] || security_fail "Backup script must be a regular file"

  identity_before="$(file_identity "$script_path")" || security_fail "Unable to identify backup script"
  owner="$(file_owner "$script_path")" || security_fail "Unable to read backup script owner"
  group="$(file_group "$script_path")" || security_fail "Unable to read backup script group"
  mode="0$(file_mode "$script_path")" || security_fail "Unable to read backup script mode"
  [[ "$owner" == "$expected_owner" ]] || security_fail "Backup script owner mismatch"
  [[ "$group" == "$expected_group" ]] || security_fail "Backup script group mismatch"
  [[ "$mode" == "$expected_mode" ]] || security_fail "Backup script mode mismatch"

  digest="$(sha256sum -- "$script_path")" || security_fail "Unable to hash backup script"
  digest="${digest%% *}"
  identity_after="$(file_identity "$script_path")" || security_fail "Unable to re-identify backup script"
  owner_after="$(file_owner "$script_path")" || security_fail "Unable to re-read backup script owner"
  group_after="$(file_group "$script_path")" || security_fail "Unable to re-read backup script group"
  mode_after="0$(file_mode "$script_path")" || security_fail "Unable to re-read backup script mode"
  [[ "$identity_before" == "$identity_after" && ! -L "$script_path" && -f "$script_path" ]] \
    || security_fail "Backup script changed during identity validation"
  [[ "$owner_after" == "$owner" && "$group_after" == "$group" && "$mode_after" == "$mode" ]] \
    || security_fail "Backup script metadata changed during identity validation"
  [[ "$digest" == "$expected_digest" ]] || security_fail "Backup script SHA-256 mismatch"
}

validate_backup_identity() {
  local manifest="$1"

  validate_backup_manifest "$manifest"
  validate_backup_script_file "$BACKUP_SCRIPT_PATH"
}

execute_pinned_backup_script() (
  local script_path="$1"
  local expected_digest="$2"
  local expected_owner="$3"
  local expected_group="$4"
  local expected_mode="$5"
  local snapshot_dir snapshot_path snapshot_digest

  validate_backup_script_file \
    "$script_path" "$script_path" "$expected_digest" "$expected_owner" "$expected_group" "$expected_mode"
  umask 077
  snapshot_dir="$(mktemp -d /tmp/buildingos-backup-control.XXXXXX)" \
    || security_fail "Unable to create private backup control directory"
  snapshot_path="$snapshot_dir/backup-postgres.sh"
  trap 'rm -rf -- "$snapshot_dir"' EXIT

  cp -- "$script_path" "$snapshot_path" \
    || security_fail "Unable to snapshot the validated backup script"
  chmod 500 "$snapshot_path" || security_fail "Unable to secure the backup script snapshot"
  snapshot_digest="$(sha256sum -- "$snapshot_path")" \
    || security_fail "Unable to hash the backup script snapshot"
  snapshot_digest="${snapshot_digest%% *}"
  [[ "$snapshot_digest" == "$expected_digest" ]] \
    || security_fail "Backup script snapshot SHA-256 mismatch"

  # A second source validation detects metadata or pathname replacement during
  # snapshot creation; only the already-pinned bytes execute below.
  validate_backup_script_file \
    "$script_path" "$script_path" "$expected_digest" "$expected_owner" "$expected_group" "$expected_mode"
  bash "$snapshot_path"
)

run_validated_backup() {
  local manifest="$1"

  validate_backup_manifest "$manifest"
  execute_pinned_backup_script \
    "$BACKUP_SCRIPT_PATH" "$BACKUP_SCRIPT_SHA256" "$BACKUP_SCRIPT_OWNER" "$BACKUP_SCRIPT_GROUP" "$BACKUP_SCRIPT_MODE"
}

resolve_rollback_security_context() {
  if [[ "${TEST_MODE:-0}" == '1' ]]; then
    ROLLBACK_SECURITY_PROTECTED_DIR="${ROLLBACK_PROTECTED_DIR:-$PRODUCTION_ROLLBACK_PROTECTED_DIR}"
    ROLLBACK_SECURITY_EXPECTED_OWNER="${ROLLBACK_EXPECTED_OWNER:-$PRODUCTION_ROLLBACK_EXPECTED_OWNER}"
    ROLLBACK_SECURITY_EXPECTED_GROUP="${ROLLBACK_EXPECTED_GROUP:-$PRODUCTION_ROLLBACK_EXPECTED_GROUP}"
  else
    [[ -z "${ROLLBACK_PROTECTED_DIR:-}" && -z "${ROLLBACK_EXPECTED_OWNER:-}" && -z "${ROLLBACK_EXPECTED_GROUP:-}" ]] \
      || security_fail "Rollback security overrides require TEST_MODE=1"
    ROLLBACK_SECURITY_PROTECTED_DIR="$PRODUCTION_ROLLBACK_PROTECTED_DIR"
    ROLLBACK_SECURITY_EXPECTED_OWNER="$PRODUCTION_ROLLBACK_EXPECTED_OWNER"
    ROLLBACK_SECURITY_EXPECTED_GROUP="$PRODUCTION_ROLLBACK_EXPECTED_GROUP"
  fi
}

validate_rollback_protected_directory() {
  local owner group mode

  require_canonical_directory_without_symlinks "$ROLLBACK_SECURITY_PROTECTED_DIR" 'Rollback protected directory'
  owner="$(file_owner "$ROLLBACK_SECURITY_PROTECTED_DIR")" || security_fail 'Unable to read rollback protected directory owner'
  group="$(file_group "$ROLLBACK_SECURITY_PROTECTED_DIR")" || security_fail 'Unable to read rollback protected directory group'
  mode="0$(file_mode "$ROLLBACK_SECURITY_PROTECTED_DIR")" || security_fail 'Unable to read rollback protected directory mode'
  [[ "$owner" == "$ROLLBACK_SECURITY_EXPECTED_OWNER" ]] || security_fail 'Rollback protected directory owner mismatch'
  [[ "$group" == "$ROLLBACK_SECURITY_EXPECTED_GROUP" ]] || security_fail 'Rollback protected directory group mismatch'
  [[ "$mode" == '0700' ]] || security_fail 'Rollback protected directory mode must be exactly 0700'
}

validate_canonical_timestamp() {
  local timestamp="$1"
  local parsed

  [[ "$timestamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || security_fail "Receipt timestamp is not canonical UTC"
  if date --version >/dev/null 2>&1; then
    parsed="$(date -u -d "$timestamp" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)" \
      || security_fail "Receipt timestamp is invalid"
  else
    parsed="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$timestamp" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)" \
      || security_fail "Receipt timestamp is invalid"
  fi
  [[ "$parsed" == "$timestamp" ]] || security_fail "Receipt timestamp is not canonical UTC"
}

read_secured_receipt_snapshot() {
  local receipt="$1"
  local expected_owner="$2"
  local expected_group="$3"
  local descriptor_path path_identity descriptor_identity owner group mode snapshot_with_sentinel
  local path_identity_after descriptor_identity_after owner_after group_after mode_after

  [[ ! -L "$receipt" && -f "$receipt" ]] || security_fail "Compatibility receipt must be a non-symlink regular file"
  exec 9< "$receipt" || security_fail "Unable to open compatibility receipt"
  if [[ -e /proc/self/fd/9 ]]; then
    descriptor_path='/proc/self/fd/9'
  else
    descriptor_path='/dev/fd/9'
  fi
  [[ -f "$descriptor_path" ]] || {
    exec 9<&-
    security_fail "Opened compatibility receipt is not a regular file"
  }

  path_identity="$(file_identity "$receipt")" || {
    exec 9<&-
    security_fail "Unable to identify compatibility receipt"
  }
  descriptor_identity="$(file_identity "$descriptor_path")" || {
    exec 9<&-
    security_fail "Unable to identify opened compatibility receipt"
  }
  owner="$(file_owner "$descriptor_path")" || {
    exec 9<&-
    security_fail "Unable to read compatibility receipt owner"
  }
  group="$(file_group "$descriptor_path")" || {
    exec 9<&-
    security_fail "Unable to read compatibility receipt group"
  }
  mode="0$(file_mode "$descriptor_path")" || {
    exec 9<&-
    security_fail "Unable to read compatibility receipt mode"
  }
  [[ "$path_identity" == "$descriptor_identity" && ! -L "$receipt" && -f "$receipt" ]] || {
    exec 9<&-
    security_fail "Compatibility receipt changed while opening"
  }
  [[ "$owner" == "$expected_owner" ]] || {
    exec 9<&-
    security_fail "Compatibility receipt owner mismatch"
  }
  [[ "$group" == "$expected_group" ]] || {
    exec 9<&-
    security_fail "Compatibility receipt group mismatch"
  }
  [[ "$mode" == '0600' ]] || {
    exec 9<&-
    security_fail "Compatibility receipt mode must be exactly 0600"
  }

  snapshot_with_sentinel="$(cat <&9; printf '__BUILDINGOS_RECEIPT_END__')" || {
    exec 9<&-
    security_fail "Unable to read compatibility receipt"
  }
  path_identity_after="$(file_identity "$receipt")" || {
    exec 9<&-
    security_fail "Compatibility receipt path changed while reading"
  }
  descriptor_identity_after="$(file_identity "$descriptor_path")" || {
    exec 9<&-
    security_fail "Opened compatibility receipt changed while reading"
  }
  owner_after="$(file_owner "$descriptor_path")" || {
    exec 9<&-
    security_fail "Unable to re-read compatibility receipt owner"
  }
  group_after="$(file_group "$descriptor_path")" || {
    exec 9<&-
    security_fail "Unable to re-read compatibility receipt group"
  }
  mode_after="0$(file_mode "$descriptor_path")" || {
    exec 9<&-
    security_fail "Unable to re-read compatibility receipt mode"
  }
  [[ "$path_identity_after" == "$path_identity" && "$descriptor_identity_after" == "$descriptor_identity" && "$owner_after" == "$owner" && "$group_after" == "$group" && "$mode_after" == "$mode" && ! -L "$receipt" && -f "$receipt" ]] || {
    exec 9<&-
    security_fail "Compatibility receipt changed while reading"
  }
  exec 9<&-
  SECURED_RECEIPT_SNAPSHOT="${snapshot_with_sentinel%__BUILDINGOS_RECEIPT_END__}"
}

validate_rollback_receipt() {
  local receipt="$1"
  local expected_target_sha="$2"
  local expected_previous_sha="$3"
  local expected_api_digest="$4"
  local expected_web_digest="$5"
  local receipt_parent receipt_name body receipt_id timestamp compatibility target_sha previous_sha api_digest web_digest migration_count
  local -a lines=()

  [[ "$expected_target_sha" =~ ^[0-9a-f]{40}$ && "$expected_previous_sha" =~ ^[0-9a-f]{40}$ ]] \
    || security_fail "Receipt SHA arguments must be exactly 40 lowercase hexadecimal characters"
  [[ "$expected_api_digest" =~ ^sha256:[0-9a-f]{64}$ && "$expected_web_digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || security_fail "Receipt digest arguments must be immutable SHA-256 digests"

  resolve_rollback_security_context
  validate_rollback_protected_directory
  [[ "$receipt" == /* && "$receipt" != *'//'* && "$receipt" != *'/./'* && "$receipt" != *'/../'* && "$receipt" != */. && "$receipt" != */.. ]] \
    || security_fail "Compatibility receipt path is not lexically canonical"
  receipt_parent="${receipt%/*}"
  receipt_name="${receipt##*/}"
  [[ "$receipt_parent" == "$ROLLBACK_SECURITY_PROTECTED_DIR" && "$receipt_name" == *.receipt ]] \
    || security_fail "Compatibility receipt must be a direct child of the protected directory"
  [[ ! -L "$receipt_parent" ]] || security_fail "Compatibility receipt parent must not be a symbolic link"

  read_secured_receipt_snapshot "$receipt" "$ROLLBACK_SECURITY_EXPECTED_OWNER" "$ROLLBACK_SECURITY_EXPECTED_GROUP"
  [[ "$SECURED_RECEIPT_SNAPSHOT" != *$'\r'* ]] || security_fail "Compatibility receipt must use LF, not CRLF"
  [[ "$SECURED_RECEIPT_SNAPSHOT" == *$'\n' ]] || security_fail "Compatibility receipt must end with exactly one LF"
  [[ "$SECURED_RECEIPT_SNAPSHOT" != *$'\n\n' ]] || security_fail "Compatibility receipt contains a blank or extra trailing line"

  body="${SECURED_RECEIPT_SNAPSHOT%$'\n'}"
  while IFS= read -r line; do
    lines+=("$line")
  done <<< "$body"
  [[ "${#lines[@]}" -eq 9 ]] || security_fail "Compatibility receipt must contain exactly nine ordered v2 fields"
  [[ "${lines[0]}" == "receipt_version=$ROLLBACK_RECEIPT_VERSION" ]] || security_fail "Compatibility receipt version mismatch"
  [[ "${lines[1]}" == receipt_id=* ]] || security_fail "Compatibility receipt field 2 must be receipt_id"
  [[ "${lines[2]}" == timestamp_utc=* ]] || security_fail "Compatibility receipt field 3 must be timestamp_utc"
  [[ "${lines[3]}" == compatibility=* ]] || security_fail "Compatibility receipt field 4 must be compatibility"
  [[ "${lines[4]}" == target_sha=* ]] || security_fail "Compatibility receipt field 5 must be target_sha"
  [[ "${lines[5]}" == previous_sha=* ]] || security_fail "Compatibility receipt field 6 must be previous_sha"
  [[ "${lines[6]}" == previous_api_digest=* ]] || security_fail "Compatibility receipt field 7 must be previous_api_digest"
  [[ "${lines[7]}" == previous_web_digest=* ]] || security_fail "Compatibility receipt field 8 must be previous_web_digest"
  [[ "${lines[8]}" == migration_count=* ]] || security_fail "Compatibility receipt field 9 must be migration_count"

  receipt_id="${lines[1]#receipt_id=}"
  timestamp="${lines[2]#timestamp_utc=}"
  compatibility="${lines[3]#compatibility=}"
  target_sha="${lines[4]#target_sha=}"
  previous_sha="${lines[5]#previous_sha=}"
  api_digest="${lines[6]#previous_api_digest=}"
  web_digest="${lines[7]#previous_web_digest=}"
  migration_count="${lines[8]#migration_count=}"

  [[ "$receipt_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || security_fail "Receipt ID is invalid"
  [[ "$receipt_name" == "$receipt_id.receipt" ]] || security_fail "Receipt filename does not match receipt_id"
  validate_canonical_timestamp "$timestamp"
  [[ "$compatibility" == 'SAFE' ]] || security_fail "Rollback compatibility is not SAFE"
  [[ "$target_sha" == "$expected_target_sha" ]] || security_fail "Receipt target SHA mismatch"
  [[ "$previous_sha" == "$expected_previous_sha" ]] || security_fail "Receipt previous SHA mismatch"
  [[ "$api_digest" == "$expected_api_digest" ]] || security_fail "Receipt API digest mismatch"
  [[ "$web_digest" == "$expected_web_digest" ]] || security_fail "Receipt Web digest mismatch"
  [[ "$migration_count" =~ ^(0|[1-9][0-9]*)$ ]] || security_fail "Receipt migration count is not canonical"

  # shellcheck disable=SC2034 # Output consumed by rollback-production.sh after sourcing this file.
  VALIDATED_ROLLBACK_MIGRATION_COUNT="$migration_count"
}

database_contracts_match() {
  local previous_sha="$1"
  local target_sha="$2"
  local comparison_status

  [[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]] || security_fail 'Previous SHA is required for database contract comparison'
  [[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || security_fail 'Target SHA is required for database contract comparison'
  command -v git >/dev/null 2>&1 || security_fail 'git is required for database contract comparison'
  git cat-file -e "${previous_sha}^{commit}" >/dev/null 2>&1 \
    || security_fail 'Previous SHA cannot be resolved for database contract comparison'
  git cat-file -e "${target_sha}^{commit}" >/dev/null 2>&1 \
    || security_fail 'Target SHA cannot be resolved for database contract comparison'

  if git diff --no-ext-diff --no-textconv --quiet \
    "$previous_sha" "$target_sha" -- \
    apps/api/prisma/schema.prisma apps/api/prisma/migrations; then
    return 0
  else
    comparison_status=$?
  fi

  [[ "$comparison_status" -eq 1 ]] \
    || security_fail 'Unable to compare database contract between SHAs'
  return 1
}

validate_application_rollback_compatibility() {
  local postgres_container="${1:-pawtech-postgres}"
  local database_name="${2:-buildingos_db}"
  local previous_sha="${3:-}"
  local target_sha="${4:-}"
  local result

  [[ "$#" -eq 4 ]] || security_fail 'Application rollback compatibility requires previous and target SHAs'
  ROLLBACK_COMPATIBILITY_BASIS=''
  ROLLBACK_COMPATIBILITY_PREVIOUS_SHA=''
  ROLLBACK_COMPATIBILITY_TARGET_SHA=''

  if database_contracts_match "$previous_sha" "$target_sha"; then
    ROLLBACK_COMPATIBILITY_BASIS='SAME_DB_CONTRACT'
    ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$previous_sha"
    ROLLBACK_COMPATIBILITY_TARGET_SHA="$target_sha"
    printf 'Application rollback compatibility verified: SAFE (basis=SAME_DB_CONTRACT)\n'
    return 0
  fi

  [[ "$postgres_container" =~ ^[A-Za-z0-9_.-]+$ ]] || security_fail 'Unsafe PostgreSQL container name'
  [[ "$database_name" =~ ^[a-z0-9_]+$ ]] || security_fail 'Unsafe database name'
  command -v docker >/dev/null 2>&1 || security_fail 'docker is required for compatibility validation'
  docker inspect "$postgres_container" >/dev/null 2>&1 || security_fail 'PostgreSQL container is unavailable for compatibility validation'

  result="$({
    docker exec -i "$postgres_container" sh -lc \
      'exec psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$1"' sh "$database_name" <<'SQL'
BEGIN READ ONLY;
SELECT CASE WHEN
  (
    SELECT count(*) FROM "RecurringExpense" WHERE "buildingId" IS NULL
  )
  + (SELECT count(*) FROM "ExchangeRate")
  + (SELECT count(*) FROM "Expense" WHERE "functionalAmountMinor" IS NOT NULL)
  + (SELECT count(*) FROM "Income" WHERE "functionalAmountMinor" IS NOT NULL)
  + (SELECT count(*) FROM "Adjustment" WHERE "functionalAmountMinor" IS NOT NULL)
  + (SELECT count(*) FROM "Payment" WHERE "functionalAmountMinor" IS NOT NULL)
  + (SELECT count(*) FROM "PaymentAllocation" WHERE "paymentOriginalAmountMinor" IS NOT NULL)
  + (SELECT count(*) FROM "Liquidation" WHERE "valuationMode" IS NOT NULL)
  + (SELECT count(*) FROM "Fund")
  + (SELECT count(*) FROM "FundTransaction")
  + (SELECT count(*) FROM "IncomeApplication")
  + (SELECT count(*) FROM "IncomePolicy")
  + (SELECT count(*) FROM "LiquidationIncomeOffset") = 0
THEN 'SAFE' ELSE 'UNSAFE' END;
COMMIT;
SQL
  } 2>/dev/null)" || security_fail 'Unable to validate application rollback compatibility'

  [[ "$result" == 'SAFE' ]] || security_fail 'New-schema data makes application rollback unsafe'
  ROLLBACK_COMPATIBILITY_BASIS='DATA_COMPATIBILITY'
  ROLLBACK_COMPATIBILITY_PREVIOUS_SHA="$previous_sha"
  ROLLBACK_COMPATIBILITY_TARGET_SHA="$target_sha"
  printf 'Application rollback compatibility verified: SAFE (basis=DATA_COMPATIBILITY)\n'
}

generate_rollback_compatibility_receipt() {
  local target_sha="$1"
  local previous_sha="$2"
  local previous_api_digest="$3"
  local previous_web_digest="$4"
  local migration_count="$5"
  local receipt_id receipt timestamp_utc

  [[ "$target_sha" =~ ^[0-9a-f]{40}$ && "$previous_sha" =~ ^[0-9a-f]{40}$ ]] \
    || security_fail 'Receipt generation requires exact commit SHAs'
  [[ "$previous_api_digest" =~ ^sha256:[0-9a-f]{64}$ && "$previous_web_digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || security_fail 'Receipt generation requires immutable image digests'
  [[ "$migration_count" == '97' ]] || security_fail 'Receipt generation requires exactly 97 applied migrations'
  [[ "$ROLLBACK_COMPATIBILITY_BASIS" == 'SAME_DB_CONTRACT' || "$ROLLBACK_COMPATIBILITY_BASIS" == 'DATA_COMPATIBILITY' ]] \
    || security_fail 'Receipt generation requires validated rollback compatibility'
  [[ "$ROLLBACK_COMPATIBILITY_TARGET_SHA" == "$target_sha" && "$ROLLBACK_COMPATIBILITY_PREVIOUS_SHA" == "$previous_sha" ]] \
    || security_fail 'Receipt generation inputs differ from validated rollback compatibility'

  resolve_rollback_security_context
  if [[ ! -e "$ROLLBACK_SECURITY_PROTECTED_DIR" ]]; then
    (umask 077 && mkdir "$ROLLBACK_SECURITY_PROTECTED_DIR") \
      || security_fail 'Unable to create rollback protected directory'
  fi
  validate_rollback_protected_directory

  receipt_id="rollback-$target_sha"
  receipt="$ROLLBACK_SECURITY_PROTECTED_DIR/$receipt_id.receipt"
  if [[ -e "$receipt" || -L "$receipt" ]]; then
    validate_rollback_receipt "$receipt" "$target_sha" "$previous_sha" "$previous_api_digest" "$previous_web_digest"
    printf '%s\n' "$receipt"
    return
  fi
  timestamp_utc="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" || security_fail 'Unable to generate receipt timestamp'

  if ! (
    umask 077
    set -o noclobber
    printf 'receipt_version=%s\nreceipt_id=%s\ntimestamp_utc=%s\ncompatibility=SAFE\ntarget_sha=%s\nprevious_sha=%s\nprevious_api_digest=%s\nprevious_web_digest=%s\nmigration_count=%s\n' \
      "$ROLLBACK_RECEIPT_VERSION" "$receipt_id" "$timestamp_utc" "$target_sha" "$previous_sha" \
      "$previous_api_digest" "$previous_web_digest" "$migration_count" > "$receipt"
  ); then
    security_fail 'Unable to create rollback compatibility receipt without clobbering'
  fi
  validate_rollback_receipt "$receipt" "$target_sha" "$previous_sha" "$previous_api_digest" "$previous_web_digest"
  printf '%s\n' "$receipt"
}

production_security_usage() {
  cat >&2 <<'EOF'
Usage:
  production-security-validate.sh backup-manifest <manifest>
  production-security-validate.sh backup-identity <manifest>
  production-security-validate.sh run-backup <manifest>
  production-security-validate.sh rollback-receipt <receipt> <target_sha> <previous_sha> <api_digest> <web_digest>
EOF
  return 64
}

production_security_main() {
  local command="${1:-}"
  [[ $# -gt 0 ]] && shift

  case "$command" in
    backup-manifest)
      [[ $# -eq 1 ]] || production_security_usage
      validate_backup_manifest "$1"
      ;;
    backup-identity)
      [[ $# -eq 1 ]] || production_security_usage
      validate_backup_identity "$1"
      ;;
    run-backup)
      [[ $# -eq 1 ]] || production_security_usage
      run_validated_backup "$1"
      ;;
    rollback-receipt)
      [[ $# -eq 5 ]] || production_security_usage
      validate_rollback_receipt "$1" "$2" "$3" "$4" "$5"
      ;;
    *)
      production_security_usage
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  production_security_main "$@"
fi
