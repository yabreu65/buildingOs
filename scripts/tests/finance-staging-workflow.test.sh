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
const workflowDispatch = (acceptance.on ?? acceptance[true])?.workflow_dispatch;
const acceptanceSteps = acceptance.jobs?.acceptance?.steps ?? [];
const diagnosticStep = acceptanceSteps.find((step) => step.name === 'Inspect staging runtime environment (diagnostic only)');
const passwordStep = acceptanceSteps.find((step) => step.name === 'Generate ephemeral Golden QA password');
const financeStep = acceptanceSteps.find((step) => step.name === 'Run controlled staging acceptance over SSH');

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
if (workflowDispatch?.inputs?.diagnostic_only?.type !== 'boolean') {
  throw new Error('finance acceptance diagnostic_only input must be boolean');
}
if (workflowDispatch.inputs.diagnostic_only.default !== false) {
  throw new Error('finance acceptance diagnostic_only input must default to false');
}
if (diagnosticStep?.if !== '${{ inputs.diagnostic_only == true }}') {
  throw new Error('diagnostic step must run only in diagnostic mode');
}
if (passwordStep?.if !== '${{ inputs.diagnostic_only != true }}' || financeStep?.if !== '${{ inputs.diagnostic_only != true }}') {
  throw new Error('finance acceptance steps must be excluded in diagnostic mode');
}
const diagnosticRun = diagnosticStep?.run ?? '';
for (const forbidden of ['finance-staging-acceptance.sh', 'finance-staging-acceptance.mjs', 'api-seed-staging-golden', 'migrate']) {
  if (diagnosticRun.includes(forbidden)) {
    throw new Error(`diagnostic mode must not invoke ${forbidden}`);
  }
}
for (const output of ['api_app_env=', 'api_node_env=', 'web_app_env=', 'web_node_env=', 'api_revision=', 'web_revision=']) {
  if (!diagnosticRun.includes(output)) {
    throw new Error(`diagnostic mode must report ${output}`);
  }
}

console.log('PASS: finance acceptance serializes with staging deployment');
NODE
