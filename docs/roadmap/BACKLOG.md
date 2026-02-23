# BuildingOS Backlog - Atomic User Stories

**Status**: ACTIVE BACKLOG
**Last Updated**: 2026-02-23
**Format**: Epic → User Story (with Story Points)

---

## E1: Finance UI - 45 Story Points

### Backend Complete ✅ (15 endpoints, 3 models)
- POST /charges (create)
- GET /charges (list)
- PATCH /charges/:id (update)
- DELETE /charges/:id (soft delete)
- POST /payments (submit payment)
- GET /payments (list + review)
- PATCH /payments/:id (approve/reject)
- POST /allocations (allocate payment to charges)
- GET /allocations (list)
- GET /summary (KPIs)
- GET /ledger (transaction history)
- ... (15 total)

### Frontend Stories - 45pts

**FS1.1 Finance API Integration** | 5pts | Must-have
```
As a Developer,
I want a complete LeadsFinanceService wrapping all 15 backend endpoints,
So that components don't depend on raw HTTP calls.

DoD:
- ✅ All 15 endpoints wrapped in TypeScript
- ✅ Type-safe responses (FinanceCharge, FinancePayment, etc.)
- ✅ Error handling with user-friendly messages
- ✅ Unit tests for all methods (>80% coverage)
- ✅ No TypeScript errors
```

**FS1.2 Finance Summary Dashboard** | 5pts | Must-have
```
As a Tenant Admin,
I want to see KPI cards (total charges, paid, pending, delinquent),
So I can quickly understand financial status.

DoD:
- ✅ Component renders 4 KPI cards (responsive)
- ✅ Cards show current month + YTD comparison
- ✅ Color coding: green (paid), orange (pending), red (overdue)
- ✅ useFinanceSummary hook fetches data on mount
- ✅ Loading skeleton + error handling
```

**FS1.3 Charges Table with Filtering** | 8pts | Must-have
```
As a Tenant Admin,
I want to view all charges in a table with filters (status, unit, date range),
So I can analyze billing history.

DoD:
- ✅ Table columns: Unit, Charge ID, Amount, Type, Status, DueDate, PaidDate
- ✅ Filters: Status, Unit, DateRange (start-end)
- ✅ Sorting: Click headers to sort
- ✅ Pagination: 25/50/100 per page
- ✅ Export button (CSV)
```

**FS1.4 Payment Submission Modal** | 8pts | Must-have
```
As a Tenant Admin,
I want to submit payment for multiple charges at once,
So I can settle accounts efficiently.

DoD:
- ✅ Modal lists unpaid charges with checkboxes
- ✅ Calculate total when checked
- ✅ Form: Amount, PaymentMethod (TRANSFER/CASH/CARD/ONLINE)
- ✅ Submit creates payment via API
- ✅ Toast notification on success/error
```

**FS1.5 Payment Review Queue** | 8pts | Must-have
```
As a SUPER_ADMIN,
I want to see pending payments waiting for approval,
So I can process them quickly.

DoD:
- ✅ Page: /admin/payments/review
- ✅ Table: Submitted payments (tenant, amount, date, status)
- ✅ Quick approve/reject buttons
- ✅ Bulk actions (approve 5+ at once)
- ✅ Audit log shows approval history
```

**FS1.6 Allocation & Reconciliation UI** | 8pts | Must-have
```
As a Tenant Admin,
I want to allocate payments to specific charges manually,
So I can handle partial/split payments.

DoD:
- ✅ Payment detail modal shows "Allocate" button
- ✅ Modal lists outstanding charges
- ✅ Drag-and-drop or input to split payment
- ✅ Submit allocation via API
- ✅ Charge status auto-updates (PARTIAL → PAID)
```

**FS1.7 Payment Export & Reporting** | 3pts | Nice-to-have
```
As a Tenant Admin,
I want to export charge/payment history as PDF,
So I can send to accountants.

DoD:
- ✅ Export button on charges/payments table
- ✅ Generates PDF with summary + itemized list
- ✅ Includes totals and date range
```

---

## E2: Resident Portal - 50 Story Points

