# Production Backup Tooling Identity — ODD Tasks

## Goal
Add an official workflow-dispatch-only, fail-closed, read-only path to expose exactly `manifest_version`, `tooling_source_sha`, and `release_sha256` from the installed production backup preflight manifest. No production/staging access, workflow dispatch, backup, preflight, or mutation is authorized or will be performed.

## Constraints
- Base and certified release candidate: `b6c93f666ff66db9c5edc3aaa36d149fffdd6fcd`; stop if `origin/main` moves.
- Preserve ambient checkout changes; work only in `/Users/yoryiabreu/.pi/worktrees/production-backup-tooling-identity/buildingos`.
- Do not reuse rejected tooling SHA `5b90d997f89f96fa4d81d60822a90ac1031c33a6` as an input.
- No SDD/OpenSpec; ODD only.
- No package/lockfile changes or dependencies beyond user-approved `npm ci` in this isolated worktree.
- Do not edit product/API/web/schema/migrations/runtime/production/staging.
- External issue/PR actions only after local validation and approved issue labeling; no merge.

## Tasks
1. [x] Implement the read-only identity helper, manual workflow, and deterministic parser/workflow guard tests. Evidence: focused tests, syntax checks, and work-unit commit below.
2. [x] Run focused and repository-required safe validation; review fail-closed and output boundaries. Evidence below.
3. [ ] Create the approved issue, push branch, open PR, and record CI/E2E outcomes without dispatching any production workflow or merging.

## Validation Evidence
- Base verified before work and immediately before commit: `HEAD` and fetched `origin/main` both `b6c93f666ff66db9c5edc3aaa36d149fffdd6fcd`.
- Identity tests: `bash scripts/tests/production-backup-tooling-identity.test.sh` — PASS, 104 assertions.
- Existing safety tests: `bash scripts/tests/production-backup-preflight.test.sh` — PASS, 230 assertions; `bash scripts/tests/production-backup-controls-install.test.sh` — PASS, 98 assertions, 2 capability-dependent skips; `bash scripts/tests/privctl-receipt.test.sh` — PASS, 110 assertions.
- Syntax: `bash -n scripts/lib/production-backup-tooling-identity.sh scripts/tests/production-backup-tooling-identity.test.sh` — PASS.
- ShellCheck — unavailable (`SHELLCHECK_NOT_AVAILABLE`); not installed.
- `npm ci` — PASS after explicit user authorization, isolated worktree only; package manifests/lockfiles unchanged.
- `npm run prisma:generate -w apps/api` — PASS; local schema generation only, no database access.
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:4000 NODE_ENV=test npm run build:ci` — PASS; CI-defined environment.
- `git diff --check` — PASS.
- Production/staging access, workflow dispatch, backup, preflight, mutation: none.

## Evidence
- Worktree: `/Users/yoryiabreu/.pi/worktrees/production-backup-tooling-identity/buildingos`.
- Branch: `fix/production-backup-tooling-identity`.
- Work-unit commit: `fix(prod-backup): add tooling identity discovery` (single implementation commit on the feature branch).
