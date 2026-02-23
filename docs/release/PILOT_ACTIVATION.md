# ⚡ PILOT ACTIVATION - 30-Second Customer Onboarding

**Status**: 🟢 **PRODUCTION READY**
**Activation Time**: ~30 seconds
**Manual DB Steps Required**: 0 (Zero)
**Prerequisite**: Database running + migrations applied

---

## Quick Start (TL;DR)

```bash
# Activate pilot in one command
npm run seed:pilot

# Output: Credentials printed to console
# → Copy-paste to customer email
# → Done! 🎉
```

---

## How It Works

One command creates:

```
┌─ Tenant ────────────────────────┐
│ Name: "Pilot 2026-02-23"        │
│ Type: EDIFICIO_AUTOGESTION      │
│ Plan: FREE (1 building, 10 units)│
├─ Owner User ────────────────────┤
│ Email: owner-abc123@pilot...    │
│ Password: PilotABC123!          │
│ Role: TENANT_OWNER + TENANT_ADM │
├─ Building ──────────────────────┤
│ Name: "Pilot... - Main Building"│
│ Address: "123 Main Street..."   │
├─ 10 Units ──────────────────────┤
│ 101-110 (Apartments)            │
│ Ready for residents             │
├─ Resident User ─────────────────┤
│ Email: resident-abc123@pilot... │
│ Password: PilotXYZ123!          │
│ Unit: 101 (assigned)            │
└─────────────────────────────────┘
```

**Total time**: 30 seconds ⚡

---

# PART 1: BASIC ACTIVATION

## 1.1 Prerequisites

```bash
# 1. Database running
psql -U buildingos -d buildingos -c "SELECT 1;"
# Expected: 1 (connection OK)

# 2. Migrations applied
npm run db:migrate
# Expected: No pending migrations

# 3. Node.js 20+
node --version
# Expected: v20.x.x or higher
```

---

## 1.2 Run Pilot Seed

```bash
# Navigate to API workspace
cd apps/api

# Activate pilot
npm run seed:pilot

# Output:
# ✅ PILOT ACTIVATION COMPLETE
# [credentials printed]
```

### What You'll See (Sample Output)

```
======================================================================
🚀 BUILDINGOS PILOT ACTIVATION
======================================================================

Environment: development

📌 1️⃣  Creating Tenant
✅ Tenant created: tenant-abc123xyz
Name: Pilot 2026-02-23

📌 2️⃣  Creating Owner Account
✅ Owner user created: user-owner123
Email: owner-abc123@pilot.buildingos.local
Password: PilotAbc123!

📌 3️⃣  Creating Building
✅ Building created: building-xyz789
Name: Pilot 2026-02-23 - Main Building

📌 4️⃣  Creating 10 Units
✅ 10 units created
  • Unit 101: Apartment 101
  • Unit 102: Apartment 102
  • ... (through Unit 110)

📌 5️⃣  Creating Resident
✅ Resident user created: user-resident456
Email: resident-abc123@pilot.buildingos.local
Password: PilotXyz456!

======================================================================
✅ PILOT ACTIVATION COMPLETE
======================================================================

📌 🎯 Quick Access URLs

Web App:        http://localhost:3000
API Docs:       http://localhost:4000/api/docs
Prisma Studio: http://localhost:5555

📌 👤 OWNER LOGIN CREDENTIALS

Email:    owner-abc123@pilot.buildingos.local
Password: PilotAbc123!

📌 🏢 TENANT INFORMATION

Tenant ID:  tenant-abc123xyz
Name:       Pilot 2026-02-23
Type:       EDIFICIO_AUTOGESTION
Plan:       FREE (limits: 1 building, 10 units)

📌 🏗️  BUILDING INFORMATION

Building ID: building-xyz789
Name:        Pilot 2026-02-23 - Main Building
Address:     123 Main Street, Sample City, Country

📌 🏠 UNITS (Ready for Residents)

Total Units: 10
   Unit 101: Apartment 101
   Unit 102: Apartment 102
👤 (has resident) Unit 101: Apartment 101
   Unit 103: Apartment 103
   ... (through 110)

📌 👥 RESIDENT LOGIN CREDENTIALS

Email:    resident-abc123@pilot.buildingos.local
Password: PilotXyz456!
Unit:     101 (Apartment 101)

📌 📋 SYSTEM CONFIGURATION

Tenant ID (X-Tenant-Id):  tenant-abc123xyz
Building ID:              building-xyz789
Unit 1 ID:                unit-101xyz
Resident User ID:         user-resident456

📌 🚀 NEXT STEPS

1. Login with OWNER account:
   Email: owner-abc123@pilot.buildingos.local
   Password: PilotAbc123!

2. Share with RESIDENT:
   Email: resident-abc123@pilot.buildingos.local
   Password: PilotXyz456!

3. (Optional) Invite more residents to other units:
   Use the POST /invitations endpoint in Swagger UI

4. Create content in Swagger (POST endpoints):
   • Add more buildings (POST /buildings)
   • Create tickets (POST /buildings/:id/tickets)
   • Post communications (POST /communications)
   • Add charges (POST /charges)

✅ READY TO TEST
```