**RP2.1 Resident Dashboard (Landing)** | 8pts | Must-have
```
As a Resident,
I want to see my key info (unit, lease dates, pending actions),
So I know my status at a glance.

DoD:
- ✅ Page: /{tenantId}/dashboard
- ✅ Cards: MyUnit, NextPaymentDue, OpenTickets, Inbox
- ✅ Quick actions: Pay Now, Submit Ticket, Contact Admin
- ✅ Mobile responsive (1 col mobile, 2 col desktop)
- ✅ Real-time data fetch on mount
```

**RP2.2 My Unit Details** | 5pts | Must-have
```
As a Resident,
I want to see full details of my unit (address, lease term, occupants),
So I have reference information.

DoD:
- ✅ Component: Unit address, size, lease dates, occupants
- ✅ Lease document download link (if available)
- ✅ Contact building admin button
```

**RP2.3 My Payments View** | 8pts | Must-have
```
As a Resident,
I want to view my charges and payment history,
So I can track what I owe.

DoD:
- ✅ Page: /{tenantId}/payments
- ✅ Table: DueDate, Amount, Status, PaymentDate
- ✅ Filter by: Status (All/Due/Overdue/Paid), Month
- ✅ Pay Now button per charge or bulk
- ✅ Receipt download link for paid charges
```

**RP2.4 Online Payment (Stripe Integration)** | 13pts | Must-have
```
As a Resident,
I want to pay charges via credit card,
So I can settle accounts online.

DoD:
- ✅ Stripe Checkout integration
- ✅ Modal: Card details, confirm amount, submit
- ✅ Server-side webhook: Confirm payment status
- ✅ Database: Record payment method + transaction ID
- ✅ Email receipt to resident
- ✅ Error handling (card declined, etc.)
- ✅ PCI compliance (no card data in DB)
```

**RP2.5 My Tickets (Submit & Track)** | 8pts | Must-have
```
As a Resident,
I want to submit maintenance requests and track status,
So I can resolve issues.

DoD:
- ✅ Page: /{tenantId}/my-tickets
- ✅ Form: Title, Description, Category (select)
- ✅ Submit creates ticket with resident as creator
- ✅ Table: Status, Priority, CreatedDate, UpdatedDate
- ✅ Click ticket to see detail + comments
```

**RP2.6 Inbox & Communications** | 5pts | Must-have
```
As a Resident,
I want to receive messages from admin/property manager,
So I stay informed about building news.

DoD:
- ✅ Page: /{tenantId}/inbox
- ✅ List messages (admin broadcast + direct)
- ✅ Mark as read/unread
- ✅ Reply to direct messages
- ✅ Notification badge on navigation
```

**RP2.7 My Profile** | 3pts | Must-have
```
As a Resident,
I want to update contact info (email, phone),
So admin can reach me.

DoD:
- ✅ Page: /{tenantId}/profile
- ✅ Form: Email, Phone, Language
- ✅ Save and notify of changes
```

---

## E3: Admin UI Completion - 55 Story Points

**AU3.1 Leads Admin Dashboard** | 8pts | Must-have
```
As a SUPER_ADMIN,
I want to view all leads (list/filter/search),
So I can manage the sales pipeline.

DoD:
- ✅ Page: /admin/leads
- ✅ Table: Name, Email, Type, Source, Status, CreatedDate
- ✅ Filters: Status, Source, DateRange
- ✅ Search by email/name
- ✅ Pagination
```

**AU3.2 Lead Detail & Convert UI** | 8pts | Must-have
```
As a SUPER_ADMIN,
I want to view lead details and convert to customer,
So I can onboard new tenants easily.

DoD:
- ✅ Page: /admin/leads/:id
- ✅ Show all lead fields + notes
- ✅ Convert button → Modal (confirm tenant details)
- ✅ Submit converts lead → creates tenant
- ✅ Redirect to new tenant dashboard on success
```

**AU3.3 Communications Admin UI** | 8pts | Must-have
```
As a Tenant Admin,
I want to send broadcasts/messages to residents,
So I can communicate updates.

DoD:
- ✅ Page: /{tenantId}/communications/compose
- ✅ Form: Title, Message, Recipients (all/unit/individual)
- ✅ Send creates Communication record
- ✅ Confirm delivery status
```

