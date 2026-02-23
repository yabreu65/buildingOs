# Admin Account Creation - Sequence Diagrams

## High-Level Flow

```
SUPER_ADMIN    →    Backend API    →    Email Service    →    Admin Browser
   (Web)            (NestJS)          (Stub/SMTP)         (React/Next.js)
    |                  |                    |                   |
    |  1. Convert lead |                    |                   |
    |─────────────────→|                    |                   |
    |                  | 2. Create user     |                   |
    |                  |    + invitation    |                   |
    |                  |────────────────────→ 3. Send email     |
    |                  |                    |──────────────────→|
    |                  | 4. Return success  |                   |
    |←─────────────────|                    |                   |
    |                  |                    |      5. Admin     |
    |                  |                    |       clicks      |
    |                  |                    |       link        |
    |                  |                    |←──────────────────|
    |                  |                    |                   |
    |                  |                    |  6. Load /invite  |
    |                  |←────────────────────────────────────────|
    |                  | 7. Validate token  |                   |
    |                  |                    |                   |
    |                  | 8. Show form       |                   |
    |                  |──────────────────────────────────────→|
    |                  |                    |  9. User enters   |
    |                  |                    |     password      |
    |                  |                    |←──────────────────|
    |                  | 10. Accept inv.    |                   |
    |                  |     (new password) |                   |
    |←─────────────────|←────────────────────────────────────────|
    |                  | 11. Return JWT     |                   |
    |                  |──────────────────────────────────────→|
    |                  |                    |  12. Admin logged in
    |                  |                    |     with JWT
    |                  |                    |←──────────────────|
```

---

## Detailed Sequence: Conversion → Acceptance

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STEP 1: SUPER_ADMIN CONVERTS LEAD                    │
└─────────────────────────────────────────────────────────────────────────┘

SUPER_ADMIN                Backend                Database
   |                         |                        |
   | POST /leads/{id}/convert|                        |
   |────────────────────────→|                        |
   |                         |                        |
   |                         | BEGIN TRANSACTION      |
   |                         |────────────────────────|
   |                         |                        |
   |                         | 1. Create Tenant      |
   |                         |    (name, type, sub)  |
   |                         |────────────────────────|
   |                         |
   |                         | 2. Create User        |
   |                         |    (email, name)      |
   |                         |    Temp password:     |
   |                         |    crypto.rand(12)    |
   |                         |    = "a1b2c3d4e5f6..." |
   |                         |    bcrypt.hash(temp)  |
   |                         |    = "$2b$10$..."     |
   |                         |────────────────────────|
   |                         |
   |                         | 3. Create Invitation  |
   |                         |    token:             |
   |                         |    crypto.rand(32)    |
   |                         |    = "64_char_hex"    |
   |                         |    tokenHash:         |
   |                         |    SHA256(token)      |
   |                         |    = stored in DB     |
   |                         |    roles: [OWNER,AD]  |
   |                         |    expiresAt: +7d     |
   |                         |    status: PENDING    |
   |                         |────────────────────────|
   |                         |
   |                         | COMMIT TRANSACTION    |
   |                         |────────────────────────|
   |                         |
   |                         | 4. Queue email send   |
   |                         |    [EMAIL STUB]       |
   |                         |    Link with token    |
   |                         |    http://localhost:  |
   |                         |    3000/invite?       |
   |                         |    token=64_char_hex  |
   |                         |
   | 200 OK                  |
   |←────────────────────────|
   |
   | Response:
   | {
   |   success: true,
   |   tenant: {id, name},
   |   adminEmail: "...",
   |   invitationExpiresAt: "2026-03-02"
   | }
```

---

```
┌─────────────────────────────────────────────────────────────────────────┐
│              STEP 2: ADMIN RECEIVES EMAIL & CLICKS LINK                 │
└─────────────────────────────────────────────────────────────────────────┘

Admin Email Inbox:
┌──────────────────────────────────────────────────┐
│ From: noreply@buildingos.com                     │
│ Subject: Welcome to BuildingOS                   │
│                                                  │
│ Hi María García,                                 │
│                                                  │
│ Click link to set password:                      │
│ https://buildingos.app/invite?token=a1b2c3d4... │
│                                                  │
│ [CLICK TO SET PASSWORD]                          │
└──────────────────────────────────────────────────┘
                         │
                         │ Click link
                         ↓
                    Browser
                         │
                         └─→ GET /invite?token=a1b2c3d4...
```

---

```
┌─────────────────────────────────────────────────────────────────────────┐
│              STEP 3: FRONTEND VALIDATES TOKEN & SHOWS FORM              │
└─────────────────────────────────────────────────────────────────────────┘

