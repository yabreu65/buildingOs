# Next Sprint: Feb 26 - Mar 11, 2026 (Sprint 1)

**Duration**: 2 weeks (10 business days)
**Goal**: Kick off critical path (Finance UI + Resident Portal skeleton + Docker)
**Capacity**: 40 story points
**Team Allocation**: 4-5 engineers (Frontend 2, Backend 1, DevOps 1, QA 1)

---

## Sprint Goal

**"Establish Finance UI foundation and Resident Portal framework while enabling local development."**

### Success Criteria
- ✅ Finance API service complete with full test coverage
- ✅ Resident Portal dashboard component renders
- ✅ Docker Compose works for full-stack local dev
- ✅ All 8 tickets DONE and in production staging branch
- ✅ Zero critical issues in sprint review

---

## Sprint Backlog (8 Tickets, 40 Story Points)

### Ticket 1: Finance API Integration Service (5pts)
**Status**: READY | **Assignee**: TBD | **Epic**: E1

```markdown
# Finance API Integration Service

## Story
As a Developer,
I want a complete FinanceApiService wrapping all 15 backend endpoints,
So components can make type-safe API calls without raw HTTP.

## Definition of Done
- [ ] Create `apps/web/shared/api/finance.api.ts` (530+ lines)
- [ ] Export functions:
  - listCharges(tenantId, filters?) → Promise<Charge[]>
  - getCharge(tenantId, chargeId) → Promise<Charge>
  - createCharge(...) → Promise<Charge>
  - listPayments(...) → Promise<Payment[]>
  - submitPayment(...) → Promise<Payment>
  - approvePayment(tenantId, paymentId) → Promise<Payment>
  - listAllocations(...) → Promise<Allocation[]>
  - getSummary(tenantId) → Promise<FinanceSummary>
  - ... (15 total endpoints)
- [ ] All functions include automatic JWT injection
- [ ] Error handling: Throw meaningful errors with user messages
- [ ] Type-safe responses (TypeScript interfaces)
- [ ] Unit tests for all methods (>80% coverage)
- [ ] No TypeScript errors (npm run build:web passes)

## Acceptance Criteria
- Service is used by all Finance components in Sprint 2-3
- Zero runtime errors in staging
- 15/15 endpoints wrapped

## Notes
- Use pattern from existing `payments.api.ts` for consistency
- Add to git as single commit: "feat: Finance API integration service"
```

**PR Template**: Link to backend Finance API spec (`LEADS_API_SPEC.md` style)

---

### Ticket 2: Resident Dashboard Component (8pts)
**Status**: READY | **Assignee**: TBD | **Epic**: E2

```markdown
# Resident Dashboard Component

## Story
As a Resident,
I want to see my key information on a dashboard,
So I understand my status at a glance.

## Definition of Done
- [ ] Create `apps/web/app/(tenant)/[tenantId]/dashboard-resident/page.tsx`
- [ ] Component structure:
  ```
  ResidentDashboard
    ├── Header: "Welcome, {firstName}"
    ├── 4 KPI Cards:
    │   ├── MyUnit (unit label, address)
    │   ├── NextPaymentDue (amount, date)
    │   ├── OpenTickets (count)
    │   └── Inbox (unread count)
    ├── Quick Actions (4 buttons):
    │   ├── Pay Now
    │   ├── Submit Ticket
    │   ├── View Documents
    │   └── Contact Admin
    └── Recent Activity (last 5 tickets)
  ```
- [ ] Responsive design: 1 column mobile, 2 columns desktop
- [ ] Loading states: Skeleton cards while fetching
- [ ] Error states: Display retry button if API fails
- [ ] Real-time data: Fetch from useResidentContext on mount
- [ ] Mobile tested on iPhone 12, iPad
- [ ] No TypeScript errors
- [ ] Storybook story added

## Acceptance Criteria
- Page renders in < 2 seconds (Lighthouse)
- All 4 cards load data correctly
- Buttons navigate to correct pages
- Mobile responsive (tested on real device or emulator)

## Notes
- Use existing Card, Button, Skeleton components
- Reference: Unit Dashboard implementation (similar pattern)
- Color scheme: Use CSS variables from globals.css
```

---

### Ticket 3: Finance Summary Cards Component (5pts)
**Status**: READY | **Assignee**: TBD | **Epic**: E1