**AU3.4 Documents/Files Admin** | 8pts | Must-have
```
As a Tenant Admin,
I want to upload and manage documents,
So residents can access building info.

DoD:
- ✅ Page: /{tenantId}/documents
- ✅ Upload form: File + Visibility (Public/Admin Only)
- ✅ Table: Filename, Size, UploaderName, CreatedDate
- ✅ Download link for residents
- ✅ Delete button
```

**AU3.5 Vendors CRUD UI** | 8pts | Must-have
```
As a Tenant Admin,
I want to manage vendors (plumber, electrician, etc.),
So I can track service providers.

DoD:
- ✅ Page: /{tenantId}/vendors
- ✅ Table: Name, Category, Contact, Rating
- ✅ Create/Edit/Delete modals
- ✅ Assign vendors to work orders
```

**AU3.6 Residents/Occupants Assignment** | 8pts | Must-have
```
As a Tenant Admin,
I want to assign residents to units,
So I know who lives where.

DoD:
- ✅ Page: /{tenantId}/residents
- ✅ Table: Unit, ResidentName, Role, AssignedDate
- ✅ Assign button → Select from users or invite new
- ✅ Remove button with confirmation
- ✅ Bulk assign (CSV import)
```

**AU3.7 Admin Settings & Branding** | 7pts | Must-have
```
As a Tenant Admin,
I want to customize tenant branding (logo, colors),
So the portal matches our brand.

DoD:
- ✅ Page: /{tenantId}/settings/branding
- ✅ Form: Logo upload, PrimaryColor, SecondaryColor
- ✅ Preview changes in real-time
- ✅ Save to database
```

---

## E4: Reporting & Analytics - 40 Story Points (P1 - Post-Pilot)

**RP4.1 Finance Dashboard** | 10pts
- Revenue trends (monthly/quarterly)
- Payment rates (on-time, late)
- Delinquency by unit

**RP4.2 Operations Dashboard** | 10pts
- Ticket metrics (open, resolved, avg time)
- Vendor performance (rating, response time)
- Document access logs

**RP4.3 Occupancy Dashboard** | 8pts
- Unit utilization
- Turnover rates
- Lease expiry warnings

**RP4.4 Custom Reports** | 12pts
- Report builder UI
- Export to CSV/PDF
- Scheduled delivery (email)

---

## E5: Documentation - 20 Story Points (Parallel)

**D5.1 Admin User Guide** | 8pts
- How to create buildings/units
- How to manage residents
- How to track finances
- Troubleshooting guide

**D5.2 Resident Portal Guide** | 5pts
- How to pay charges
- How to submit tickets
- How to view documents
- FAQ

**D5.3 Video Tutorials** | 4pts
- Setup video (5 min)
- Finance workflow (3 min)
- Resident portal tour (3 min)

**D5.4 In-App Help** | 3pts
- Tooltips on complex fields
- Help icons with explanations

---

## E6: Lead Extensions - 25 Story Points (P1 - Post-Pilot)

**LE6.1 Slack Integration** | 8pts
- New lead notifications
- Conversion alerts
- Lead status webhooks

**LE6.2 Lead Routing Rules** | 12pts
- Auto-qualify TRIAL leads
- Route to sales if > 100 units
- Priority assignment

**LE6.3 Lead Scoring** | 5pts
- Quality score calculation
- Scoring UI in admin

---

## E7: Demo & Deployment - 30 Story Points

**DE7.1 Docker Compose for Local Dev** | 8pts | Must-have
```
As a Developer,
I want to run full stack locally with one command,
So I can develop without infrastructure setup.

DoD:
- ✅ docker-compose.yml with API, Web, DB, Redis
- ✅ One-liner to start: docker-compose up
- ✅ Seed data auto-loaded
- ✅ Volumes mounted for live code reloading
```

