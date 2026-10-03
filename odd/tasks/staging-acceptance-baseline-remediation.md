# ODD Tasks: Staging Acceptance Baseline Remediation

**Status:** In progress  
**Branch:** `fix/staging-acceptance-baseline-contract`  
**Base:** `b159f6914b54fad262de6b22f43207d530c360b2`  
**Issue:** #325 (`status:approved`; closed, cleanup scope follow-up)

## Goal

Make the Finance staging acceptance harness's baseline capture, durable Golden seed classification, run-scoped cleanup proof, and residue markers internally consistent and testable. This changes acceptance tooling only; it does not change Release A business behavior.

## Guardrails

- Do not execute the Finance staging acceptance workflow, seed staging, or mutate staging/production.
- Do not change business services, migrations/schema, deployment scripts, staging Compose, or GitHub variables/secrets.
- Keep Golden seed restricted to `stg-golden-tenant-auto`; durable fixture convergence is not run-scoped residue.
- Preserve private password hashes; never print serialized baseline data.
- Require exact restoration of ephemeral Golden password hashes and compare-and-set receipt-sequence cleanup before reporting zero run residue.

## Source inspection evidence

At the exact base SHA, the shell invokes a CLI mode named `capture-golden-passwords`, but that mode already calls `captureAcceptanceBaseline(prisma)` and serializes both `passwordHashes` and `receiptSequence`. Thus the reported password-only runtime handoff is **not confirmed** in the inspected source; the mode and `PASSWORD_SNAPSHOT` names are misleading, and tests must preserve the full-baseline contract explicitly. `createAcceptanceCleanup` rejects a baseline without `receiptSequence`.

The seed is a durable QA baseline provisioner. The acceptance cleanup does not delete Golden seed fixtures. Run-scoped mutable records, storage versions, AuthSession, shared ReceiptSequence preimage, and ephemeral password hashes have separate cleanup contracts.

## Tasks

1. [in progress] **Explicit full acceptance baseline handoff** — Add/require `capture-acceptance-baseline`, rename the shell snapshot variable, capture before seed, pipe the same full baseline to the acceptance child and password restore, and add RED/GREEN tests for password-only rejection/full-baseline acceptance and ordering/handoff. Record work-unit commit SHA when complete.
2. [pending] **Precise mutation and residue contract** — Classify Golden seed fixtures as `DURABLE_QA_BASELINE` with no cleanup; classify password hashes as `EPHEMERAL_GOLDEN_AUTH_MUTATION`; emit precise password restore markers, explicit receipt-sequence restore evidence, and gate `QA_RUN_RESIDUE_ZERO_PASS` on all required cleanup proofs. Add tests for inventory, preservation, marker semantics, and exact Golden seed allowlist. Record work-unit commit SHA when complete.

## Validation plan

- Focused: `node --test scripts/tests/finance-staging-acceptance-cleanup.test.mjs`; `bash scripts/tests/finance-staging-acceptance-guard.test.sh`; `bash scripts/tests/finance-staging-workflow.test.sh`; `bash scripts/tests/finance-staging-acceptance-module-resolution.test.sh`; `bash scripts/tests/staging-golden-selector.test.sh`; `bash -n scripts/finance-staging-acceptance.sh`; ShellCheck on the modified shell; `git diff --check`.
- Full authorized local gates after focused PASS: `npm run test:ci`; `npm run lint:ci`; API and Web typechecks; `NEXT_PUBLIC_API_URL=http://127.0.0.1:4000 npm run build:ci`.
- Final: inspect status/stat/diff check; commit by work unit, push branch, create PR linking approved issue #325, wait for fresh CI/E2E, then request Codex review. Do not merge.

## TDD evidence (Task 1)

- RED before implementation: `bash scripts/tests/finance-staging-acceptance-guard.test.sh` exited 1 at the missing `capture-acceptance-baseline` mode; traced with `bash -x` to the expected absent-mode assertion.
- Before-fix cleanup test: `node --test scripts/tests/finance-staging-acceptance-cleanup.test.mjs` passed 32 tests, including password-only baseline rejection and full-baseline acceptance.
- Important distinction: the inspected pre-fix CLI label `capture-golden-passwords` already called `captureAcceptanceBaseline(prisma)` and emitted both hashes and ReceiptSequence; the password-only runtime defect was not reproduced. The RED is the missing explicit mode/handoff contract.
- GREEN: `node --test scripts/tests/finance-staging-acceptance-cleanup.test.mjs` passed 32/32; `bash scripts/tests/finance-staging-acceptance-guard.test.sh` passed; `bash -n scripts/finance-staging-acceptance.sh` and `rtk git diff --check` passed.
- Implementation renamed the CLI mode and shell snapshot variable/handoff; the full baseline helper remains the single source of serialization/restoration logic.

## Commit evidence

- Task 1: pending
- Task 2: pending