```markdown
# Finance Summary Cards Component

## Story
As a Tenant Admin,
I want to see KPI cards (total charges, paid, pending, overdue),
So I understand financial status at a glance.

## Definition of Done
- [ ] Create component: `apps/web/features/finance/components/FinanceSummaryCards.tsx` (80 lines)
- [ ] 4 cards with metrics:
  1. Total Charges (this month + YTD)
  2. Paid Amount (% of total)
  3. Pending/Due (count + amount)
  4. Overdue (RED alert if any)
- [ ] Color coding:
  - Green (#10b981): Paid
  - Orange (#f59e0b): Pending
  - Red (#ef4444): Overdue
- [ ] Card layout: Grid 2x2 on desktop, 1x4 on mobile
- [ ] Hover effect: Slight shadow increase
- [ ] useFinanceSummary() hook fetches data
- [ ] Loading: Show Skeleton card
- [ ] Error: Show error state with retry
- [ ] Unit tests: Mock hook, test render, test colors

## Acceptance Criteria
- Component renders without errors
- All 4 cards display correct data
- Colors match Figma design (if exists, else use above)
- Mobile responsive

## Notes
- Reuse FinanceSummary API response from Ticket 1
- Add to Storybook for design verification
```

---

### Ticket 4: Finance Charges Table with Filtering (8pts)
**Status**: READY | **Assignee**: TBD | **Epic**: E1

```markdown
# Finance Charges Table with Filtering

## Story
As a Tenant Admin,
I want to view all charges in a table with filters and sorting,
So I can analyze billing history.

## Definition of Done
- [ ] Create page: `apps/web/app/(tenant)/[tenantId]/finances/charges/page.tsx` (150 lines)
- [ ] Table columns (sortable):
  - Unit Label | Charge ID | Amount | Type | Status | DueDate | PaidDate
- [ ] Filters (dropdown/select):
  - Status: All, PENDING, PARTIAL, PAID, CANCELED
  - Unit: Dropdown of units
  - DateRange: Start-End pickers
- [ ] Pagination: 25/50/100 per page selector
- [ ] Search: Full-text search on Charge ID
- [ ] Sort: Click column header to sort ASC/DESC
- [ ] Row actions:
  - Click row → Detail modal
  - Checkbox → Bulk select
- [ ] Bulk action: "Pay Selected" button
- [ ] Export button: "Export CSV" (trigger download)
- [ ] Loading state: Table skeleton
- [ ] Empty state: "No charges found" message
- [ ] Mobile: Horizontal scroll table on mobile

## Acceptance Criteria
- Table renders 100 charges in < 500ms
- Filters work (no page reload needed)
- Sort works on all columns
- Pagination works
- Export downloads CSV file
- Mobile scrollable

## Notes
- Use useFinanceCharges hook (will create in Ticket 1)
- Reuse Table component from shared/ui
- Add CSV export via papaparse npm package
```

---

### Ticket 5: Payment Submit Modal (8pts)
**Status**: READY | **Assignee**: TBD | **Epic**: E1

```markdown
# Payment Submit Modal Component

## Story
As a Tenant Admin,
I want to submit payment for multiple charges,
So I can settle accounts in one action.

## Definition of Done
- [ ] Create component: `apps/web/features/finance/components/PaymentSubmitModal.tsx` (120 lines)
- [ ] Modal structure:
  1. List unpaid charges with checkboxes (8 chars max display)
  2. Display Amount, DueDate, Status for each
  3. Total calculation at bottom
  4. Form fields:
     - Amount (auto-fill total, allow edit)
     - PaymentMethod: Select from [TRANSFER, CASH, CARD, ONLINE]
     - Reference (optional text)
  5. Submit button (disabled if no selection)
  6. Cancel button
- [ ] Validation:
  - At least 1 charge selected
  - Amount > 0
  - Submit creates payment via API
- [ ] On success:
  - Toast: "Payment submitted for ${amount}"
  - Refresh parent table
  - Close modal
- [ ] On error:
  - Show error message in modal
  - Disable submit button (with retry)
- [ ] Loading state: Spinner on submit button

## Acceptance Criteria
- Modal opens/closes correctly
- Checkbox selection works
- Total calculation updates on selection change
- Submit creates payment in database
- Toast appears on success
- Error handling displays errors

## Notes
- Use react-hook-form for form state
- Use useFinancePayments hook for submit
```

