#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ACCEPTANCE_SCRIPT="$ROOT_DIR/scripts/finance-staging-acceptance.mjs"
readonly GOLDEN_SEED="$ROOT_DIR/apps/api/prisma/lib/staging-seed/staging-golden-seed.ts"

node - "$ACCEPTANCE_SCRIPT" "$GOLDEN_SEED" "$ROOT_DIR" <<'NODE'
const fs = require('fs');
const vm = require('vm');

const [acceptancePath, goldenSeedPath, rootDir] = process.argv.slice(2);
const acceptance = fs.readFileSync(acceptancePath, 'utf8');
const goldenSeed = fs.readFileSync(goldenSeedPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(acceptance.includes('const unitId = "stg-golden-unit-auto-103";'), 'acceptance must use Golden A-103');
assert(!acceptance.includes('stg-golden-unit-auto-102'), 'acceptance must not use Golden A-102');
assert(goldenSeed.includes("{ id: 'stg-golden-unit-auto-102', code: 'A-102', occupancyStatus: 'OCCUPIED' }"), 'Golden A-102 fixture changed');
assert(goldenSeed.includes("{ id: 'stg-golden-unit-auto-103', code: 'A-103', occupancyStatus: 'OCCUPIED' }"), 'Golden A-103 fixture is missing');
assert(goldenSeed.includes("{ id: 'stg-golden-charge-auto-102', unitCode: 'A-102', period: '2026-04', amount: 12000, currency: 'ARS', status: 'PENDING' }"), 'Golden A-102 pending charge changed');
assert(!acceptance.includes('stg-golden-charge-auto-102'), 'harness must not select or alter the Golden A-102 charge');
assert(acceptance.includes('chargeId: charge.id') && acceptance.includes('chargeIds: [charge.id]'), 'payment must select only the fresh synthetic charge');

const guardStart = acceptance.indexOf('function calculateEffectiveOutstanding');
const guardEnd = acceptance.indexOf('\n\nasync function createPaymentProof', guardStart);
assert(guardStart >= 0 && guardEnd > guardStart, 'canonical pre-payment guard is missing');
const guardSource = acceptance.slice(guardStart, guardEnd);
const context = {};
vm.runInNewContext(`${guardSource}; globalThis.calculateEffectiveOutstanding = calculateEffectiveOutstanding; globalThis.findOlderPayableCharge = findOlderPayableCharge;`, context);

const older = { id: 'old', amount: 12000, paymentAllocations: [] };
const fresh = { id: 'fresh', amount: 12345, paymentAllocations: [] };
assert(context.findOlderPayableCharge([older, fresh], 'fresh')?.id === 'old', 'guard must detect an older payable charge');
assert(context.findOlderPayableCharge([fresh], 'fresh') === null, 'guard must allow the canonical oldest fresh charge');
assert(context.calculateEffectiveOutstanding({ amount: 12000, paymentAllocations: [{ amount: 12000, payment: { status: 'RECONCILED' } }] }) === 0, 'effective paid charge must not block the guard');

const guardCall = 'await assertCanonicalAcceptanceCharge(charge.id);';
assert(acceptance.indexOf(guardCall) < acceptance.indexOf('const proofFileId = await createPaymentProof();'), 'guard must run before payment proof and payment creation');
assert(acceptance.includes('acceptance unit contains an older payable obligation'), 'guard must fail closed with a clear message');

const sanitizerStart = acceptance.indexOf('function sanitizeApiErrorSummary');
const sanitizerEnd = acceptance.indexOf('\n\nasync function request', sanitizerStart);
assert(sanitizerStart >= 0 && sanitizerEnd > sanitizerStart, 'sanitized API error helper is missing');
const sanitizerSource = acceptance.slice(sanitizerStart, sanitizerEnd);
const sanitizerContext = {};
vm.runInNewContext(`const MAX_API_ERROR_SUMMARY_LENGTH = 240; ${sanitizerSource}; globalThis.sanitizeApiErrorSummary = sanitizeApiErrorSummary;`, sanitizerContext);
const safe = sanitizerContext.sanitizeApiErrorSummary({ statusCode: 409, error: 'Conflict', message: 'Solo puedes pagar períodos consecutivos desde la deuda más antigua.', headers: 'secret', token: 'secret', body: 'secret', stack: 'secret' });
assert(safe.includes('statusCode=409') && safe.includes('error=Conflict') && safe.includes('message=Solo puedes pagar'), 'sanitized API fields must be included');
assert(!safe.includes('secret') && !safe.includes('headers') && !safe.includes('token') && !safe.includes('stack'), 'unsafe API fields must not be exposed');
assert(safe.length <= 240, 'sanitized API error must be conservatively truncated');
const errorBlock = acceptance.slice(acceptance.indexOf('if (!response.ok)', sanitizerEnd), acceptance.indexOf('\n  return payload;', acceptance.indexOf('if (!response.ok)', sanitizerEnd)));
for (const forbidden of ['request body', 'headers', 'cookie', 'token', 'stack', 'JSON.stringify(payload)']) {
  assert(!errorBlock.includes(forbidden), `HTTP error block must not expose ${forbidden}`);
}

for (const relativePath of [
  'apps/api/src/finanzas/finanzas.service.ts',
  'apps/api/src/finanzas/finanzas.controller.ts',
  'apps/api/src/finanzas/finanzas.dto.ts',
  'apps/api/src/finanzas/payment-allocation-transaction.ts',
  'apps/api/prisma/lib/staging-seed/staging-golden-seed.ts',
]) {
  const result = require('child_process').spawnSync('git', ['diff', '--quiet', 'origin/main', '--', relativePath], { cwd: rootDir });
  assert(result.status === 0, `protected source changed: ${relativePath}`);
}

console.log('PASS: staging payment acceptance aligns with canonical FIFO selection without changing product or Golden data');
NODE
