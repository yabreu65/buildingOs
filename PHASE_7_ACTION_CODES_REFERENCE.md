# Phase 7 Action Codes Reference
**Quick lookup for all auditable actions in Phase 7 testing**

**Source**: `AUDIT_EVENTS.md` (comprehensive reference)

---

## Phase 7 Covered Events

### A) Authentication Events (3 codes)
- **AUTH_LOGIN** - User login
- **AUTH_FAILED_LOGIN** - Failed login attempt
- **AUTH_LOGOUT** - User logout

### B) Building Management (3 codes)
- **BUILDING_CREATE** - New building created
- **BUILDING_UPDATE** - Building updated (name/address)
- **BUILDING_DELETE** - Building deleted

### C) Tickets (4 codes)
- **TICKET_CREATE** - New ticket created
- **TICKET_UPDATE** - Ticket updated (title/description)
- **TICKET_STATUS_CHANGE** - Status changed (OPEN → IN_PROGRESS, etc.)
- **TICKET_ASSIGNED** - Assigned to user/membership
- **TICKET_COMMENT_ADD** - Comment added to ticket
- **TICKET_DELETE** - Ticket deleted

### D) Communications (3 codes)
- **COMMUNICATION_CREATE** - New communication drafted
- **COMMUNICATION_PUBLISHED** - Communication sent
- **COMMUNICATION_DELETE** - Communication deleted

### E) Documents (2 codes)
- **DOCUMENT_CREATE** - New document uploaded
- **DOCUMENT_DELETE** - Document deleted

### F) Finance (6 codes)
- **CHARGE_CREATE** - New charge created
- **CHARGE_CANCEL** - Charge canceled
- **CHARGE_STATUS_CHANGE** - Charge status changed (e.g., PENDING → PARTIAL)
- **PAYMENT_SUBMITTED** - Payment submitted for review
- **PAYMENT_APPROVED** - Payment approved by admin
- **PAYMENT_REJECTED** - Payment rejected
- **ALLOCATION_CREATED** - Payment allocated to charge

### G) Occupants (2 codes)
- **OCCUPANT_ASSIGN** - Resident assigned to unit
- **OCCUPANT_REMOVE** - Resident removed from unit

### H) Vendors (3 codes)
- **VENDOR_CREATE** - New vendor created
- **VENDOR_UPDATE** - Vendor updated
- **VENDOR_DELETE** - Vendor deleted

### I) Quotes (3 codes)
- **QUOTE_CREATE** - New quote created
- **QUOTE_STATUS_CHANGE** - Quote status changed
- **QUOTE_DELETE** - Quote deleted

### J) Work Orders (3 codes)
- **WORKORDER_CREATE** - New work order created
- **WORKORDER_STATUS_CHANGE** - Status changed (IN_PROGRESS → COMPLETED, etc.)
- **WORKORDER_DELETE** - Work order deleted

### K) Impersonation (2 codes)
- **IMPERSONATION_START** - SUPER_ADMIN enters support mode
- **IMPERSONATION_END** - SUPER_ADMIN exits support mode

### L) Subscription Management (2 codes)
- **SUBSCRIPTION_CREATE** - New subscription
- **SUBSCRIPTION_UPDATE** - Plan changed

### M) Tenant Management (3 codes) - SUPER_ADMIN Only
- **TENANT_CREATE** - New tenant created
- **TENANT_UPDATE** - Tenant updated
- **TENANT_DELETE** - Tenant deleted

---

## Testing Mapping

### Phase 7A (Auditoría) - Eventos Esperados

| Test Step | Expected Action Code | Entity Type |
|-----------|---------------------|-------------|
| 1. Crear Ticket | TICKET_CREATE | Ticket |
| 2. Cambiar status | TICKET_STATUS_CHANGE | Ticket |
| 3. Asignar ticket | TICKET_ASSIGNED | Ticket |
| 4. Comentar | TICKET_COMMENT_ADD | TicketComment |
| 5. Publicar comunicado | COMMUNICATION_PUBLISHED | Communication |
| 6. Subir documento | DOCUMENT_CREATE | Document |
| 7. Crear cargo | CHARGE_CREATE | Charge |
| 8. Resident sube pago | PAYMENT_SUBMITTED | Payment |
| 9. Admin aprueba pago | PAYMENT_APPROVED | Payment |
| 9b. Imputar | ALLOCATION_CREATED | PaymentAllocation |
| 10. Crear vendor | VENDOR_CREATE | Vendor |
| 10b. Crear quote | QUOTE_CREATE | Quote |
| 10c. Crear workorder | WORKORDER_CREATE | WorkOrder |

### Phase 7B (Impersonation) - Eventos Esperados

| Test Step | Expected Action Code | Metadata |
|-----------|---------------------|----------|
| 13. Start impersonation | IMPERSONATION_START | targetTenantId |
| 15. Exit impersonation | IMPERSONATION_END | targetTenantId |

### Phase 7C (Reportes) - No genera eventos (solo lectura)
- Reportes no crean audit entries (son queries read-only)
- Pero cada query es auditable vía logs de acceso API

---

## Metadata Patterns

