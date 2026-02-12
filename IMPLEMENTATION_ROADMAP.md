# BuildingOS — Implementation Roadmap

## Executive Summary

**Total Completion**: ~18% done
**Remaining Work**: ~82% (to reach full MVP specification)
**Estimated Effort**: 8-12 weeks (with team of 1-2 devs)

---

## Phase Breakdown & Task Lists

### 📦 Phase 0: Foundation & Schema (1 week) — NOW

**Objective**: Update Prisma schema, migrations, and prepare API infrastructure for real endpoints.

#### Tasks

- [ ] **0.1** — Extend Prisma schema
  - Add: Ticket, Communication, Provider, Document, ExpenseEntry, UnitExpense, Amenity, AmenityReservation
  - Update: Building, Unit, Tenant, User, Membership (add buildingScope)
  - File: `/apps/api/prisma/schema.prisma`
  - Reference: `ARCHITECTURE.md` section 7

- [ ] **0.2** — Create Prisma migration
  - `npx prisma migrate dev --name add_core_entities`
  - Generate seed data for demo tenant (3 buildings, 10 units, 5 tickets, 3 communications, 2 providers)
  - File: `/apps/api/prisma/seed.ts`

- [ ] **0.3** — Update JWT strategy
  - Add `buildingScope` to JWT claims
  - File: `/apps/api/src/auth/jwt.strategy.ts`
  - File: `/packages/contracts/src/session.types.ts` (update AuthSession type)

- [ ] **0.4** — Create `useContextAware()` hook
  - Extract tenantId, buildingId, unitId from URL
  - Return `{ tenantId, buildingId, unitId, activeRole }`
  - File: `/apps/web/shared/hooks/useContextAware.ts`

- [ ] **0.5** — Create context breadcrumbs component
  - Show: "SUPER_ADMIN > Tenant: Acme Corp > Building: Piso 10"
  - File: `/apps/web/shared/components/layout/ContextBreadcrumbs.tsx`

- [ ] **0.6** — Create role selector component
  - Dropdown para cambiar "viewing as" role (si user tiene múltiples roles)
  - File: `/apps/web/shared/components/layout/RoleSelector.tsx`

- [ ] **0.7** — Verify zero TypeScript errors
  - `npm run type-check` both apps

**Deliverable**: Prisma schema ready, migrations applied, hooks ready for phase 1.

---

### 🏗️ Phase 1: Navigation & Building Dashboard Scaffold (1 week)

**Objective**: Implement hierarchical navigation and create building dashboard shell with sub-routes.

#### Tasks

- [ ] **1.1** — Update tenant dashboard
  - Add "Edificios" section (grid de buildings)
  - Click building → `/[tenantId]/buildings/[buildingId]`
  - File: `/apps/web/app/(tenant)/[tenantId]/dashboard/page.tsx`

- [ ] **1.2** — Create building dashboard layout
  - New layout: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/layout.tsx`
  - Subnav with routes: Overview, Tickets, Communications, Units, Residents, Providers, Documents, Finances, Settings
  - Context: `useContextAware()` captures buildingId, validates access

- [ ] **1.3** — Create building overview page
  - Grid of stat cards: reclamos abiertos, morosidad, comunicados, unidades
  - File: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/page.tsx`

- [ ] **1.4** — Create unit dashboard layout
  - New layout: `/apps/web/app/(tenant)/[tenantId]/units/[unitId]/layout.tsx`
  - Subnav: Overview, Payments, Tickets, Communications, Profile

- [ ] **1.5** — Create unit overview page
  - Display: saldo, próximos vencimientos, últimos reclamos
  - File: `/apps/web/app/(tenant)/[tenantId]/units/[unitId]/page.tsx`

- [ ] **1.6** — Update API `TenantAccessGuard`
  - Validate `buildingId` belongs to `tenantId`
  - File: `/apps/api/src/tenancy/tenant-access.guard.ts`

**Deliverable**: 4 dashboards with navigation working (data still from localStorage/mock).

---

### 🎫 Phase 2: Tickets/Reclamos (2 weeks)

**Objective**: Implement full ticket lifecycle: create, view, assign, close, add comments/evidence.

#### Frontend Tasks

- [ ] **2.1** — Create ticket storage layer (localStorage MVP)
  - CRUD: `createTicket()`, `listTickets()`, `getTicketById()`, `updateTicket()`, `deleteTicket()`
  - Comments: `addTicketComment()`, `getTicketComments()`
  - Evidence: `addEvidence()`, `deleteEvidence()`, `getEvidence()`
  - File: `/apps/web/features/tickets/tickets.storage.ts`

