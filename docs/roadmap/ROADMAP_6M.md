# BuildingOS 6-Month Roadmap (Feb 23 - Aug 23, 2026)

**Status**: PLANNING PHASE
**Document Date**: 2026-02-23
**Target**: Pilot-Ready by Jun 23, 2026 (4 months)
**Goal**: From MVP to customer-ready SaaS platform

---

## What is "Pilot Ready"?

**Definition**: A functioning SaaS product suitable for 5-10 paying beta customers in production.

### Mandatory Pilot Ready Criteria

✅ = Already done | ⚠️ = In progress | ❌ = Not started

| Criterion | Status | Epic | Owner |
|-----------|--------|------|-------|
| Core API (auth, buildings, units, finance) | ✅ | - | Done |
| Database (all models, migrations) | ✅ | - | Done |
| Admin dashboard (buildings, units, leads) | ✅ | - | Done |
| Finance MVP (charges, payments) | ✅ Backend + ⚠️ Frontend 40% | E2 | TBD |
| Lead capture → Customer conversion | ✅ | E1 | Done |
| Production observability (logs, traces, health) | ✅ | - | Done |
| Security (auth, rate limiting, audit) | ✅ | - | Done |
| Email notifications | ✅ | - | Done |
| Multi-tenant isolation | ✅ | - | Done |
| Customer-facing UI (dashboard, communications) | ❌ 20% | E3 | TBD |
| Reporting / Basic Analytics | ❌ 0% | E4 | TBD |
| Documentation (API, admin guide, FAQ) | ✅ API Docs + ⚠️ Admin/User Docs | E5 | TBD |
| Demo data + one-click setup | ⚠️ 50% | E7 | TBD |
| Performance optimization | ⚠️ 30% | E8 | TBD |

**Pilot Ready Target**: All items ✅ by Jun 23, 2026

---

## Epic Catalog (Next 6 Months)

### **E0: Leads System (Phase 4) - COMPLETE ✅**
**Priority**: P0 | **Status**: DONE | **Effort**: M | **Risk**: LOW
**Objective**: Marketing lead capture → customer conversion
**Deliverables**: POST /leads/public + admin management + lead-to-tenant conversion
**Outcome**: Sales can capture and onboard customers from website

---

### **E1: Finance UI (Phase 6 Frontend) - IN PROGRESS ⚠️**
**Priority**: P0 | **Status**: 40% | **Effort**: L | **Risk**: MEDIUM | **Depends on**: E3 (UI patterns)
**Objective**: Complete financial dashboard for tenants (charges, payments, allocations)
**Deliverables**:
- ✅ Backend: 15 endpoints + 3 models + business logic
- ⚠️ Frontend: API service done, need: 7 modals + 2 pages + integration
- [ ] Payment review & approval flow
- [ ] Charge detail & dispute workflow
- [ ] Export to CSV/PDF

**Outcome**: Tenants can view and manage finances self-service

**Risks**:
- Complexity of payment state machine
- Multi-currency edge cases
- Reconciliation logic

---

### **E2: Resident Portal - CRITICAL PATH**
**Priority**: P0 | **Status**: 10% | **Effort**: L | **Risk**: MEDIUM
**Objective**: Mobile-first portal for residents (occupants of units)
**Deliverables**:
- [ ] Dashboard: Quick links, upcoming payments, tickets
- [ ] My Unit: Details, occupants, lease info
- [ ] My Payments: View charges, pay online (Stripe integration)
- [ ] My Tickets: Submit & track maintenance requests
- [ ] Inbox: Notifications & communications
- [ ] Profile: Update contact info

**Outcome**: Residents can pay, communicate, and track issues

**Risks**:
- Scope creep (residents want many features)
- Mobile responsiveness across devices
- Payment integration complexity

---

### **E3: Admin UI Completion - CRITICAL PATH**
**Priority**: P0 | **Status**: 30% | **Effort**: L | **Risk**: LOW
**Objective**: Complete admin dashboards for all major features
**Deliverables**:
- ✅ Buildings: CRUD complete
- ✅ Units: CRUD complete
- ✅ Leads: Convert flow done
- [ ] Leads Admin Dashboard: List/filter/convert UI
- ✅ Tickets: Create/manage done
- [ ] Communications: Admin send UI (backend done)
- [ ] Documents: Upload/manage UI (backend done)
- [ ] Vendors: CRUD complete (backend done)
- [ ] Finance: Charge/payment admin (backend done)
- [ ] Residents/Occupants: Assign/remove UI

