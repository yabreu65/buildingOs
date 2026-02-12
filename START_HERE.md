# 🚀 BuildingOS — START HERE

**Last Updated**: February 12, 2026
**Project Status**: 18-20% Complete → Target 100% in 8-12 weeks

---

## TL;DR — The Elevator Pitch

**BuildingOS** es un SaaS de administración de edificios/condominios multi-tenant con 4 niveles jerárquicos:

```
SUPER_ADMIN (dueño del SaaS)
    ↓
TENANT (administradora o edificio autogestionado)
    ↓
BUILDING (administrador del edificio)
    ↓
UNIT (residente/propietario)
```

**¿Qué está hecho?** (~18%)
- ✅ Auth real (JWT + DB)
- ✅ SUPER_ADMIN dashboard con CRUD de tenants
- ✅ Storage para units, residents, payments (localStorage MVP)
- ✅ RBAC completo (5 roles, 12 permisos)
- ✅ Infraestructura (PostgreSQL, Redis, MinIO, Docker)

**¿Qué falta?** (~82%)
- ❌ 3 dashboards jerárquicos (TENANT, BUILDING, UNIT)
- ❌ 8 módulos de negocio (Tickets, Communications, Finance, Providers, Documents, Residents, Amenities, Assistant IA)
- ❌ 40+ API endpoints (solo 6 implementados)
- ❌ Migración localStorage → API real

---

## 📚 Read These Docs (In Order)

### 1. **QUICK_REFERENCE.md** (10 min) 👈 Start here
- Status snapshot
- What's done vs missing
- Implementation order
- Common tasks

### 2. **ARCHITECTURE.md** (30 min)
- Full technical spec
- 4 dashboards detallados
- API endpoints roadmap
- Prisma schema extensiones
- Technical rules

### 3. **IMPLEMENTATION_ROADMAP.md** (30 min)
- 9 fases con task lists
- Timeline por semana
- Milestones
- Deliverables

### 4. **COMPLETION_ANALYSIS.md** (20 min)
- Estado detallado por feature
- Risks & opportunities
- Clarifying questions
- Success criteria

### 5. **NAVIGATION_FLOWS.md** (Reference)
- Mermaid diagrams
- Data model ERD
- API hierarchy
- Permission matrix

---

## 🎯 High-Level Plan

### Goal
Implementar 4 dashboards jerárquicos + 8 módulos de negocio con:
- Multi-tenant isolation (DB + API + UI)
- RBAC con 5 roles
- 50+ API endpoints
- 80%+ test coverage
- Mobile responsive + a11y

### Timeline
- **Weeks 1**: Foundation (schema, hooks, context)
- **Weeks 2-3**: Navigation (4 dashboards working)
- **Weeks 4-5**: Tickets (CRUD + comments + evidence)
- **Weeks 6-7**: Communications (CRUD + segmentation)
- **Week 8**: Finance (expenses + account current + morosity)
- **Week 9**: Providers + Documents
- **Week 10**: Assistant IA widget
- **Weeks 11-12**: Polish + testing + SUPER_ADMIN expansions

**Total**: 12 weeks, 1-2 devs

### Phases

```
Phase 0: Foundation      [████░░░░░░░░░░░░░░░░░░░░░░░░] Week 1
Phase 1: Navigation      [████████░░░░░░░░░░░░░░░░░░░░] Weeks 2-3
Phase 2: Tickets         [████████████░░░░░░░░░░░░░░░░] Weeks 4-5
Phase 3: Communications  [████████████████░░░░░░░░░░░░] Weeks 6-7
Phase 4: Finance         [████████████████████░░░░░░░░] Week 8
Phase 5: Providers+Docs  [████████████████████████░░░░] Week 9
Phase 6: Assistant IA    [████████████████████████████] Week 10
Phase 7-9: Polish+Test   [██████████████████████████████] Weeks 11-12

Current: [████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 18%
Target:  [██████████████████████████████████████████████████] 100%
```

---

## 🏗️ Architecture Overview

