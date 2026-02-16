# Tickets Security & Scope Validation

## Overview

All Tickets endpoints enforce strict multi-tenant isolation and scope validation across three layers:

1. **Guard Layer** (BuildingAccessGuard): Validates user has access to the building
2. **Service Layer** (TicketsValidators): Validates building/ticket/unit scope
3. **Database Layer** (Prisma): Enforces foreign key constraints

---

## Security Flow

### Request Validation Order

```
User Request
    ↓
[1] JwtAuthGuard
    - Validates JWT token is valid
    - Extracts user info and memberships
    - Returns 401 if invalid
    ↓
[2] BuildingAccessGuard
    - Extracts buildingId from URL params
    - Finds building in database
    - Verifies user has membership in building's tenant
    - Populates req.tenantId automatically
    - Returns 403 Forbidden if user not in tenant
    - Returns 404 Not Found if building doesn't exist
    ↓
[3] Controller Handler
    - Uses req.tenantId (validated by guard)
    - Passes to service layer
    ↓
[4] Service Layer (Validators)
    - Validates building belongs to tenant
    - Validates unit belongs to building and tenant
    - Validates ticket belongs to building and tenant
    - Returns 404 if scope doesn't match
    ↓
[5] Database Layer
    - Prisma enforces foreign keys and constraints
    - Cascade deletes on ticket deletion
```

---

## Endpoint Security

### POST /buildings/:buildingId/tickets
**Creates a ticket in a building**

**Guards:**
- JwtAuthGuard
- BuildingAccessGuard

**Validations:**
- req.tenantId: Populated by BuildingAccessGuard
- buildingId: Must belong to tenantId
- unitId (if provided): Must belong to buildingId and tenantId
- assignedToMembershipId (if provided): Must belong to tenantId

**Error Responses:**
- 401 Unauthorized: Invalid JWT
- 403 Forbidden: User not in building's tenant
- 404 Not Found: Building doesn't exist or belongs to different tenant
- 400 Bad Request: Invalid input data (Zod validation)

**Request Example (Valid):**
```
POST /buildings/bld-123/tickets HTTP/1.1
Authorization: Bearer <JWT>

{
  "title": "Fix door lock",
  "description": "Main entrance door lock is broken",
  "category": "MAINTENANCE",
  "priority": "HIGH",
  "unitId": "unit-456",
  "assignedToMembershipId": "mem-789"
}
```

---

### GET /buildings/:buildingId/tickets
**Lists all tickets in a building**

**Guards:**
- JwtAuthGuard
- BuildingAccessGuard

**Validations:**
- Same as create endpoint
- Additional query parameter validation:
  - status: Must be one of OPEN|IN_PROGRESS|RESOLVED|CLOSED
  - priority: Must be one of LOW|MEDIUM|HIGH|URGENT
  - unitId (filter): Must belong to buildingId if provided
  - assignedToMembership: Must belong to tenantId if provided

**Error Responses:**
- 401 Unauthorized: Invalid JWT
- 403 Forbidden: User not in building's tenant
- 404 Not Found: Building doesn't exist

---

### GET /buildings/:buildingId/tickets/:ticketId
**Gets a single ticket**

**Guards:**
- JwtAuthGuard
- BuildingAccessGuard

**Validations:**
- buildingId: Must belong to tenantId
- ticketId: Must belong to buildingId and tenantId

**Error Responses:**
- 401 Unauthorized: Invalid JWT
- 403 Forbidden: User not in building's tenant
- 404 Not Found: Building or ticket doesn't exist/belong to tenant

---

### PATCH /buildings/:buildingId/tickets/:ticketId
**Updates a ticket**

**Guards:**
- JwtAuthGuard
- BuildingAccessGuard

**Validations:**
- All get validations (building, ticket)
- New unitId (if provided): Must belong to buildingId and tenantId
- New assignedToMembershipId (if provided): Must belong to tenantId
- Status transition: Must be valid (see state machine)

**Error Responses:**
- 401 Unauthorized: Invalid JWT
- 403 Forbidden: User not in building's tenant
- 404 Not Found: Building, ticket, or unit doesn't exist/belong to tenant
- 400 Bad Request: Invalid status transition

---

### DELETE /buildings/:buildingId/tickets/:ticketId
**Deletes a ticket (cascade deletes comments)**

**Guards:**
- JwtAuthGuard
- BuildingAccessGuard

**Validations:**
- All get validations

**Error Responses:**
- 401 Unauthorized: Invalid JWT
- 403 Forbidden: User not in building's tenant
- 404 Not Found: Building or ticket doesn't exist/belong to tenant

---

### POST /buildings/:buildingId/tickets/:ticketId/comments
**Adds a comment to a ticket**