**Outcome**: Admin has full control over all tenant data

**Dependencies**: None (foundation complete)

---

### **E4: Reporting & Analytics - POST-PILOT**
**Priority**: P1 | **Status**: 0% | **Effort**: L | **Risk**: MEDIUM
**Objective**: Dashboards & reports for decision-making
**Deliverables**:
- [ ] Finance: Revenue, payment rates, delinquency
- [ ] Operations: Ticket trends, vendor performance
- [ ] Occupancy: Unit utilization, turnover rates
- [ ] Communications: Engagement metrics
- [ ] Custom reports (exportable)

**Outcome**: Property managers have data-driven insights

**Note**: POST-PILOT (not required for beta)

---

### **E5: Documentation & Help System - PARALLEL**
**Priority**: P1 | **Status**: 50% | **Effort**: M | **Risk**: LOW
**Objective**: Help customers succeed with BuildingOS
**Deliverables**:
- ✅ API Documentation (LEADS_API_SPEC.md + others)
- [ ] Admin User Guide (5-10 pages)
- [ ] Resident Portal Guide (3-5 pages)
- [ ] FAQ & Troubleshooting
- [ ] Video tutorials (3-5 short videos)
- [ ] In-app help tooltips/onboarding

**Outcome**: Customers can self-serve without support tickets

---

### **E6: Lead Extensions (Slack + Routing)**
**Priority**: P1 | **Status**: 0% | **Effort**: M | **Risk**: LOW | **Depends on**: E0 (leads system)
**Objective**: Enhance lead management for sales team efficiency
**Deliverables**:
- [ ] Slack notifications (real-time alerts)
- [ ] Lead routing (auto-qualify TRIAL vs sales-assisted)
- [ ] Lead scoring (quality ranking)
- [ ] Bulk actions (convert multiple leads)

**Outcome**: Sales team has better tools and visibility

**Note**: Nice-to-have, not blocking Pilot Ready

---

### **E7: Demo & Deployment Infrastructure**
**Priority**: P0 | **Status**: 50% | **Effort**: M | **Risk**: MEDIUM
**Objective**: One-click demo setup and production deployment
**Deliverables**:
- ✅ Seed data (2 demo tenants)
- [ ] Docker Compose for local dev
- [ ] Staging environment ready
- [ ] Deployment playbook (AWS/Heroku/DigitalOcean)
- [ ] Monitoring alerts (PagerDuty integration)
- [ ] Backup/restore procedures

**Outcome**: Customers can deploy + devs can demo easily

---

### **E8: Performance & Reliability**
**Priority**: P1 | **Status**: 30% | **Effort**: M | **Risk**: MEDIUM
**Objective**: Ensure SaaS reliability at scale
**Deliverables**:
- ✅ Health checks (liveness + readiness)
- ✅ Structured logging (Pino + Sentry)
- [ ] Database query optimization (N+1 fixes)
- [ ] API response time < 500ms (p95)
- [ ] Load testing (1000 concurrent users)
- [ ] CDN for static assets
- [ ] Cache strategy (Redis layer)

**Outcome**: Platform handles pilot customer load

---

## Priority Legend

| Priority | Definition | Sprint Allocation |
|----------|-----------|-------------------|
| **P0** | Blocks Pilot Ready | 70% of sprint |
| **P1** | Nice-to-have for Pilot | 20% of sprint |
| **P2** | Post-Pilot / Phase 2+ | 10% of sprint |

---

## Timeline & Milestones

