# Audit Events Reference

## Overview

This document catalogs all audit events logged in the BuildingOS system. Each event is recorded in the `AuditLog` table with:
- `action`: Enum value from `AuditAction`
- `entity`: Semantic entity type (e.g., "Ticket", "Building")
- `entityId`: ID of the affected resource
- `metadata`: Additional context (before/after values, IDs, etc.)
- `tenantId`: Tenant scope (nullable for global events)
- `actorUserId`: User who performed the action (nullable for system events)
- `createdAt`: Timestamp of the action

---

## SUPER_ADMIN Events (5)

These events are triggered by SUPER_ADMIN operations on the control plane.

### TENANT_CREATE
**Action**: User creates a new tenant

- **Entity**: `Tenant`
- **Metadata**:
  - `name`: Tenant name
  - `type`: Tenant type (ADMINISTRADORA | EDIFICIO_AUTOGESTION)
- **Triggered by**: `POST /api/super-admin/tenants`
- **Example**:
  ```json
  {
    "action": "TENANT_CREATE",
    "entity": "Tenant",
    "entityId": "clh123...",
    "metadata": {
      "name": "Edificio Principal",
      "type": "ADMINISTRADORA"
    }
  }
  ```

### TENANT_UPDATE
**Action**: User updates a tenant

- **Entity**: `Tenant`
- **Metadata**:
  - `name`: Updated name
  - `type`: Updated type
- **Triggered by**: `PATCH /api/super-admin/tenants/:tenantId`

### TENANT_DELETE
**Action**: User deletes a tenant

- **Entity**: `Tenant`
- **Metadata**:
  - `name`: Deleted tenant name
- **Triggered by**: `DELETE /api/super-admin/tenants/:tenantId`

### SUBSCRIPTION_CREATE
**Action**: Subscription created for tenant

- **Entity**: `Subscription`
- **Metadata**:
  - `planId`: Billing plan ID
  - `status`: Subscription status (TRIAL, ACTIVE, etc.)
- **Triggered by**: Internal (during tenant creation)

### SUBSCRIPTION_UPDATE
**Action**: Subscription plan changed

- **Entity**: `Subscription`
- **Metadata**:
  - `oldPlanId`: Previous plan ID
  - `newPlanId`: New plan ID
- **Triggered by**: `PATCH /api/super-admin/tenants/:tenantId/subscription`

---

## AUTH Events (3)

Authentication and session events.

### AUTH_LOGIN
**Action**: User successfully logs in

- **Entity**: `User`
- **Metadata**:
  - `email`: User email
  - `isSuperAdmin`: Whether user has SUPER_ADMIN role
- **Triggered by**: `POST /auth/login` (successful)
- **Scope**: Global (no tenantId)

### AUTH_LOGOUT
**Action**: User logs out (frontend only, not tracked server-side yet)

- **Entity**: `User`
- **Metadata**: (reserved for future use)

### AUTH_FAILED_LOGIN
**Action**: Failed login attempt

- **Entity**: `User` (identified by email)
- **EntityId**: Email address (for tracking failed attempts)
- **Metadata**:
  - `email`: Email attempted
- **Triggered by**: `POST /auth/login` (invalid credentials)
- **Scope**: Global (no tenantId)

---

## BUILDING Events (3)

Building management operations.

### BUILDING_CREATE
**Action**: New building created in a tenant

- **Entity**: `Building`
- **Metadata**:
  - `name`: Building name
  - `address`: Building address
- **Triggered by**: `POST /tenants/:tenantId/buildings`
- **Scope**: Tenant-scoped

### BUILDING_UPDATE
**Action**: Building details updated

- **Entity**: `Building`
- **Metadata**:
  - `name`: Updated name
  - `address`: Updated address
- **Triggered by**: `PATCH /tenants/:tenantId/buildings/:buildingId`

### BUILDING_DELETE
**Action**: Building deleted (cascade deletes units, tickets, etc.)

- **Entity**: `Building`
- **Metadata**:
  - `name`: Deleted building name
- **Triggered by**: `DELETE /tenants/:tenantId/buildings/:buildingId`

---

## UNIT Events (3)

Unit (apartment/office) management.

### UNIT_CREATE
**Action**: New unit created in a building

- **Entity**: `Unit`
- **Metadata**:
  - `buildingId`: Parent building ID
  - `code`: Unit code
  - `label`: Unit label/number
- **Triggered by**: API call (future implementation)

### UNIT_UPDATE
**Action**: Unit details updated

- **Entity**: `Unit`
- **Metadata**:
  - `code`: Updated code
  - `label`: Updated label
- **Triggered by**: API call (future implementation)

### UNIT_DELETE
**Action**: Unit deleted

