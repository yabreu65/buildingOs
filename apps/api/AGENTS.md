# API — Domain Instructions (BuildingOS)

> This file supplements ../../AGENTS.md. Load it when working in apps/api.

## Scope
- Backend NestJS modules, controllers, services, DTOs, guards, validators, Prisma queries, API contracts, RBAC, tenant isolation, finance flows, communications, and background jobs.

## Mandatory Backend Rules
- All tenant-owned data must be scoped by `tenantId`.
- Cross-tenant access is always forbidden.
- Validate tenant ownership before reads and writes.
- Controllers should stay thin; business logic belongs in services.
- Use DTOs and validators for input validation.
- Do not bypass guards, decorators, or RBAC checks.
- Do not use `any` in API, Prisma, finance, tenant, auth, or RBAC code.
- Prefer `unknown`, DTOs, validators, Zod schemas, or typed interfaces.
- If `any` is required at an unavoidable external boundary, justify it briefly.

## NestJS Patterns
- Use dependency injection through constructors.
- Register providers through modules, not ad-hoc imports.
- Use `@Global()` only when intentional and documented.
- Keep modules cohesive by domain.
- Do not create circular dependencies without explaining why.

## Prisma Patterns
- Always scope tenant-owned queries by `tenantId`.
- Prefer explicit `select` or scoped `include` to avoid leaking unrelated tenant or user data.
- Never trust `tenantId`, `buildingId`, `unitId`, or `userId` from request body without verifying ownership server-side.
- Use transactions for multi-step writes.
- Prefer database constraints for uniqueness and idempotency.
- Use database constraints for financial uniqueness whenever possible.
- Do not use unchecked writes unless explicitly justified.
- Do not silently catch Prisma errors.
- Report Prisma/DB errors with the failing operation and likely cause.
- Financial writes must be transactional.

## Auth & RBAC
- Enforce role checks on protected endpoints.
- Validate current tenant context before executing tenant actions.
- Tenant context must come from authenticated context, route context, or verified membership, not blindly from client payloads.
- Admin and operator actions must verify both role and tenant/building scope.
- Resident actions must verify the resident is linked to the requested unit or allowed resource.
- `SUPER_ADMIN` access must be explicit, not accidental.
- `RESIDENT` access must only expose allowed tenant/unit data.
- Never trust role or tenant values from client payloads without server verification.

## Units and Residents
- Units must belong to a building.
- Unit labels must be unique per building after normalization.
- `unitCode` must be unique per building if present.
- `UnitResident` is historical and should use `endAt` for previous assignments.
- There must be at most one active resident assignment per unit.

## Financial Domain Rules
- `Expense` records costs and must not create resident debt directly.
- Creating, editing, validating, or deleting an `Expense` must not directly mutate debt.
- Debt must be derived from `Charge` minus `Payment`/`Credit`/`Adjustment` entries, not directly from `Expense`.
- `Liquidation` consolidates expenses for an accounting period.
- `Charge` represents enforceable debt for a unit.
- `Payment` reduces debt through charges or ledger entries.
- Publishing a liquidation creates charges.
- Publishing must be transactional and idempotent.
- Duplicate charges for the same tenant/building/unit/period/liquidation are forbidden.
- Published financial documents should use snapshots or adjustments instead of mutating historical results.
- Published liquidations should be immutable; corrections should be adjustments.
- Monetary calculations must avoid floating point drift and preserve exact cents or decimals.
- Allocation rounding must preserve exact totals.

## Communications / Web Push
- Communication publishing must not be broken by partial push/email failures unless the operation is explicitly strict.
- Web Push fanout must be tenant-scoped and recipient-scoped.
- Expired push subscriptions must be revoked with tenant/user/endpoint scope.
- Do not leak sensitive data in notification payloads.

## Error Handling
- Use consistent HTTP status codes.
- Return clear errors without exposing secrets or internals.
- Never hide failed validation.
- Do not convert authorization, tenant isolation, or financial errors into generic success responses.
- Do not swallow partial failures unless the operation is explicitly best-effort.
- Log sensitive failures with enough context to debug, but without secrets or personal data.
- Do not remove or weaken tests to make errors disappear.

## Testing
- Add focused tests for critical business rules.
- Test tenant isolation, RBAC, error paths, and financial edge cases.
- Test idempotency for publish, payment, and financial operations.
- Test cross-tenant denial cases.
- Test duplicate prevention for charges, liquidations, units, and resident assignments.
- Prefer focused API/service tests before broad suites.
- Keep test data explicit and tenant-scoped.

## PR Checklist
- [ ] Tenant scoping verified.
- [ ] RBAC and guards verified.
- [ ] Prisma queries reviewed for `tenantId`.
- [ ] Financial behavior matches Expense/Liquidation/Charge/Payment semantics when touched.
- [ ] No `any`, silent casts, or type escapes in critical API paths.
- [ ] Tests or skipped validations documented.
- [ ] No dependency, package, or lockfile changes without approval.
