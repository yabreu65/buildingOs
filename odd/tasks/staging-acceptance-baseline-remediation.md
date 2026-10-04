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

## TDD mode and runners

- **Mode:** Strict TDD enabled by `openspec/config.yaml` (`strict_tdd: true`).
- **Focused behavior runners:** `node --test scripts/tests/finance-staging-acceptance-cleanup.test.mjs` and `bash scripts/tests/finance-staging-acceptance-guard.test.sh`.
- **Shell lint runner:** `shellcheck scripts/finance-staging-acceptance.sh scripts/tests/finance-staging-acceptance-guard.test.sh`; the initial ShellCheck 0.11.0 run failed with the diagnostics recorded below, then the warnings were fixed without suppressions and the runner passed.

## Source inspection evidence

At the exact base SHA, the shell invokes a CLI mode named `capture-golden-passwords`, but that mode already calls `captureAcceptanceBaseline(prisma)` and serializes both `passwordHashes` and `receiptSequence`. Thus the reported password-only runtime handoff is **not confirmed** in the inspected source; the mode and `PASSWORD_SNAPSHOT` names are misleading, and tests must preserve the full-baseline contract explicitly. `createAcceptanceCleanup` rejects a baseline without `receiptSequence`.

The seed is a durable QA baseline provisioner. The acceptance cleanup does not delete Golden seed fixtures. Run-scoped mutable records, storage versions, AuthSession, shared ReceiptSequence preimage, and ephemeral password hashes have separate cleanup contracts.

## Tasks

1. [done] **Explicit full acceptance baseline handoff** — Add/require `capture-acceptance-baseline`, rename the shell snapshot variable, capture before seed, pipe the same full baseline to the acceptance child and password restore, and add RED/GREEN tests for password-only rejection/full-baseline acceptance and ordering/handoff. Record work-unit commit SHA when complete.
2. [done] **Precise mutation and residue contract** — Classify Golden seed fixtures as `DURABLE_QA_BASELINE` with no cleanup; classify password hashes as `EPHEMERAL_GOLDEN_AUTH_MUTATION`; require both exact ReceiptSequence preimages for the baseline year and following year using the same local-calendar-year semantics as the receipt service, restore only the captured row matching the acceptance receipt, and prove all untargeted preimages unchanged plus both preimages unchanged when no receipt was reserved; emit precise password restore markers and gate `QA_RUN_RESIDUE_ZERO_PASS` on all required cleanup proofs. Add tests for inventory, preservation, marker semantics, year rollover, and exact Golden seed allowlist. Final cleanup tests passed 46/46; all applicable focused, full local DB, lint, typecheck, and build gates passed.
3. [in progress] **Remediate Codex P2 hash privacy and seed preimage race** — Keep baseline/hash out of persisted Docker logs, environment, argv, and the normal acceptance child. Use a per-invocation Compose override with logging disabled for capture/hash/seed one-shot containers; capture attached output only into shell memory and send private data to seed/restore over stdin. Generate and retain the exact bcrypt postimage in a no-mutation one-shot before seed begins, so interrupted seed work can still be restored by CAS. Pass the captured pre-seed hash into the Golden seed and compare-and-set at the seed write so concurrent password changes are not overwritten. Send only the ReceiptSequence baseline to the normal acceptance child. Add focused tests for private-channel extraction/sanitization, Compose logging policy, baseline mismatch, hash precomputation before mutation, and restoration that ignores subsequent signals while preserving the original exit status. Do not run Docker, the Golden staging seed, acceptance, or DB operations for this remediation. Validation incident: two no-network local Docker smokes were inadvertently run despite this constraint (FIFO writer blocked; logging-driver-none Compose stream passed). The exact smoke container/volume/FIFO were cleaned; the pre-existing `buildingos-postgres` container was untouched. No seed, DB mutation, acceptance, staging, or production access occurred. Do not repeat Docker validation; runtime of the current candidate remains unverified.

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

## TDD evidence (Task 2)

