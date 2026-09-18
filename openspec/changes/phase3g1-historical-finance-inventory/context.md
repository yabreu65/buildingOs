# SDD Project Context — Phase 3G.1 Historical Finance Inventory

## Status

- **Status:** initialized
- **Change:** `phase3g1-historical-finance-inventory`
- **Planning phase:** proposal (next recommended phase)
- **Scope:** historical finance inventory only; planning initialization, no implementation
- **Workspace:** `/Users/yoryiabreu/proyectos/buildingos`

## Approved session preflight

- **Execution:** `auto`
- **Artifact store:** `both` (`openspec` + `engram`)
- **Delivery strategy:** `ask-on-risk`
- **Review budget:** 400 changed lines
- **Strict TDD:** active
- **Test runner:** `npm run test -w apps/api`
- **Allowed edit root:** `openspec/changes/phase3g1-historical-finance-inventory`

The selected preflight is preserved as session authority. Auto execution does not bypass human-controlled consent, authorization, security, destructive/publishing, ambiguous-scope, or review-budget exception gates.

## Repository context

BuildingOS is an npm-workspaces monorepo for a multi-tenant condominium-management SaaS:

- **API:** NestJS 10, Prisma 5, PostgreSQL 16, Redis, MinIO
- **Web:** Next.js 16, React 19, Tailwind 4, Zod 4
- **Shared packages:** `@buildingos/contracts`, `@buildingos/permissions`
- **Isolation:** tenant-owned data must be scoped by `tenantId`
- **Finance semantics:** expenses record costs; liquidations consolidate accounting periods; charges represent enforceable unit debt; payments reduce debt; published financial documents are transactional, idempotent, immutable, and snapshot/adjustment based.

## Relevant historical finance surface

CodeGraph reconnaissance identified the existing finance surface across expenses, liquidations, charges, payments, income offsets, snapshots, legacy backfill, API services/controllers, web contracts/hooks, and focused tests. Notable existing concepts include:

- `apps/api/src/finanzas/liquidations.service.ts`
- `apps/web/features/finance/services/expense-ledger.api.ts`
- `apps/web/features/finance/services/finance.api.ts`
- `apps/web/features/finance/contracts/finance-types.ts`
- `apps/web/features/finance/hooks/finance-query-keys.ts`
- Existing liquidation, payment, expense, and finance contract tests

This reconnaissance is context only; no production source, schema, migration, frontend, staging, production, or `.codegraph` content was modified.

## OpenSpec configuration resolved

`openspec/config.yaml` is present and retained. It declares:

- `strict_tdd: true`
- API unit runner: Jest via `npm run test -w apps/api`
- API E2E runner: Jest via `npm run test:e2e -w apps/api`
- configured proposal → spec → design → tasks → apply → verify → archive phases
- CI, lint, typecheck, formatter, and monorepo context

## Planning boundary

This initialization does not define historical inventory requirements, alter financial semantics, or authorize implementation. The next phase should produce the proposal for the approved historical finance inventory, including scope, evidence sources, non-goals, risks, and acceptance criteria before spec/design work.

## Registry note

`.atl/skill-registry.md` was not present during initialization. The current session supplied the required `gentle-ai` skill path directly. No registry file was created because the session allowed edits only under the change directory.
