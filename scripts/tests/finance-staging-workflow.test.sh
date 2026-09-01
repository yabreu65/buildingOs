#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ACCEPTANCE_WORKFLOW="$ROOT_DIR/.github/workflows/finance-staging-acceptance.yml"
readonly DEPLOY_WORKFLOW="$ROOT_DIR/.github/workflows/deploy-staging.yml"

node - "$ACCEPTANCE_WORKFLOW" "$DEPLOY_WORKFLOW" <<'NODE'
const fs = require('fs');
const yaml = require('js-yaml');

const [acceptancePath, deployPath] = process.argv.slice(2);
const acceptance = yaml.load(fs.readFileSync(acceptancePath, 'utf8'));
const deploy = yaml.load(fs.readFileSync(deployPath, 'utf8'));

if (acceptance.concurrency?.group !== 'staging-deploy') {
  throw new Error('finance acceptance must use the staging-deploy concurrency group');
}
if (acceptance.concurrency?.['cancel-in-progress'] !== false) {
  throw new Error('finance acceptance must not cancel an in-progress staging job');
}
if (deploy.concurrency?.group !== 'staging-deploy') {
  throw new Error('staging deployment concurrency group changed unexpectedly');
}
if (deploy.concurrency?.['cancel-in-progress'] !== false) {
  throw new Error('staging deployment cancellation policy changed unexpectedly');
}

console.log('PASS: finance acceptance serializes with staging deployment');
NODE