**Guards:**
- JwtAuthGuard
- BuildingAccessGuard

**Validations:**
- All get validations (building, ticket)

**Error Responses:**
- 401 Unauthorized: Invalid JWT
- 403 Forbidden: User not in building's tenant
- 404 Not Found: Building or ticket doesn't exist/belong to tenant
- 400 Bad Request: Invalid input (Zod)

---

### GET /buildings/:buildingId/tickets/:ticketId/comments
**Gets all comments for a ticket**

**Guards:**
- JwtAuthGuard
- BuildingAccessGuard

**Validations:**
- All get validations

**Error Responses:**
- 401 Unauthorized: Invalid JWT
- 403 Forbidden: User not in building's tenant
- 404 Not Found: Building or ticket doesn't exist/belong to tenant

---

## Negative Test Cases

### Case 1: Cross-Tenant Access

**Scenario:** User from Tenant A tries to access Tenant B's building

**Request:**
```
POST /buildings/bld-b123/tickets
Authorization: Bearer <JWT-user-from-tenant-a>

{
  "title": "Test",
  "description": "Should fail",
  "category": "TEST"
}
```

**Expected Response:**
```
403 Forbidden
{
  "code": "FORBIDDEN",
  "message": "No tiene acceso al building en este tenant"
}
```

**Why:** BuildingAccessGuard checks that building's tenantId is in user's membership list.

---

### Case 2: Building ID Doesn't Exist

**Scenario:** User requests a building that doesn't exist

**Request:**
```
GET /buildings/nonexistent-id/tickets
Authorization: Bearer <JWT>
```

**Expected Response:**
```
404 Not Found
{
  "code": "NOT_FOUND",
  "message": "Building not found or does not belong to this tenant"
}
```

**Why:** BuildingAccessGuard queries database and returns 404 if building not found.

---

### Case 3: Unit from Different Building

**Scenario:** User creates a ticket and assigns it to a unit from a different building

**Setup:**
- Tenant A has Building X with Unit 1
- Tenant A has Building Y with Unit 2
- User tries to create ticket in Building X with unitId=Unit 2

**Request:**
```
POST /buildings/bld-x-123/tickets
Authorization: Bearer <JWT>

{
  "title": "Test",
  "description": "Test with wrong unit",
  "category": "TEST",
  "unitId": "unit-from-building-y"
}
```

**Expected Response:**
```
404 Not Found
{
  "code": "NOT_FOUND",
  "message": "Unit not found or does not belong to this building/tenant"
}
```

**Why:** TicketsValidators.validateUnitBelongsToBuildingAndTenant() queries with both buildingId and tenantId constraints.

---

### Case 4: Ticket from Different Building

**Scenario:** User tries to access a ticket that belongs to a different building in the same tenant

**Setup:**
- Tenant A has Building X with Ticket 1
- Tenant A has Building Y with Ticket 2
- User tries to GET ticket 2 from building X

**Request:**
```
GET /buildings/bld-x-123/tickets/ticket-from-bld-y
Authorization: Bearer <JWT>
```

**Expected Response:**
```
404 Not Found
{
  "code": "NOT_FOUND",
  "message": "Ticket not found or does not belong to this building/tenant"
}
```

**Why:** TicketsValidators.validateTicketBelongsToBuildingAndTenant() checks both buildingId and tenantId.

---

### Case 5: Invalid JWT Token

**Scenario:** Request without valid JWT

**Request:**
```
GET /buildings/bld-123/tickets
Authorization: Bearer invalid-token
```

**Expected Response:**
```
401 Unauthorized
{
  "code": "UNAUTHORIZED",
  "message": "Invalid token"
}
```

**Why:** JwtAuthGuard validates token before anything else.

---

### Case 6: Reassign Ticket to Unit from Different Building

**Scenario:** User updates a ticket and tries to reassign it to a different unit

**Request:**
```
PATCH /buildings/bld-x-123/tickets/ticket-123
Authorization: Bearer <JWT>

{
  "unitId": "unit-from-different-building"
}
```

**Expected Response:**
```
404 Not Found
{
  "code": "NOT_FOUND",
  "message": "Unit not found or does not belong to this building/tenant"
}
```

**Why:** Service validates unitId scope before updating.

---

## Scope Validation Helpers

### validateBuildingBelongsToTenant(tenantId, buildingId)

**What it does:**
- Queries building with both id and tenantId
- Throws NotFoundException if not found

**Why it's safe:**
- Database query includes tenantId constraint
- Returns 404 for cross-tenant access (prevents enumeration)

**Implementation:**
```typescript
async validateBuildingBelongsToTenant(
  tenantId: string,
  buildingId: string,
): Promise<void> {
  const building = await this.prisma.building.findFirst({
    where: { id: buildingId, tenantId },
  });

  if (!building) {
    throw new NotFoundException(
      `Building not found or does not belong to this tenant`,
    );
  }
}
```

