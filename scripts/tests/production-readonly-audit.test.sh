#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly WORKFLOW="$ROOT_DIR/.github/workflows/production-readonly-audit.yml"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"

node - "$WORKFLOW" "$AUDITOR" <<'NODE'
const fs = require('fs');
const yaml = require('js-yaml');

const [workflowPath, auditorPath] = process.argv.slice(2);
const workflowText = fs.readFileSync(workflowPath, 'utf8');
const auditorText = fs.readFileSync(auditorPath, 'utf8');
const workflow = yaml.load(workflowText);
const trigger = workflow.on ?? workflow[true];

if (!trigger?.workflow_dispatch || Object.keys(trigger).length !== 1) {
  throw new Error('audit workflow must be workflow_dispatch only');
}
if (trigger.workflow_dispatch.inputs?.candidate_sha?.required !== true || trigger.workflow_dispatch.inputs?.candidate_sha?.type !== 'string') {
  throw new Error('candidate_sha must be a required string input');
}
if (workflow.permissions?.contents !== 'read' || Object.keys(workflow.permissions).length !== 1) {
  throw new Error('audit workflow must grant contents read only');
}
if (workflow.concurrency?.group !== 'production-operations' || workflow.concurrency?.['cancel-in-progress'] !== false) {
  throw new Error('audit workflow concurrency policy is unsafe');
}

const job = workflow.jobs?.audit;
if (job?.environment !== 'production') throw new Error('audit job must use production environment');
if (!workflowText.includes('[[ "$GITHUB_REF" == "refs/heads/main" ]]')) throw new Error('audit must require refs/heads/main');
if (!workflowText.includes('bash -s -- ${remote_args[*]}')) throw new Error('audit must stream the auditor to bash -s');
if (/\b(?:bash|sh)\s+[^\n]*deploy-production\.sh\b/.test(workflowText)) throw new Error('audit workflow must not invoke deployment tooling');
if (!workflowText.includes('PRODUCTION_SSH_HOST') || !workflowText.includes('PRODUCTION_SSH_USER') || !workflowText.includes('PRODUCTION_SSH_PRIVATE_KEY') || !workflowText.includes('PRODUCTION_SSH_KNOWN_HOSTS')) {
  throw new Error('audit workflow must use the existing production SSH secrets');
}
if (workflowText.includes('echo "$SSH_PRIVATE_KEY"') || workflowText.includes('printf "%s" "$SSH_PRIVATE_KEY"')) {
  throw new Error('audit workflow must not print the SSH private key');
}

const forbiddenAuditorPatterns = [
  /git\s+(fetch|pull|switch|checkout|reset)\b/,
  /docker\s+compose\s+(up|run|build|pull)\b/,
  /docker\s+(restart|stop|start|rm)\b/,
  /prisma\s+(migrate\s+deploy|db\s+push|migrate\s+resolve)\b/,
  /npm\s+(install|ci)\b/,
  /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/,
  /aws\s+s3\s+(cp|sync|rm)\b/,
  /aws\s+s3api\s+(put-|delete-)/,
  /curl\s+(POST|PUT|PATCH|DELETE)\b/,
  /backup-(buildingos-production|postgres-paired)\.sh/,
  /\benv\b\s*\|\s*(sort|uniq|sed|awk|cat|tee)/,
  /printenv\b/,
  /docker\s+compose\s+.*--force-recreate/,
  /finance-staging-acceptance(?:\.mjs|\.sh)/,
];
for (const pattern of forbiddenAuditorPatterns) {
  if (pattern.test(auditorText)) throw new Error(`forbidden auditor construct: ${pattern}`);
}

const safeEnvAllowlist = [
  'APP_ENV', 'NODE_ENV', 'STORAGE_BACKEND', 'S3_ENDPOINT', 'S3_BUCKET',
  'S3_FORCE_PATH_STYLE', 'PAYMENT_PROVIDER', 'ENABLE_PAYMENT_WEBHOOKS',
];
for (const key of safeEnvAllowlist) {
  if (!auditorText.includes(key)) throw new Error(`missing safe environment key ${key}`);
}
for (const secretName of ['DATABASE_URL', 'JWT_SECRET', 'SMTP_PASS', 'SSH_PRIVATE_KEY']) {
  if (auditorText.includes(secretName)) throw new Error(`auditor must not read ${secretName}`);
}
if (!auditorText.includes('BEGIN READ ONLY;')) throw new Error('database query sessions must begin read only');
if ((auditorText.match(/psql/g) ?? []).length !== 1) throw new Error('all database queries must use one guarded psql helper');
if (!auditorText.includes('COMMIT;')) throw new Error('read-only query sessions must terminate explicitly');
if (!auditorText.includes('pg_restore --list')) throw new Error('existing backups must be inspectable without creation');
if (!auditorText.includes('S3_DEEP_AUDIT_UNAVAILABLE')) throw new Error('unsupported S3 clients must be reported');
if (!auditorText.includes('EXPECTED_AUTHORITATIVE_BUCKET') || !auditorText.includes("EXPECTED_BUCKET='buildingos-production'")) throw new Error('authoritative production bucket must be reported');
if (!auditorText.includes('TENANT_REAL_BUSINESS=UNKNOWN')) throw new Error('real-business classification must fail closed');
if (!auditorText.includes('TARGET_MIGRATION_STATUS')) throw new Error('target migration state must be reported');

console.log('PASS: production read-only audit workflow and auditor are structurally fail-closed');
NODE