---

## 1.3 Verify Activation (Manual Check)

```bash
# Option A: Check in Prisma Studio
npm run studio
# Browser: http://localhost:5555
# View: Tenant, User, Building, Unit tables (should have data)

# Option B: Check via API
curl http://localhost:4000/health
# Expected: {"status":"ok",...}

# Option C: Login as owner
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner-abc123@pilot.buildingos.local",
    "password": "PilotAbc123!"
  }'
# Expected: 200 OK + JWT token

# Option D: Check buildings (as owner)
curl http://localhost:4000/buildings \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "X-Tenant-Id: tenant-abc123xyz"
# Expected: 200 OK + 1 building
```

---

# PART 2: ADVANCED USAGE

## 2.1 Custom Tenant Name

```bash
# Default: Uses date as name ("Pilot 2026-02-23")
npm run seed:pilot

# Custom name:
npm run seed:pilot -- --name "Acme Corp"

# Output:
# 📌 1️⃣  Creating Tenant
# ✅ Tenant created: tenant-xyz...
# Name: Acme Corp
```

---

## 2.2 Custom Tenant Type

```bash
# Default: EDIFICIO_AUTOGESTION
npm run seed:pilot

# ADMINISTRADORA type:
npm run seed:pilot -- --type ADMINISTRADORA

# Both name and type:
npm run seed:pilot -- --name "My Customer" --type ADMINISTRADORA

# Output will reflect the chosen type
```

---

## 2.3 Staging Environment

```bash
# Local (development):
npm run seed:pilot

# Staging:
npm run seed:pilot:staging

# Manual environment:
NODE_ENV=staging npm run seed:pilot

# Note: Script only allows development | staging
# Will refuse to run on production (safety check)
```

---

## 2.4 Multiple Pilots (Different Names)

```bash
# Create first pilot
npm run seed:pilot -- --name "Customer A"

# Output:
# Email: owner-abc123@pilot...
# Password: PilotXxx123!
# (Copy these down)

# Create second pilot
npm run seed:pilot -- --name "Customer B"

# Output:
# Email: owner-def456@pilot...
# Password: PilotYyy456!
# (Copy these down)

# Both pilots coexist in same database
# Each has own tenant, building, units, users
```

---

# PART 3: CUSTOMER HANDOFF

## 3.1 What to Send Customer

Copy-paste this to customer email:

```
Hello [CUSTOMER],

Welcome to BuildingOS Pilot! 🎉

Your tenant has been set up and is ready to use.

📋 LOGIN CREDENTIALS
─────────────────────

Owner Account (Administer your property):
  Email:    owner-abc123@pilot.buildingos.local
  Password: PilotAbc123!

Resident Account (Test resident experience):
  Email:    resident-abc123@pilot.buildingos.local
  Password: PilotXyz456!
  (Already assigned to Unit 101)

🎯 ACCESS LINKS
───────────────

Web App:  http://localhost:3000
        (In production: https://app.buildingos.com)

API Docs: http://localhost:4000/api/docs
        (Swagger UI - for developers)

✅ WHAT'S READY

✓ 1 Building ("Pilot... - Main Building")
✓ 10 Units (Apartments 101-110)
✓ 1 Resident (assigned to Unit 101)
✓ All features enabled (tickets, communications, payments, etc.)

🚀 NEXT STEPS

1. Login as OWNER with credentials above
2. Explore the dashboard
3. Create a ticket to test the system
4. Invite more residents to other units (Units 102-110)
5. Send feedback

📞 SUPPORT

If you have any questions or issues, reply to this email or call [SUPPORT_PHONE].

Happy testing!
─────────────
BuildingOS Support Team
```

---

## 3.2 Demo Walkthrough (For Sync Call)

### 5-Minute Demo Script

