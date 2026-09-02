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
if (!auditorText.includes('readonly_query_stdin')) throw new Error('database queries must use stdin transport');
if (!auditorText.includes('BEGIN READ ONLY;')) throw new Error('database query sessions must begin read only');
if ((auditorText.match(/psql/g) ?? []).length !== 1) throw new Error('all database queries must use one guarded psql helper');
if (!auditorText.includes('COMMIT;')) throw new Error('read-only query sessions must terminate explicitly');
if (auditorText.includes("report_query '") || auditorText.includes('readonly_query ')) throw new Error('fragile SQL argument transport must not remain');
if (!auditorText.includes('pg_restore --list')) throw new Error('existing backups must be inspectable without creation');
if (!auditorText.includes('S3_DEEP_AUDIT_UNAVAILABLE')) throw new Error('unsupported S3 clients must be reported');
if (!auditorText.includes('require.resolve("minio")')) throw new Error('S3 audit must use the runtime MinIO SDK');
if (!auditorText.includes('docker exec -i "$API_CONTAINER" node')) throw new Error('S3 node probe must receive its stdin script');
if (!auditorText.includes('nextContinuationToken') || !auditorText.includes('isTruncated')) throw new Error('S3 object audit must paginate fully');
if (!auditorText.includes('S3_DEEP_AUDIT=INCOMPLETE') || !auditorText.includes('AUDIT_EVIDENCE_FAILURES')) throw new Error('incomplete S3 evidence must fail the overall audit');
for (const marker of ['checkout_status" == \'CLEAN\'', 'RUNTIME_IDENTITY=UNKNOWN', 'PUBLIC_READYZ_HTTP=FAIL', 'AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))']) {
  if (!auditorText.includes(marker)) throw new Error(`missing fail-closed evidence marker ${marker}`);
}
if (!auditorText.includes('EXPECTED_AUTHORITATIVE_BUCKET') || !auditorText.includes("EXPECTED_BUCKET='buildingos-production'")) throw new Error('authoritative production bucket must be reported');
if (!auditorText.includes('TENANT_REAL_BUSINESS=UNKNOWN')) throw new Error('real-business classification must fail closed');
if (!auditorText.includes('TARGET_MIGRATION_STATUS')) throw new Error('target migration state must be reported');
if (auditorText.includes("'CURRENCY_MISMATCHES'")) throw new Error('cross-currency audit must not use the old unconditional mismatch metric');
for (const metric of ['OVER_ALLOCATIONS_DEFINITE', 'OVER_ALLOCATIONS_UNVERIFIABLE', 'INCONSISTENT_SAME_CURRENCY_SHARES', 'OVER_ALLOCATIONS_FUNCTIONAL_DEFINITE', 'OVER_ALLOCATIONS_FUNCTIONAL_UNVERIFIABLE', 'CURRENCY_MISMATCHES_DEFINITE', 'CURRENCY_MISMATCHES_UNVERIFIABLE']) {
  if (!auditorText.includes(metric)) throw new Error(`missing cross-currency metric ${metric}`);
}
if (!auditorText.includes('functional_consumed')) throw new Error('functional-currency consumption must be checked');
if (!auditorText.includes('inconsistent_same_currency_share') || !auditorText.includes('paymentOriginalAmountMinor" <> a.amount')) throw new Error('same-currency original shares must match charge-side amounts');
if (!auditorText.includes('production_sha" == "$api_revision"')) throw new Error('checkout and image revisions must match');
if (!auditorText.includes('status_output="$(git -C "$APP_DIR" status')) throw new Error('git status failures must fail closed');
if (!auditorText.includes('git -C "$APP_DIR" ls-files --others --ignored --exclude-standard 2>/dev/null')) throw new Error('ignored-file inspection failures must fail closed');
if (!auditorText.includes('WHERE "canceledAt" IS NULL')) throw new Error('canceled charges must not count as duplicate active charges');
if (!auditorText.includes('ALLOWED_IGNORED_RUNTIME_ENV')) throw new Error('ignored checkout files must use the production allowlist');
if (!auditorText.includes('BACKUP_CHECKSUM_VERIFICATION=%s')) throw new Error('backup checksum state must be reported');
if (!workflowText.includes('CERTIFIED_MIGRATION_COUNT=%s')) throw new Error('migration observation must be derived dynamically');
if (workflowText.includes("certified_migration_count == '98'")) throw new Error('audit workflow must not pin a transient migration count');
if (!auditorText.includes('PUBLIC_READYZ_STATUS')) throw new Error('readiness status must be reported');
if (!auditorText.includes('p."buildingId" <> c."buildingId"') || !auditorText.includes('p."unitId" IS DISTINCT FROM c."unitId"')) throw new Error('allocation scope relationships must be audited');
if (!workflowText.includes("awk -F '=' '/^[[:space:]]*readonly[[:space:]]+TARGET_APPLIED[[:space:]]*=/")) throw new Error('manifest target must parse the shell assignment');
if (!auditorText.includes('validate_pg_restore_list') || !auditorText.includes('docker exec -i "$POSTGRES_CONTAINER" pg_restore --list')) throw new Error('pg_restore validation must use the existing PostgreSQL container when needed');
if (!auditorText.includes("restore_status='INCOMPLETE'")) throw new Error('unavailable pg_restore validation must be incomplete');
if (!auditorText.includes('validate_backup_mechanism') || !auditorText.includes('validate_backup_manifest') || !auditorText.includes('validate_backup_script_file')) throw new Error('backup mechanism identity must use in-stream validation');
if (!auditorText.includes('BACKUP_MECHANISM_OWNER=%s') || !auditorText.includes('BACKUP_MECHANISM_GROUP=%s') || !auditorText.includes('BACKUP_MECHANISM_MODE=%s')) throw new Error('backup mechanism owner, group, and mode must be reported');
if (!auditorText.includes('configured_bucket')) throw new Error('S3 audit must require the authoritative runtime bucket');
if (!auditorText.includes('has_same_currency')) throw new Error('mixed allocation currency modes must be audited');
if (!auditorText.includes('CHARGE_OVER_ALLOCATIONS')) throw new Error('charge-side over-allocation must be audited');
if (!auditorText.includes("checksum_status='INCOMPLETE'")) throw new Error('missing backup checksums must fail closed');
if (!auditorText.includes('BACKUP_STATE_DIR') || !auditorText.includes('paired-$backup_set_id.json')) throw new Error('backup readiness must use durable paired state');
for (const metric of ['NEGATIVE_PAYMENT_ALLOCATIONS', 'NEGATIVE_PAYMENT_ORIGINAL_ALLOCATIONS']) {
  if (!auditorText.includes(metric)) throw new Error(`missing negative allocation metric ${metric}`);
}
if (!auditorText.includes('"paymentOriginalAmountMinor" < 0')) throw new Error('negative original allocation shares must be audited');
if (!auditorText.includes('--arg completedAt "$completed_at"') || !auditorText.includes('.completed_at == $completedAt')) throw new Error('paired backup freshness must bind receipt and state timestamps');
if (!auditorText.includes('RUNTIME_APP_SHA') || !auditorText.includes('.app_sha == $runtimeAppSha')) throw new Error('backup evidence must bind to the verified runtime SHA');

console.log('PASS: production read-only audit workflow and auditor are structurally fail-closed');
NODE