---

### Ticket 6: Docker Compose Local Dev Setup (8pts)
**Status**: READY | **Assignee**: TBD | **Epic**: E7

```markdown
# Docker Compose for Local Development

## Story
As a Developer,
I want to run the full stack with one command,
So I can develop without manual infrastructure setup.

## Definition of Done
- [ ] Create `docker-compose.yml` in project root (100 lines)
- [ ] Services:
  ```yaml
  services:
    api:
      image: node:18
      build: apps/api
      ports: 4000:4000
      env: DATABASE_URL, JWT_SECRET, MAIL_PROVIDER=none
      volumes: ./apps/api:/app
      depends_on: db, redis

    web:
      image: node:18
      build: apps/web
      ports: 3000:3000
      volumes: ./apps/web:/app
      depends_on: api

    db:
      image: postgres:15
      ports: 5432:5432
      env: POSTGRES_PASSWORD=dev, POSTGRES_DB=buildingos
      volumes: postgres_data:/var/lib/postgresql/data

    redis:
      image: redis:7
      ports: 6379:6379
      volumes: redis_data:/data
  ```
- [ ] Run migrations on startup: `prisma migrate deploy`
- [ ] Seed data on startup: Load demo tenants (seed.ts)
- [ ] Environment file: `.env.docker` with all needed vars
- [ ] Documentation: `docs/LOCAL_DEV.md` (how to run)
- [ ] One-liner to start: `docker-compose up` (all services start)
- [ ] Live reload: Code changes reflected immediately (no rebuild)
- [ ] Test it: Verify localhost:3000 works, API responds, DB has data

## Acceptance Criteria
- One command starts everything
- localhost:3000 shows web app
- localhost:4000/health returns 200
- Database has seed data
- Code changes auto-reload
- Team can use this immediately

## Notes
- Add docker-compose.override.yml for local tweaks (git ignored)
- Include troubleshooting in docs (common issues)
```

---

### Ticket 7: Admins Leads Dashboard UI (8pts)
**Status**: READY | **Assignee**: TBD | **Epic**: E3

```markdown
# Super-Admin Leads Dashboard UI

## Story
As a SUPER_ADMIN,
I want to view all leads with filtering and search,
So I can manage the sales pipeline.

## Definition of Done
- [ ] Create page: `apps/web/app/super-admin/leads/page.tsx` (150 lines)
- [ ] Table columns:
  - FullName | Email | Phone | TenantType | UnitsEstimate | Source | Status | CreatedDate | Actions
- [ ] Filters:
  - Status: Dropdown (NEW, CONTACTED, QUALIFIED, DISQUALIFIED)
  - Source: Dropdown (pricing-page, contact-form, etc.)
  - DateRange: Start-End pickers
- [ ] Search: Full-text on name/email
- [ ] Sort: Click headers
- [ ] Pagination: 25/50/100 per page
- [ ] Row actions:
  - Click row → Lead detail page
  - "Convert" button → Modal (see Ticket 8)
- [ ] Bulk select: Checkboxes on rows
- [ ] Bulk action: "Convert Selected" button (future: Phase 5)
- [ ] Loading: Table skeleton
- [ ] Empty state: "No leads found"

## Acceptance Criteria
- Page renders all leads
- Filters work without reload
- Convert button navigates to detail
- Mobile scrollable
- Pagination works

## Notes
- Reuse useLeads hook (already exists from Phase 4)
- Reuse Table component
- Link to conversion flow in Ticket 8
```

---

### Ticket 8: Lead Convert Modal & Success Flow (8pts)
**Status**: READY | **Assignee**: TBD | **Epic**: E3