- **Entity**: `Unit`
- **Metadata**:
  - `buildingId`: Parent building ID
- **Triggered by**: API call (future implementation)

---

## OCCUPANT Events (2)

Unit occupant (resident/owner) management.

### OCCUPANT_ASSIGN
**Action**: User assigned to a unit

- **Entity**: `UnitOccupant`
- **Metadata**:
  - `unitId`: Unit ID
  - `userId`: User assigned
  - `role`: Role assigned (OWNER | RESIDENT)
- **Triggered by**: `POST /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants`

### OCCUPANT_REMOVE
**Action**: User removed from unit

- **Entity**: `UnitOccupant`
- **Metadata**:
  - `unitId`: Unit ID
  - `userId`: User removed
  - `role`: Role that was removed
- **Triggered by**: `DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants/:occupantId`

---

## TICKET Events (6)

Maintenance request tracking.

### TICKET_CREATE
**Action**: New maintenance request created

- **Entity**: `Ticket`
- **Metadata**:
  - `title`: Ticket title
  - `buildingId`: Building ID
  - `unitId`: Unit ID (optional)
- **Triggered by**: `POST /buildings/:buildingId/tickets`

### TICKET_UPDATE
**Action**: Ticket details updated (non-status changes)

- **Entity**: `Ticket`
- **Metadata**:
  - `field`: Which field changed
  - `oldValue`: Previous value
  - `newValue`: New value
- **Triggered by**: `PATCH /buildings/:buildingId/tickets/:ticketId`

### TICKET_STATUS_CHANGE
**Action**: Ticket status changed (OPEN → IN_PROGRESS, etc.)

- **Entity**: `Ticket`
- **Metadata**:
  - `oldStatus`: Previous status
  - `newStatus`: New status
- **Triggered by**: `PATCH /buildings/:buildingId/tickets/:ticketId` (when status field included)

### TICKET_ASSIGN
**Action**: Ticket assigned to staff member

- **Entity**: `Ticket`
- **Metadata**:
  - `assignedToMembershipId`: Staff member ID
- **Triggered by**: `PATCH /buildings/:buildingId/tickets/:ticketId`

### TICKET_COMMENT_ADD
**Action**: Comment added to ticket

- **Entity**: `TicketComment`
- **Metadata**:
  - `ticketId`: Parent ticket ID
- **Triggered by**: `POST /buildings/:buildingId/tickets/:ticketId/comments`

### TICKET_DELETE
**Action**: Ticket deleted (cascade deletes comments)

- **Entity**: `Ticket`
- **Metadata**:
  - `title`: Deleted ticket title
- **Triggered by**: `DELETE /buildings/:buildingId/tickets/:ticketId`

---

## COMMUNICATION Events (4)

Internal messaging system.

### COMMUNICATION_CREATE_DRAFT
**Action**: Communication draft created

- **Entity**: `Communication`
- **Metadata**:
  - `subject`: Message subject
  - `recipientCount`: Number of recipients
- **Triggered by**: `POST /communications` (draft mode)

### COMMUNICATION_EDIT_DRAFT
**Action**: Draft communication edited

- **Entity**: `Communication`
- **Metadata**:
  - `subject`: Updated subject
- **Triggered by**: `PATCH /communications/:id` (before sending)

### COMMUNICATION_SEND
**Action**: Communication sent to recipients

- **Entity**: `Communication`
- **Metadata**:
  - `subject`: Message subject
  - `sentCount`: Number of recipients received message
- **Triggered by**: `POST /communications/:id/send`

### COMMUNICATION_READ
**Action**: Recipient reads communication

- **Entity**: `CommunicationReceipt`
- **Metadata**:
  - `communicationId`: Parent message ID
  - `readBy`: Recipient user ID
- **Triggered by**: `PATCH /communications/:id/receipts/:receiptId` (mark as read)

---

## DOCUMENT Events (5)

File and document management.

### FILE_UPLOADED
**Action**: File uploaded to storage

- **Entity**: `File`
- **Metadata**:
  - `filename`: Original filename
  - `mimetype`: MIME type
  - `size`: File size in bytes
- **Triggered by**: `POST /documents/upload`

### DOCUMENT_CREATE
**Action**: Document metadata created (links to file)

- **Entity**: `Document`
- **Metadata**:
  - `title`: Document title
  - `fileId`: Associated file ID
  - `buildingId`: Building scope (optional)
- **Triggered by**: `POST /buildings/:buildingId/documents`

### DOCUMENT_VISIBILITY_CHANGED
**Action**: Document visibility/sharing changed

- **Entity**: `Document`
- **Metadata**:
  - `visibility`: New visibility level (PRIVATE, BUILDING, PUBLIC)
