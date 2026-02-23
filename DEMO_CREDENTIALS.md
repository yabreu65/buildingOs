# 🔑 BuildingOS - Demo Credentials

**⚠️ FOR LOCAL DEVELOPMENT ONLY - DO NOT USE IN PRODUCTION**

---

## 🚀 Quick Start

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Setup database
npm run db:migrate

# 3. Seed demo data
npm run seed

# 4. Start apps
npm run dev
```

Then login at `http://localhost:3000`

---

## 👥 Demo User Accounts

### SUPER_ADMIN (Full System Access)
```
Email:    superadmin@demo.com
Password: SuperAdmin123!
Scope:    All tenants (control plane)
```
✅ Can:
- Create/manage tenants
- View audit logs
- Manage subscriptions & plans
- Access `/super-admin/*` routes

---

### Tenant: Admin Demo (ADMINISTRADORA Plan)
**Plan: PRO** | 2 Buildings | 6 Units Total | 10 Users Max | AI Enabled

#### TENANT_ADMIN
```
Email:    admin@demo.com
Password: Admin123!
Role:     TENANT_ADMIN
Scope:    All buildings in "Admin Demo" tenant
```
✅ Can:
- Manage all buildings & units
- Manage residents & occupants
- Create charges & payments
- View reports & analytics
- Manage vendors & operations

---

### Tenant: Edificio Demo (EDIFICIO_AUTOGESTION Plan)
**Plan: FREE (Trial)** | 1 Building | 6 Units | 2 Users Max | No AI

#### TENANT_ADMIN
```
Email:    admin@demo.com
Password: Admin123!
Role:     TENANT_ADMIN
Scope:    All buildings in "Edificio Demo" tenant
```
Same permissions as above, but limited by FREE plan.

---

#### OPERATOR
```
Email:    operator@demo.com
Password: Operator123!
Role:     OPERATOR
Scope:    Assigned buildings/units
Building: Demo Building - Self Managed
Units:    Apt 201 (as OWNER)
```
✅ Can:
- Create/manage tickets
- Manage work orders & vendors
- Process payments & charges
- View occupants in assigned units

---

#### RESIDENT
```
Email:    resident@demo.com
Password: Resident123!
Role:     RESIDENT
Scope:    Assigned units only
Building: Demo Building - Self Managed
Units:
  - Apt 102 (as RESIDENT)
  - Apt 202 (as RESIDENT)
```
✅ Can:
- View own unit details
- Create maintenance tickets
- Make payments
- View personal invoices & charges
- View shared documents

---

## 🏢 Demo Data Structure

### Tenant: Admin Demo (ADMINISTRADORA)
```
├── Building A - Downtown (456 Park Ave)
│   ├── Apt A-101 (OCCUPIED - admin)
│   ├── Apt A-102 (OCCUPIED)
│   └── Apt A-103 (VACANT)
│
└── Building B - Uptown (789 Oak Boulevard)
    ├── Apt B-201 (OCCUPIED - admin)
    ├── Apt B-202 (VACANT)
    └── Apt B-203 (OCCUPIED)
```

### Tenant: Edificio Demo (EDIFICIO_AUTOGESTION)
```
└── Demo Building - Self Managed (123 Main St)
    ├── Apt 101 (OCCUPIED - admin as OWNER)
    ├── Apt 102 (OCCUPIED - resident as RESIDENT)
    ├── Apt 103 (VACANT)
    ├── Apt 201 (OCCUPIED - operator as OWNER)
    ├── Apt 202 (OCCUPIED - resident as RESIDENT)
    └── Apt 203 (VACANT)
```

---

## 📊 Demo Data Included

Each seeded tenant includes:

✅ **Buildings & Units**
- Multiple buildings per tenant
- Various occupancy statuses
- Mixed unit types

✅ **Users & Roles**
- 4 demo users with different roles
- Multi-role capabilities (admin in both tenants)
- Realistic memberships

✅ **Financial Data**
- Sample charges (common expenses)
- Partial payment made by resident
- Payment allocation workflow
- Different charge statuses (PAID, PARTIAL)

✅ **Operations**
- 1 vendor (Plomería Express)
- 1 ticket (leaky faucet)
- 1 quote & 1 work order
- Operator assignment workflow

✅ **Documents**
- Building-wide rules (PDF)
- Unit-specific maintenance guide
- Different visibility levels

✅ **Communication**
- Sample ticket with comments
- Admin acknowledgment
- Resident communication flow

---

## 🔒 Security Notes

- ⚠️ **Demo passwords are weak** - DO NOT use in production
- ⚠️ **Seed data is idempotent** - running `npm run seed` multiple times is safe
- ⚠️ **Demo database resets** - all changes will be lost on db:migrate:reset
- ✅ **Tenant isolation enforced** - demo validates multi-tenant security
- ✅ **Role-based access** - UI respects role permissions

---

## 🔄 Reset Demo Data

To reset everything and start fresh:

```bash
# Option 1: Reset database and re-seed
npm run db:migrate:reset

# Option 2: Manual steps
npm run db:migrate:reset
npm run seed
```

---

## 🧪 Testing the System

### Test as SUPER_ADMIN
```
Login: superadmin@demo.com / SuperAdmin123!
Navigate: http://localhost:3000/super-admin
Actions: View all tenants, subscriptions, audit logs
```

### Test as TENANT_ADMIN
```
Login: admin@demo.com / Admin123!
Switch between tenants via sidebar
Navigate buildings, units, residents
Create charges, manage vendors
```

### Test as RESIDENT
```
Login: resident@demo.com / Resident123!
View only assigned units (102, 202)
Create maintenance tickets
View & pay charges
```

### Test Tenant Isolation
```
1. Login as admin (sees "Admin Demo" tenant)
2. Note building IDs and unit codes
3. Logout and login as resident
4. Verify resident CANNOT see buildings from admin tenant
5. Verify resident ONLY sees their assigned units
```

---

## 📝 Common Issues

**"User already exists"**
- Seed is idempotent - this is expected behavior
- Delete test data manually if needed: `DELETE FROM "User" WHERE email LIKE '%@demo.com'`

**"Database error: does not exist"**
- Run migrations: `npm run db:migrate`

**"Can't login"**
- Verify database is running: `docker compose ps`
- Check NODE_ENV: Should be `development` for local

**"Passwords not working"**
- Passwords are hashed at seed time
- Cannot change via direct SQL - use API endpoints

---

## 🔗 API Endpoints

All endpoints require `Authorization: Bearer <JWT-TOKEN>`

### Get JWT Token
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@demo.com",
    "password": "Admin123!"
  }'
```

### Sample Requests

**List buildings for Admin Demo tenant**
```bash
curl http://localhost:4000/api/tenants/{tenantId}/buildings \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: {tenantId}"
```

**List units for a building**
```bash
curl http://localhost:4000/api/tenants/{tenantId}/buildings/{buildingId}/units \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: {tenantId}"
```

---

## 📚 Documentation

- [Architecture Guide](./docs/ARCHITECTURE.md)
- [API Documentation](./apps/api/README.md)
- [Frontend Guide](./apps/web/README.md)
- [Database Schema](./apps/api/prisma/schema.prisma)

---

**Last updated:** Feb 22, 2026
**For production credentials:** See your DevOps/Security team
