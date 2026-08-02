#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_BRANCH_PATTERN='^release/prod-wave-[0-9]+(-[a-z0-9][a-z0-9-]*)?$'
readonly EXPECTED_REMOTE_DIR='/opt/pawtech/apps/buildingos-release-staging/buildingos-app'
readonly EXPECTED_ROOT='/opt/pawtech/apps/buildingos-release-staging'
readonly EXPECTED_COMPOSE_PROJECT='buildingos-release-staging'
readonly EXPECTED_COMPOSE_FILE='infra/docker/docker-compose.release-staging.yml'
readonly EXPECTED_ENV_FILE='/opt/pawtech/env/buildingos-release-staging.env'
readonly BLOCKED_ROOT_PROD='/opt/pawtech/apps/buildingos'
readonly BLOCKED_ROOT_STAGING='/opt/pawtech/apps/buildingos-staging'

usage() {
  printf 'Usage: %s <branch> <previous_sha>\n' "${0##*/}" >&2
  exit 64
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

trap 'rc=$?; printf "ERROR: rollback failed at line %s (exit %s)\n" "$LINENO" "$rc" >&2' ERR

validate_sha() {
  local sha="$1"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "SHA must be exactly 40 lowercase hex characters"
}

validate_branch() {
  local branch="$1"

  [[ -n "$branch" ]] || fail "Branch cannot be empty"
  [[ "$branch" != '/' ]] || fail "Branch cannot be /"
  [[ "$branch" != main ]] || fail "Branch main is not allowed"
  [[ "$branch" != staging ]] || fail "Branch staging is not allowed"
  [[ "$branch" != develop ]] || fail "Branch develop is not allowed"
  [[ "$branch" != feature/* ]] || fail "Feature branches are not allowed"
  [[ "$branch" != fix/* ]] || fail "Fix branches are not allowed"
  [[ "$branch" != chore/* ]] || fail "Chore branches are not allowed"
  [[ "$branch" =~ $EXPECTED_BRANCH_PATTERN ]] || fail "Branch must match release/prod-wave-* pattern"
}

validate_exact_setting() {
  local label="$1"
  local actual="$2"
  local expected="$3"

  [[ -n "$actual" ]] || fail "$label cannot be empty"
  [[ "$actual" == "$expected" ]] || fail "$label must be exactly: $expected"
}

read_setting() {
  local env_name="$1"
  local default_value="$2"

  if [[ -n "${!env_name+x}" ]]; then
    printf '%s' "${!env_name}"
  else
    printf '%s' "$default_value"
  fi
}

record_evidence() {
  local status="$1"
  local branch="$2"
  local previous_sha="$3"
  local target_sha="$4"

  install -d -m 700 "$EXPECTED_ROOT/deployments"
  local evidence_file="$EXPECTED_ROOT/deployments/rollback-$(date -u +%Y%m%dT%H%M%SZ)-${target_sha}.txt"
  umask 077
  {
    printf 'timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'status=%s\n' "$status"
    printf 'branch=%s\n' "$branch"
    printf 'previous_sha=%s\n' "$previous_sha"
    printf 'target_sha=%s\n' "$target_sha"
    printf 'compose_project=%s\n' "$EXPECTED_COMPOSE_PROJECT"
    printf 'compose_file=%s\n' "$EXPECTED_COMPOSE_FILE"
    printf 'env_file=%s\n' "$EXPECTED_ENV_FILE"
    printf 'restore_db=manual_only\n'
  } > "$evidence_file"
  chmod 600 "$evidence_file"
  printf '%s\n' "$evidence_file"
}

main() {
  [[ $# -eq 2 ]] || usage

  local branch="$1"
  local target_sha="$2"
  local remote_dir
  local compose_project
  local compose_file
  local env_file

  validate_branch "$branch"
  validate_sha "$target_sha"

  remote_dir="$(read_setting RELEASE_STAGING_REMOTE_DIR "$EXPECTED_REMOTE_DIR")"
  compose_project="$(read_setting RELEASE_STAGING_COMPOSE_PROJECT "$EXPECTED_COMPOSE_PROJECT")"
  compose_file="$(read_setting RELEASE_STAGING_COMPOSE_FILE "$EXPECTED_COMPOSE_FILE")"
  env_file="$(read_setting RELEASE_STAGING_ENV_FILE "$EXPECTED_ENV_FILE")"

  validate_exact_setting 'release-staging remote directory' "$remote_dir" "$EXPECTED_REMOTE_DIR"
  validate_exact_setting 'release-staging Compose project' "$compose_project" "$EXPECTED_COMPOSE_PROJECT"
  validate_exact_setting 'release-staging Compose file' "$compose_file" "$EXPECTED_COMPOSE_FILE"
  validate_exact_setting 'release-staging env file' "$env_file" "$EXPECTED_ENV_FILE"

  case "$remote_dir" in
    ''|'/') fail "Remote directory cannot be empty or /" ;;
    "$BLOCKED_ROOT_PROD"|"$BLOCKED_ROOT_STAGING"|"$BLOCKED_ROOT_PROD"/*|"$BLOCKED_ROOT_STAGING"/*)
      fail "Remote directory must never target production or staging"
      ;;
  esac

  command -v git >/dev/null || fail "git is required"
  command -v docker >/dev/null || fail "docker is required"

  cd "$remote_dir"
  [[ -d .git ]] || fail "Git repository not found at $remote_dir"
  local origin_url
  origin_url="$(git remote get-url origin 2>/dev/null)" || fail "Remote origin is missing"
  [[ -n "$origin_url" ]] || fail "Remote origin is missing"

  local current_tree
  current_tree="$(git status --porcelain --untracked-files=all)"
  [[ -z "$current_tree" ]] || fail "Working tree must be clean before rollback"

  local previous_sha
  previous_sha="$(git rev-parse HEAD)"

  git fetch --no-tags origin "+refs/heads/$branch:refs/remotes/origin/$branch"
  git cat-file -e "$target_sha^{commit}"
  git merge-base --is-ancestor "$target_sha" "refs/remotes/origin/$branch"
  test "$(git rev-parse "$target_sha^{commit}")" = "$target_sha"

  git switch --detach --quiet "$target_sha"
  test "$(git rev-parse HEAD)" = "$target_sha"
  test -z "$(git status --porcelain --untracked-files=all)"

  local compose_cmd=(
    docker compose
    --project-name "$compose_project"
    --env-file "$env_file"
    -f "$compose_file"
  )

  "${compose_cmd[@]}" config --quiet
  "${compose_cmd[@]}" up --detach

  local smoke_output
  smoke_output="$(scripts/smoke-release-staging.sh "$target_sha" 2>&1)"
  printf '%s\n' "$smoke_output"

  record_evidence "SUCCESS" "$branch" "$previous_sha" "$target_sha" >/dev/null
  printf 'Rollback completed for %s to %s\n' "$branch" "$target_sha"
  printf 'Manual database restore is not performed automatically in Wave 0; keep restore separate if a future wave requires it.\n'
}

main "$@"