- **Triggered by**: `PATCH /buildings/:buildingId/documents/:documentId`

### DOCUMENT_DOWNLOADED
**Action**: User downloads document

- **Entity**: `Document`
- **Metadata**:
  - `title`: Document title
  - `downloadedBy`: User ID
- **Triggered by**: `GET /buildings/:buildingId/documents/:documentId/download`

### DOCUMENT_DELETE
**Action**: Document deleted

- **Entity**: `Document`
- **Metadata**:
  - `title`: Deleted document title
- **Triggered by**: `DELETE /buildings/:buildingId/documents/:documentId`

---

## FINANCE Events (7)

Billing and payment tracking.

### CHARGE_CREATE
**Action**: New charge created (for rent, utilities, etc.)

- **Entity**: `Charge`
- **Metadata**:
  - `amount`: Charge amount (cents)
  - `type`: Charge type (COMMON_EXPENSE, EXTRAORDINARY, FINE, etc.)
  - `unitId`: Unit charged (optional)
  - `dueDate`: Due date
- **Triggered by**: `POST /buildings/:buildingId/charges`

### CHARGE_CANCEL
**Action**: Charge canceled

- **Entity**: `Charge`
- **Metadata**:
  - `reason`: Cancellation reason
- **Triggered by**: `DELETE /buildings/:buildingId/charges/:chargeId`

### PAYMENT_SUBMIT
**Action**: Payment submitted for review

- **Entity**: `Payment`
- **Metadata**:
  - `amount`: Payment amount (cents)
  - `method`: Payment method (TRANSFER, CASH, CARD, ONLINE)
- **Triggered by**: `POST /buildings/:buildingId/payments`

### PAYMENT_APPROVE
**Action**: Payment approved by admin

- **Entity**: `Payment`
- **Metadata**:
  - `approvedBy`: Staff member ID
- **Triggered by**: `PATCH /buildings/:buildingId/payments/:paymentId` (approve)

### PAYMENT_REJECT
**Action**: Payment rejected

- **Entity**: `Payment`
- **Metadata**:
  - `reason`: Rejection reason
- **Triggered by**: `PATCH /buildings/:buildingId/payments/:paymentId` (reject)

### PAYMENT_ALLOCATE
**Action**: Payment allocated against charges

- **Entity**: `PaymentAllocation`
- **Metadata**:
  - `paymentId`: Payment ID
  - `chargeId`: Charge ID
  - `amount`: Allocated amount
- **Triggered by**: `POST /buildings/:buildingId/allocations`

### ALLOCATION_DELETE
**Action**: Payment allocation reversed

- **Entity**: `PaymentAllocation`
- **Metadata**:
  - `paymentId`: Payment ID
  - `amount`: Deallocated amount
- **Triggered by**: `DELETE /buildings/:buildingId/allocations/:allocationId`

---

## VENDOR Events (9)

Vendor and work order management.

### VENDOR_CREATE
**Action**: New vendor added to system

- **Entity**: `Vendor`
- **Metadata**:
  - `name`: Vendor name
  - `specialization`: Service type
- **Triggered by**: `POST /buildings/:buildingId/vendors`

### VENDOR_UPDATE
**Action**: Vendor details updated

- **Entity**: `Vendor`
- **Metadata**:
  - `name`: Updated name
- **Triggered by**: `PATCH /buildings/:buildingId/vendors/:vendorId`

### VENDOR_DELETE
**Action**: Vendor deleted

- **Entity**: `Vendor`
- **Metadata**:
  - `name`: Deleted vendor name
- **Triggered by**: `DELETE /buildings/:buildingId/vendors/:vendorId`

### VENDOR_ASSIGN
**Action**: Vendor assigned to building

- **Entity**: `VendorAssignment`
- **Metadata**:
  - `vendorId`: Vendor ID
  - `buildingId`: Building ID
- **Triggered by**: Internal or admin action

### VENDOR_UNASSIGN
**Action**: Vendor removed from building

- **Entity**: `VendorAssignment`
- **Metadata**:
  - `vendorId`: Vendor ID
  - `buildingId`: Building ID
- **Triggered by**: Internal or admin action

### QUOTE_CREATE
**Action**: Service quote requested from vendor

- **Entity**: `Quote`
- **Metadata**:
  - `vendorId`: Vendor ID
  - `amount`: Quoted amount
  - `scope`: Work scope description
- **Triggered by**: `POST /buildings/:buildingId/quotes`

### QUOTE_STATUS_CHANGE
**Action**: Quote status changed (PENDING → ACCEPTED, etc.)

- **Entity**: `Quote`
- **Metadata**:
  - `oldStatus`: Previous status
  - `newStatus`: New status
- **Triggered by**: `PATCH /buildings/:buildingId/quotes/:quoteId`

