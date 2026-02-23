# Leads API Specification

Complete specification for the BuildingOS marketing leads system.

## Architecture

```
LeadsModule
├── PublicLeadsController    (NO auth, marketing funnel)
├── AdminLeadsController     (SUPER_ADMIN only, CRM)
├── LeadsService            (Business logic)
└── DTOs                    (Validation)
```

## Public Endpoints (NO Authentication)

### POST /leads/public
**Purpose**: Submit a new marketing lead from website form

**Request**:
```json
{
  "fullName": "John Doe",
  "email": "john@example.com",
  "phoneWhatsapp": "+1 555-0000",
  "tenantType": "ADMINISTRADORA",
  "buildingsCount": 2,
  "unitsEstimate": 150,
  "countryCity": "Argentina, Buenos Aires",
  "message": "Looking for a property management solution",
  "source": "pricing-page"
}
```

**Response** (201 Created):
```json
{
  "id": "lead_123",
  "email": "john@example.com",
  "fullName": "John Doe",
  "status": "NEW",
  "createdAt": "2026-02-23T...",
  "message": "Lead received. Our sales team will contact you shortly."
}
```

**Security**:
- ✅ No authentication required
- ✅ Rate-limited globally (300 req/min per IP via middleware)
- ✅ Honeypot field validation (website field must be empty)
- ✅ Sends email notification to sales team
- ✅ Audit logged (LEAD_CREATED)

**Errors**:
- `400 Bad Request`: Validation failed (invalid email, missing required fields)
- `409 Conflict`: Email already exists as lead
- `429 Too Many Requests`: Rate limit exceeded

---

## Admin Endpoints (SUPER_ADMIN Only)

**Authentication**: JWT + SUPER_ADMIN role required for all endpoints

### GET /leads/admin
**Purpose**: List all leads with filtering and pagination

**Query Parameters**:
```
status=NEW|CONTACTED|QUALIFIED|DISQUALIFIED
email=john            (partial match, case-insensitive)
source=pricing-page
skip=0               (default)
take=50              (max 100)
```

**Example**:
```
GET /leads/admin?status=NEW&take=20
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "lead_123",
      "fullName": "John Doe",
      "email": "john@example.com",
      "phone": "+1 555-0000",
      "tenantType": "ADMINISTRADORA",
      "buildingsCount": 2,
      "unitsEstimate": 150,
      "location": "Argentina, Buenos Aires",
      "message": "...",
      "source": "pricing-page",
      "status": "NEW",
      "contactedAt": null,
      "notes": null,
      "convertedTenantId": null,
      "convertedAt": null,
      "createdAt": "2026-02-23T...",
      "updatedAt": "2026-02-23T..."
    }
  ],
  "total": 45,
  "page": 0
}
```

**Errors**:
- `401 Unauthorized`: No valid JWT
- `403 Forbidden`: Not SUPER_ADMIN role

---

### GET /leads/admin/:id
**Purpose**: Get full lead details

**Response** (200 OK): Full Lead object (same as list item)

**Errors**:
- `401 Unauthorized`: Invalid JWT
- `403 Forbidden`: Not SUPER_ADMIN
- `404 Not Found`: Lead not found

---

### PATCH /leads/admin/:id
**Purpose**: Update lead status and internal notes

**Request**:
```json
{
  "status": "CONTACTED",
  "notes": "Called on 2026-02-23, interested in TRIAL plan"
}
```

**Response** (200 OK): Updated Lead object

**Rules**:
- `status`: Optional, one of NEW|CONTACTED|QUALIFIED|DISQUALIFIED
- `notes`: Optional, max 2000 characters
- Setting status to CONTACTED auto-populates `contactedAt` timestamp
- Audit logged (LEAD_STATUS_CHANGED)

**Errors**:
- `401 Unauthorized`: Invalid JWT
- `403 Forbidden`: Not SUPER_ADMIN
- `404 Not Found`: Lead not found
- `400 Bad Request`: Invalid status value

---

### POST /leads/admin/:id/convert
**Purpose**: Convert lead to customer (creates tenant + owner + invitation)

**CRITICAL**: This is the main lead-to-customer conversion flow

**Request**:
```json
{
  "tenantName": "Acme Building Management",
  "tenantType": "ADMINISTRADORA",
  "ownerEmail": "owner@acmebuildings.com",
  "ownerFullName": "John Doe",
  "planId": "plan_trial_123",
  "createDemoData": true
}
```

**Response** (201 Created):
```json
{
  "tenantId": "tenant_123",
  "ownerUserId": "user_456",
  "inviteSent": true
}
```

**Defaults** (if not provided):
- `tenantType`: Uses lead.tenantType
- `ownerEmail`: Uses lead.email
- `ownerFullName`: Uses lead.fullName
- `planId`: Uses TRIAL plan
- `createDemoData`: true

**Conversion Flow** (Atomic Transaction):
1. Validate lead (not DISQUALIFIED, not already converted)
2. Create Tenant with tenantType
3. Create Subscription with plan (status: TRIAL)
4. Find or create User (owner)
5. Create Membership (roles: TENANT_OWNER, TENANT_ADMIN)
6. Generate invitation token (7-day expiry)
7. Send email to owner with invitation link
8. Update lead (status: QUALIFIED, convertedTenantId, convertedAt)
9. Audit: TENANT_CREATE + LEAD_CONVERTED