```markdown
# Lead Convert Modal & Tenant Creation

## Story
As a SUPER_ADMIN,
I want to convert a lead to a customer with one click,
So onboarding is fast and easy.

## Definition of Done
- [ ] Modal: `LeadConvertModal.tsx` (120 lines)
  - Display lead info (read-only)
  - Form fields (pre-filled, editable):
    - TenantName (required, 50 chars max)
    - TenantType (select)
    - OwnerEmail (required, can differ from lead email)
    - OwnerFullName (required)
    - PlanId (select, default: TRIAL)
  - Submit button → Calls POST /admin/leads/:id/convert
  - Loading state while submitting
  - Error display if conversion fails
- [ ] Redirect on success:
  - Toast: "Lead converted! Tenant created: {tenantName}"
  - Redirect to new tenant dashboard
- [ ] Undo? (No - conversions are atomic and final)
- [ ] List page auto-refreshes after modal closes

## Acceptance Criteria
- Modal pre-fills all lead fields
- Form validates (required fields)
- Submit API call succeeds
- Tenant created in database
- Redirect to tenant dashboard works
- Lead shows convertedTenantId after

## Notes
- Use react-hook-form with Zod validation
- Reuse ConvertLeadDto from backend (Phase 4)
- Atomic transaction ensures no orphaned data
```

---

## Sprint Dependencies & Risks

### Dependencies
| Ticket | Depends On | Start After |
|--------|-----------|-------------|
| T1 | (None) | Day 1 |
| T2 | (None) | Day 1 |
| T3 | T1 (API) | Day 3 |
| T4 | T1 (API) | Day 3 |
| T5 | T1 (API) | Day 3 |
| T6 | (None) | Day 1 |
| T7 | (None) | Day 1 |
| T8 | (None) | Day 1 |

### Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| API spec changes mid-sprint | HIGH | Lock backend API (Phase 4 done) before sprint starts |
| Frontend UI complexity | MEDIUM | Start with wireframes, get design approval early |
| Docker setup issues | MEDIUM | One engineer dedicated, pair programming first 2 days |
| Time zone coordination | LOW | Daily 9am standup (async notes if needed) |

---

## Daily Standups (10 min, 9am UTC)

**Format**: 3 questions per person
- What did I do yesterday?
- What am I doing today?
- Any blockers?

**Meeting Link**: [TBD - Zoom/Slack Huddle]

---

## Sprint Review (Friday Mar 11, 3pm UTC)

**Agenda** (30 min):
1. Demo all completed tickets (5 min each)
2. Retrospective: What went well? What to improve?
3. Sprint velocity: Story points completed vs. planned
4. Sprint 2 kickoff: Preview tickets for next 2 weeks

---

## Definition of Done (All Tickets)

✅ **Code**:
- [ ] Code written + committed to `develop` branch
- [ ] Code reviewed + approved by 1 senior dev
- [ ] No TypeScript errors (`npm run build` passes)
- [ ] No console errors or warnings

✅ **Testing**:
- [ ] Unit tests written (>80% coverage)
- [ ] Manual testing completed (screenshot/video)
- [ ] Works on staging environment

✅ **Documentation**:
- [ ] Commits have clear messages
- [ ] Code comments for complex logic
- [ ] Storybook story added (for UI components)

✅ **Product**:
- [ ] Product owner accepts ticket (feature works as intended)
- [ ] No regressions in existing features
- [ ] All acceptance criteria met

---

## Ticket Assignments (TBD - To Be Determined)

**Suggested Breakdown**:
- **Frontend Lead** (2 weeks): T2, T3, T4, T5, T7, T8
- **Backend/API Lead** (1 week): T1 (5pts)
- **DevOps** (1 week): T6 (8pts)
- **QA** (parallel): Testing all, filing bugs

---

## Success Metrics for Sprint 1

| Metric | Target | Owner |
|--------|--------|-------|
| Velocity | 40 story points | Scrum Master |
| Completion Rate | 100% (8/8 tickets DONE) | Team |
| Bug Escape | < 3 P1 bugs post-sprint | QA |
| Code Review Time | < 4 hours average | Tech Lead |
| Test Coverage | > 80% | QA |

---

## Post-Sprint Plan

**Sprint 2 (Mar 12-25)**:
- Finish remaining Finance UI (Ticket 1.6, 1.7)
- Complete Resident Portal payments & tickets
- Performance optimization starts

**Sprint 3 (Mar 26-Apr 8)**:
- Admin UI completion (Communications, Documents, Vendors)
- Load testing & optimization
- Staging deployment ready

---

## How to Use This Sprint

1. **Monday Morning**: Print this doc, share with team, review tickets
2. **Daily**: Update Jira/Linear with progress, attend standup
3. **Friday**: Demo completed work, retro meeting
4. **Monday Next**: Move to Sprint 2 backlog

**Questions?** Ask in #engineering-sprint Slack channel

