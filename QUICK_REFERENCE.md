# BuildingOS — Quick Reference

## Current Status Snapshot

| Metric | Value |
|--------|-------|
| **Overall Completion** | ~18-20% |
| **Days to Full MVP** | 60-90 days (1-2 devs) |
| **Dashboards Done** | 1 of 4 (SUPER_ADMIN) |
| **API Endpoints** | 6 of 50+ |
| **Modules Implemented** | 2 of 10 (Auth, SUPER_ADMIN tenant mgmt) |
| **Test Coverage** | 56+ tests (SUPER_ADMIN only) |
| **TypeScript Errors** | 0 ✅ |
| **Storage Strategy** | localStorage (MVP), needs migration to API |

---

## What's Done (Ready to Use)

✅ **Authentication**
- JWT login/signup
- Session restore
- Multi-tenant isolation
- Role-based routing

✅ **SUPER_ADMIN Dashboard**
- Tenant CRUD (create, read, update, delete, suspend)
- 3-step creation wizard
- Search/filter/sort by plan, status, date
- Global stats (active, trial, suspended tenants)
- Plan limits (FREE/BASIC/PRO/ENTERPRISE)
- Impersonation button (context only, not real auth)

✅ **Infrastructure**
- PostgreSQL 16 + Prisma ORM
- NestJS API (port 4000, Swagger enabled)
- Next.js frontend (port 3000, PWA manifest)
- Docker Compose (PG, Redis, MinIO)
- RBAC matrix (5 roles, 12 permissions)

✅ **Developer Tooling**
- Monorepo structure (apps/web, apps/api, packages)
- Shared types & permissions
- TypeScript strict mode
- Feature-based folder organization
- localStorage reactive pattern (custom events)

---

## What's Missing (By Priority)

### 🔴 Critical (Blocks core functionality)
1. **Ticket/Reclamo system** — Residents can't report issues → Phase 2
2. **Communications** — Admins can't broadcast → Phase 3
3. **Finance/Ledger** — No expense tracking, morosity, account current → Phase 4
4. **Building Dashboard** — Day-to-day management missing → Phase 1
5. **Unit Dashboard** — Resident portal missing → Phase 1

### 🟠 Important (Unlocks workflows)
6. **Providers management** — Can't assign work to contractors → Phase 5
7. **Documents** — Can't share rules, actas, presupuestos → Phase 5
8. **Residents directory** — Refactor modal into full page → Phase 5
9. **Assistant IA** — No AI support on dashboards → Phase 6
10. **Building/Unit settings** — Can't configure locale, currency, etc. → Phase 1

### 🟡 Nice to Have (Improves UX)
11. **Multi-role UI selector** — Users can't switch roles visually → Phase 7
12. **Amenities/Reservations** — Optional feature → Phase 7
13. **Advanced reporting** — Charts, exports, trends → Phase 7
14. **Webhooks** — Tenant integrations → Phase 7
15. **SUPER_ADMIN expansions** — Monitoring, billing, audit → Phase 9

---

## Implementation Order (Fastest Path to MVP)

### Week 1: Phase 0 — Foundation
- Extend Prisma schema (Ticket, Communication, Provider, Document, Expense)
- Create migrations
- Add `useContextAware()` hook
- Update JWT with building scope
- **Goal**: Schemas + context helpers ready

### Weeks 2-3: Phase 1 — Navigation
- Building selector on tenant dashboard
- Building + unit dashboard layouts
- Nav wiring between all 4 dashboards
- **Goal**: Can navigate to all 4 dashboards (no data yet)

### Weeks 4-5: Phase 2 — Tickets
- Ticket storage + types + validation
- Ticket UI (list, create, detail, comments, evidence)
- Building & unit ticket pages
- **Goal**: Full ticket CRUD working

### Weeks 6-7: Phase 3 — Communications
- Communication storage + types + validation
- Communication UI (list, create, segmentation, channels)
- Building & unit communication pages
- **Goal**: Full communication CRUD working

### Week 8: Phase 4 — Finance (cut scope)
- Expense storage + UI (basic)
- Account current per unit
- Morosity table
- **Goal**: Finance dashboard functional

### Week 9: Phase 5 — Providers + Documents
- Provider & Document CRUD
- S3 client + upload
- Document sharing with expiring links
- **Goal**: Can manage docs and contractors