**Security**:
- ✅ Only SUPER_ADMIN can execute
- ✅ Prevents double-conversion (checks convertedTenantId)
- ✅ Prevents DISQUALIFIED leads from conversion
- ✅ Atomic transaction (all-or-nothing)
- ✅ Fire-and-forget email (failures don't rollback)

**Errors**:
- `401 Unauthorized`: Invalid JWT
- `403 Forbidden`: Not SUPER_ADMIN
- `404 Not Found`: Lead not found
- `400 Bad Request`: Lead DISQUALIFIED or invalid planId
- `409 Conflict`: Lead already converted

---

### DELETE /leads/admin/:id
**Purpose**: Delete a lead record

**Response** (204 No Content)

**Notes**:
- Audit trail is preserved (LEAD_DELETED)
- Use with caution - deleted leads cannot be recovered
- Conversion records are preserved

**Errors**:
- `401 Unauthorized`: Invalid JWT
- `403 Forbidden`: Not SUPER_ADMIN
- `404 Not Found`: Lead not found

---

## Data Models

### Lead
```typescript
{
  id: string                    // Unique ID
  fullName: string              // 1-100 chars
  email: string                 // Unique, validated
  phone?: string                // Optional, max 20 chars
  tenantType: TenantType        // ADMINISTRADORA | EDIFICIO_AUTOGESTION
  buildingsCount?: number       // >=1
  unitsEstimate: number         // >=1
  location?: string             // "Country, City"
  message?: string              // Optional, max 1000 chars
  source?: string               // "pricing-page", "contact-form", etc.
  status: LeadStatus            // NEW | CONTACTED | QUALIFIED | DISQUALIFIED
  contactedAt?: Date            // Set when status changes to CONTACTED
  notes?: string                // Internal sales notes, max 2000 chars
  convertedTenantId?: string    // Tenant ID if converted
  convertedAt?: Date            // When conversion happened
  createdAt: Date
  updatedAt: Date
}
```

### LeadStatus Enum
```typescript
enum LeadStatus {
  NEW              // Just submitted
  CONTACTED        // Sales team reached out
  QUALIFIED        // Prospect is interested
  DISQUALIFIED     // No longer pursuing
}
```

---

## Rate Limiting

**Public endpoint** (`POST /leads/public`):
- Global: 300 requests/minute per IP (via middleware)
- Client-side: 3 submissions per 60 seconds (localStorage)

**Admin endpoints**:
- Standard rate limiting applies
- No special limits

---

## Audit Trail

**Events Logged**:

| Event | When | Metadata |
|-------|------|----------|
| `LEAD_CREATED` | Lead submitted | email, fullName, tenantType, source |
| `LEAD_STATUS_CHANGED` | Status updated | email, previousStatus, newStatus |
| `LEAD_DELETED` | Lead deleted | email, fullName |
| `LEAD_CONVERTED` | Converted to customer | tenantId, ownerUserId |
| `TENANT_CREATE` | Tenant created from lead | source: "lead_conversion", leadId |

All audit events are fire-and-forget (don't fail main operation).

---

## Email Notifications

**When**: Lead submitted via POST /leads/public

**To**: SALES_TEAM_EMAIL (config: salesTeamEmail)

**Subject**: New Lead: {firstName lastName} ({tenantType})

**Content**:
- Lead details (name, email, phone, type, buildings, units)
- Location
- Message from prospect
- Lead ID (for lookup)
- Timestamp

---

## Security Summary

| Endpoint | Auth | Rate Limit | Scope |
|----------|------|-----------|-------|
| POST /leads/public | ❌ | 300/min | Global (SaaS-wide) |
| GET /leads/admin | ✅ SUPER_ADMIN | Standard | Requires JWT + role |
| GET /leads/admin/:id | ✅ SUPER_ADMIN | Standard | Requires JWT + role |
| PATCH /leads/admin/:id | ✅ SUPER_ADMIN | Standard | Requires JWT + role |
| POST /leads/admin/:id/convert | ✅ SUPER_ADMIN | Standard | Atomic transaction |
| DELETE /leads/admin/:id | ✅ SUPER_ADMIN | Standard | Requires JWT + role |

---

## Testing Checklist

- [ ] POST /public/leads accepts valid lead
- [ ] POST /public/leads rejects duplicate email
- [ ] POST /public/leads with filled honeypot is ignored
- [ ] Rate limiting blocks after 300 requests/min
- [ ] GET /admin/leads requires SUPER_ADMIN
- [ ] GET /admin/leads returns filtered results
- [ ] PATCH /admin/leads/:id updates status and sets contactedAt
- [ ] POST /admin/leads/:id/convert creates tenant + owner + invitation
- [ ] Convert prevents double-conversion (convertedTenantId check)
- [ ] Convert prevents DISQUALIFIED lead conversion
- [ ] Convert sends email to owner
- [ ] Convert updates lead.status to QUALIFIED
- [ ] All admin endpoints blocked without SUPER_ADMIN
- [ ] All admin endpoints blocked without JWT
- [ ] Audit trail recorded for all events
- [ ] Email notifications sent on lead creation