---

### validateUnitBelongsToBuildingAndTenant(tenantId, buildingId, unitId)

**What it does:**
- Queries unit with id, buildingId, and building.tenantId constraint
- Throws NotFoundException if not found

**Why it's safe:**
- Database query includes both buildingId and tenantId constraints
- Prevents assigning units from different buildings
- Returns 404 for both non-existent units and cross-building units

**Implementation:**
```typescript
async validateUnitBelongsToBuildingAndTenant(
  tenantId: string,
  buildingId: string,
  unitId: string,
): Promise<void> {
  const unit = await this.prisma.unit.findFirst({
    where: {
      id: unitId,
      buildingId,
      building: { tenantId },
    },
  });

  if (!unit) {
    throw new NotFoundException(
      `Unit not found or does not belong to this building/tenant`,
    );
  }
}
```

---

### validateTicketBelongsToBuildingAndTenant(tenantId, buildingId, ticketId)

**What it does:**
- Queries ticket with id, tenantId, and buildingId
- Throws NotFoundException if not found

**Why it's safe:**
- Database query includes both buildingId and tenantId constraints
- Prevents accessing tickets from different buildings
- Returns 404 for both non-existent tickets and cross-building tickets

**Implementation:**
```typescript
async validateTicketBelongsToBuildingAndTenant(
  tenantId: string,
  buildingId: string,
  ticketId: string,
): Promise<void> {
  const ticket = await this.prisma.ticket.findFirst({
    where: {
      id: ticketId,
      tenantId,
      buildingId,
    },
  });

  if (!ticket) {
    throw new NotFoundException(
      `Ticket not found or does not belong to this building/tenant`,
    );
  }
}
```

---

## Key Security Properties

### 1. No Information Leakage
- All scope violations return the same 404 message
- Attacker cannot distinguish between "doesn't exist" and "doesn't belong to you"
- Prevents enumeration attacks

### 2. Multi-Layer Validation
- Guard layer: Prevents access to non-owned buildings
- Service layer: Prevents scope crossing within the tenant
- Database layer: Enforces constraints

### 3. Idempotent Validations
- Guards and validators can be called multiple times
- No side effects
- Safe to add more validations without breaking existing flow

### 4. Explicit Error Types
- 403 Forbidden: User is authenticated but not authorized
- 404 Not Found: Resource doesn't exist or doesn't belong to user
- 400 Bad Request: Input validation failed
- 401 Unauthorized: JWT invalid

### 5. Scope Always Validated
- Every endpoint validates building scope before any operation
- Every endpoint that touches units validates unit scope
- Every endpoint that touches tickets validates ticket scope
- No endpoint can cross tenant or building boundaries

---

## Testing Recommendations

### Unit Tests
```typescript
// Test that validator throws NotFoundException for missing building
it('should throw NotFoundException when building does not belong to tenant', async () => {
  await expect(
    validator.validateBuildingBelongsToTenant('tenant-a', 'building-b'),
  ).rejects.toThrow(NotFoundException);
});

// Test that validator throws NotFoundException for missing unit
it('should throw NotFoundException when unit from different building', async () => {
  await expect(
    validator.validateUnitBelongsToBuildingAndTenant(
      'tenant-a',
      'building-a',
      'unit-from-building-b',
    ),
  ).rejects.toThrow(NotFoundException);
});
```

### Integration Tests
```typescript
// Test that building access guard rejects cross-tenant access
it('should return 403 when user not in building tenant', async () => {
  const response = await request(app.getHttpServer())
    .post('/buildings/building-from-other-tenant/tickets')
    .set('Authorization', `Bearer ${jwtToken}`)
    .send({ title: 'Test', description: 'Test', category: 'TEST' });

  expect(response.status).toBe(403);
});

// Test that ticket endpoint returns 404 for missing ticket
it('should return 404 when ticket does not exist', async () => {
  const response = await request(app.getHttpServer())
    .get('/buildings/building-123/tickets/nonexistent-ticket')
    .set('Authorization', `Bearer ${jwtToken}`);

  expect(response.status).toBe(404);
});
```

---

## Summary

The Tickets module implements strict security with:
- ✅ JWT authentication on all endpoints
- ✅ Building-level access control (BuildingAccessGuard)
- ✅ Tenant scope validation (TicketsValidators)
- ✅ Building/Unit scope validation (TicketsValidators)
- ✅ No information leakage (same 404 for missing + unauthorized)
- ✅ Reusable validators (no duplication)
- ✅ Cascade delete on ticket deletion

**Result:** Users cannot access tickets, buildings, or units outside their tenant boundaries, even with a valid JWT.
