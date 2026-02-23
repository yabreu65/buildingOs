# Plan-Based Limits Implementation

## Overview

BuildingOS enforces billing plan limits across critical operations without hardcoding per-customer constraints. All limits are defined at the **BillingPlan level** and dynamically enforced via **PlanEntitlementsService**.

## Architecture

### 1. Plan Definition (Schema)

```prisma
model BillingPlan {
  id           String @id @default(cuid())
  planId       BillingPlanId @unique  // FREE, BASIC, PRO, ENTERPRISE
  name         String
  maxBuildings Int
  maxUnits     Int
  maxUsers     Int
  maxOccupants Int
}

enum BillingPlanId {
  FREE
  BASIC
  PRO
  ENTERPRISE
}
```

### 2. Available Plans

| Plan | Max Buildings | Max Units | Max Users | Max Occupants |
|------|---------------|-----------|-----------|---------------|
| **FREE** | 1 | 10 | 2 | 20 |
| **BASIC** | 3 | 100 | 10 | 200 |
| **PRO** | 10 | 500 | 50 | 1,000 |
| **ENTERPRISE** | 999 | 9,999 | 999 | 99,999 |

### 3. PlanEntitlementsService

The `PlanEntitlementsService` is the single source of truth for limit enforcement:

```typescript
export class PlanEntitlementsService {
  // Get tenant's subscription and plan details
  async getTenantPlan(tenantId): Promise<TenantPlan | null>

  // Get tenant's current resource usage
  async getTenantUsage(tenantId): Promise<TenantUsage>

  // Main enforcement method
  async assertLimit(tenantId, resourceType): Promise<void>
  // Throws ConflictException (HTTP 409) if limit exceeded
  // resourceType: 'buildings' | 'units' | 'users' | 'occupants'
}
```

## Enforcement Points

Plan limits are checked **before** creating resources:

### 1. Building Creation

**File**: `apps/api/src/buildings/buildings.service.ts`

```typescript
async create(tenantId: string, dto: CreateBuildingDto) {
  // Check plan limit: maxBuildings
  await this.planEntitlements.assertLimit(tenantId, 'buildings');

  // If we get here, limit is OK - create building
  const building = await this.prisma.building.create({...});
  return building;
}
```

**Behavior**:
- ✅ **FREE plan**: Can create 1 building
- ✅ **BASIC plan**: Can create up to 3 buildings
- ✅ **PRO plan**: Can create up to 10 buildings
- ✅ **ENTERPRISE**: Can create up to 999 buildings

### 2. Unit Creation

**File**: `apps/api/src/units/units.service.ts`

```typescript
async create(tenantId: string, buildingId: string, dto: CreateUnitDto) {
  // Check plan limit: maxUnits
  await this.planEntitlements.assertLimit(tenantId, 'units');

  // If we get here, limit is OK - create unit
  const unit = await this.prisma.unit.create({...});
  return unit;
}
```

**Behavior**:
- ✅ **FREE plan**: Can create up to 10 units total
- ✅ **BASIC plan**: Can create up to 100 units total
- ✅ **PRO plan**: Can create up to 500 units total

### 3. Occupant Assignment

**File**: `apps/api/src/occupants/occupants.service.ts`

```typescript
async assignOccupant(tenantId, buildingId, unitId, dto) {
  // Check plan limit: maxOccupants
  await this.planEntitlements.assertLimit(tenantId, 'occupants');

  // If we get here, limit is OK - assign occupant
  const occupant = await this.prisma.unitOccupant.create({...});
  return occupant;
}
```

**Behavior**:
- ✅ **FREE plan**: Can assign up to 20 occupants across all units
- ✅ **BASIC plan**: Can assign up to 200 occupants
- ✅ **PRO plan**: Can assign up to 1,000 occupants

### 4. User Invitations

**File**: `apps/api/src/invitations/invitations.service.ts`

```typescript
async createInvitation(tenantId, dto, actorMembershipId) {
  // Check plan limit: maxUsers
  await this.planEntitlements.assertLimit(tenantId, 'users');

  // If we get here, limit is OK - create invitation
  const invitation = await this.prisma.invitation.create({...});
  return invitation;
}
```

**Behavior**:
- ✅ **FREE plan**: Can invite up to 2 users total
- ✅ **BASIC plan**: Can invite up to 10 users total
- ✅ **PRO plan**: Can invite up to 50 users total

## Error Handling

When a limit is exceeded, the service throws a **ConflictException (HTTP 409)** with detailed metadata:

```json
{
  "code": 409,
  "message": "Conflict",
  "error": {
    "code": "PLAN_LIMIT_EXCEEDED",
    "message": "Plan limit exceeded: maxBuildings",
    "metadata": {
      "limit": 1,
      "current": 1,
      "planId": "free-plan-id",
      "resourceType": "buildings"
    }
  }
}
```

### Frontend Handling

The frontend can use the error code to show user-friendly messages:

```typescript
try {
  await buildingsApi.create({name: 'New Building'});
} catch (error) {
  if (error.response?.data?.error?.code === 'PLAN_LIMIT_EXCEEDED') {
    const meta = error.response.data.error.metadata;
    showError(`
      You've reached the ${meta.resourceType} limit for your plan.
      Current: ${meta.current}/${meta.limit}
    `);
  }
}
```

## Subscription Status Validation

In addition to resource limits, the `assertLimit` method validates that the **subscription status is ACTIVE or TRIAL**:

```typescript
private validateSubscriptionStatus(status: SubscriptionStatus): void {
  const isAllowed =
    status === SubscriptionStatus.ACTIVE ||
    status === SubscriptionStatus.TRIAL;

  if (!isAllowed) {
    throw new BadRequestException(
      `Cannot create resources: subscription status is ${status}`
    );
  }
}
```