### 4 Dashboards (Hierarchical)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1️⃣  SUPER_ADMIN Dashboard                                      │
│ ─────────────────────────────────────────────────────────────── │
│ • Overview (tenants, MRR, alerts)                              │
│ • Tenant management (CRUD, plans, limits)                      │
│ • Monitoring (system health, errors)                           │
│ • Billing (MRR chart, invoices)                                │
│ • Support (platform tickets)                                   │
│ • Audit logs (who did what)                                    │
│ • Config (integraciones, security)                             │
│ • Assistant IA (global context)                                │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2️⃣  TENANT Dashboard                                            │
│ ─────────────────────────────────────────────────────────────── │
│ • Overview (buildings, reclamos, morosidad)                    │
│ • Buildings selector (grid or table)                           │
│ • User management (invite, roles, scope)                       │
│ • Unified inbox (tickets, messages, approvals)                 │
│ • Reports (cross-building analytics)                           │
│ • Settings (branding, integraciones)                           │
│ • Assistant IA (tenant context)                                │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3️⃣  BUILDING Dashboard                                          │
│ ─────────────────────────────────────────────────────────────── │
│ • Overview (operation KPIs)                                    │
│ • Tickets (create, assign, close, comments, evidence)          │
│ • Communications (create, segment, send, track)                │
│ • Units (list, CRUD, assign residents)                         │
│ • Residents (directory, roles, contact)                        │
│ • Providers (directory, quotes, assign work)                   │
│ • Documents (rules, actas, presupuestos, upload/share)         │
│ • Finances (expenses, payments, morosity, ledger)              │
│ • Settings (moneda, timezone, servicios)                       │
│ • Assistant IA (building context)                              │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4️⃣  UNIT Dashboard (Residente)                                  │
│ ─────────────────────────────────────────────────────────────── │
│ • Saldo / Account current                                      │
│ • Pagos (historial + pagar)                                    │
│ • Reclamos (crear, seguir)                                     │
│ • Comunicados (leer, confirmar)                                │
│ • Mi Perfil (datos, convivientes, mascotas)                    │
│ • Reservas (amenities, calendario)                             │
│ • Assistant IA (unit context)                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8 Modules (Core Business Features)

```
1. 🎫 Tickets/Reclamos        → Residents report issues, admins assign/close
2. 💬 Communications          → Admins broadcast, segment, track confirmations
3. 💰 Finance/Ledger          → Expenses, account current per unit, morosity
4. 👤 Residents               → Directory, roles, contact management
5. 🔧 Providers               → Contractor directory, quotes, work assignment
6. 📄 Documents               → Upload, categorize, share (S3/MinIO)
7. 🎮 Amenities/Reservations  → Bookable spaces, calendar (optional)
8. 🤖 Assistant IA            → Contextual AI widget on all dashboards
```

---

## ✅ What's Done

### Code (18% complete)

```
✅ Authentication & Auth Guards
   - JWT login/signup
   - Session restore
   - Multi-tenant checks
   - Role-based route protection

✅ SUPER_ADMIN Dashboard
   - Tenant CRUD (create, read, update, delete, suspend)
   - 3-step wizard for tenant creation
   - Search/filter/sort (by plan, status, date)
   - Global stats (active, trial, suspended)
   - Plan limits validation
   - Impersonation button

✅ Storage Layer (localStorage MVP)
   - Tenants, buildings, units, residents
   - Payments, banking, properties
   - Reactive pattern (custom events)
   - Safe JSON parsing

✅ Types & Validation
   - Zod schemas for all entities
   - 56+ unit tests (100% coverage for SUPER_ADMIN)
   - TypeScript strict mode
   - Zero compilation errors

✅ Infrastructure
   - Docker Compose (PostgreSQL 16, Redis 7, MinIO)
   - Prisma ORM with migrations
   - NestJS API (port 4000)
   - Next.js frontend (port 3000, PWA manifest)
   - GitHub monorepo (apps/web, apps/api, packages)

✅ RBAC & Permissions
   - 5 roles: SUPER_ADMIN, TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT
   - 12+ permissions matrix
   - Permission checks in components
   - Role-based route guards
```

### Database