Admin Browser              Backend                Database
   |                         |                        |
   | GET /invite?token=...   |                        |
   |────────────────────────→|                        |
   |                         |                        |
   |                         | GET /invitations/      |
   |                         | validate?token=...     |
   |                         |                        |
   |                         | 1. Hash token          |
   |                         |    tokenHash =         |
   |                         |    SHA256(token)       |
   |                         |────────────────────────|
   |                         |
   |                         | 2. Find invitation     |
   |                         |    by tokenHash        |
   |                         |←───────────────────────|
   |                         |    Found! Status=OK
   |                         |
   |                         | 3. Check:             |
   |                         |    - Status = PENDING? ✓
   |                         |    - Expired?         ✗
   |                         |    - Valid?           ✓
   |                         |
   |                         | 200 OK                |
   | {                       |←────────────────────---|
   |   tenantId: "...",      |
   |   email: "maria@...",   |
   |   expiresAt: "2026-03-02"
   | }                       |
   |                         |
   | Now render form:        |
   | ┌─────────────────────────────────────────┐
   | │   Complete Your Registration           │
   | │                                         │
   | │   Full Name:                            │
   | │   [María García López           ] ✓     │
   | │                                         │
   | │   Password:                             │
   | │   [••••••••••••••••      ] ✓ 8+ chars  │
   | │                                         │
   | │   Confirm Password:                     │
   | │   [••••••••••••••••      ] ✓ Match     │
   | │                                         │
   | │           [Set Password & Sign In]      │
   | └─────────────────────────────────────────┘
```

---

```
┌─────────────────────────────────────────────────────────────────────────┐
│         STEP 4: ADMIN SUBMITS FORM → ACCEPT INVITATION JWT ISSUED       │
└─────────────────────────────────────────────────────────────────────────┘

Admin Browser              Backend                Database              JWT
   |                         |                        |                  |
   | User enters password    |                        |                  |
   | clicks "Set Password"   |                        |                  |
   |                         |                        |                  |
   | POST /invitations/accept|                        |                  |
   | {                       |                        |                  |
   |   token: "64_hex",      |                        |                  |
   |   name: "María García", |                        |                  |
   |   password: "MyPwd123"  |                        |                  |
   | }                       |                        |                  |
   |────────────────────────→|                        |                  |
   |                         |                        |                  |
   |                         | acceptInvitation()    |                  |
   |                         |                        |                  |
   |                         | 1. Hash token         |                  |
   |                         |    tokenHash =        |                  |
   |                         |    SHA256(token)      |                  |
   |                         |                        |                  |
   |                         | 2. Find Invitation    |                  |
   |                         |────────────────────────|                  |
   |                         |←───────────────────────|                  |
   |                         |    Found!
   |                         |
   |                         | 3. Verify:           |
   |                         |    - PENDING? ✓       |
   |                         |    - Expired? ✗       |
   |                         |
   |                         | BEGIN TRANSACTION     |
   |                         |────────────────────────|
   |                         |                        |
   |                         | 4. Find User by       |
   |                         |    email              |
   |                         |────────────────────────|
   |                         |←───────────────────────|
   |                         |    FOUND (created in
   |                         |    Step 1)
   |                         |
   |                         | 5. Update password:   |
   |                         |    OLD:               |
   |                         |    $2b$10$temp_hash   |
   |                         |                        |
   |                         |    NEW:               |
   |                         |    bcrypt.hash(       |
   |                         |      "MyPwd123", 10   |
   |                         |    )                  |
   |                         |    = $2b$10$new_hash  |
   |                         |────────────────────────|
   |                         |
   |                         | 6. Create Membership  |
   |                         |    {userId, tenantId} |
   |                         |────────────────────────|
   |                         |
   |                         | 7. Create roles       |
   |                         |    - TENANT_OWNER     |
   |                         |    - TENANT_ADMIN     |
   |                         |────────────────────────|
   |                         |
   |                         | 8. Mark Invitation    |
   |                         |    ACCEPTED           |
   |                         |    acceptedAt = now   |
   |                         |────────────────────────|
   |                         |
   |                         | COMMIT TRANSACTION    |
   |                         |────────────────────────|
   |                         |                        |
   |                         | 9. Generate JWT       |                    |
   |                         |    {                  |←───────────────────|
   |                         |     email, userId,    |   jwtService.sign()
   |                         |     isSuperAdmin: false
   |                         |    }                  |
   |                         |←───────────────────────|
   |                         |
   |                         | 200 OK                |
   |                         | {                     |
   |                         |   accessToken:        |
   |                         |   "eyJhbGciOi..."     |
   |                         |   user: {             |
   |                         |     id, email, name   |
   |                         |   },                  |
   |                         |   memberships: [{     |
   |                         |     tenantId,         |
   |                         |     roles: [OWNER,    |
   |                         |       ADMIN]          |
   |                         |   }]                  |
   |                         | }                     |
   |←────────────────────────|
   |
   | ✓ Token received!
   | Store in sessionStorage
   | Redirect to /dashboard
```

---

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STEP 5: ADMIN LOGGED IN & READY                      │
└─────────────────────────────────────────────────────────────────────────┘

Admin Browser
   |
   | Token stored in sessionStorage
   | Redirect to /{tenantId}/dashboard
   |
   ↓

   ┌────────────────────────────────┐
   │                                │
   │    Welcome to BuildingOS!      │
   │                                │
   │    María García López          │
   │    (TENANT_OWNER, TENANT_ADMIN)│
   │                                │
   │    [+ Add Building]             │
   │    [+ Manage Team]              │
   │    [+ View Payments]            │
   │                                │
   └────────────────────────────────┘

   Permissions:
   - Can create buildings ✓
   - Can manage team ✓
   - Can view all reports ✓
   - Cannot access SUPER_ADMIN panel ✗
```

