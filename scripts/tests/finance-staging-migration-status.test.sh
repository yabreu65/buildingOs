#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly SCRIPT="$ROOT_DIR/scripts/finance-staging-acceptance.sh"

run_status_case() {
  local name="$1"
  local expected="$2"
  shift 2
  local output
  local status

  set +e
  output="$(bash -c 'source "$1"; shift; check_migration_status "$@"' bash "$SCRIPT" "$@" 2>&1)"
  status=$?
  set -e

  if [[ "$expected" == 'success' ]]; then
    [[ "$status" -eq 0 ]] || { printf 'FAIL: %s was rejected\n%s\n' "$name" "$output" >&2; exit 1; }
  else
    [[ "$status" -ne 0 ]] || { printf 'FAIL: %s was accepted\n' "$name" >&2; exit 1; }
    [[ "$output" == *'staging Prisma migration status is not healthy'* ]] || {
      printf 'FAIL: %s did not report an unhealthy migration status\n%s\n' "$name" "$output" >&2
      exit 1
    }
  fi
}

run_status_case 'healthy Prisma 5.22 status' success bash -c 'printf "%s\n" "Database schema is up to date!"'
run_status_case 'pending migration status' rejected bash -c 'printf "%s\n" "Following migration(s) have not yet been applied" >&2; exit 1'
run_status_case 'failed migration status' rejected bash -c 'printf "%s\n" "The migration failed" >&2; exit 1'

printf 'PASS: Prisma migration status exit contract is enforced\n'