```
✅ Core Models
   - User (email, name, password)
   - Tenant (name, type, status, plan)
   - Membership (user + tenant + roles)
   - Building (name, address)
   - Unit (label, code, type, occupancy)
   - UnitResident (with soft-delete via endAt)

🔄 Partial Models
   - Payment (submit/review only)
   - BankAccount (CRUD only)

🚫 Missing (need Prisma extension)
   - Ticket
   - Communication
   - Provider
   - Document
   - ExpenseEntry
   - Amenity
```

---

## ❌ What's Missing

### By Priority

```
🔴 CRITICAL (Blocks core workflows) — ~40% of remaining work
  1. Ticket/Reclamo system      → Phase 2
  2. Communications module       → Phase 3
  3. Finance/Ledger              → Phase 4
  4. Building Dashboard          → Phase 1
  5. Unit Dashboard              → Phase 1

🟠 IMPORTANT (Unlocks full features) — ~30% of remaining work
  6. Providers management
  7. Documents (S3 uploads)
  8. Residents refactor
  9. Assistant IA
  10. Building/Unit settings

🟡 NICE TO HAVE (Polish) — ~30% of remaining work
  11. Multi-role UI selector
  12. Amenities
  13. Advanced reporting (charts)
  14. Webhooks
  15. SUPER_ADMIN monitoring/billing
```

### By Module

```
Module                   % Done   Missing
──────────────────────────────────────────────
Authentication           100%     ✅ Complete
RBAC                     100%     ✅ Complete
SUPER_ADMIN Dashboard    80%      Monitoring, Billing, Audit (stubs)
Buildings                30%      CRUD UI, API
Units                    40%      API, refactor UI
Residents                30%      Refactor modal → page, API
Tickets                  0%       All (storage, UI, API)
Communications           0%       All (storage, UI, API)
Finance                  15%      Expenses, account current, morosity
Providers                0%       All (storage, UI, API)
Documents                0%       S3 client, upload UI, API
Amenities                0%       All (storage, UI, API)
Assistant IA             0%       Widget, LLM integration
Auditing                 0%       Logging middleware
```

---

## 🚦 Getting Started

### Step 1: Read Documentation (1-2 hours)
1. Read this file (10 min)
2. Read `QUICK_REFERENCE.md` (10 min)
3. Read `ARCHITECTURE.md` (30 min)
4. Skim `IMPLEMENTATION_ROADMAP.md` (15 min)
5. Bookmark `NAVIGATION_FLOWS.md` for reference

### Step 2: Answer Clarifying Questions
Before coding, clarify:
- **Impersonation**: Real JWT login or just context switch?
- **Building admin**: Can be external? How invited?
- **Auto-billing**: Monthly charges automatic or manual?
- **Offline-first**: Is PWA capability important?
- **AI priority**: Phase 1 or Phase 6?

### Step 3: Setup Environment
```bash
# Clone repo (already done)
# Install dependencies
npm install

# Start dev servers
npm run dev                # api + web
# Or separate
npm run dev:api           # NestJS on :4000
npm run dev:web           # Next.js on :3000

# Start database + services
docker-compose up         # PostgreSQL, Redis, MinIO

# Check everything works
npm run type-check        # Should be 0 errors
npm run test              # Should pass existing tests
```

### Step 4: Start Phase 0 (This Week)
```bash
# 1. Extend Prisma schema
# ✏️ Edit apps/api/prisma/schema.prisma
# Add: Ticket, Communication, Provider, Document, Expense, Amenity models

# 2. Create migration
npm run db:migrate dev --name add_core_entities

# 3. Build `useContextAware()` hook
# ✏️ Create apps/web/shared/hooks/useContextAware.ts
# Returns: { tenantId, buildingId, unitId, activeRole }

# 4. Update JWT strategy
# ✏️ Edit apps/api/src/auth/jwt.strategy.ts
# Add: buildingScope to claims

# 5. Create context breadcrumbs
# ✏️ Create apps/web/shared/components/layout/ContextBreadcrumbs.tsx

# 6. Verify zero errors
npm run type-check
```

---

## 📊 Completion Checklist

Track progress against phases:

