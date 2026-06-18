# RBAC v1 Canonical Design

## Goal
Define one professional RBAC contract for Prisma, API runtime, shared packages, and web consumers without changing effective production access semantics during the first migration.

## Canonical source-of-truth strategy
- Baseline behavior source: API runtime RBAC in `/apps/api/src/rbac`
- Canonical contract location after migration:
  - `/packages/contracts/src/rbac.ts` for shared types
  - `/packages/permissions/src/permissions.ts` for role-permission mapping

## Canonical roles
These remain aligned to Prisma `Role` enum:
- SUPER_ADMIN
- TENANT_OWNER
- TENANT_ADMIN
- OPERATOR
- RESIDENT

## Canonical scopes
These remain aligned to Prisma `ScopeType` enum:
- TENANT
- BUILDING
- UNIT

## Canonical permission vocabulary (phase-1 recommendation)
Preserve current production runtime semantics:
- buildings.read
- buildings.write
- units.read
- units.write
- payments.submit
- payments.review
- tickets.read
- tickets.write
- tickets.manage
- members.manage

## Semantics
- `read`: read/list/view operations
- `write`: create/update operations that are not global moderation/assignment flows
- `manage`: elevated operational control beyond basic write for the resource domain
- No implicit inference is introduced in this phase; if a role has `tickets.manage`, it should still explicitly include any needed ticket permissions in the map until a future hierarchy design is approved

## Explicitly out of scope for this RBAC unification
- assistant tool permissions (`tools.*`)
- billing feature flags / plan capabilities
- communications publish/read permission model redesign
- expense-domain permission redesign

## Shared contract targets
### packages/contracts/src/rbac.ts
Should expose:
- `Role`
- `ScopeType`
- `Permission`
- `ScopedRole`
- `TenantMembershipRoles`

### packages/permissions/src/permissions.ts
Should expose:
- `ROLE_PERMISSIONS: Record<Role, Permission[]>`
- helper readers only if needed, but no alternate vocabulary

## Runtime compatibility constraints
1. `AuthorizeService` behavior must not change
2. `BuildingAccessGuard` effective-role mutation must be preserved during the migration
3. `jwt.strategy.ts` may continue producing `roles: string[]` temporarily until phase 5
4. frontend may consume a subset of permissions, but it must not define a different vocabulary

## Future-safe typing direction
- Replace `roles: string[]` with `roles: Role[]`
- Replace ad hoc scoped role shapes with shared `ScopedRole`
- Replace string-keyed permission maps with `Record<Role, Permission[]>`

## Success criteria for v1
- One permission vocabulary across API/shared/web
- One role-permission matrix
- No production behavior change in effective authorization decisions
- No duplicate competing RBAC contracts left active after migration
