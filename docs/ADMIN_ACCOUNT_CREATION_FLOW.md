# Admin Account Creation Flow - Lead to Active User

## Overview

When a lead is converted to a tenant, the system automatically creates an admin account via an invitation-based workflow. The admin never needs to sign up manually—they receive an email with a secure invitation link and then set their own password.

---

## Complete Flow (5 Steps)

### Step 1: Lead Conversion (Backend Auto-Creation)

**When**: SUPER_ADMIN converts a lead to a tenant via `POST /api/super-admin/leads/:leadId/convert`

**What Happens**:
```
1. LeadsService.convertLeadToTenant():
   ├─ Create new Tenant (name, type, subscription TRIAL)
   ├─ Create new User (email, name, PASSWORD_HASH)
   │  └─ generateTemporaryPassword():
   │     └─ Creates: crypto.randomBytes(12).toString('hex')
   │        = 24-character random hex password
   │  └─ hashPassword():
   │     └─ bcrypt.hash(tempPassword, salt=10)
   │        = One-way hash (cannot be reversed)
   │
   ├─ Create new Invitation with secure token
   │  ├─ token: crypto.randomBytes(32).toString('hex')
   │  │         = 64-character random hex (ultra-secure)
   │  ├─ tokenHash: SHA-256(token)
   │  │             = Stored in DB (prevents plaintext theft)
   │  ├─ roles: [TENANT_OWNER, TENANT_ADMIN] (from lead)
   │  ├─ expiresAt: now + 7 days
   │  └─ status: PENDING
   │
   ├─ Send email (STUB for now, would be production email service):
   │  └─ Link: http://localhost:3000/invite?token=<64_char_hex>
   │
   └─ Audit log: MEMBERSHIP_INVITE_SENT
      └─ Metadata: email, roles, timestamp
```

**Why temp password**: Fallback only if admin tries to login directly (they shouldn't—they should use invitation link)

**Key Security**:
- ✅ Token never stored in plaintext (only SHA-256 hash)
- ✅ 7-day expiry window
- ✅ Token is single-use (marked ACCEPTED after use)
- ✅ Audit trail of conversion

---

### Step 2: Admin Receives Email

**What Admin Sees**:
```
From: BuildingOS <noreply@buildingos.com>
Subject: Welcome to BuildingOS - Set Your Password

Hi [NAME],

You've been invited to manage a property on BuildingOS.
Click the link below to set your password and get started:

👉 https://buildingos.app/invite?token=a1b2c3d4e5f6g7h8...

This link expires in 7 days.

Questions? Contact support@buildingos.com
```

**Admin Action**: Clicks the link → Browser navigates to `/invite?token=...` page

---

### Step 3: Frontend Invitation Page (`/invite?token=...`)

**What Happens**:
```
1. Page loads with token from URL query param
   └─ GET /invitations/validate?token=...
      └─ Backend checks if token is valid, not expired, not already used
      └─ Returns: { tenantId, email, expiresAt }

2. If token valid:
   └─ Show form asking:
      ├─ Full Name (required, min 1 char)
      │  └─ Pre-fills with lead name if available
      └─ Password (required, min 8 chars)
         └─ Show strength indicator
         └─ Show confirm password field

3. User enters name + password

4. User clicks "Set Password & Sign In" button
```

**Example Form**:
```
╔════════════════════════════════════════════╗
║         Complete Your Registration        ║
╠════════════════════════════════════════════╣
║                                            ║
║  Full Name:                                ║
║  ┌────────────────────────────────────┐   ║
║  │ María García López                 │   ║
║  └────────────────────────────────────┘   ║
║                                            ║
║  Password (min 8 characters):              ║
║  ┌────────────────────────────────────┐   ║
║  │ ••••••••••••••                     │   ║
║  └────────────────────────────────────┘   ║
║  Strength: ███████░░ Strong               ║
║                                            ║
║  Confirm Password:                         ║
║  ┌────────────────────────────────────┐   ║
║  │ ••••••••••••••                     │   ║
║  └────────────────────────────────────┘   ║
║                                            ║
║                [Set Password & Sign In]   ║
║                                            ║
╚════════════════════════════════════════════╝
```

---

### Step 4: Accept Invitation (JWT Issued)

**Frontend POSTs**:
```
POST /invitations/accept
Content-Type: application/json

{
  "token": "a1b2c3d4e5f6g7h8...",  // 64-char hex from URL
  "name": "María García López",     // User entered
  "password": "MySecure!Pass123"    // User entered (min 8 chars)
}
```

**Backend Processing** (InvitationsService.acceptInvitation):
```
1. Hash token with SHA-256
   └─ tokenHash = SHA-256(token)

2. Look up invitation by tokenHash
   └─ Query: WHERE tokenHash = ?
   └─ Return: Invitation record with roles, email, tenantId

3. Verify invitation is valid:
   ├─ Status = PENDING (not already used)
   ├─ Expiry > now (not expired)
   └─ Throw 404 for any error (no enumeration attacks)

4. IN TRANSACTION (atomic):
   ├─ Find or create User by email:
   │  ├─ User already exists (created in Step 1)
   │  ├─ Update passwordHash:
   │  │  └─ passwordHash = bcrypt.hash(password, salt=10)
   │  │     = One-way hash of USER's chosen password
   │  └─ Keep email + name from original creation
   │
   ├─ Create or find Membership (user + tenant link):
   │  └─ Create: { userId, tenantId }
   │
   ├─ Create MembershipRoles:
   │  ├─ Role: TENANT_OWNER
   │  └─ Role: TENANT_ADMIN
   │
   └─ Mark Invitation as ACCEPTED:
      └─ status = ACCEPTED
      └─ acceptedAt = now

5. Generate JWT Token:
   └─ jwtService.sign({
        email,
        sub: userId,
        isSuperAdmin: false
      })

6. Audit log: MEMBERSHIP_INVITE_ACCEPTED
   └─ Metadata: email, roles, timestamp
```

**Backend Returns**:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_abc123",
    "email": "maria@example.com",
    "name": "María García López"
  },
  "memberships": [
    {
      "tenantId": "tenant_xyz789",
      "roles": ["TENANT_OWNER", "TENANT_ADMIN"]
    }
  ]
}
```

---

### Step 5: Admin Logged In and Ready

**Frontend**:
```
1. Receive JWT token + user data
2. Store JWT in sessionStorage
3. Store user info in memory
4. Redirect to /{tenantId}/dashboard
5. Admin can now use the app with TENANT_OWNER + TENANT_ADMIN roles
```

**Password is Now Set**:
- ✅ Old temp password (created in Step 1) is REPLACED
- ✅ New password (chosen in Step 3) is hashed and stored
- ✅ Admin can now login via traditional login page with email + new password
- ✅ If they lose JWT token, they can login again with email + password

---

## Database State After Flow

### After Step 1 (Conversion):
```
users:
  id: "user_abc123"
  email: "maria@example.com"
  name: "María García López"
  passwordHash: "$2b$10$..." (bcrypt hash of TEMP password)