### Week 10: Phase 6 — Assistant IA
- Widget + chat UI
- Placeholder API endpoint
- Basic LLM integration (OpenAI)
- **Goal**: Widget visible on all dashboards

### Weeks 11-12: Phase 7 & Polish
- Multi-role UI selector
- Amenities (optional)
- Advanced reporting (Recharts)
- Accessibility + mobile
- **Goal**: Production-ready features

---

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| **4 nested dashboards** | Matches building management hierarchy (org → building → unit) |
| **RBAC with 5 roles** | SUPER_ADMIN, TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT covers all personas |
| **localStorage MVP** | Fast iteration without API, plan to migrate gradually |
| **Prisma + PostgreSQL** | Type-safe ORM, mature, multi-tenant support built-in |
| **Next.js + React** | Full-stack type-safety, SSR, API routes, image optimization |
| **Feature-first structure** | Scalable folder org, self-contained modules |
| **BullMQ for queues** | Redis already in Docker, async job processing (notifications, billing) |
| **MinIO for files** | S3-compatible, self-hosted, docker-ready |

---

## Questions to Answer Before Starting

Before kicking off Phase 0, clarify with product owner:

1. **Impersonation**: Should SUPER_ADMIN actually log in as tenant (real JWT) or just switch context?
2. **Building admin external**: Can external contractor be building admin? How invited?
3. **Auto-billing**: Generate monthly expenses automatically or manual per building?
4. **Offline-first**: Is PWA offline capability important?
5. **AI priority**: Should assistant IA be earlier (Phase 1) or Phase 6?
6. **Payment gateway**: Which one (MercadoPago, Stripe, PayU)?

---

## File Architecture

```
Specification
  ARCHITECTURE.md               ← Full technical spec (read first)
  IMPLEMENTATION_ROADMAP.md    ← Task breakdown + timeline (read second)
  COMPLETION_ANALYSIS.md       ← Detailed status + risks (this file's parent)
  NAVIGATION_FLOWS.md          ← Mermaid diagrams (visual reference)
  QUICK_REFERENCE.md           ← This file

Code
  /apps/api/
    src/
      auth/                    ✅ Login, signup, JWT
      tenants/                 ✅ List tenants
      tenancy/                 ✅ Multi-tenant guards
      prisma/                  ✅ DB service
      (tickets/)               🔲 To build
      (communications/)        🔲 To build
      (finances/)              🔲 To build
    prisma/
      schema.prisma            ✅ Update needed
      migrations/
        20260211*_init_postgres/            ✅ Done
        (20260212*_core_entities_needed)    🔲 To add

  /apps/web/
    features/
      auth/                    ✅ Login, signup, session hooks
      super-admin/             ✅ Dashboard + CRUD
      units/                   🟡 Partial (storage + modal)
      payments/                🟡 Partial (submit + review)
      (buildings/)             🔲 To build
      (tickets/)               🔲 To build
      (communications/)        🔲 To build
      (finances/)              🔲 To build
      (residents/)             🔲 To build (refactor from modal)
      (providers/)             🔲 To build
      (documents/)             🔲 To build
      (amenities/)             🔲 To build
      (assistant/)             🔲 To build
    shared/
      components/
        ui/                    ✅ Buttons, cards, inputs, tables
        layout/                ✅ Sidebar, topbar, AppShell
      hooks/
        useContextAware.ts     🔲 To build
        useAssistantContext.ts 🔲 To build
    app/
      (public)/                ✅ Landing, login, signup
      (tenant)/[tenantId]/     🟡 Dashboard stub
      super-admin/             ✅ 6 pages done

  Tests
    tests/
      tenants.storage.test.ts  ✅ 32 tests
      super-admin.utils.test.ts ✅ 24 tests
      (other features)         🔲 To add
```

---

## CLI Commands Reference

```bash
# Development
npm run dev              # Start both apps (api:4000, web:3000)
npm run dev:api         # Just API
npm run dev:web         # Just web

# Testing
npm run test            # Run all tests
npm run test:watch      # Watch mode

# Building
npm run build           # Build both apps
npm run build:api       # Build API
npm run build:web       # Build web

# Database
npm run db:migrate      # Run migrations
npm run db:seed         # Seed demo data
npm run db:studio       # Open Prisma Studio (GUI)

# Linting
npm run lint            # Check linting
npm run format          # Format code (Prettier)

# Docker
docker-compose up       # Start PostgreSQL, Redis, MinIO
docker-compose down     # Stop services
```

