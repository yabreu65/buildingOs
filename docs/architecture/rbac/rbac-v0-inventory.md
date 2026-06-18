# RBAC v0 Inventory

## Scope
- Prisma RBAC model
- API runtime RBAC
- Shared contracts and permissions packages
- Web RBAC consumers
- Assistant-specific tool permissions (out of main RBAC scope)

## Canonical runtime today
Pending verification summary.

## Prisma source model
- File: /Users/yoryiabreu/proyectos/buildingos/apps/api/prisma/schema.prisma
- Role enum: SUPER_ADMIN, TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT
- ScopeType enum: TENANT, BUILDING, UNIT
- MembershipRole stores scoped roles per membership

## API runtime RBAC
- File: /Users/yoryiabreu/proyectos/buildingos/apps/api/src/rbac/permissions.ts
- Permissions:
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
- Role permissions live in PERMISSIONS map
- authorize.service.ts resolves tenant/building/unit scopes from Prisma membership roles

## Shared contracts package
- File: /Users/yoryiabreu/proyectos/buildingos/packages/contracts/src/rbac.ts
- Roles aligned with Prisma enum
- Permission vocabulary diverges from API runtime:
  - properties.read / properties.write
  - expenses.read / expenses.write
  - tickets.create / tickets.manage
  - communications.read / communications.publish

## Shared permissions package
- File: /Users/yoryiabreu/proyectos/buildingos/packages/permissions/src/permissions.ts
- ROLE_PERMISSIONS map follows the shared-contract vocabulary, not the API runtime vocabulary
- No verified app imports found from apps/api or apps/web

## Web RBAC
- Files:
  - /Users/yoryiabreu/proyectos/buildingos/apps/web/features/rbac/rbac.types.ts
  - /Users/yoryiabreu/proyectos/buildingos/apps/web/features/rbac/rbac.permissions.ts
- Uses a third vocabulary subset:
  - properties.read
  - properties.write
  - units.read
  - units.write
  - payments.submit
  - payments.review
- Missing tickets, members, communications, expenses from the main runtime API RBAC

## Auth and request contracts
- Files:
  - /Users/yoryiabreu/proyectos/buildingos/apps/api/src/auth/jwt.strategy.ts
  - /Users/yoryiabreu/proyectos/buildingos/apps/api/src/common/types/request.types.ts
- Role arrays are mostly typed as string[]
- memberships[].roles currently represent tenant-scoped role names only
- scopedRoles is available in tenancy service / JWT flow but not normalized into a shared RBAC contract yet

## Building access guard behavior
- File: /Users/yoryiabreu/proyectos/buildingos/apps/api/src/tenancy/building-access.guard.ts
- Mutates req.user.roles with tenant/building effective roles for the requested building context
- This is important for preserving behavior during migration

## Assistant-specific permissions (separate system)
- File: /Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/tools.service.ts
- Uses tools.* permissions, not the main RBAC Permission union
- Must remain out of the main RBAC unification effort

## Verified divergence summary
1. Prisma/API roles are aligned at the role-name level
2. API runtime permissions diverge from shared package permissions
3. Web RBAC diverges from both API runtime and shared package by using a smaller subset
4. API auth/request contracts still use string[] where Role[] should eventually exist
5. Scope resolution logic lives in API services/guards, not in shared contracts

## Proposed canonical baseline for migration
Use the API runtime RBAC vocabulary and semantics as the migration baseline because it is the active production behavior today.
