# Release A Write Barrier and DB107

## Objective
Safely transition BuildingOS production from runtime `db82d3d37fc6184a6d4063709b9a15b923371695` / DB97 to Release A / DB107. Keep old API and Web unavailable before migrations; block candidate HTTP and scheduled mutations until DB107, rollback compatibility, API health/readyz, and Web health/login gates pass; then release writes, recheck health, record SUCCESS, and publish the successful-deployment selector.

## Scope and constraints
- Base must remain `9a27de7a8152d9a12df4373401abb167a75d6d15`.
- Add only migration 107. Migrations 98–106 are immutable; migration 108 must not exist.
- DB107 preserves historical NULL rows, required db82d3 NULL/V1/V2/V3 behavior, and strict modern V1/V4 distribution, recipient tenant/building ownership, and consistency checks.
- The release barrier is Release A-specific, local, deterministic, fail-closed, filesystem-controlled, and has no database/S3/SaaS dependency. Include known scheduled mutators. Do not retrofit db82d3; stop old API and Web.
- During an unsafe 104–106 partial migration failure: leave both old services stopped; never open the candidate barrier, publish SUCCESS/selector, or restore the database automatically.
- No production/staging access, deploy, workflow dispatch, or merge. Preserve the dirty ambient checkout. No dependency or package/lock changes.
- Delivery issue must carry `status:approved`; commit/push/PR only after all required local checks pass. Do not merge.

## Tasks

| ID | Task | Status | Evidence / commit |
|---|---|---|---|
| T1 | Verify refs and preserve ambient checkout; create isolated branch, feature tracker, Engram mirror, and visible task projection | DONE | Target worktree `/Users/yoryiabreu/.pi/worktrees/release-a-write-barrier-db107/buildingos`, branch `feat/release-a-write-barrier-db107`, HEAD/base `9a27de7a8152d9a12df4373401abb167a75d6d15`; tracker and Engram mirror created; ambient dirty checkout untouched |
| T2 | Implement Release A filesystem-controlled HTTP/scheduled write barrier; stop old API/Web before migrations; add DB107 SQL, validator, and manifest target 107 | DONE | DB107, manifest/validator, HTTP/scheduled fail-closed barriers, and deploy/rollback sequencing authored; migrations98–106 unchanged, exactly107/no108. |
| T3 | Add PostgreSQL compatibility/integrity cases, barrier tests, rollback cases, and end-to-end deploy-order/fail-closed tests | DONE | PostgreSQL integration12; manifest45, security63, target contract6, recovery37, deploy-order, rollback; full CI test gate 4,675 passed/266 skipped. |
| T4 | Run focused checks and required Prisma, API, typecheck, lint, build, and diff gates against verified local disposable PostgreSQL only | DONE | Disposable PostgreSQL validation and local Prisma, direct API/Web typecheck, lint, build, CI tests and `git diff --check` pass; root typecheck wrapper lacks workspace scripts (direct checks pass). |
| T5 | Create approved issue, commit, push, open PR, and observe CI/E2E; do not merge | IN_PROGRESS | Issue #333 is open with `status:approved`. PM authorized one atomic PR to `main` and approved the size exception. 30 intended Release A files staged and reviewed; commit/push/PR pending. |

## Delivery strategy and workload
- The staged candidate is 1,744 changed lines (1,639 additions + 105 deletions), exceeding the ~400-line review threshold. PM explicitly superseded `feature-branch-chain` with `SINGLE_ATOMIC_PR_TO_MAIN` and approved `size:exception` because this is one production-safety contract. Repository has no `size:exception` label; do not create one. No merge is authorized.

## Test mode
- Strict TDD was not configured in visible project/session settings. User explicitly selected `tdd-disabled-unverified-db` on 2026-10-02: author required tests, but do not fabricate RED/GREEN; use functional tests when dependencies and a verified disposable local DB are available.

## Verification gates
- PostgreSQL: 97→107; db82d3 legacy NULL draft and V3 publication; modern draft and V4; invalid distribution, cross-tenant/building recipient rejection; historical NULL preservation; db82d3+DB106 reject and db82d3+DB107 accept.
- Barrier: POST/PUT/PATCH/DELETE rejected; health/readyz available; scheduled mutators perform no writes; released state permits writes; indeterminate control state fails closed.
- Deployment ordering: recovery point < old API/Web quiescence < migration < DB107 validation < rollback compatibility < blocked candidate activation < health/login gates < release < final health < SUCCESS < selector. DB107 failure never resumes old services; DB107-valid candidate activation failure allows app-only rollback but never publishes selector.
- Manifest target exactly 107; no migration 108; migrations 98–106 unchanged.
- Focused PostgreSQL/barrier/deploy/rollback tests; `prisma validate` and generate; API tests; typecheck; lint; `npm run build:ci`; `git diff --check`.

