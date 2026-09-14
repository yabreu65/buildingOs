#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:4000}"

fail() {
  printf 'WORK_REMAINS: %s\n' "$*" >&2
  printf 'Push is FORBIDDEN.\n' >&2
  exit 1
}

reject_dirty_tracked_tree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    fail 'tracked changes are present; pre-push validation must cover the exact committed HEAD candidate'
  fi
}

reject_unexpected_untracked() {
  local untracked
  untracked="$(git ls-files --others --exclude-standard | awk '$0 !~ /^\.codegraph(\/|$)/')"
  if [[ -n "$untracked" ]]; then
    printf 'Unexpected untracked files:\n%s\n' "$untracked" >&2
    fail 'remove, ignore, or explicitly account for unexpected untracked files before the pre-push gate'
  fi
}

is_ipv4_loopback() {
  local host="$1"
  local -a octets
  local octet
  local value

  IFS='.' read -r -a octets <<< "$host"
  [[ ${#octets[@]} -eq 4 ]] || return 1

  for octet in "${octets[@]}"; do
    [[ "$octet" =~ ^[0-9]{1,3}$ ]] || return 1
    value=$((10#$octet))
    (( value <= 255 )) || return 1
  done

  [[ "${octets[0]}" == '127' ]]
}

is_local_test_database() {
  local url="$1"
  local host
  local database

  host="$(printf '%s\n' "$url" | sed -E 's#^[[:alnum:]][[:alnum:]+.-]*://([^@/]*@)?(\[[^]]+\]|[^/:?]+).*#\2#')"
  database="${url%%\?*}"
  database="${database##*/}"

  case "$host" in
    localhost|::1|\[::1\]) ;;
    *) is_ipv4_loopback "$host" || return 1 ;;
  esac

  case "$database" in
    *test*|*_ci|*_quality) [[ "$database" != "buildingos" ]] ;;
    *) return 1 ;;
  esac
}

require_seed_test_database() {
  if [[ "${QUALITY_SEED_TEST_DATABASE_CONFIRMED:-}" != "1" ]]; then
    fail 'seed-sensitive paths require QUALITY_SEED_TEST_DATABASE_CONFIRMED=1'
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    fail 'seed-sensitive paths require an explicit disposable local DATABASE_URL'
  fi
  if ! is_local_test_database "$DATABASE_URL"; then
    fail 'DATABASE_URL must use localhost/loopback and a test-like database name, never exactly buildingos'
  fi
}

is_backend_production_path() {
  local path="$1"

  case "$path" in
    apps/api/src/*)
      case "$path" in
        *.spec.ts|*.test.ts|*/__tests__/*|*/test/*|*/tests/*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

if ! git fetch origin main; then
  fail 'unable to fetch origin/main; refusing to determine changed paths'
fi

if ! git rev-parse --verify --quiet origin/main >/dev/null; then
  fail 'origin/main is unavailable after fetch; refusing to determine changed paths'
fi

reject_dirty_tracked_tree
reject_unexpected_untracked

if [[ "${QUALITY_GATES_INTERNAL_HARNESS:-}" != '1' ]]; then
  printf '+ bash scripts/tests/quality-gates.test.sh\n'
  bash "$REPO_ROOT/scripts/tests/quality-gates.test.sh" || fail 'quality gate harness failed'
fi

if ! changed_paths="$(git diff --name-only origin/main...HEAD)"; then
  fail 'unable to determine changed paths from origin/main...HEAD'
fi

needs_seed_test=0
needs_prisma_gate=0
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  case "$path" in
    apps/api/prisma/schema.prisma|apps/api/prisma/migrations/*|apps/api/prisma/seed.test.ts|apps/api/prisma/seed*.ts|apps/api/prisma/lib/seed-*|apps/api/prisma/lib/*seed*)
      needs_seed_test=1
      ;;
  esac
  if is_backend_production_path "$path"; then
    needs_seed_test=1
  fi
  case "$path" in
    apps/api/prisma/schema.prisma|apps/api/prisma/migrations/*)
      needs_prisma_gate=1
      ;;
  esac
done <<< "$changed_paths"

if (( needs_seed_test )); then
  require_seed_test_database
  printf '+ npm run seed:test -w apps/api\n'
  DATABASE_URL="$DATABASE_URL" npm run seed:test -w apps/api || fail 'seed:test failed'
fi

if (( needs_prisma_gate )); then
  printf '+ npm exec --workspace @buildingos/api -- prisma validate\n'
  npm exec --workspace @buildingos/api -- prisma validate || fail 'prisma validate failed'
  printf '+ scripts/quality/migration-upgrade-gate.sh\n'
  bash "$REPO_ROOT/scripts/quality/migration-upgrade-gate.sh" || fail 'migration upgrade gate failed'
fi

printf '+ npm run lint:ci\n'
npm run lint:ci || fail 'lint:ci failed'
printf '+ npm run test:ci\n'
npm run test:ci || fail 'test:ci failed'
printf '+ npm run build:ci\n'
npm run build:ci || fail 'build:ci failed'
printf '+ git diff --check origin/main...HEAD\n'
git diff --check origin/main...HEAD || fail 'git diff --check origin/main...HEAD failed'

printf 'PASS: local candidate pre-push parity gate completed.\n'
