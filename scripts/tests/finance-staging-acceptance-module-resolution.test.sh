#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ACCEPTANCE_SCRIPT="$ROOT_DIR/scripts/finance-staging-acceptance.sh"
readonly SMOKE_SCRIPT_HOST="$ROOT_DIR/scripts/tests/finance-staging-acceptance-module-resolution-smoke.mjs"
readonly IMAGE='buildingos-finance-acceptance-module-resolution-smoke:local'
readonly SMOKE_SCRIPT_CONTAINER='/app/apps/api/finance-staging-acceptance-module-resolution-smoke.mjs'

node - "$ACCEPTANCE_SCRIPT" <<'NODE'
const fs = require('fs');

const source = fs.readFileSync(process.argv[2], 'utf8');
const oldTarget = ':/opt/finance-staging-acceptance.mjs:ro';
const newTarget = ':/app/apps/api/finance-staging-acceptance.mjs:ro';
const executionPath = '--entrypoint node buildingos-api /app/apps/api/finance-staging-acceptance.mjs';

if (source.includes(oldTarget) || source.includes('/opt/finance-staging-acceptance.mjs')) {
  throw new Error('acceptance module must not use the /opt mount or execution path');
}
if (!source.includes(newTarget)) {
  throw new Error('acceptance module must be mounted read-only under the API package tree');
}
if (!source.includes(executionPath)) {
  throw new Error('acceptance module must execute from the mounted API package path');
}
if (source.includes('npm install') || source.includes('npm ci')) {
  throw new Error('acceptance must not install runtime dependencies');
}

console.log('PASS: acceptance module mount and execution path are safe');
NODE

cleanup() {
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build \
  --file "$ROOT_DIR/apps/api/Dockerfile" \
  --target runtime \
  --tag "$IMAGE" \
  "$ROOT_DIR" >/dev/null

docker run --rm \
  --network none \
  --env DATABASE_URL='postgresql://smoke:smoke@127.0.0.1:1/smoke' \
  --volume "$SMOKE_SCRIPT_HOST:$SMOKE_SCRIPT_CONTAINER:ro" \
  --entrypoint node \
  "$IMAGE" "$SMOKE_SCRIPT_CONTAINER"