```
Feb 23 - Mar 22  (4 weeks) = Sprint 1-2
├─ Sprint 1: Finance UI (phase 1) + Resident Portal skeleton
├─ Sprint 2: Resident Portal (payments) + Admin UI completion
└─ Milestone: MVP Admin + Resident views working

Mar 23 - Apr 20  (4 weeks) = Sprint 3-4
├─ Sprint 3: Communications UI + Documents UI
├─ Sprint 4: Leads Dashboard UI + Vendor management UI
└─ Milestone: All admin UIs complete

Apr 21 - May 18  (4 weeks) = Sprint 5-6
├─ Sprint 5: Performance optimization + Reporting (basic)
├─ Sprint 6: Documentation + Demo infrastructure
└─ Milestone: Performance targets met + docs ready

May 19 - Jun 23  (5 weeks) = Sprint 7-8 + Buffer
├─ Sprint 7: Bug fixes + QA + Staging deployment
├─ Sprint 8: Load testing + Monitoring setup + Go-live checklist
└─ **Jun 23: PILOT READY ✅**

Jun 24+
├─ Onboard pilot customers
├─ Gather feedback
└─ Plan Phase 2 features
```

---

## Epic Dependency Graph

```
E0 (Leads) ✅
  ↓
E1 (Finance UI) ← Depends on UI patterns in E3
  ↓
E3 (Admin UI)
  ↓
E4 (Reporting) ← Depends on clean data models
  ↓
E5 (Docs) ← Can be done in parallel

E2 (Resident Portal) ← Depends on E1 (Finance)
  ↓
E6 (Lead Extensions) ← Depends on E0
E7 (Demo/Deploy) ← Depends on E3 + E2
E8 (Performance) ← Depends on all systems (parallel)
```

---

## Risk Assessment

| Risk | Impact | Mitigation | Epic |
|------|--------|-----------|------|
| Finance logic complexity | HIGH | Early testing, edge case docs | E1 |
| Resident portal scope creep | HIGH | Strict MVP scope, defer v2 features | E2 |
| Mobile responsiveness issues | MEDIUM | Start mobile-first design, test early | E2/E3 |
| Performance degradation | MEDIUM | Profiling + optimization sprints | E8 |
| Deployment complexity | MEDIUM | Infrastructure as code, staging env | E7 |
| Documentation gaps | LOW | Weekly doc reviews, user testing | E5 |

---

## Success Metrics (Pilot Ready)

| Metric | Target | Owner |
|--------|--------|-------|
| API Uptime | 99.5% | Backend |
| API Response (p95) | < 500ms | Backend/DB |
| Frontend Lighthouse Score | > 85 | Frontend |
| Zero critical security issues | 0 | Security |
| All tests pass | 100% | QA |
| Documentation coverage | > 80% | Product |
| Bug backlog | < 10 critical | QA |

---

## What's NOT in Pilot Ready (Postponed)

❌ **Phase 2 Features** (After Pilot Feedback):
- Mobile app (iOS/Android)
- Advanced analytics & BI
- Integration marketplace (Slack, Zapier, etc.)
- White-label SaaS
- Multi-language support
- Voice/SMS communications
- Computer vision (document OCR)
- AI-powered predictions

---

## Working Agreement

### Definition of Done (All User Stories)
1. Code reviewed + approved
2. Unit tests (>80% coverage)
3. E2E tests pass
4. No TypeScript errors
5. Staging deployment working
6. Documentation updated
7. Product accepted story

### Sprint Cadence
- **2-week sprints** (Tue-Mon)
- Monday 9am: Planning
- Wednesday 2pm: Check-in
- Friday 4pm: Review
- Friday 5pm: Retro

### Velocity Target
- **Sprint Capacity**: 40 story points
- **Ramp-up**: Weeks 1-2 (20pts), then 35-40pts steady

---

## Decision: Proceed with This Roadmap?

**Recommendation**: YES ✅

**Rationale**:
1. Clear path to Pilot Ready in 4 months
2. Prioritizes customer-facing features (E1, E2, E3)
3. Infrastructure investments (E7, E8) in parallel
4. Post-pilot enhancements deferred (E4, E6)
5. Realistic timeline with 2-week buffer

**Questions for Product/Leadership**:
1. Is Jun 23 Pilot Ready date acceptable?
2. Should resident portal be mobile app or responsive web first?
3. Any additional customer requirements for pilot?
4. Budget allocation for infrastructure (hosting, CDN, etc.)?

---

## Document History

| Date | Author | Change |
|------|--------|--------|
| 2026-02-23 | Engineering | Initial 6-month roadmap |