## Progress log
- 2026-10-01: PM approved the narrow coordinated Release A barrier. Confirmed live `origin/main` and target worktree base are the required SHA. Created isolated branch, feature tracker, Engram mirror, and todo projection. The ambient dirty checkout remains untouched. No source edits or tests yet.
- 2026-10-02: Fixed a nested-shell quoting defect in `scripts/tests/production-deploy-recovery-point-gate.test.sh`: a single-quoted EXIT trap broke the outer single-quoted `bash -c` fixture, preventing all callback scenarios from parsing. Replaced it with `signal_exit` + `trap signal_exit EXIT`; recovery gate now passes 37 assertions. Manifest (45), security (63), target contract (6), deploy-order, rollback, changed-shell `bash -n`, `git diff --check`, and migration immutability/target checks passed.
- 2026-10-02: PM authorized `npm ci` and a verified local disposable PostgreSQL instance. `npm ci` passed; pre/post SHA-256 checks prove root `package.json` and `package-lock.json` unchanged. `npm run lint:ci` and API Prisma client generation passed. The focused API run exposed a true barrier bypass: public `GET /invitations/validate` wrote `Invitation.status=EXPIRED` for expired tokens despite GET bypassing the global write guard. Made validation read-only and added regression; also corrected deterministic test fixtures (guard route tenant context, full CLOSED sentinel path, and non-configurable FS spies). Re-run passed 4/4 focused suites, 31/31 tests. Disposable Postgres image/runtime preflight passed; the repo's shared Compose Postgres has a persistent volume and will not be reused.
- 2026-10-02: Disposable PostgreSQL 16 validation passed using a new no-volume local container with tmpfs-only DB storage and loopback-only random host port. Applied migrations 1–97, verified exact DB97 pre-state, applied 98–106 and observed expected db82d3 rollback-compatibility rejection, then applied 107 and verified target107/zero failures. Actual Release A PostgreSQL suite passed 12 tests, covering legacy NULL/V3, modern V1/V4, integrity rejection, tenant/building ownership, V4 metadata tampering, and historical NULL preservation. DB107 accepted pinned db82d3 and candidate runtimes; unknown SHA rejected. Container and private temp directory removed.
- 2026-10-02: Remaining local gates: `npm run lint:ci`, `prisma validate`, Prisma generate, CI build, API direct tsc, Web direct tsc, full API Jest, `npm run test:ci` with declared CI env, and API config-validation E2E all passed. The root `npm run typecheck` convenience script itself exits nonzero because API/Web workspaces define no `typecheck` script; both direct `tsc --noEmit -p tsconfig.json` commands pass. Final shell suites pass (manifest45, security63, target6, deploy-order, recovery37, rollback); final `bash -n`, diff-check, migration 98–106 byte comparison, exact-107/no-108 and package hashes pass. ShellCheck unavailable and was not installed. Independent static review found no remaining blocker.
- 2026-10-02: P3 review classified all nine untracked Release A paths as intended; no unknown/unrelated files. Diff/secret review found no secrets, production env, host keys or generated candidate artifacts; migrations98–106 unchanged, exactly107/no108; `git diff --check` clean.
- 2026-10-02: PM resolved issue prerequisite externally. Verified issue #333 is open with `status:approved`; no duplicate search or new issue creation performed. P4 staged exactly 30 intended Release A paths; cached diff check passed, candidate totals 1,639 additions + 105 deletions. P5 explicitly authorized one atomic PR to `main` and approved the size exception; `size:exception` label is unavailable, so none will be created. No merge is authorized. Commit, push, PR and remote CI/E2E are pending. No production/staging access or mutation.

## Delivery evidence
- Issue: #333 (open; `status:approved`)
- Work-unit commit(s): pending
- Push: pending
- PR/head: pending
- CI/E2E: pending
- Runtime harness: not applicable; no production/staging/runtime operations are authorized.