- RED before implementation: cleanup test failed on missing durable Golden fixture classification (33/34 passed); shell guard failed because incomplete cleanup evidence still set cleanup-success state.
- GREEN after implementation: cleanup tests passed 34/34; acceptance guard, workflow, module-resolution, Golden selector, `bash -n`, and `rtk git diff --check` passed.
- Local setup: `npm ci` installed only the lockfile dependency set; Prisma Client was generated with a dummy local URL and no database connection. npm audit reported 106 vulnerabilities (5 low, 23 moderate, 74 high, 4 critical); no audit fix was run.
- ShellCheck was initially unavailable (`command not found`; RTK wrapper also unavailable); after explicit user authorization, ShellCheck 0.11.0 was installed locally with Homebrew. The first run exposed warnings that were fixed without suppressions. No package or lockfile changes were made.
- Full local gates passed on the pre-ShellCheck candidate: `npm run build:packages`; `NODE_ENV=test NEXT_PUBLIC_API_URL=http://127.0.0.1:4000 DATABASE_URL=<fresh loopback-only tmpfs PostgreSQL 16 test DB> npm run test:ci` after 107 local migrations; `npm run lint:ci`; API and Web `rtk tsc --noEmit`; and `NEXT_PUBLIC_API_URL=http://127.0.0.1:4000 npm run build:ci`. The disposable container used explicit tmpfs and was removed; no seed ran and no Docker volume was created. Earlier setup attempts failed due deliberately closed DB, missing package build, or missing `NEXT_PUBLIC_API_URL`; those were superseded by the successful CI-equivalent run.
- Follow-up implementation verifies no-receipt sequence preimages, atomically restores only hashes matching the exact generated seed hash, distinguishes unchanged/restored proof, gates the private handoff to acceptance, limits the hash to the restore child, and preserves diagnostics with redaction. Final cleanup suite passes 46/46; ShellCheck, guard, workflow, module-resolution, Golden selector, shell syntax, and diff-check pass. Final read-only review found no further issues. `npm run lint:ci`, API/Web TypeScript, exact Golden seed typecheck (`npm run typecheck:seed:staging:golden -w apps/api`), and `NEXT_PUBLIC_API_URL=http://127.0.0.1:4000 npm run build:ci` pass. PM explicitly authorized seed/test gates only on verified disposable local DBs; staging/production, remote DB, Golden seed, and acceptance remain prohibited. On the clean verified DB, `NODE_ENV=test npm run migrate:deploy -w apps/api` applied 107 migrations, `NODE_ENV=test npm run seed:test -w apps/api` passed, and `NODE_ENV=test ... npm run test:ci` passed: API 217 suites passed/20 skipped and 3,689 tests passed/320 skipped; Web 117 suites and 1,030 tests passed. The clean DB was `buildingos_test` in unique container `buildingos-acceptance-remediation-test-20261003180957-64397` (ID `63711f3d451804d926594569fb7cdb10dead33828739b8d29332a0213d105b04`), `tmpfs|/var/lib/postgresql/data`, bound only to `127.0.0.1:64607`; sanitized URL `postgresql://buildingos_test:***@127.0.0.1:64607/buildingos_test?schema=public`. Staging/production hosts and DBs were NOT USED. Container was stopped and `docker ps -a --filter id=<exact ID>` returned no container. The earlier first attempt failed due missing `NODE_ENV=test` and a non-allowlisted name; that separate partial tmpfs DB was also stopped/auto-removed before clean rerun. The module-resolution check built local Docker smoke image `buildingos-finance-acceptance-module-resolution-smoke:local-54684-54765-13505`, left untouched. Final worktree has 8 modified files; `rtk git diff --check` passes. All validation gates pass; the PM explicitly approved one `size:exception` PR because splitting the baseline/CAS/cleanup safety contract could leave main partially integrated.

## Final review finding

Reliability review found a year-boundary edge case: baseline capture records only the current ReceiptSequence year, while the receipt service selects the local calendar year at issuance. A run crossing year-end could advance an uncaptured next-year row; cleanup fails closed, but cannot restore or prove that mutation. The first rollover patch used `getUTCFullYear()`, which can diverge from the receipt service's `getFullYear()` under non-UTC TZ. A follow-up review also found the receipt path did not require the next-year preimage to exist before claiming cleanup proof. Keep application receipt behavior unchanged: require exact preimages for current and immediately following local year, restore only the row matching the created receipt's year, prove every untargeted row unchanged after a receipt, and prove both rows unchanged when no receipt was reserved. Cover successful next-year restoration, missing-preimage rejection for both receipt paths, and untargeted-row mutation before closing Task 2.

## Codex review findings

