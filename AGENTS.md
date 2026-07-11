# BuildingOS — AI Agent Instructions

## Operational Guardrails
- Timebox: max 45 minutes per task. If not done, report progress and stop.
- Silence: never exceed 10 minutes without user update on active tasks.
- Checkpoint: every 10 minutes or at end of each sub-step.
- No modify package.json, package-lock.json, pnpm-lock.yaml, or yarn.lock without explicit user permission.
- No add dependencies without explicit user permission.
- No run build, deploy, or publish without explicit user permission.
- No commit or push without explicit user permission.
- If scope is uncertain, STOP and ask before proceeding.
- Never say "listo" without validation, or clarify that validation was not performed.
- GitHub Actions build, lint, test, and E2E jobs declared in `.github/workflows/` are preauthorized quality gates for CI alignment work. This does not authorize deploys, VPS access, staging, production, or remote migrations.

## RTK Usage
When working with AI coding agents such as Codex or OpenCode, prefer RTK commands to reduce token usage and keep command outputs compact.

Use RTK for project inspection, Git, Docker, build, lint, test and log commands.

Prefer:
* `rtk git status` instead of `git status`
* `rtk git diff` instead of `git diff`
* `rtk git log -n 10` instead of `git log -n 10`
* `rtk docker ps` instead of `docker ps`
* `rtk docker compose ps` instead of `docker compose ps`
* `rtk docker logs <container>` instead of `docker logs <container>`
* `rtk grep "text" .` instead of `grep` or `rg`
* `rtk next build` instead of `next build`
* `rtk tsc` instead of `tsc`
* `rtk test npm test` or `rtk test pnpm test` for long test outputs

For Codex App, follow this file as project instructions and use RTK whenever available.
For OpenCode, use RTK through the configured OpenCode integration when available.
If RTK is not installed or a command fails because of RTK, fall back to the normal command.

## TypeScript/Node.js
- Use `const`/`let`, never `var`
- Prefer `interface` over `type` for object definitions
- Avoid `any` types - use proper typing
- Use `readonly` for immutable DTO/config/interface properties when it improves type safety
- Add JSDoc for public methods when the behavior, contract, or side effects are not obvious

## NestJS (apps/api)
- Use `@Injectable()` decorator for services
- Implement proper error handling with typed exceptions
- Use dependency injection via constructor
- Use `@Global()` only when a shared module is intentionally global and the impact is documented
- Use guards and interceptors for cross-cutting concerns

## React/Next.js (apps/web)
- Use functional components only
- Prefer named exports
- Use TypeScript for all components
- Use proper prop typing with interfaces/types
- Use `const` for component definitions

## API/REST
- Follow REST conventions: GET, POST, PATCH, DELETE
- Return proper HTTP status codes
- Use DTOs (Data Transfer Objects) for request/response
- Validate all inputs with Zod/validators
- Document endpoints with JSDoc

## Testing
- Write tests for critical business logic
- Use `describe` and `it` blocks
- Test error scenarios, not just happy paths
- Use meaningful test descriptions
- Run slice tests before full test suite
- Tests must pass before commit (or explicit user override)

## Security
- Never hardcode secrets - use environment variables
- Validate all user input
- Implement multi-tenant isolation checks
- Use RBAC for authorization
- Hash sensitive data (passwords, tokens)

## Database / Prisma
- Use Prisma migrations for schema changes
- Always include `tenantId` for multi-tenant isolation
- Use soft deletes where appropriate (`deletedAt` field)
- Create indexes for frequently queried columns

## Multi-Tenant Rules (consolidated)
- Every entity must be scoped by `tenantId`
- Cross-tenant access is always forbidden
- Validate tenant before every query and mutation
- For domain-specific multi-tenant contracts, see:
  - `apps/api/AGENTS.md` (backend contracts, units, UnitResident)
  - `apps/web/AGENTS.md` (frontend guards, activeTenantId)