---

## Key Files to Know

| File | Purpose | Size |
|------|---------|------|
| `apps/api/prisma/schema.prisma` | Data model | 200+ lines (extend to 400+) |
| `apps/api/src/auth/jwt.strategy.ts` | JWT validation | 50 lines |
| `apps/web/features/super-admin/tenants.storage.ts` | Tenant CRUD | 300+ lines |
| `apps/web/features/units/units.storage.ts` | Units CRUD | 200+ lines |
| `apps/web/shared/hooks/useBoStorageTick.ts` | localStorage subscription | 50 lines |
| `apps/web/app/(tenant)/[tenantId]/layout.tsx` | Tenant route guard | 80 lines |
| `packages/contracts/src/rbac.ts` | Permission types | 100+ lines |
| `packages/permissions/src/permissions.ts` | RBAC matrix | 150+ lines |

---

## Common Tasks & Where to Start

### "I want to add a new module (e.g., Tickets)"
1. Add types to `features/tickets/tickets.types.ts`
2. Add Zod schema to `features/tickets/tickets.schema.ts`
3. Add storage to `features/tickets/tickets.storage.ts`
4. Build UI components in `features/tickets/components/*.tsx`
5. Create pages in `app/(tenant)/[tenantId]/buildings/[buildingId]/tickets/page.tsx`
6. Add API endpoints in `apps/api/src/tickets/`
7. Add tests to `tests/tickets.storage.test.ts`

### "I want to add a permission/role"
1. Add to `Role` enum in `packages/contracts/src/rbac.ts`
2. Add to `Permission` type in `packages/contracts/src/rbac.ts`
3. Update `ROLE_PERMISSIONS` matrix in `packages/permissions/src/permissions.ts`
4. Use in guards/components: `useCan('permission.name')`

### "I want to modify the Prisma schema"
1. Edit `apps/api/prisma/schema.prisma`
2. Run `npm run db:migrate dev --name <description>`
3. Seeds update in `apps/api/prisma/seed.ts`
4. Regenerate Prisma client: `npm run db:generate`

### "I want to test a feature"
1. Create `.storage.test.ts` file in the feature
2. Use existing pattern from `tests/tenants.storage.test.ts`
3. Run `npm run test -- <feature>`
4. Aim for 80%+ coverage per feature

---

## External Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **NestJS** | 10+ | Backend framework |
| **Next.js** | 15 | Frontend framework |
| **Prisma** | Latest | ORM + migrations |
| **PostgreSQL** | 16 | Database |
| **Redis** | 7 | Queues (BullMQ) |
| **MinIO** | Latest | S3-compatible storage |
| **React Hook Form** | Latest | Form management |
| **Zod** | Latest | Schema validation |
| **TanStack Query** | Latest | API data fetching (upgrade needed) |
| **Recharts** | Latest | Charts/reporting (not used yet) |
| **Passport** | Latest | Authentication |
| **JWT** | Latest | Token signing |

**To Add** (not yet integrated):
- OpenAI API (LLM for assistant)
- Stripe/MercadoPago (payments)
- SendGrid/Twilio (emails/SMS)
- WhatsApp Business API
- Sentry (error tracking)

---

## Success Metrics (By Phase End)

| Phase | Goal | Success Criteria |
|-------|------|------------------|
| **0** | Schema ready | 0 TS errors, migrations applied |
| **1** | Navigation | Can reach all 4 dashboards |
| **2** | Tickets working | Full CRUD, comments, evidence, API |
| **3** | Communications working | Create, send, segment, track confirmations |
| **4** | Finance dashboard | Expenses, account current, morosity |
| **5** | Providers + docs | Upload, share, directory |
| **6** | Assistant IA | Widget on all dashboards, LLM integration |
| **7** | Production ready | Multi-role, a11y, mobile, performance |

---

## Contact & Documentation

📚 **Full Docs**
- `ARCHITECTURE.md` — Detailed technical spec
- `IMPLEMENTATION_ROADMAP.md` — Task breakdown
- `NAVIGATION_FLOWS.md` — Mermaid diagrams
- `README.md` — Development setup

💡 **Next Steps**
1. Read `ARCHITECTURE.md` (30 min)
2. Read `IMPLEMENTATION_ROADMAP.md` (20 min)
3. Answer clarifying questions (10 min)
4. Kick off Phase 0 (1 week)