- [ ] **2.2** — Create ticket types & validation
  - Types: Ticket, Comment, Evidence, TicketStatus, Priority, Category
  - Zod schemas: `createTicketSchema`, `updateTicketSchema`
  - File: `/apps/web/features/tickets/tickets.types.ts`
  - File: `/apps/web/features/tickets/tickets.schema.ts`

- [ ] **2.3** — Build ticket UI components
  - `TicketTable.tsx` — list view with filters (status, priority, assignee, category)
  - `TicketForm.tsx` — create/edit form (category, title, description, priority, file upload)
  - `TicketDetail.tsx` — detail view, comments section, evidence gallery
  - `TicketComments.tsx` — add comment, display comments with author + timestamp
  - `TicketEvidence.tsx` — upload images/files, preview, delete
  - File: `/apps/web/features/tickets/components/*.tsx`

- [ ] **2.4** — Create building tickets page
  - Table + create button
  - Click row → detail modal
  - File: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/tickets/page.tsx`

- [ ] **2.5** — Create unit tickets page
  - Resident can create ticket
  - Can view + comment on own tickets
  - File: `/apps/web/app/(tenant)/[tenantId]/units/[unitId]/tickets/page.tsx`

- [ ] **2.6** — Create `useTickets()` hook
  - Wraps storage layer, returns { tickets, loading, error }
  - File: `/apps/web/features/tickets/hooks/useTickets.ts`

#### Backend Tasks

- [ ] **2.7** — Create Ticket API endpoints
  - GET `/tenants/:tenantId/buildings/:buildingId/tickets`
  - POST `/tenants/:tenantId/buildings/:buildingId/tickets`
  - GET `/tenants/:tenantId/buildings/:buildingId/tickets/:ticketId`
  - PUT `/tenants/:tenantId/buildings/:buildingId/tickets/:ticketId`
  - DELETE `/tenants/:tenantId/buildings/:buildingId/tickets/:ticketId`
  - POST/GET/DELETE for comments
  - POST/DELETE for evidence
  - Files:
    - `/apps/api/src/tickets/tickets.module.ts`
    - `/apps/api/src/tickets/tickets.controller.ts`
    - `/apps/api/src/tickets/tickets.service.ts`
    - `/apps/api/src/tickets/tickets.repository.ts`

- [ ] **2.8** — Add Ticket permission checks
  - RESIDENT can create ticket only on own unit
  - OPERATOR/ADMIN can assign/close
  - File: `/apps/api/src/tickets/ticket-access.guard.ts`

**Deliverable**: Full ticket CRUD with UI + API, comments, evidence, permission checks.

---

### 💬 Phase 3: Communications (1.5 weeks)

**Objective**: Implement announcements/comunicados with segmentation and multi-channel sending.

#### Frontend Tasks

- [ ] **3.1** — Create communication storage layer
  - CRUD: `createCommunication()`, `listCommunications()`, `sendCommunication()`, `deleteCommunication()`
  - Confirmations: `markAsRead()`, `confirmCommunication()`
  - File: `/apps/web/features/communications/communications.storage.ts`

- [ ] **3.2** — Create communication types & validation
  - Types: Communication, CommunicationStatus, Channel, Segmentation
  - Zod schemas
  - File: `/apps/web/features/communications/communications.types.ts`

- [ ] **3.3** — Build communication UI components
  - `CommunicationList.tsx` — table of sent comunicados
  - `CommunicationForm.tsx` — create comunicado (title, body, channels, segmentation)
  - `SegmentationBuilder.tsx` — selector: all units / specific units
  - `ChannelSelector.tsx` — checkboxes: EMAIL, SMS, PUSH, WHATSAPP
  - `ConfirmationTracker.tsx` — view who read/confirmed
  - `CommunicationDetail.tsx` — view sent comunicado, confirmations
  - File: `/apps/web/features/communications/components/*.tsx`

- [ ] **3.4** — Create building communications page
  - Table + create button
  - File: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/communications/page.tsx`

- [ ] **3.5** — Create unit communications page
  - Show comunicados from building
  - Confirm/mark as read
  - File: `/apps/web/app/(tenant)/[tenantId]/units/[unitId]/communications/page.tsx`

- [ ] **3.6** — Create `useCommunications()` hook
  - File: `/apps/web/features/communications/hooks/useCommunications.ts`

#### Backend Tasks

- [ ] **3.7** — Create Communication API endpoints
  - GET `/tenants/:tenantId/buildings/:buildingId/communications`
  - POST `/tenants/:tenantId/buildings/:buildingId/communications`
  - PUT `/tenants/:tenantId/buildings/:buildingId/communications/:communicationId`
  - DELETE `/tenants/:tenantId/buildings/:buildingId/communications/:communicationId`
  - POST `/tenants/:tenantId/buildings/:buildingId/communications/:communicationId/send`
  - GET `/tenants/:tenantId/buildings/:buildingId/communications/:communicationId/confirmations`
  - Files:
    - `/apps/api/src/communications/communications.module.ts`
    - `/apps/api/src/communications/communications.controller.ts`
    - `/apps/api/src/communications/communications.service.ts`

- [ ] **3.8** — Implement channel queuing (placeholder)
  - When `/send` called, queue job in BullMQ (Redis)
  - Job processor: sends EMAIL/SMS/PUSH/WHATSAPP (stub implementation)
  - Files:
    - `/apps/api/src/communications/communication-queue.processor.ts`

**Deliverable**: Full communication CRUD, segmentation, channel selection, confirmation tracking.

---

### 💰 Phase 4: Finance & Ledger (2 weeks)

**Objective**: Implement expense tracking, account current, and morosity calculation.

#### Frontend Tasks

- [ ] **4.1** — Create expense storage layer
  - CRUD: `createExpense()`, `listExpenses()`, `updateExpense()`, `deleteExpense()`
  - Calculations: `calculateAccountCurrent()`, `calculateMorosity()`, `getPaymentHistory()`
  - File: `/apps/web/features/finances/expenses.storage.ts`

- [ ] **4.2** — Create finance types & validation
  - Types: ExpenseEntry, UnitExpense, PaymentStatus, AccountCurrent
  - Zod schemas
  - File: `/apps/web/features/finances/finances.types.ts`

- [ ] **4.3** — Build finance UI components
  - `ExpenseList.tsx` — table of expenses/charges (CHARGE, PAYMENT, ADJUSTMENT)
  - `ExpenseForm.tsx` — create expense, assign to units
  - `AccountCurrentCard.tsx` — show saldo per unit (positive/negative)
  - `MorosityTable.tsx` — units with overdue payments, days overdue, amount
  - `PaymentHistoryTable.tsx` — payments received, date, amount, reference
  - `LedgerExport.tsx` — export to CSV/PDF/Excel
  - File: `/apps/web/features/finances/components/*.tsx`

- [ ] **4.4** — Create building finances page
  - Expense list + create button
  - Morosity table
  - Charts (Recharts): expense timeline, collections vs receivables
  - File: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/finances/page.tsx`

- [ ] **4.5** — Create unit payment page (refactor existing)
  - Account current card
  - Payment history
  - "Pagar" button (submit payment form)
  - File: `/apps/web/app/(tenant)/[tenantId]/units/[unitId]/payments/page.tsx`

- [ ] **4.6** — Integrate with existing payments feature
  - Link: Unit payment page → payment review (admin)
  - File: update `/apps/web/features/payments/payments.storage.ts`

- [ ] **4.7** — Create `useFinances()` hooks
  - `useExpenses(tenantId, buildingId)`, `useAccountCurrent(unitId)`, `useMorosity(buildingId)`
  - File: `/apps/web/features/finances/hooks/*.ts`

#### Backend Tasks

- [ ] **4.8** — Create Expense API endpoints
  - GET `/tenants/:tenantId/buildings/:buildingId/expenses`
  - POST `/tenants/:tenantId/buildings/:buildingId/expenses`
  - PUT `/tenants/:tenantId/buildings/:buildingId/expenses/:expenseId`
  - DELETE `/tenants/:tenantId/buildings/:buildingId/expenses/:expenseId`

- [ ] **4.9** — Create Account Current API endpoint
  - GET `/tenants/:tenantId/buildings/:buildingId/units/:unitId/account-current`
  - Returns: { saldo, nextDueDate, lastPaymentDate, paymentHistory[] }

- [ ] **4.10** — Create Payment API endpoints (integrate with existing)
  - GET `/tenants/:tenantId/buildings/:buildingId/units/:unitId/payments`
  - POST `/tenants/:tenantId/buildings/:buildingId/units/:unitId/payments`
  - PUT `/tenants/:tenantId/buildings/:buildingId/units/:unitId/payments/:paymentId`

- [ ] **4.11** — Implement morosity calculation logic
  - Scheduled job (BullMQ): daily at midnight, calculate overdue per unit
  - File: `/apps/api/src/finances/morosity-calculation.processor.ts`

**Deliverable**: Full expense/ledger/account current/morosity system with UI + API.

---

### 👥 Phase 5: Residents, Providers, Documents (1.5 weeks)

**Objective**: CRUD for residents, providers, and document management.

#### Frontend Tasks

- [ ] **5.1** — Refactor units + residents
  - Separate `ResidentAssignmentModal.tsx` into dedicated residents page
  - Build `ResidentTable.tsx`, `ResidentForm.tsx`, `ResidentDetail.tsx`
  - File: `/apps/web/features/residents/residents.storage.ts`
  - File: `/apps/web/features/residents/components/*.tsx`

- [ ] **5.2** — Create building residents page
  - Table: name, unit, email, phone, role (OWNER/TENANT/OTHER), status
  - CRUD: add, edit, deactivate resident
  - File: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/residents/page.tsx`

- [ ] **5.3** — Create provider storage & UI
  - CRUD: `createProvider()`, `listProviders()`, `updateProvider()`, `deleteProvider()`
  - Components: `ProviderTable.tsx`, `ProviderForm.tsx`
  - File: `/apps/web/features/providers/providers.storage.ts`
  - File: `/apps/web/features/providers/components/*.tsx`

- [ ] **5.4** — Create building providers page
  - Table: name, email, phone, category, status, actions
  - CRUD + filter by category
  - File: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/providers/page.tsx`

- [ ] **5.5** — Create document storage & UI
  - CRUD: `uploadDocument()`, `listDocuments()`, `deleteDocument()`, `shareDocument()`
  - Components: `DocumentList.tsx`, `DocumentUpload.tsx`, `DocumentShare.tsx`
  - File: `/apps/web/features/documents/documents.storage.ts`
  - File: `/apps/web/features/documents/components/*.tsx`

- [ ] **5.6** — Create building documents page
  - Table: filename, category, uploaded by, date, version, actions (view, download, share, delete)
  - Upload area (S3/MinIO)
  - File: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/documents/page.tsx`

#### Backend Tasks

- [ ] **5.7** — Create Resident API endpoints
  - GET `/tenants/:tenantId/buildings/:buildingId/residents`
  - POST `/tenants/:tenantId/buildings/:buildingId/residents`
  - PUT `/tenants/:tenantId/buildings/:buildingId/residents/:residentId`
  - DELETE `/tenants/:tenantId/buildings/:buildingId/residents/:residentId`

- [ ] **5.8** — Create Provider API endpoints
  - GET `/tenants/:tenantId/providers`
  - POST `/tenants/:tenantId/providers`
  - PUT `/tenants/:tenantId/providers/:providerId`
  - DELETE `/tenants/:tenantId/providers/:providerId`

- [ ] **5.9** — Create Document API endpoints
  - GET `/tenants/:tenantId/buildings/:buildingId/documents`
  - POST `/tenants/:tenantId/buildings/:buildingId/documents` (multipart upload)
  - DELETE `/tenants/:tenantId/buildings/:buildingId/documents/:documentId`
  - POST `/tenants/:tenantId/buildings/:buildingId/documents/:documentId/share` (generate share link)
  - GET `/share/:shareToken` (public endpoint, validate expiration)

- [ ] **5.10** — Configure MinIO/S3 client
  - Setup client in API (NestJS S3 module)
  - Implement upload/download/delete logic
  - File: `/apps/api/src/storage/s3.service.ts`

**Deliverable**: Residents, providers, documents CRUD with UI + API.

---

### 🤖 Phase 6: Assistant IA Widget (1.5 weeks)

**Objective**: Create contextual AI chat widget visible on all dashboards.

#### Frontend Tasks

- [ ] **6.1** — Create assistant types & context
  - Types: AssistantMessage, AssistantContext, AssistantThread
  - File: `/apps/web/features/assistant/assistant.types.ts`

- [ ] **6.2** — Build assistant widget components
  - `AssistantWidget.tsx` — floating button + collapsed chat (bottom-right)
  - `AssistantChat.tsx` — expand modal, chat interface, message history
  - File: `/apps/web/features/assistant/components/*.tsx`

- [ ] **6.3** — Create `useAssistant()` hook
  - `useAssistant()` — manages chat messages, sends to API, handles streaming
  - `useAssistantContext()` — captures current tenant/building/unit/role context
  - File: `/apps/web/features/assistant/hooks/useAssistant.ts`

- [ ] **6.4** — Add assistant widget to shared layout
  - Import `AssistantWidget` in `AppShell.tsx`
  - Show on all authenticated pages
  - Pass context via props or context provider
  - File: `/apps/web/shared/components/layout/AppShell.tsx`

- [ ] **6.5** — Create assistant context provider
  - Wraps entire app (root layout)
  - Provides `tenantId`, `buildingId`, `unitId`, `activeRole` to widget
  - File: `/apps/web/shared/context/AssistantContext.tsx`

#### Backend Tasks

- [ ] **6.6** — Create Assistant API endpoint (placeholder)
  - POST `/assistant/chat`
  - Payload: `{ message, context: { tenantId, buildingId, unitId, userRole } }`
  - Response: `{ reply, suggestions[] }`
  - File: `/apps/api/src/assistant/assistant.controller.ts`
  - File: `/apps/api/src/assistant/assistant.service.ts`

- [ ] **6.7** — Implement LLM integration
  - Choose: OpenAI API / Claude API / Local LLM
  - Implement RAG (Retrieval-Augmented Generation) to fetch building context
  - File: `/apps/api/src/llm/llm.service.ts`

- [ ] **6.8** — Add context fetching for assistant
  - Service method to fetch tenant/building/unit data for context
  - Feed to LLM as system prompt
  - File: `/apps/api/src/assistant/context-builder.service.ts`

**Deliverable**: Floating assistant widget on all dashboards, basic LLM integration.

---

### 🎚️ Phase 7: Advanced Features & Polish (2 weeks)

**Objective**: Multi-role support, amenities, tenant operations, SUPER_ADMIN expansions.

#### Frontend Tasks

- [ ] **7.1** — Implement role selector
  - Update `RoleSelector.tsx` to actually change active role
  - Update sidebar/navbar based on active role
  - Store active role in localStorage (`bo_active_role`)
  - File: `/apps/web/shared/components/layout/RoleSelector.tsx`

- [ ] **7.2** — Create amenities + reservations (optional)
  - `AmenityReservationForm.tsx`, `ReservationCalendar.tsx`
  - Storage: `/apps/web/features/amenities/amenities.storage.ts`
  - Building page: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/amenities/page.tsx`
  - Unit page: `/apps/web/app/(tenant)/[tenantId]/units/[unitId]/amenities/page.tsx`

- [ ] **7.3** — Create tenant settings page
  - Update: name, email, branding (logo, colors)
  - Integrations: toggle payment gateway, WhatsApp, email provider
  - File: `/apps/web/app/(tenant)/[tenantId]/settings/page.tsx`

- [ ] **7.4** — Create building settings page
  - Update: name, address, timezone, currency, locale
  - Utilities: list services (water, electricity, gas) and alert thresholds
  - File: `/apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/settings/page.tsx`

- [ ] **7.5** — Create profile + settings page for residents
  - Update: name, email, phone, convivientes (list), mascotas/vehículos
  - File: `/apps/web/app/(tenant)/[tenantId]/units/[unitId]/profile/page.tsx`

- [ ] **7.6** — Expand SUPER_ADMIN dashboard
  - Monitoring page: system health, Redis/DB checks, error logs
  - Billing page: MRR chart, tenant payments, invoices (mock data)
  - Support/Tickets page: bandeja de incidentes de plataforma (mock)
  - Audit logs page: quién hizo qué (mock)
  - Config page: catálogos, integraciones, seguridad
  - Files: `/apps/web/app/super-admin/[monitoring|billing|support|config]/page.tsx`

- [ ] **7.7** — Add advanced reporting
  - Dashboard KPI cards with Recharts (line/bar/pie charts)
  - Export functionality (CSV, PDF, Excel)
  - Filters: date range, categories, building scope
  - Build reusable `ReportCard.tsx`, `ChartBuilder.tsx` components

- [ ] **7.8** — Mobile responsiveness & accessibility
  - Test on mobile (iOS Safari, Android Chrome)
  - Fix layout issues, touch targets, responsive tables
  - a11y: ARIA labels, keyboard navigation, color contrast
  - Test with axe DevTools, WAVE

- [ ] **7.9** — Performance optimization
  - Code splitting per feature
  - Image optimization (Next.js Image)
  - Lazy load components
  - Optimize bundle size (analyze with `next/bundle-analyzer`)

- [ ] **7.10** — Add comprehensive error handling
  - Error boundary component
  - User-friendly error messages
  - Retry logic for failed API calls
  - File: `/apps/web/shared/components/ErrorBoundary.tsx`

#### Backend Tasks

- [ ] **7.11** — Enhance API with advanced features
  - Pagination, sorting, filtering for all list endpoints
  - Bulk operations (delete multiple, bulk assign)
  - Search endpoints (cross-entity search)

- [ ] **7.12** — Implement audit logging
  - Middleware to log all mutations (POST/PUT/DELETE)
  - Store: `userId, action, entity, entityId, tenantId, buildingId, timestamp, changes`
  - Endpoint: GET `/tenants/:tenantId/audit-logs` (SUPER_ADMIN/TENANT_ADMIN only)

- [ ] **7.13** — Setup cron jobs (BullMQ)
  - Daily morosity recalculation
  - Weekly report generation
  - Pending notification reminders
  - File: `/apps/api/src/jobs/scheduled-jobs.module.ts`

- [ ] **7.14** — Add webhook support
  - Allow tenants to register webhooks (POST, PUT, PATCH events)
  - Implement job processor to send webhooks
  - File: `/apps/api/src/webhooks/webhooks.service.ts`

- [ ] **7.15** — Implement API rate limiting & throttling
  - Use `nestjs-throttler`
  - Different limits per role
  - File: `/apps/api/src/throttle.module.ts`

- [ ] **7.16** — Add API documentation & testing
  - Swagger/OpenAPI fully documented
  - Postman collection
  - Integration tests for critical flows
  - Files: `/apps/api/test/*.spec.ts`

**Deliverable**: Multi-role UI, amenities, expanded SUPER_ADMIN, advanced reporting, a11y, performance optimized.

---

### 🧪 Phase 8: Testing & Hardening (1 week)

**Objective**: Test coverage, security audit, performance testing.

#### Tasks

- [ ] **8.1** — Unit tests
  - Storage layers: 80%+ coverage
  - Utils: 100% coverage
  - Goal: `/test` npm script passes
  - Files: `*.storage.test.ts`, `*.utils.test.ts`

- [ ] **8.2** — Integration tests
  - API endpoints: critical flows
  - Multi-tenant isolation
  - Permission guards
  - Files: `/apps/api/test/*.e2e-spec.ts`

- [ ] **8.3** — Component tests
  - Critical UI flows (create tenant, create ticket, send communication)
  - Modal/form interactions
  - Tools: Vitest + @testing-library/react

- [ ] **8.4** — E2E tests
  - Full user journeys (login → create building → create ticket → assign → close)
  - Tools: Cypress or Playwright
  - Files: `/apps/web/e2e/*.cy.ts`

- [ ] **8.5** — Security audit
  - OWASP Top 10 check
  - SQL injection, XSS, CSRF prevention
  - API key/token handling
  - Review: auth flows, permissions, data access

- [ ] **8.6** — Performance testing
  - Load test: 100 concurrent users on API
  - Frontend: Lighthouse score >90
  - Database: slow query logs, index optimization

- [ ] **8.7** — QA checklist
  - Manual testing across all features
  - Browser compatibility (Chrome, Safari, Firefox)
  - Mobile testing (iOS, Android)
  - Accessibility: WCAG 2.1 AA

**Deliverable**: >80% test coverage, security audit passed, performance baseline established.

---

### 📊 Phase 9: SUPER_ADMIN & Billing (1 week)

**Objective**: Complete SUPER_ADMIN dashboard with monitoring, billing, support.

#### Tasks

- [ ] **9.1** — Monitoring dashboard
  - System health: DB, Redis, S3 status
  - Error logs: real-time feed
  - Performance metrics: API latency, response times
  - File: `/apps/web/app/super-admin/monitoring/page.tsx`

- [ ] **9.2** — Billing dashboard
  - MRR/ARR charts (mock data for now)
  - Tenant payment tracking
  - Invoice generation/download
  - File: `/apps/web/app/super-admin/billing/page.tsx`

- [ ] **9.3** — Support/Tickets for platform issues
  - Bandeja de tickets abiertos
  - Impersonation workflow: open as tenant, reproduce issue, close
  - File: `/apps/web/app/super-admin/support/page.tsx`

- [ ] **9.4** — Audit logs explorer
  - Search by user, action, entity, date range, tenant
  - Export audit trail
  - File: `/apps/web/app/super-admin/audit-logs/page.tsx`

- [ ] **9.5** — Config/settings for platform
  - Catálogos: countries, currencies, languages
  - Integraciones: payment gateways, email, SMS, WhatsApp
  - Security: 2FA policy, password requirements, IP whitelist
  - Files: `/apps/web/app/super-admin/config/page.tsx`

**Deliverable**: Fully functional SUPER_ADMIN platform operations dashboard.

---

## 🎯 Priority Matrix

### Must Have (Weeks 1-4)
- Phase 0: Schema + Foundation
- Phase 1: Navigation + Building Dashboard
- Phase 2: Tickets CRUD + API
- Phase 3: Communications CRUD + API

### Should Have (Weeks 5-8)
- Phase 4: Finance/Ledger
- Phase 5: Residents, Providers, Documents
- Phase 6: Assistant IA (basic)
- Phase 7: Polish + Multi-role

### Nice to Have (Weeks 9-12)
- Phase 8: Testing & Hardening
- Phase 9: SUPER_ADMIN Expansions
- Amenities, advanced reporting, webhooks

---

## 🚀 Delivery Milestones

| Milestone | Week | Deliverables |
|-----------|------|--------------|
| **M1: Foundation** | 1 | Schema, migrations, hooks, navigation |
| **M2: Tickets + Communications** | 3 | Full CRUD, API, UI, permissions |
| **M3: Finance** | 5 | Expenses, account current, morosity, API |
| **M4: Residents, Providers, Docs** | 6.5 | All CRUD, uploads (S3), sharing |
| **M5: Assistant IA** | 8 | Widget, basic LLM integration, context-aware |
| **M6: Advanced Features** | 10 | Multi-role, amenities, reporting, a11y, performance |
| **M7: Testing & Security** | 11 | >80% test coverage, security audit passed |
| **M8: SUPER_ADMIN Complete** | 12 | Monitoring, billing, audit logs, config |

---

## 📋 Resource Requirements

### Team
- **1-2 Full-Stack Devs** (Node.js/TypeScript, React/Next.js)
- **1 QA Engineer** (manual testing, test automation)
- **Product Owner** (spec clarifications, prioritization)

### Infrastructure
- PostgreSQL 16 (Heroku, AWS RDS, or self-hosted)
- Redis 7 (for BullMQ queues)
- MinIO or AWS S3 (file storage)
- OpenAI/Claude API (for assistant)

### External Services
- Payment gateway (Stripe, MercadoPago)
- Email/SMS provider (SendGrid, Twilio)
- WhatsApp Business API
- Analytics (Mixpanel, Segment)

---

## 🔍 Success Criteria

By project completion:

- ✅ 4 hierarchical dashboards fully functional
- ✅ 50+ API endpoints covering all business flows
- ✅ Multi-tenant isolation enforced at DB + API + UI level
- ✅ CRUD for: Buildings, Units, Residents, Tickets, Communications, Providers, Documents, Expenses
- ✅ Multi-role support with UI role selector
- ✅ Finance module with ledger, account current, morosity tracking
- ✅ Assistant IA widget on all dashboards
- ✅ >80% test coverage
- ✅ Mobile responsive (tested on iOS/Android)
- ✅ WCAG 2.1 AA accessibility
- ✅ Production-ready security (OWASP Top 10 passed)
- ✅ 90+ Lighthouse score
- ✅ Documentation: architecture, API, deployment, runbooks

---

## 📝 Notes

- **localStorage → API Migration**: Keep both during development, gradually migrate.
- **Git strategy**: Feature branches, PR reviews, squash merge to main.
- **CI/CD**: GitHub Actions for testing, linting, deployments (placeholder in repo).
- **Database backups**: Automate daily backups before production launch.
- **Monitoring**: Setup error tracking (Sentry), logging (ELK), uptime monitoring (StatusPage).

---

## 🔗 Reference Links

- Full specification: `ARCHITECTURE.md`
- Current codebase status: `STATUS.md`
- Project decisions: `PRODUCT_DECISIONS.md`
- Development guide: `README.md`