invitations:
  id: "inv_123"
  tenantId: "tenant_xyz789"
  email: "maria@example.com"
  tokenHash: "a1b2c3d4..." (SHA-256 hash)
  roles: ["TENANT_OWNER", "TENANT_ADMIN"]
  status: "PENDING"
  expiresAt: "2026-03-02T00:00:00Z"
```

### After Step 5 (Accepted):
```
users:
  id: "user_abc123"
  email: "maria@example.com"
  name: "María García López"
  passwordHash: "$2b$10$..." (bcrypt hash of ADMIN'S CHOSEN password)

memberships:
  id: "mem_456"
  userId: "user_abc123"
  tenantId: "tenant_xyz789"

membershipRoles:
  - membershipId: "mem_456", role: "TENANT_OWNER"
  - membershipId: "mem_456", role: "TENANT_ADMIN"

invitations:
  id: "inv_123"
  status: "ACCEPTED"
  acceptedAt: "2026-02-25T10:30:00Z"
```

---

## Why This Design?

| Aspect | Traditional Signup | Invitation Flow | Winner |
|--------|-------------------|-----------------|--------|
| **User Experience** | Admin signs up themselves | Email with pre-filled info | Invitation (no signup page) |
| **Tenant Association** | Admin must know tenant ID | Tenant pre-linked in invitation | Invitation (automatic) |
| **Security** | Manual username/email validation | Email verified before invite sent | Invitation (verified) |
| **Onboarding** | Admin must remember to signup | Admin clicks email link | Invitation (guided) |
| **Attack Surface** | Signup form is public | Only invite link works | Invitation (closed) |

---

## Security Layers

```
Layer 1: Token Generation
├─ 64-character random hex (crypto.randomBytes(32))
└─ Impossible to brute-force

Layer 2: Token Storage
├─ Only SHA-256 hash stored in DB (not plaintext)
└─ Even DB breach doesn't leak tokens

Layer 3: Token Expiry
├─ 7-day window only
└─ Background cron marks expired tokens every 5 minutes

Layer 4: Single Use
├─ Token marked ACCEPTED after first use
└─ Cannot be reused if token leaked

Layer 5: Email Verification
├─ Token only works with invited email address
└─ No way to redirect invitation to different email

Layer 6: Password Security
├─ Password bcrypt hashed (salt=10)
└─ One-way hash, cannot be reversed
```

---

## Edge Cases & Error Handling

### What if admin loses the email?
- ✅ TENANT_OWNER can revoke and resend invitation
- ✅ Resend generates NEW token, invalidates old one
- ✅ 7-day window resets

### What if admin waits more than 7 days?
- ❌ Token expires automatically
- ✅ Background cron marks it as EXPIRED
- ✅ Must request new invitation from TENANT_OWNER

### What if admin already exists in another tenant?
- ✅ Same email can have memberships in multiple tenants
- ✅ After accepting, user will have 2 memberships

### What if someone else clicks the link with correct email?
- ❌ They can set password, but invitation requires name + password
- ❌ Even if they succeed, they're now the account owner
- ⚠️ This is why invitations should only be sent to verified email addresses

### What if admin wants to change password later?
- ✅ Must use password reset flow (from login page)
- ✅ Separate from invitation flow
- ✅ Requires email verification

---

## Frontend Components (Not Yet Built)

To complete the admin onboarding flow, we need:

### `/invite` page (NEW)
```typescript
// pages/auth/invite.tsx
// Routes to: GET /invite?token=...
export default function InvitePage() {
  const router = useRouter();
  const [token] = useState(() => router.query.token as string);
  const [loading, setLoading] = useState(true);
  const [invitationInfo, setInvitationInfo] = useState(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    // Validate token on mount
    validateToken(token).then(setInvitationInfo);
  }, [token]);

  const onSubmit = async (data: AcceptInvitationFormData) => {
    // POST /invitations/accept
    const result = await acceptInvitation({ token, ...data });
    if (result.accessToken) {
      // Store JWT + redirect to dashboard
      localStorage.setItem('token', result.accessToken);
      router.push(`/${result.memberships[0].tenantId}/dashboard`);
    }
  };

  return <InvitationForm />;
}
```

### `InvitationForm` component (NEW)
```typescript
// features/auth/components/InvitationForm.tsx
// Fields: name, password, confirmPassword
// Validation: name >= 1 char, password >= 8 chars, match
// Submit: POST /invitations/accept
```

---

## Current Status

✅ **Backend**: 100% Complete
- Invitation creation, validation, acceptance
- Token generation and hashing
- Email sending (stubbed, ready for production email service)
- Audit logging
- Cron job for expiry cleanup

⚠️ **Frontend**: 0% Complete
- `/invite` page not yet built
- `InvitationForm` component not yet built
- Need to handle error states (invalid token, expired, etc.)

---

## Next Steps (If Needed)

1. Create `/invite` page component
2. Create `InvitationForm` with validation
3. Create `acceptInvitation()` API service function
4. Add loading state + error handling
5. Test complete flow end-to-end
6. Replace email stub with production email service

---

## Testing the Flow Manually

```bash
# 1. Convert a lead (auto-creates user + invitation)
curl -X POST http://localhost:4000/api/super-admin/leads/{leadId}/convert \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Check console for: [EMAIL STUB] Invitation link: http://localhost:3000/invite?token=...

# 2. Validate token before accepting
curl http://localhost:4000/invitations/validate?token=<token>

# 3. Accept invitation
curl -X POST http://localhost:4000/invitations/accept \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<token>",
    "name": "María García",
    "password": "MySecure!Pass123"
  }'

# 4. Try login with new password
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "maria@example.com",
    "password": "MySecure!Pass123"
  }'
# Should return: { accessToken: "...", user: {...}, memberships: [...] }
```

---

## Summary

**To answer: "Como el admin crea su user y pass?"**

1. **User is created automatically** when lead converts (with temp password)
2. **Admin receives invitation email** with secure link
3. **Admin clicks link** → Goes to `/invite?token=...` page
4. **Admin enters name + new password** → Form validates both
5. **Backend accepts invitation** → Creates membership + roles + JWT
6. **Admin is logged in** with chosen password

The password is set in step 4, not step 1. The temp password in step 1 is just a fallback.