```
PHASE 0: Foundation (Week 1)
[ ] Extend Prisma schema with 6 new models
[ ] Create & run migrations
[ ] `useContextAware()` hook implemented
[ ] JWT strategy updated with buildingScope
[ ] Context breadcrumbs component created
[ ] RoleSelector component created
[ ] Zero TypeScript errors

PHASE 1: Navigation (Weeks 2-3)
[ ] Building selector on tenant dashboard
[ ] Building dashboard layout + overview page
[ ] Unit dashboard layout + overview page
[ ] Navbar wiring between all 4 dashboards
[ ] Context flows through URL and hooks

PHASE 2: Tickets (Weeks 4-5)
[ ] Ticket storage layer (localStorage MVP)
[ ] Ticket types & Zod schema
[ ] Ticket UI components (table, form, detail, comments, evidence)
[ ] Building tickets page
[ ] Unit tickets page (create + follow)
[ ] Ticket API endpoints (6 endpoints)
[ ] Tests for tickets storage

PHASE 3: Communications (Weeks 6-7)
[ ] Communication storage layer
[ ] Communication types & Zod schema
[ ] Communication UI (list, create, segmentation, channels)
[ ] Building communications page
[ ] Unit communications page
[ ] Communication API endpoints (6 endpoints)
[ ] Channel queuing (BullMQ placeholder)

PHASE 4: Finance (Week 8)
[ ] Expense storage layer
[ ] Finance types & Zod schema
[ ] Finance UI (expenses list, account current, morosity table)
[ ] Building finances page
[ ] Unit payments page (refactor)
[ ] Finance API endpoints (5 endpoints)
[ ] Morosity calculation logic

PHASE 5: Providers + Documents (Week 9)
[ ] Providers storage & CRUD UI
[ ] Documents storage & S3 client
[ ] Building providers page
[ ] Building documents page
[ ] Providers + Documents API endpoints
[ ] Document upload, share, expiring links

PHASE 6: Assistant IA (Week 10)
[ ] Assistant types & context
[ ] AssistantWidget component
[ ] AssistantChat modal
[ ] `useAssistant()` hook
[ ] Assistant context provider
[ ] API endpoint (placeholder)
[ ] LLM integration (OpenAI)

PHASE 7-9: Polish + Testing (Weeks 11-12)
[ ] Multi-role UI selector
[ ] Amenities module (optional)
[ ] Advanced reporting (Recharts)
[ ] Mobile responsive testing
[ ] a11y audit (WCAG 2.1 AA)
[ ] 80%+ test coverage
[ ] SUPER_ADMIN expansions
```

---

## 🔧 Key Commands

```bash
# Development
npm run dev              # Both apps
npm run dev:api         # API only
npm run dev:web         # Web only

# Testing
npm run test            # All tests
npm run test:watch      # Watch mode
npm run type-check      # TypeScript check

# Database
npm run db:migrate dev --name <desc>
npm run db:seed         # Seed demo data
npm run db:studio       # Prisma Studio GUI

# Building
npm run build           # Both apps
npm run lint            # Linting
npm run format          # Prettier format

# Docker
docker-compose up       # Start services
docker-compose down     # Stop services
```

---

## 📁 File Structure

```
/Users/yoryiabreu/proyectos/buildingos/
├── 📘 START_HERE.md                ← YOU ARE HERE
├── 📘 QUICK_REFERENCE.md           ← Next read
├── 📘 ARCHITECTURE.md              ← Full spec
├── 📘 IMPLEMENTATION_ROADMAP.md    ← Task list
├── 📘 COMPLETION_ANALYSIS.md       ← Detailed status
├── 📘 NAVIGATION_FLOWS.md          ← Diagrams
│
├── apps/
│   ├── api/                        NestJS backend
│   │   ├── src/
│   │   │   ├── auth/               ✅ JWT login/signup
│   │   │   ├── tenants/            ✅ Tenant list
│   │   │   ├── tenancy/            ✅ Guards
│   │   │   └── (tickets, comms...) 🚫 To build
│   │   └── prisma/
│   │       ├── schema.prisma       ⚠️  Need to extend
│   │       └── seed.ts             ⚠️  Need to update
│   │
│   └── web/                        Next.js frontend
│       ├── features/
│       │   ├── auth/               ✅ Login/signup
│       │   ├── super-admin/        ✅ Dashboard
│       │   ├── units/              🟡 Partial
│       │   ├── payments/           🟡 Partial
│       │   └── (buildings, etc.)   🚫 To build
│       ├── shared/
│       │   ├── components/ui/      ✅ Base UI
│       │   ├── components/layout/  ✅ Layout
│       │   └── hooks/              🟡 Need context hooks
│       └── app/
│           ├── (public)/           ✅ Landing/auth
│           ├── (tenant)/           🟡 Tenant dashboard stub
│           └── super-admin/        ✅ 6 pages
│
├── packages/
│   ├── contracts/                  Shared types
│   └── permissions/                RBAC matrix
│
└── infra/
    └── docker/                     Docker Compose
        ├── docker-compose.yml      ✅ PG + Redis + MinIO
```

