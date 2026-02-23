# 🚀 BuildingOS - Quick Start Guide

## One-Command Setup (Local Development)

```bash
# Start everything and load demo data in one go:
docker compose up -d && npm run db:migrate && npm run seed && npm run dev
```

That's it! 🎉

---

## Step-by-Step Setup

### 1️⃣ **Start Infrastructure**
```bash
docker compose up -d
```
- PostgreSQL: `localhost:5432`
- MinIO: `localhost:9000`

Wait for containers to be healthy (~10s)

### 2️⃣ **Setup Database**
```bash
npm run db:migrate
```
Creates all tables from Prisma schema

### 3️⃣ **Seed Demo Data**
```bash
npm run seed
```
Creates:
- ✅ 2 demo tenants (ADMINISTRADORA + EDIFICIO_AUTOGESTION)
- ✅ 4 demo users with different roles
- ✅ 3 buildings with 12 total units
- ✅ Sample data: tickets, charges, vendors, documents, etc.

See: **DEMO_CREDENTIALS.md** for login details

### 4️⃣ **Start Applications**
```bash
npm run dev
```
- API: `http://localhost:4000`
- Frontend: `http://localhost:3000`

---

## 📋 Demo Tenants Created

### Tenant 1: Admin Demo (ADMINISTRADORA)
**Plan: PRO** | 2 Buildings | 6 Units

- **Building A - Downtown** (456 Park Ave)
  - Apt A-101 (OCCUPIED)
  - Apt A-102 (OCCUPIED)
  - Apt A-103 (VACANT)

- **Building B - Uptown** (789 Oak Boulevard)
  - Apt B-201 (OCCUPIED)
  - Apt B-202 (VACANT)
  - Apt B-203 (OCCUPIED)

---

### Tenant 2: Edificio Demo (EDIFICIO_AUTOGESTION)
**Plan: FREE (Trial)** | 1 Building | 6 Units

- **Demo Building - Self Managed** (123 Main St)
  - Apt 101 (OCCUPIED)
  - Apt 102 (OCCUPIED)
  - Apt 103 (VACANT)
  - Apt 201 (OCCUPIED)
  - Apt 202 (OCCUPIED)
  - Apt 203 (VACANT)

---

## 👥 Demo User Credentials

| Email | Password | Role | Access |
|-------|----------|------|--------|
| `superadmin@demo.com` | `SuperAdmin123!` | SUPER_ADMIN | All tenants |
| `admin@demo.com` | `Admin123!` | TENANT_ADMIN | Both tenants |
| `operator@demo.com` | `Operator123!` | OPERATOR | Edificio Demo only |
| `resident@demo.com` | `Resident123!` | RESIDENT | Assigned units only |

👉 See **DEMO_CREDENTIALS.md** for full details

---

## ✅ Verify Setup

### API is running
```bash
curl http://localhost:4000/health
# Should return: { "status": "ok" }
```

### Frontend is running
```
Open http://localhost:3000 in browser
You should see login page
```

### Database is populated
```bash
npm run db:studio
# Opens Prisma Studio with all seeded data
```

### Try a login
```
Email: admin@demo.com
Password: Admin123!
Should see buildings dashboard
```

---

## 🔄 Reset Demo Data

To start fresh with clean demo data:

```bash
# Dangerous! Drops all data and re-seeds
npm run db:migrate:reset
```

Or manually:
```bash
npm run db:migrate:reset
npm run seed
npm run dev
```

---

## 📊 Demo Data Included

Each seed includes:

✅ **Buildings & Units**
- Multiple buildings per tenant
- Various occupancy statuses
- Occupant assignments with roles

✅ **Financial Data**
- Charges (common expenses)
- Partial payments by residents
- Payment allocations
- Different statuses (PAID, PARTIAL, PENDING)

✅ **Operations**
- Vendors (Plomería Express)
- Tickets (maintenance requests)
- Quotes & Work orders
- Operator assignments

✅ **Documents**
- Building rules (PDF)
- Unit-specific guides
- Different visibility levels

✅ **Tickets & Comments**
- Sample maintenance ticket
- Operator acknowledgments
- Communication workflow

---

## 🔒 Important Security Notes

⚠️ **FOR LOCAL DEVELOPMENT ONLY**
- Demo passwords are weak - DO NOT use in production
- Seed data includes fake credentials for testing
- Database persists in Docker volumes (safe for demo reset)

✅ **System enforces:**
- Multi-tenant isolation (tested)
- Role-based access control
- Data validation at API level

---

## 🛠️ Useful Commands

```bash
# Development
npm run dev                 # Start all apps (API + Web)
npm run dev -w apps/api    # Start API only
npm run dev -w apps/web    # Start web only

# Database
npm run db:migrate         # Run migrations
npm run db:migrate:reset   # ⚠️ Drop all + re-migrate
npm run db:seed            # Load demo data
npm run db:studio          # Open Prisma Studio

# Code Quality
npm run lint               # Lint all workspaces
npm run typecheck          # TypeScript validation
npm run build              # Build all apps
npm run test               # Run unit tests
npm run test:e2e -w apps/api  # Run E2E tests

# Monorepo
npm run --list            # List all available commands
npm run <cmd> -ws         # Run in all workspaces
npm run <cmd> -w apps/api # Run in specific workspace
```

---

## 🔗 Key URLs

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | http://localhost:3000 | Web app (login, dashboard) |
| **API** | http://localhost:4000 | REST endpoints (with JWT auth) |
| **Database Studio** | Run `npm run db:studio` | Browse/edit data visually |
| **MinIO Console** | http://localhost:9001 | S3-compatible storage (optional) |
| **Health Check** | http://localhost:4000/health | API status |

---

## 🚨 Common Issues

### "Port already in use"
```bash
# Kill process using port
lsof -ti :3000 | xargs kill -9  # Frontend
lsof -ti :4000 | xargs kill -9  # API
lsof -ti :5432 | xargs kill -9  # Database
```

### "Database connection failed"
```bash
# Check containers
docker compose ps

# Restart containers
docker compose down
docker compose up -d
npm run db:migrate
npm run seed
```

### "npm: command not found"
- Install Node.js 20+ from https://nodejs.org
- Or use `nvm install 20`

### "Build errors"
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## 📚 Next Steps

1. **Explore the code:**
   - Backend: `apps/api/src`
   - Frontend: `apps/web/app`
   - Shared types: `packages/contracts`

2. **Review architecture:**
   - Read: `docs/ARCHITECTURE.md` (if available)
   - Check: `MEMORY.md` for previous work

3. **Make changes:**
   - Create a branch: `git checkout -b feature/my-feature`
   - Make changes, test locally
   - Push and create a PR

4. **Check the CI:**
   - GitHub Actions will run: lint, typecheck, test, build
   - Fix any issues and push again

---

## 🆘 Need Help?

- Check `DEMO_CREDENTIALS.md` for user details
- Read `docs/ARCHITECTURE.md` for system design
- Check git log for recent changes: `git log --oneline -10`
- Run tests to verify: `npm run test`

---

**Last updated:** Feb 22, 2026
**Node version required:** 20+
**Docker required:** Yes (or run DB manually)