```
1. Show login page (0:00-0:30)
   - Navigate to http://localhost:3000
   - Show login form
   - Mention credentials provided

2. Login as owner (0:30-1:00)
   - Email: owner-abc123@pilot.buildingos.local
   - Password: PilotAbc123!
   - Click: Login
   - Wait for dashboard

3. Show dashboard (1:00-2:00)
   - "This is your tenant dashboard"
   - Point out: Buildings, Units, Residents cards
   - Show: 1 building with 10 units
   - Show: 1 resident in Unit 101

4. Create a ticket (2:00-3:00)
   - Click: "Buildings" → Building name → "Tickets"
   - Click: "Create Ticket"
   - Fill: Title="Test maintenance request", Description="Testing the system"
   - Choose: Category=MAINTENANCE, Priority=HIGH
   - Click: Create
   - Show: Ticket appears in list

5. Show resident view (3:00-4:00)
   - Logout (or open in incognito)
   - Login as resident: resident-abc123@pilot.buildingos.local
   - Password: PilotXyz456!
   - Show: Resident sees ONLY their unit (Unit 101)
   - Show: Can see the ticket just created
   - Show: Can comment on ticket

6. Summary (4:00-5:00)
   - "You have full access to all features"
   - "Try creating more units, inviting residents, posting communications"
   - "Send feedback anytime"
```

---

# PART 4: SAFETY & LIMITATIONS

## 4.1 Safety Features

```
✅ SAFETY CHECK 1: Environment Validation
   Script refuses to run on PRODUCTION
   Error: "SEED PILOT only allowed in: development, staging"

✅ SAFETY CHECK 2: No Existing Credentials Overwritten
   Each pilot gets unique email (includes tenant ID)
   owner-abc123@pilot.buildingos.local ← unique per tenant
   resident-xyz789@pilot.buildingos.local ← unique per tenant

✅ SAFETY CHECK 3: Automatic Unique Names
   If you create multiple pilots same day, they get timestamps
   "Pilot 2026-02-23" (first)
   "Pilot 2026-02-23 2" (second)
   OR use --name flag to make explicit distinction

✅ SAFETY CHECK 4: FREE Plan Limits
   Each pilot gets FREE plan (1 building, 10 units, 2 users)
   If needs more: Use SUPER_ADMIN to change plan
   Command: PATCH /super-admin/tenants/{tenantId}/subscription
```

---

## 4.2 Known Limitations

```
Current (Expected in Pilot):
- 1 Building max (can add more if upgraded to BASIC+ plan)
- 10 Units max (can add more if upgraded)
- FREE features only (no AI, bulk ops, etc.)
- Credentials printed to console (safe for dev/staging only)

NOT Allowed (Would indicate bug):
- Cross-tenant data leakage (CRITICAL)
- Authentication failures (CRITICAL)
- Data corruption (CRITICAL)
```

---

## 4.3 Resetting a Pilot (Start Over)

### Option A: Delete and Re-seed

```bash
# Find tenant ID
psql -U buildingos -d buildingos -c \
  "SELECT id, name FROM \"Tenant\" ORDER BY \"createdAt\" DESC LIMIT 1;"
# Output: tenant-abc123xyz | Pilot 2026-02-23

# Delete tenant (cascades to all related data)
psql -U buildingos -d buildingos -c \
  "DELETE FROM \"Tenant\" WHERE id = 'tenant-abc123xyz';"

# Re-seed new pilot
npm run seed:pilot -- --name "Pilot Retry"
```

### Option B: Wipe Database Completely

```bash
# Prisma reset (removes ALL data, reapplies migrations)
npm run migrate reset

# Expected:
# ✅ Drop existing database
# ✅ Create new database
# ✅ Apply migrations
# ✅ Run seed (creates default demo data)

# Then create pilot:
npm run seed:pilot
```

---

# PART 5: TROUBLESHOOTING

## Problem: "SEED PILOT only allowed in: development, staging"

```
Cause: Running on production or other environment

Solution:
export NODE_ENV=development
npm run seed:pilot

OR

NODE_ENV=staging npm run seed:pilot
```

## Problem: "Cannot find module 'bcrypt'"

```
Cause: Dependencies not installed

Solution:
npm ci
npm run seed:pilot
```

## Problem: "Database connection refused"

```
Cause: PostgreSQL not running

Solution:
# Check if running
psql -U buildingos -d buildingos -c "SELECT 1;"

# If not running:
brew services start postgresql@16  # macOS
systemctl start postgresql         # Linux
docker-compose up -d postgres      # Docker
```