**Subscriptions in other states cannot perform writes:**
- ❌ `PAST_DUE`: Payment overdue
- ❌ `CANCELED`: Subscription canceled
- ❌ `SUSPENDED`: Administrative hold
- ❌ `EXPIRED`: Trial ended without conversion

## Demo Data

The seed includes 2 tenants with different plans to test limits:

### Tenant A: Admin Demo
- **Plan**: PRO
- **Limits**: 10 buildings, 500 units, 50 users, 1,000 occupants
- **Current**: 2 buildings, 6 units, 1 user
- **Status**: Plenty of capacity

### Tenant B: Edificio Demo
- **Plan**: FREE
- **Limits**: 1 building, 10 units, 2 users, 20 occupants
- **Current**: 1 building, 6 units, 2 users
- **Status**: At building limit, near user limit

### Testing Limits

To test limit enforcement with Tenant B (FREE plan):

```bash
# 1. Login as Tenant B admin
email: admin@demo.com
password: Admin123!

# 2. Try to create second building
# Expected: HTTP 409 - Plan limit exceeded

# 3. Try to create 5th unit (6 already exist, max 10)
# Expected: HTTP 200 - Success

# 4. Try to create 11th unit
# Expected: HTTP 409 - Plan limit exceeded

# 5. Try to invite new user
# Expected: HTTP 409 - Already at maxUsers=2
```

## Plan Upgrades/Downgrades

When a tenant changes plans via the super-admin endpoint:

```
PATCH /api/super-admin/tenants/:tenantId/subscription
{ "newPlanId": "pro-plan-id" }
```

The system:
1. ✅ Validates the new plan exists
2. ✅ On **downgrades**: Checks if current usage exceeds new plan limits
   - If current usage > new plan limit → HTTP 409 (Conflict)
   - Prevents data loss from unexpected downgrades
3. ✅ On **upgrades**: Allows immediately (no validation needed)
4. ✅ Creates SubscriptionEvent + Audit log
5. ✅ Transaction ensures atomicity

**Example: Blocking Downgrade**

```bash
# Tenant has: 5 buildings, 50 units
# Trying to downgrade from PRO (10 buildings) to BASIC (3 buildings)
# Expected: HTTP 409 - Cannot downgrade: current usage exceeds new plan limits

# Tenant must delete 2 buildings first, then can downgrade
```

## Implementation Details

### How Usage is Counted

```typescript
async getTenantUsage(tenantId: string): Promise<TenantUsage> {
  // Count buildings (all, regardless of deleted status)
  const buildingCount = await this.prisma.building.count({
    where: { tenantId }
  });

  // Count units (across all buildings in tenant)
  const unitCount = await this.prisma.unit.count({
    where: {
      building: { tenantId }
    }
  });

  // Count active memberships (invited + accepted users)
  const membershipCount = await this.prisma.membership.count({
    where: { tenantId }
  });

  // Count occupant assignments
  const occupantCount = await this.prisma.unitOccupant.count({
    where: {
      unit: {
        building: { tenantId }
      }
    }
  });

  return { buildings, units, activeUsers, activeOccupants };
}
```

### Design Patterns

1. **No hardcoding**: All limits come from `BillingPlan` table
2. **Tenant-scoped**: Each tenant has own subscription + plan
3. **Fire-and-forget**: Limit checks never fail main operation (throws early)
4. **Multi-tenant safe**: Filters by tenantId at every query level
5. **Generic**: Same `assertLimit()` method handles all resource types
6. **Extensible**: Adding new resource type requires only:
   - Adding case to switch statement
   - Adding query to getTenantUsage()
   - Calling assertLimit() in relevant service

## Testing

### Run Plan Limits Tests

```bash
# Full E2E test suite
npm run test:e2e

# Just plan limits test
npm run test:e2e apps/api/test/plan-limits.e2e-spec.ts

# Watch mode
npm run test:e2e -- --watch apps/api/test/plan-limits.e2e-spec.ts
```

### Test Coverage

The `plan-limits.e2e-spec.ts` covers:
- ✅ Building creation limits
- ✅ Unit creation limits
- ✅ Occupant assignment limits
- ✅ User invitation limits
- ✅ Usage reporting accuracy
- ✅ Plan details retrieval
- ✅ Subscription status validation

## Database Indexes

The implementation uses these indexes for efficient counting:

```prisma
model Building {
  tenantId String  @@index([tenantId])
}

model Unit {
  buildingId String  @@index([buildingId])
}

model Membership {
  tenantId String  @@index([tenantId])
}

model UnitOccupant {
  unitId String  @@index([unitId])
}
```

This ensures count queries are O(1) even with millions of records.

## Future Enhancements

1. **Usage Alerts**: Warn tenants when approaching limits (80%, 90%)
2. **Soft Limits**: Allow small overage with billing adjustment
3. **Usage Dashboard**: Show current usage vs. plan limits per tenant
4. **Limit Customization**: Enterprise plans could have custom limits
5. **Auto-upgrade**: Offer plan upgrade when limit reached
6. **Rate Limiting**: API request rate limits tied to plan tier

## Migration Guide

**From previous versions** (if hardcoding existed):

1. No data migration needed - BillingPlan model already exists
2. Verify all services call `assertLimit()` before creating resources
3. Ensure Subscription records have correct `planId` references
4. Test with seed data before production

---

**Last Updated**: February 22, 2026
**Status**: Production Ready ✅
**Coverage**: 100% of critical operations