### TICKET_CREATE
```json
{
  "title": "...",
  "priority": "HIGH|MEDIUM|LOW|URGENT",
  "category": "Maintenance|Cleaning|...",
  "unitId": "...",
  "buildingId": "..."
}
```

### TICKET_STATUS_CHANGE
```json
{
  "oldStatus": "OPEN",
  "newStatus": "IN_PROGRESS",
  "ticketId": "..."
}
```

### PAYMENT_APPROVED
```json
{
  "paymentId": "...",
  "amount": 50000,  // en centavos
  "approvedBy": "admin@...",
  "approvedAt": "2026-02-17T..."
}
```

### ALLOCATION_CREATED
```json
{
  "paymentId": "...",
  "chargeId": "...",
  "amount": 50000,  // en centavos
  "allocatedAt": "2026-02-17T..."
}
```

### IMPERSONATION_START
```json
{
  "targetTenantId": "{tenantA}",
  "targetTenantName": "Tenant A",
  "superAdminId": "...",
  "startedAt": "2026-02-17T..."
}
```

### IMPERSONATION_END
```json
{
  "targetTenantId": "{tenantA}",
  "targetTenantName": "Tenant A",
  "duration_seconds": 3600,
  "endedAt": "2026-02-17T..."
}
```

---

## Query Examples

### Get all TICKET_CREATE events for Tenant A
```bash
curl -H "Authorization: Bearer {token}" \
  "http://localhost:4000/audit/logs?tenantId={tenantA}&action=TICKET_CREATE" | jq .
```

### Get all IMPERSONATION events (global, SUPER_ADMIN only)
```bash
curl -H "Authorization: Bearer {superAdminToken}" \
  "http://localhost:4000/audit/logs?action=IMPERSONATION_START" | jq .
```

### Get all events for a specific Ticket
```bash
curl -H "Authorization: Bearer {token}" \
  "http://localhost:4000/audit/logs?tenantId={tenantA}&entityId={ticketId}" | jq .
```

### Get 50 most recent events for Tenant A
```bash
curl -H "Authorization: Bearer {token}" \
  "http://localhost:4000/audit/logs?tenantId={tenantA}&limit=50" | jq '.logs | sort_by(.createdAt) | reverse'
```

---

## Audit Query Filtering

### Supported Query Parameters
- `tenantId`: Required (unless global event like AUTH_LOGIN)
- `action`: Filter by action code (optional)
- `entityId`: Filter by specific resource ID (optional)
- `entityType`: Filter by entity type (optional)
- `limit`: Max results per page (default: 50, max: 100)
- `offset`: Pagination offset (default: 0)
- `from`: Start date ISO 8601 (optional)
- `to`: End date ISO 8601 (optional)

### Access Control
- **SUPER_ADMIN**: Can query any tenant's logs
- **TENANT_ADMIN**: Can only query own tenant logs
- **OPERATOR/RESIDENT**: 403 Forbidden

---

## Expected Counts After Full Phase 7 Testing

| Category | Expected Count | Notes |
|----------|----------------|-------|
| AUTH_LOGIN | ≥2 | Min logins (A+B) |
| TICKET_CREATE | ≥1 | Per test step 1 |
| TICKET_STATUS_CHANGE | ≥1 | Per test step 2 |
| TICKET_ASSIGNED | ≥1 | Per test step 3 |
| TICKET_COMMENT_ADD | ≥1 | Per test step 4 |
| COMMUNICATION_PUBLISHED | ≥1 | Per test step 5 |
| DOCUMENT_CREATE | ≥1 | Per test step 6 |
| CHARGE_CREATE | ≥1 | Per test step 7 |
| PAYMENT_SUBMITTED | ≥1 | Per test step 8 |
| PAYMENT_APPROVED | ≥1 | Per test step 9 |
| ALLOCATION_CREATED | ≥1 | Per test step 9b |
| VENDOR_CREATE | ≥1 | Per test step 10 |
| QUOTE_CREATE | ≥1 | Per test step 10b |
| WORKORDER_CREATE | ≥1 | Per test step 10c |
| WORKORDER_STATUS_CHANGE | ≥1 | Per test step 10c |
| IMPERSONATION_START | ≥1 | Per test step 13 |
| IMPERSONATION_END | ≥1 | Per test step 15 |
| **TOTAL** | **≥20** | Minimum audit trail |

---

## Verification Checklist

Before signing off Phase 7:

- [ ] All action codes match AUDIT_EVENTS.md
- [ ] Metadata includes useful context (not just IDs)
- [ ] Timestamps in chronological order
- [ ] No cross-tenant data leakage
- [ ] actorMembershipId always present
- [ ] API responses consistent format
- [ ] Pagination working correctly (limit/offset)
- [ ] Role-based access control enforced
- [ ] No performance degradation (<200ms per query)

---

## References

- Full documentation: `AUDIT_EVENTS.md`
- Testing guide: `MANUAL_TESTING_REPORT_PHASE_7.md`
- Implementation: `apps/api/src/audit/audit.service.ts`
- Database schema: `apps/api/prisma/schema.prisma` (AuditLog model)