## Problem: "UNIQUE constraint failed: User.email"

```
Cause: Tried to create pilot twice with same auto-generated email

Solution:
# Use custom name to make unique
npm run seed:pilot -- --name "Unique Pilot Name $(date +%s)"

# OR delete previous pilot first (see 4.3)
```

## Problem: Credentials not printed or garbled

```
Cause: Terminal color codes not supported

Solution:
# Try redirecting output
npm run seed:pilot > pilot_output.txt
cat pilot_output.txt

# OR disable colors by redirecting to pipe
npm run seed:pilot | cat
```

---

# PART 6: VERIFICATION CHECKLIST

After running `npm run seed:pilot`, verify:

```
✅ Credentials printed to console
   - [ ] Owner email visible
   - [ ] Owner password visible
   - [ ] Resident email visible
   - [ ] Resident password visible

✅ Can login as owner
   - [ ] API returns JWT token
   - [ ] Dashboard loads
   - [ ] Can see building + units

✅ Can login as resident
   - [ ] Can see only Unit 101
   - [ ] Access control enforced
   - [ ] Cannot see other units

✅ Data integrity
   - [ ] 1 Tenant created
   - [ ] 1 Owner + 1 Resident user created
   - [ ] 1 Building created
   - [ ] 10 Units created (101-110)
   - [ ] Resident assigned to Unit 101

✅ Ready for customer
   - [ ] Credentials saved somewhere safe
   - [ ] Ready to share with customer
   - [ ] Demo script prepared (optional)
```

---

# PART 7: WHAT HAPPENS NEXT (Customer's Perspective)

### Scenario 1: Customer Login

```
1. Customer receives email with credentials
2. Logs in with owner account
3. Sees: 1 building, 10 units, 1 resident
4. Can immediately:
   ✓ Create more units (up to 10 total, FREE plan limit)
   ✓ Invite more residents
   ✓ Create tickets (maintenance requests)
   ✓ Post communications
   ✓ View financial data
5. If needs more: Upgrade plan (contact sales)
```

### Scenario 2: Resident Exploration

```
1. Resident logs in with provided account
2. Sees: Their unit (Unit 101) dashboard
3. Can immediately:
   ✓ Create maintenance tickets
   ✓ View payments/ledger (if configured)
   ✓ Comment on communications
   ✓ View documents
4. Cannot see:
   ✗ Other units (multi-tenancy enforced)
   ✗ Admin functions (role-based access)
```

---

# PART 8: RUNNING COMPLETE INTEGRATION TEST

```bash
# After pilot seed, run this to verify everything:

# 1. Database check
psql -U buildingos -d buildingos -c "SELECT COUNT(*) FROM \"Tenant\", \"User\", \"Building\", \"Unit\";"
# Expected: Counts > 0

# 2. API health check
curl http://localhost:4000/health
# Expected: {"status":"ok","timestamp":"..."}

# 3. Login as owner
OWNER_TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner-abc123@pilot.buildingos.local",
    "password": "PilotAbc123!"
  }' | jq -r '.accessToken')

# 4. Get buildings
curl http://localhost:4000/buildings \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "X-Tenant-Id: tenant-abc123xyz" | jq '.[] | {id, name}'
# Expected: 1 building

# 5. Get units
BUILDING_ID=$(curl -s http://localhost:4000/buildings \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "X-Tenant-Id: tenant-abc123xyz" | jq -r '.[0].id')

curl http://localhost:4000/buildings/$BUILDING_ID/units \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "X-Tenant-Id: tenant-abc123xyz" | jq 'length'
# Expected: 10

# All checks passed = System ready for customer ✅
```

---

# FINAL: ACTIVATION CHECKLIST

**Before sending pilot to customer:**

- [ ] Ran `npm run seed:pilot` successfully
- [ ] Credentials printed and saved
- [ ] Database verified (can see data in Prisma Studio)
- [ ] Can login as owner (API test or Web UI)
- [ ] Can login as resident (API test or Web UI)
- [ ] Cross-tenant access blocked (security check)
- [ ] Customer email prepared with credentials
- [ ] Support contact information shared
- [ ] SLA document reviewed by customer
- [ ] Demo script prepared (optional, for sync call)

---

**Status**: 🟢 **READY FOR PILOT ACTIVATION**

One command. 30 seconds. Zero manual work. Complete pilot ready.