### WORK_ORDER_CREATE
**Action**: Work order created for approved quote

- **Entity**: `WorkOrder`
- **Metadata**:
  - `quoteId`: Associated quote ID
  - `vendorId`: Assigned vendor ID
- **Triggered by**: `POST /buildings/:buildingId/work-orders`

### WORK_ORDER_STATUS_CHANGE
**Action**: Work order status updated (IN_PROGRESS → COMPLETED, etc.)

- **Entity**: `WorkOrder`
- **Metadata**:
  - `oldStatus`: Previous status
  - `newStatus`: New status
- **Triggered by**: `PATCH /buildings/:buildingId/work-orders/:workOrderId`

---

## Querying Audit Logs

### Endpoint
```
GET /audit/logs
```

### Query Parameters
All parameters are optional. If not provided, all logs are returned.

| Parameter | Type | Example | Notes |
|-----------|------|---------|-------|
| `tenantId` | string | `clh123...` | Filter by tenant. TENANT_ADMIN users are forced to their own tenant. |
| `actorUserId` | string | `clh456...` | Filter by actor (user who performed action) |
| `action` | string | `TICKET_CREATE` | Filter by audit action (any `AuditAction` enum value) |
| `entityType` | string | `Ticket` | Filter by entity type (Ticket, Building, Document, etc.) |
| `dateFrom` | ISO date | `2026-02-17T00:00:00Z` | Start of date range |
| `dateTo` | ISO date | `2026-02-18T23:59:59Z` | End of date range |
| `skip` | number | `0` | Pagination offset (default 0) |
| `take` | number | `50` | Records per page (default 50, max 100) |

### Example Request
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://api.example.com/audit/logs?tenantId=clh123&action=TICKET_CREATE&skip=0&take=10"
```

### Response Structure
```json
{
  "data": [
    {
      "id": "clh789...",
      "tenantId": "clh123...",
      "actorUserId": "clh456...",
      "action": "TICKET_CREATE",
      "entity": "Ticket",
      "entityId": "clh321...",
      "metadata": {
        "title": "Broken window in unit 302",
        "buildingId": "clh001...",
        "unitId": "clh002..."
      },
      "createdAt": "2026-02-17T10:30:00Z",
      "tenant": {
        "id": "clh123...",
        "name": "Edificio Principal"
      },
      "actor": {
        "id": "clh456...",
        "email": "admin@example.com",
        "name": "Admin User"
      }
    }
  ],
  "total": 1250,
  "pagination": {
    "skip": 0,
    "take": 10,
    "total": 1250
  }
}
```

---

## Access Control

### SUPER_ADMIN
- Can query logs from **all tenants**
- Can filter by any `tenantId`
- Can export audit trails for compliance

### TENANT_ADMIN / TENANT_OWNER / TENANT_OPERATOR
- Can only query logs from **their own tenant**
- The `tenantId` filter is **ignored** (security: forced to their tenant)
- Cannot see logs from other tenants

### RESIDENT
- **Cannot access** audit logs (403 Forbidden)

---

## Fire-and-Forget Pattern

Audit logging uses a **fire-and-forget** pattern:
- Service calls `auditService.createLog()` but does NOT await it
- If audit write fails, the main operation still succeeds
- Errors are logged to console for debugging
- **No impact** on user-facing operations

This ensures:
1. Audit failures don't break business logic
2. API latency is not affected by audit writes
3. System remains resilient to temporary audit storage issues

---

## Best Practices

### When Adding New Audit Events

1. **Add new action to `AuditAction` enum** in `schema.prisma`
2. **Create migration**: `npx prisma migrate dev --name add_my_audit_action`
3. **Add audit call in service**:
   ```typescript
   void this.auditService.createLog({
     tenantId,
     actorUserId,
     action: AuditAction.MY_NEW_ACTION,
     entityType: 'MyEntity',
     entityId: entity.id,
     metadata: { /* relevant details */ },
   });
   ```
4. **Never await** the audit call (fire-and-forget)
5. **Document** in this file with examples

### Metadata Guidelines

Include contextual information useful for:
- **Troubleshooting**: What changed? From what to what?
- **Compliance**: Who did it? When? What scope?
- **Analytics**: Count events by type, actor, time range

Avoid:
- Sensitive data (passwords, tokens, PII beyond email/name)
- Large objects (serialize to summary only)
- Nested structures beyond 2 levels

---

## Related Documentation

- **Auth**: [AUTH_CONTRACT.md](./docs/AUTH_CONTRACT.md) - Authentication & roles
- **Multi-Tenancy**: ARCHITECTURE.md - Tenant isolation patterns
- **API Security**: IMPLEMENTATION_ROADMAP.md - Security guards & validation