**DE7.2 Staging Environment** | 8pts | Must-have
```
As DevOps,
I want a staging env that mirrors production,
So we can test before deploying to customers.

DoD:
- ✅ Staging URL accessible (staging.buildingos.com)
- ✅ Same DB schema as prod
- ✅ Demo data for testing
- ✅ CI/CD auto-deploys on commit to staging branch
```

**DE7.3 Production Deployment Playbook** | 8pts | Must-have
```
As DevOps,
I want clear steps to deploy to production,
So deployment is reliable and repeatable.

DoD:
- ✅ AWS/Heroku/DigitalOcean setup guide
- ✅ Database migration procedure
- ✅ Rollback procedure
- ✅ Monitoring dashboard setup
```

**DE7.4 Monitoring & Alerts** | 6pts | Must-have
```
As DevOps,
I want real-time alerts for production issues,
So I can respond quickly to outages.

DoD:
- ✅ Sentry integration for errors
- ✅ Uptime monitoring (StatusPage)
- ✅ Performance alerts (API response time)
- ✅ Database alerts (disk space, connections)
```

---

## E8: Performance & Reliability - 35 Story Points

**PR8.1 Database Query Optimization** | 10pts | Must-have
```
As Backend Engineer,
I want to identify and fix N+1 queries,
So API response time is < 500ms p95.

DoD:
- ✅ Profile all endpoints with load tool
- ✅ Add database indexes where needed
- ✅ Cache frequently accessed data (Redis)
- ✅ Pagination on large tables
```

**PR8.2 Frontend Performance** | 8pts | Must-have
```
As Frontend Engineer,
I want Lighthouse score > 85,
So users have fast, smooth experience.

DoD:
- ✅ Run Lighthouse audit on all main pages
- ✅ Minify CSS/JS bundles
- ✅ Code splitting for large pages
- ✅ Image optimization (WebP)
- ✅ Lighthouse score > 85
```

**PR8.3 Load Testing** | 10pts | Must-have
```
As QA Engineer,
I want to verify the system handles 1000 concurrent users,
So we're confident about pilot capacity.

DoD:
- ✅ Create load test scenarios (k6 or similar)
- ✅ Simulate 100 → 500 → 1000 concurrent users
- ✅ Monitor API response time, error rates
- ✅ Document findings and any optimizations needed
```

**PR8.4 Caching Strategy** | 7pts | Must-have
```
As Backend Engineer,
I want to implement Redis caching,
So frequently accessed data is fast.

DoD:
- ✅ Cache: User sessions, tenant config, billing plans
- ✅ Cache TTL: 1h for static, 15m for dynamic
- ✅ Invalidation: Cache cleared on updates
```

---

## Backlog Statistics

| Epic | Total Stories | Must-Have | Nice-to-Have | Story Points |
|------|---------------|-----------|--------------|--------------|
| E1: Finance UI | 7 | 6 | 1 | 45 |
| E2: Resident Portal | 7 | 7 | 0 | 50 |
| E3: Admin UI | 7 | 7 | 0 | 55 |
| E4: Reporting | 4 | 0 | 4 | 40 |
| E5: Documentation | 4 | 2 | 2 | 20 |
| E6: Lead Extensions | 3 | 0 | 3 | 25 |
| E7: Demo/Deploy | 4 | 3 | 1 | 30 |
| E8: Performance | 4 | 4 | 0 | 35 |
| **TOTAL** | **40** | **29** | **11** | **300** |

**Pilot Ready Capacity**: 200 points (E0+E1+E2+E3+E7+E8 must-have)
**Post-Pilot Optional**: 100 points (E4+E6+E5 nice-to-have)

---

## Prioritization Rules

1. **All E0 + E1 + E2 + E3 must be DONE before Pilot** (blocking)
2. **E7 + E8 can be done in parallel** (doesn't block features)
3. **E4 + E6 deferred until after Pilot feedback**
4. **E5 documentation done throughout** (don't wait until end)

---

## How to Use This Backlog

1. **Sprint Planning**: Pick E1.1, E3.1, E2.1, E8.1 (40pts) for Sprint N
2. **Velocity Tracking**: Points completed = Velocity
3. **Dependencies**: Check "Depends on" before picking story
4. **DoD Verification**: All DoD items must be ✅ before story is DONE