---

## Password History

| Step | Event | Password | Hash |
|------|-------|----------|------|
| 1 | Lead converts | Temp: `a1b2c3d4e5...` (24 hex) | `$2b$10$temp_hash...` |
| 2 | Email sent | (same temp) | (same) |
| 3 | Admin clicks invite | (same temp) | (same) |
| 4 | Admin submits form | Admin chosen: `MyPwd123` | `$2b$10$new_hash...` ← **REPLACED** |
| 5+ | Admin logged in | Uses `MyPwd123` | Uses `new_hash` |

**Key Point**: Temp password is replaced, not used. Admin never types or sees it.

---

## Token Status Transitions

```
                    Created (Step 1)
                          ↓
                    ┌─────────────┐
                    │   PENDING   │
                    │ (7-day TTL) │
                    └─────────────┘
                     ↙             ↘
                    /               \
          Accepted                 Expired
          (Step 4)                (Cron job)
            ↓                         ↓
        ┌────────┐              ┌─────────┐
        │ACCEPTED│              │ EXPIRED │
        └────────┘              └─────────┘
           (final)                (final)
```

### Also Possible:
```
PENDING → REVOKED (admin revokes before expiry)
PENDING → ACCEPTED → <kept as ACCEPTED>
```

---

## Error Cases & HTTP Responses

### Validate Token (`GET /invitations/validate?token=...`)

| Scenario | Response | Status |
|----------|----------|--------|
| Valid token, PENDING | `{ tenantId, email, expiresAt }` | 200 |
| Token not found | `{ message: "Invitación inválida o expirada" }` | 404 |
| Already ACCEPTED | `{ message: "Invitación inválida o expirada" }` | 404 |
| Expired | Auto-marked EXPIRED, then: `{ message: "..." }` | 404 |
| No token param | `{ message: "Token requerido" }` | 400 |

### Accept Invitation (`POST /invitations/accept`)

| Scenario | Response | Status |
|----------|----------|--------|
| Success | `{ accessToken, user, memberships }` | 200 |
| Invalid token | `{ message: "Invitación inválida o expirada" }` | 404 |
| Name missing (new user) | `{ message: "Nombre requerido..." }` | 400 |
| Password < 8 chars (new user) | `{ message: "Contraseña requerida..." }` | 400 |
| Already accepted | Same 404 (status != PENDING) | 404 |

---

## Security Checkpoints

```
POST /invitations/accept
  │
  ├─ Validate token format (min 10 chars)
  │  └─ Reject if missing/invalid format → 400
  │
  ├─ Hash token with SHA-256
  │
  ├─ Look up invitation by tokenHash
  │  └─ Reject if not found → 404
  │
  ├─ Check status is PENDING
  │  └─ Reject if ACCEPTED/REVOKED/EXPIRED → 404
  │
  ├─ Check expiration (< now)
  │  └─ Reject if expired → 404 (auto-mark EXPIRED)
  │
  ├─ Extract tenantId, email, roles
  │
  ├─ Validate name (min 1 char)
  │  └─ Reject if missing/empty → 400
  │
  ├─ Validate password (min 8 chars)
  │  └─ Reject if missing/short → 400
  │
  ├─ BEGIN TRANSACTION
  │  │
  │  ├─ Find user by email
  │  │  └─ Verify matches invitation email
  │  │
  │  ├─ Validate password hash algorithm (bcrypt)
  │  │
  │  ├─ Create membership (no duplication check—will fail constraint)
  │  │
  │  ├─ Create roles from invitation
  │  │
  │  └─ Mark invitation ACCEPTED
  │
  ├─ COMMIT TRANSACTION (atomic)
  │
  ├─ Sign JWT
  │  └─ isSuperAdmin: false (never allow elevation)
  │
  └─ Audit log: MEMBERSHIP_INVITE_ACCEPTED
```

---

## Production Checklist

- [ ] Replace email stub with actual email service (SendGrid, AWS SES, etc.)
- [ ] Add SMTP configuration to environment variables
- [ ] Create `/invite` frontend page
- [ ] Create `InvitationForm` component with validation
- [ ] Add password strength indicator on frontend
- [ ] Test complete flow end-to-end
- [ ] Add rate limiting to `/invitations/accept` (5 per hour per IP)
- [ ] Configure JWT expiry (currently unbounded after acceptance)
- [ ] Add refresh token rotation for long-lived sessions
- [ ] Configure password reset flow for admins who forget password
- [ ] Add two-factor authentication (optional enhancement)
- [ ] Configure email template with branding
- [ ] Add invitation expiry to admin UI (show when invites expire)
- [ ] Add "resend invitation" button in admin panel