---

## 💡 Key Insights

### What Makes This Project Unique
1. **4 Hierarchical Dashboards** — Not just a CRUD app, real organization structure
2. **Multi-tenant from Day 1** — Isolated at DB, API, and UI level
3. **RBAC-first** — 5 roles, 12 permissions, matrix-driven
4. **Async-ready** — Redis + BullMQ for notifications, billing, scheduled jobs
5. **Offline-capable** — localStorage pattern, PWA manifest, can go fully offline-first later
6. **Contextual AI** — Assistant widget understands tenant/building/unit scope

### Critical Success Factors
1. **Storage → API migration** — Keep localStorage as fallback, gradually move to API
2. **Building-scope enforcement** — Implement TenantAccessGuard for buildingId validation
3. **Test coverage** — Aim for 80%+ per feature, TDD approach
4. **Accessibility** — WCAG 2.1 AA from the start, not retrofitted
5. **Documentation** — Keep ARCHITECTURE.md and IMPLEMENTATION_ROADMAP.md in sync

### Common Pitfalls to Avoid
1. ❌ Not validating buildingId in API guards → data leaks
2. ❌ Skipping unit tests → bugs in production
3. ❌ localStorage as permanent solution → scalability issues
4. ❌ Not thinking about soft-deletes early → messy data
5. ❌ Forgetting multi-role UI support → incomplete feature

---

## 🎯 Next Actions

### RIGHT NOW (Today)
1. ✅ Read this file (you're doing it!)
2. ✅ Read `QUICK_REFERENCE.md`
3. ✅ Read `ARCHITECTURE.md` (full technical spec)

### THIS WEEK (Phase 0 — Foundation)
1. Extend Prisma schema (Ticket, Communication, Provider, Document, Expense, Amenity)
2. Create migration and seed data
3. Build `useContextAware()` hook
4. Update JWT with buildingScope
5. Create context breadcrumbs + role selector

### NEXT WEEKS (Phase 1-3)
1. **Phase 1** (Weeks 2-3): Build 4 dashboards navigation skeleton
2. **Phase 2** (Weeks 4-5): Implement full Tickets CRUD
3. **Phase 3** (Weeks 6-7): Implement full Communications CRUD

---

## 📞 Questions?

If you need clarification on:
- **Architecture** → Read `ARCHITECTURE.md` section
- **Tasks** → Check `IMPLEMENTATION_ROADMAP.md` phase
- **Status** → See `COMPLETION_ANALYSIS.md`
- **Diagrams** → Look at `NAVIGATION_FLOWS.md`
- **Quick lookup** → Use `QUICK_REFERENCE.md`

---

## ✨ TL;DR Summary

| Metric | Value |
|--------|-------|
| **Current Status** | 18-20% complete |
| **Dashboards Done** | 1 of 4 (SUPER_ADMIN) |
| **API Endpoints** | 6 of 50+ |
| **Estimated Time to 100%** | 8-12 weeks (1-2 devs) |
| **Next Phase** | Phase 0 — Foundation (1 week) |
| **Key Deliverable** | 4 Dashboards + 8 modules + 50+ APIs |

**Start with**: Phase 0 this week → Phase 1 next 2 weeks → Phases 2-7 over next 10 weeks.

Good luck! 🚀