## Financial Rules
- Expense records costs; it must not create resident debt directly.
- Liquidation consolidates expenses for an accounting period.
- Charge represents enforceable debt for a unit.
- Payment reduces debt through charges or ledger entries.
- Debt must come from charges minus payments/credits, not directly from expenses.
- Creating or editing an expense must not directly alter resident debt.
- Published liquidations must be transactional, idempotent, immutable, and protected against duplicates.
- Allocations must preserve exact totals: `sum(charges) === liquidation.total`.
- Never change financial semantics without explicit user approval.

## Error Handling Guardrails
- Never suppress errors, warnings, failed tests, or Prisma errors to make a task look complete.
- Never hide failed validation.
- Never remove or weaken tests to make a suite pass.
- If a command fails, report the command, the failure, and the suspected cause.
- On Prisma or database errors, report the exact failing operation and likely cause.
- Do not silently retry destructive, financial, or migration operations.
- If validation was skipped, say so clearly.

## Cheap and Safe Working Rules
- Work in the smallest possible slice that still produces a coherent result.
- Read only the files needed to decide or verify.
- Keep production code strict: no `any`, no silent casts, no type escapes unless there is a documented boundary.
- Keep tests with the code they verify.
- When backend finance code changes, run slice tests first, then `prisma validate` if schema changed. Request explicit user permission before running any build.
- Use multi-agent only when the task is broad enough that a separate, independent subtask materially helps.
- Before closing a slice, check the touched production files for accidental `any` usage and run `git diff --check`.

## Before Closing a Slice

Before reporting a slice as finished, always verify the working tree and report only the minimum evidence needed to review the slice.

### Required commands

Preferred path when RTK is available:

```bash
rtk git status
rtk git diff --stat
rtk git diff --check
```

Fallback when RTK is not available or fails:

```bash
git status --short
git diff --stat
git diff --check
```

### Required rules

- If any file has uncommitted changes, report them explicitly.
- Do not dump large diffs by default. Show `git diff --stat` and summarize the impact unless a full diff was explicitly requested.
- If `git diff --check` reports whitespace errors, fix them before closing the slice.
- If tests or validations were not run, say that clearly instead of implying coverage.

### Report template

After running the commands above, fill this template:

- **Files modified**: list each file with a one-line summary of what changed.
- **Tests or validations executed**: list each command executed and its result (pass/fail).
- **Tests or validations skipped**: if any checks were intentionally skipped, explain why.
- **Remaining risks**: any known risks, edge cases, or follow-up items.
- **Status**: `ready for review` | `ready for commit` | `incomplete` (explain what's missing).

## Commits
- Use conventional commits: feat, fix, refactor, test, docs, etc.
- Write clear, actionable commit messages
- Keep commits atomic (one feature per commit)
- Include context about WHY not just WHAT

## Domain-Specific Instructions
Codex, OpenCode, and any other coding agent must load the closest `AGENTS.md` that applies to the files being changed.

Start with this root file for repository-wide rules. Then, if the work is inside one of the domains below, also load the domain-specific `AGENTS.md`.

These domain files supplement this root file. They do not replace it.

### apps/api/AGENTS.md — Backend, NestJS, Prisma, RBAC, tenants, finance, communications, API

Load `apps/api/AGENTS.md` when working on backend code, NestJS modules, Prisma schema/query logic, RBAC, tenant isolation, finance flows, communications, or API contracts.

### apps/web/AGENTS.md — Frontend, Next.js, forms, guards, activeTenantId, UI, UX

Load `apps/web/AGENTS.md` when working on frontend code, Next.js routes, forms, guards, `activeTenantId`, UI behavior, or UX flows.

### infra/AGENTS.md — Docker, Traefik, deploy, secrets, VPS, CI/CD, producción

Load `infra/AGENTS.md` when working on Docker, Traefik, deployment, secrets handling, VPS setup, CI/CD, or production operations.
