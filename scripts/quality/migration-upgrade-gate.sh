#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

fail() {
  printf 'WORK_REMAINS: migration upgrade gate failed: %s\n' "$*" >&2
  exit 1
}

BASE_REF="${BASE_REF:-main}"
CURRENT_REF="${CURRENT_REF:-HEAD}"
if ! BASE_COMMIT="$(git rev-parse --verify --quiet "${BASE_REF}^{commit}")"; then
  fail "BASE_REF does not resolve to a commit: $BASE_REF"
fi
if ! CURRENT_COMMIT="$(git rev-parse --verify --quiet "${CURRENT_REF}^{commit}")"; then
  fail "CURRENT_REF does not resolve to a commit: $CURRENT_REF"
fi
if [[ "$CURRENT_COMMIT" != "$(git rev-parse HEAD)" ]]; then
  fail 'CURRENT_REF must resolve to the checked-out candidate HEAD'
fi

# The gate always constructs its own local URLs and never accepts the caller's target.
unset DATABASE_URL

BASE_WORKTREE="$(mktemp -d /tmp/buildingos-migration-base.XXXXXX)"
CONTAINER_NAME="buildingos-migration-quality-$(openssl rand -hex 8)"
POSTGRES_USER="quality_$(openssl rand -hex 8)"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
CURRENT_DB="quality_current_$(openssl rand -hex 8)"
UPGRADE_DB="quality_upgrade_$(openssl rand -hex 8)"
WORKTREE_ADDED=0
CONTAINER_STARTED=0

cleanup() {
  if (( CONTAINER_STARTED )); then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  if (( WORKTREE_ADDED )); then
    git worktree remove --force "$BASE_WORKTREE" >/dev/null 2>&1 || true
  fi
  rmdir "$BASE_WORKTREE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! git worktree add --detach "$BASE_WORKTREE" "$BASE_COMMIT" >/dev/null; then
  fail 'unable to create detached base worktree'
fi
WORKTREE_ADDED=1

if ! docker run -d --rm --name "$CONTAINER_NAME" \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB=postgres \
  -p 127.0.0.1::5432 \
  postgres:16-alpine >/dev/null; then
  fail 'unable to start disposable local postgres:16-alpine container'
fi
CONTAINER_STARTED=1

for _ in $(awk 'BEGIN { for (i = 1; i <= 30; i++) print i }'); do
  if docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
  pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; then
  fail 'local postgres did not become ready'
fi

LOCAL_PORT="$(docker port "$CONTAINER_NAME" 5432/tcp | awk -F: 'NR == 1 { print $NF }')"
if [[ ! "$LOCAL_PORT" =~ ^[0-9]+$ ]]; then
  fail 'could not determine the random local postgres port'
fi

create_database() {
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE \"$1\";" >/dev/null
}

create_database "$CURRENT_DB"
create_database "$UPGRADE_DB"
CURRENT_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${LOCAL_PORT}/${CURRENT_DB}"
UPGRADE_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${LOCAL_PORT}/${UPGRADE_DB}"

printf '+ current: prisma generate and migrate deploy on a clean disposable database\n'
(
  cd "$REPO_ROOT"
  DATABASE_URL="$CURRENT_DATABASE_URL" npm exec --workspace @buildingos/api -- prisma generate
  DATABASE_URL="$CURRENT_DATABASE_URL" npm exec --workspace @buildingos/api -- prisma migrate deploy
) || fail 'current branch cannot generate and migrate a clean database'

if [[ ! -d "$BASE_WORKTREE/node_modules" ]]; then
  printf '+ base: npm ci (node_modules absent)\n'
  (cd "$BASE_WORKTREE" && npm ci) || fail 'base worktree dependency installation failed'
fi

printf '+ base: build packages, generate, migrate, and seed disposable upgrade database\n'
(
  cd "$BASE_WORKTREE"
  npm run build:packages
  DATABASE_URL="$UPGRADE_DATABASE_URL" npm exec --workspace @buildingos/api -- prisma generate
  DATABASE_URL="$UPGRADE_DATABASE_URL" npm exec --workspace @buildingos/api -- prisma migrate deploy
  DATABASE_URL="$UPGRADE_DATABASE_URL" npm run seed:test -w apps/api
) || fail 'base branch failed to prepare the disposable upgrade database'

snapshot_sql="SELECT l.\"id\", l.\"totalAmountMinor\", COUNT(c.\"id\"), COALESCE(SUM(c.\"amount\"), 0) FROM \"Liquidation\" l LEFT JOIN \"Charge\" c ON c.\"liquidationId\" = l.\"id\" WHERE l.\"period\" = '2026-04' AND l.\"status\" = 'PUBLISHED' GROUP BY l.\"id\", l.\"totalAmountMinor\" ORDER BY l.\"id\" LIMIT 1;"
capture_snapshot() {
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    psql -v ON_ERROR_STOP=1 -At -F '|' -U "$POSTGRES_USER" -d "$UPGRADE_DB" -c "$snapshot_sql"
}

baseline_snapshot="$(capture_snapshot)" || fail 'unable to capture the representative published April 2026 liquidation'
if [[ -z "$baseline_snapshot" ]]; then
  fail 'base seed did not create a representative published April 2026 liquidation'
fi

printf '+ current: prisma generate and migrate deploy on the seeded disposable upgrade database\n'
(
  cd "$REPO_ROOT"
  DATABASE_URL="$UPGRADE_DATABASE_URL" npm exec --workspace @buildingos/api -- prisma generate
  DATABASE_URL="$UPGRADE_DATABASE_URL" npm exec --workspace @buildingos/api -- prisma migrate deploy
) || fail 'current branch failed to upgrade the seeded disposable database'

upgraded_snapshot="$(capture_snapshot)" || fail 'unable to capture the upgraded representative liquidation'
if [[ "$baseline_snapshot" != "$upgraded_snapshot" ]]; then
  fail 'published April 2026 liquidation ID, total, charge count, or charge sum changed across upgrade'
fi

printf '+ RUN_POSTGRES_INTEGRATION=1 POSTGRES_TEST_DB_NAME=<disposable> DATABASE_URL=<disposable> npm run test -w apps/api -- --runInBand src/finanzas/liquidation-publication.postgres.spec.ts\n'
(
  cd "$REPO_ROOT"
  RUN_POSTGRES_INTEGRATION=1 POSTGRES_TEST_DB_NAME="$UPGRADE_DB" DATABASE_URL="$UPGRADE_DATABASE_URL" \
    npm run test -w apps/api -- --runInBand src/finanzas/liquidation-publication.postgres.spec.ts
) || fail 'liquidation publication PostgreSQL integration test failed'

printf 'PASS: disposable local migration upgrade foundation completed.\n'