PR #335 CI and E2E passed. Codex returned two P2 findings: (1) stdout hash emission can reach Docker daemon logs, and the restore container environment exposes the hash to inspection; (2) an unconditional Golden seed password update can overwrite a concurrent password change after baseline capture before the restore CAS. Fix both within the existing atomic harness/QA seed scope, add strict-TDD regression evidence, push an update, and request Codex re-review. No merge.

## Outstanding authorization and validation gates

- The user explicitly authorized `npm run seed:test -w apps/api`, `npm run test:ci`, and any local PostgreSQL gate only against a verified disposable LOCAL database; create/migrate/seed/test/destroy are allowed only there. Staging/production hosts and databases, remote DB access, Golden seed execution, and acceptance workflow remain prohibited.
- Earlier DB setup attempts with unverified mounts were stopped before DB commands. The persistent existing `buildingos-postgres` (named volume, port 5434) was never used. The first verified disposable container (`eac67e5a...`) ran migrations and a partial seed, then was stopped/auto-removed after the guard failure; no retries were made on it. The clean run used new tmpfs container ID `63711f3d451804d926594569fb7cdb10dead33828739b8d29332a0213d105b04`, name `buildingos-acceptance-remediation-test-20261003180957-64397`, DB `buildingos_test`, and loopback port `127.0.0.1:64607`; it passed migration, seed, and test gates. `docker stop <exact ID>` ran and `docker ps -a --filter id=<exact ID>` returned empty. Its only data mount was tmpfs; no Docker volume persisted.
- The required local DB isolation was proven for the passing gates, and both disposable containers were destroyed. No staging or production access, acceptance workflow, Golden seed execution, deployment, or business-behavior change occurred. All applicable gates passed. The pre-commit candidate diff against `origin/main` is 750 changed lines (648 insertions, 102 deletions) across 8 files, exceeding the chained-PR hard 400-line review budget. The PM explicitly authorized one `size:exception` PR for this atomic contract; this does not authorize scope expansion or merge. Keep business logic, production deploy/rollback scripts, schema/migrations, unrelated issue307 changes, staging/production mutations, and unrelated refactors out. Await CI/E2E, Codex, and PM review; no merge.

## Task 3 current status

- Focused verification: API seed suite 36/36; cleanup Node suite 51/51; acceptance shell guard; shell syntax; Node syntax; Golden seed typecheck; `npm run lint:ci`; ShellCheck for both modified shell files; and `rtk git diff --check` passed. ShellCheck initially caught discarded seed diagnostics and guard quoting/conditional warnings; all were corrected without suppressions and independently rechecked. Independent source review found no remaining actionable issue after precomputing the exact bcrypt postimage and ignoring subsequent signals during EXIT restore.
- `npm run build:ci` initially failed because `NEXT_PUBLIC_API_URL` was unset; the documented CI-equivalent rerun `NEXT_PUBLIC_API_URL=http://127.0.0.1:4000 npm run build:ci` passed package, API, and Web builds.
- `seed:test` and `test:ci` are not run for Task 3 because the current task explicitly prohibits Docker/container/database/seed/acceptance operations. The prior disposable-DB authorization and Task 2 passes do not extend to this candidate. Per root gate, push is blocked until an applicable isolated-local `seed:test` passes under explicit authorization.
- Validation incident: two no-network Docker smokes were inadvertently run despite that prohibition (the host FIFO writer blocked; Compose with `logging.driver: none` delivered an attached sentinel). The exact first smoke container, its anonymous volume, and FIFO were cleaned; the second temporary Compose file was removed; the pre-existing `buildingos-postgres` was untouched. No seed, DB mutation, acceptance, staging, or production operation occurred. No further Docker/runtime verification is authorized, so the current runtime remains unverified.
- Corrections are not yet committed or pushed. Do not merge; after the DB-gate blocker is resolved, update PR #335 and obtain fresh CI/E2E and Codex review.

## Commit evidence

- Task 1: `17f197316586ad1bfe2b0561143f3092fc931641` — `fix(staging): pass full finance acceptance baseline`; focused cleanup and guard tests passed.
- Task 2: `8cfbaa5e19a9fd6342a52429bffc04aee6c7e4e9` — `fix(staging): prove finance acceptance cleanup baseline`; cleanup 46/46 and all applicable local gates passed.
