# 🔐 Billing Transfer Security Review

**Date**: Feb 18, 2026
**Status**: 🟡 PARTIAL (70% complete, critical gaps identified)
**Severity**: 🔴 P0 - Missing endpoints block production use

---

## 📋 Executive Summary

The manual payment transfer system (SaaS billing) has **good model separation** but **critical gaps** in:
1. ❌ **Tenant-facing endpoints** (no way for tenants to submit payments)
2. ❌ **proofFileId field** (can't track payment receipts)
3. ❌ **Audit action names** (SAAS_PAYMENT_* not in enum)
4. ⚠️ **No UI** for tenant or admin
5. ⚠️ **No scheduled jobs** for expiration/past-due

**Risk Level**: 🔴 Cannot go to production without fixes

---

## ✅ What's Working Well

### 1. Model Separation ✓
```
✓ PaymentVerification (SaaS payments) - SEPARATE from Payment (building)
✓ Clear fields: tenantId, subscriptionId, status, amount, currency
✓ Proper relationships: FK to tenant + subscription
✓ Timestamps: createdAt, approvedAt, rejectedAt
✓ Admin tracking: approvedByUserId
✓ Metadata: JSON field for extensibility
```

### 2. PaymentVerificationStatus Enum ✓
```prisma
enum PaymentVerificationStatus {
  PENDING      // Waiting for admin approval
  APPROVED     // Payment received & verified
  REJECTED     // Payment rejected by admin
}
```
✓ Correct 3-state flow
✓ No ambiguous states

### 3. Admin Controller ✓
```
✓ GET /admin/payments - list pending
✓ GET /admin/payments/:id - get details
✓ POST /admin/payments/:id/approve - approve payment
✓ POST /admin/payments/:id/reject - reject payment
✓ SuperAdminGuard enforced (JWT + SuperAdminGuard)
✓ Idempotency check: Cannot approve twice (409 BadRequestException)
```

### 4. PaymentService Logic ✓
```typescript
✓ approvePayment():
  - Marks payment APPROVED
  - Calls SubscriptionService.transitionTrialToActive() OR transitionPastDueToActive()
  - Sets currentPeriodEnd = now + 30 days
  - Audits PAYMENT_APPROVE

✓ rejectPayment():
  - Marks payment REJECTED with reason
  - Does NOT change subscription (stays TRIAL/PAST_DUE)
  - Audits PAYMENT_REJECT
```

### 5. SubscriptionService Transitions ✓
```typescript
✓ transitionTrialToActive():
  - status TRIAL → ACTIVE
  - sets currentPeriodStart = now
  - sets currentPeriodEnd = now + 30 days

✓ transitionPastDueToActive():
  - status PAST_DUE → ACTIVE
  - renews currentPeriodEnd

✓ Audit logging on all transitions
```

### 6. Separation of Concerns ✓
```
✓ Payment (model): buildingId required → Building scope
✓ PaymentVerification (model): subscriptionId required → SaaS scope
✓ Payment.tenantId is indirect (through building.tenantId)
✓ PaymentVerification.tenantId is direct (PK validation)
✓ No shared table, no model confusion
```

### 7. Multi-Tenant Isolation (partial) ✓
```
✓ PaymentVerification.tenantId enforced as FK
✓ Admin controller validates:
  - SuperAdminGuard (only SUPER_ADMIN can list/approve/reject)
  - No tenant filtering (admin sees all tenants' pending payments)

⚠️ NO validation that tenantId from payment matches requester (but admin is SUPER_ADMIN, so OK)
```

### 8. Enforcement in Writes ✓
```
✓ PlanEntitlementsService.validateSubscriptionStatus():
  - Blocks writes if status in (PAST_DUE, CANCELED, EXPIRED)
  - Used in: buildings, units, occupants, tickets, comms, docs, finance, vendors
  - Throws: BadRequestException with clear message
```

---

## ❌ Critical Gaps (Blocking Production)

### 1. ❌ TENANT ENDPOINTS MISSING (P0 - BLOCKING)
**Impact**: Tenants cannot submit payment proofs.

**What's needed**:
```typescript
// TenantBillingController (NEW)
@Controller('tenants/:tenantId/billing')
@UseGuards(JwtAuthGuard, TenantAccessGuard)

@Get('subscription')
  async getSubscriptionStatus(@Param tenantId)
  → { status, trialEndsAt, currentPeriodEnd, pastDueDays, paymentDetails }

@Get('payments')
  async getPaymentHistory(@Param tenantId)
  → [ { id, status, amount, approvedAt, rejectedReason } ]

@Post('payments/submit')
  async submitPayment(@Param tenantId, @Body() dto)
  dto: { amount, currency, reference?, proofFileId? }
  → { id, status, reference }
```

**Validation required**:
```typescript
- tenantId from request must match JWT membership
- only TRIAL or PAST_DUE subscriptions can submit
- amount must match subscription's plan cost
- if proofFileId: validate belongs to tenantId (security!)
```

### 2. ❌ PROOF FILE SUPPORT MISSING (P0)
**Current**: reference field only (no file upload tracking)
**Problem**: Cannot track receipts/screenshots of bank transfers

**What's needed**:
```prisma
model PaymentVerification {
  // Add field:
  proofFileId    String?    // FK to File (optional)
  file           File?      @relation(fields: [proofFileId], references: [id])

  // Constraint: proofFileId.tenantId must = PaymentVerification.tenantId
  // (Add in service validation)
}
```

**Validation**:
```typescript
if (proofFileId) {
  const file = await prisma.file.findUnique({ where: { id: proofFileId } });
  if (!file || file.tenantId !== tenantId) {
    throw new NotFoundException(); // Don't leak if exists but different tenant
  }
}
```

### 3. ⚠️ AUDIT ACTIONS NOT IN ENUM (P0)
**Current**: Using AuditAction.PAYMENT_APPROVE (from finanzas)
**Problem**: Could cause confusion; should be SaaS-specific

**What's needed**:
```prisma
enum AuditAction {
  // ... existing
  SAAS_PAYMENT_SUBMITTED      // Tenant submits transfer proof
  SAAS_PAYMENT_APPROVED       // Admin approves
  SAAS_PAYMENT_REJECTED       // Admin rejects
  SUBSCRIPTION_ACTIVATED      // When approval transitions to ACTIVE
}
```

### 4. ⚠️ NO SCHEDULED JOBS (P1)
**Current**: No daily sweep for expiration/past-due transitions
**Problem**: TRIAL subscriptions can never expire; ACTIVE never becomes PAST_DUE

**What's needed**:
```typescript
// ScheduledJobsService (or in SubscriptionService)
@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
async checkSubscriptionExpirations() {
  // Find TRIAL where trialEndsAt < now → mark EXPIRED
  // Find ACTIVE where currentPeriodEnd < now without recent payment → PAST_DUE
  // Find PAST_DUE for 30+ days → CANCELED
  // Log audit events for each
}
```

### 5. ⚠️ NO TENANT UI (P1)
**Current**: No interface for tenants to:
- View subscription status
- See payment instructions
- Submit payment proof
- Check payment history

**What's needed**:
```
/tenant/[tenantId]/billing/
├─ status card: subscription state, trial ends, period dates
├─ payment section:
│  ├─ instructions (bank details)
│  ├─ reference code to use
│  └─ "Upload Receipt" button → file upload
├─ history table: past payments (submitted/approved/rejected)
└─ notification: if PAST_DUE, show banner + action CTA
```

### 6. ⚠️ NO ADMIN DASHBOARD (P1)
**Current**: Endpoints exist but no UI
**What's needed**:
```
/super-admin/billing/
├─ pending payments table
│  ├─ tenant name
│  ├─ amount, currency
│  ├─ submitted at, days pending
│  ├─ reference, proof file link
│  └─ [Approve] [Reject] buttons
├─ approve modal: confirm + optional note
├─ reject modal: required reason text
├─ history tab: approved/rejected payments (pastSearchable by: tenant, date range, status
```

### 7. ⚠️ METHOD FIELD NOT STORED (P2)
**Current**: No way to distinguish between payment methods
**What's needed**:
```prisma
enum SaaSPaymentMethod {
  TRANSFER     // Bank transfer (current)
  CARD         // Credit card (future)
  CRYPTO       // Crypto (future)
}

model PaymentVerification {
  method    SaaSPaymentMethod  @default(TRANSFER)
}
```

---

## 🔍 Security Deep Dive

### Multi-Tenant Isolation: ✅ GOOD
```
✓ PaymentVerification.tenantId is FK (cannot be null)
✓ SubscriptionService validates tenantId in FK relations
✓ Admin controller lists all tenants (OK, super admin only)
✓ Risk: LOW - No cross-tenant data leakage visible
```

### Idempotency: ✅ GOOD
```
✓ approvePayment checks: status !== PENDING → 409
✓ rejectPayment checks: status !== PENDING → 409
✓ No double-approval risk
```

### File Security: ⚠️ NEEDS FIX
```
✗ No proofFileId field → can't validate file ownership
✗ When implemented: must check file.tenantId === paymentVerification.tenantId
✗ Current: reference field doesn't link to File model
```

### Subscription State Transitions: ✅ GOOD
```
✓ SubscriptionService enforces valid transitions
✓ Only TRIAL or PAST_DUE can go ACTIVE
✓ No bypass path (must go through approvePayment)
✓ Cannot activate without admin approval
```

---

## 📝 Risk Analysis

| Risk | Severity | Current State | Impact |
|------|----------|---------------|--------|
| Tenants can't submit payments | 🔴 P0 | ❌ MISSING | Cannot use system |
| Payment receipts not tracked | 🔴 P0 | ❌ NO FILE | Audit trail incomplete |
| Wrong audit actions | 🟡 P1 | ⚠️ USING FINANZAS | Confusion, hard to audit |
| Cross-tenant file access | 🔴 P0 | ⚠️ IF IMPLEMENTED | File leak if not validated |
| Trial never expires | 🟡 P1 | ⚠️ NO JOBS | Tenants stuck in free tier |
| No admin UI | 🟡 P1 | ❌ MISSING | Admin can't easily manage |
| No tenant UI | 🟡 P1 | ❌ MISSING | UX nightmare for users |

---

## 🛠️ Fix Prioritization

### 🔴 P0 - BLOCKING (Must do before production)

1. **Add proofFileId field to PaymentVerification**
   - Files: `schema.prisma`
   - Effort: 1 hour (field + migration + validation)
   - Risk: LOW
   - Blocker: None

2. **Create TenantBillingController with 3 endpoints**
   - Files: `billing/tenant-billing.controller.ts` (NEW)
   - Effort: 3 hours (controller + DTOs + validation)
   - Risk: MEDIUM (new attack surface)
   - Blocker: #1

3. **Add SAAS_PAYMENT_* audit actions**
   - Files: `schema.prisma`
   - Effort: 30 min
   - Risk: LOW
   - Blocker: None

4. **File ownership validation in PaymentService**
   - Files: `billing/payment.service.ts`
   - Effort: 1 hour
   - Risk: MEDIUM (security critical)
   - Blocker: #1

### 🟡 P1 - IMPORTANT (Week 1 after P0)

5. **Create scheduled job for subscription expirations**
   - Files: `billing/subscription-scheduler.service.ts` (NEW)
   - Effort: 2 hours
   - Risk: MEDIUM (can mark subscriptions as expired)
   - Blocker: None

6. **Build Tenant Billing UI** (`/tenant/billing`)
   - Files: `apps/web/app/tenant/[tenantId]/billing/`
   - Effort: 4 hours
   - Risk: LOW (frontend only)
   - Blocker: #2

7. **Build Admin Billing Dashboard** (`/super-admin/billing`)
   - Files: `apps/web/app/super-admin/billing/`
   - Effort: 4 hours
   - Risk: LOW
   - Blocker: #2

### 🟢 P2 - NICE-TO-HAVE

8. Add METHOD field to PaymentVerification (for future payment methods)
9. Add createdBy field (which tenant user submitted)

---

## ✅ Acceptance Criteria (For Production)

- [ ] P0 fixes 1-4 complete + tested
- [ ] Tenant can submit payment (with proof file)
- [ ] Admin can approve/reject with audit trail
- [ ] approvePayment triggers Subscription transition
- [ ] File ownership validated (cross-tenant test passes)
- [ ] Audit logs show SAAS_PAYMENT_* actions
- [ ] Manual test: Tenant A cannot see Tenant B's payments
- [ ] Manual test: Approve twice → 409 error
- [ ] Manual test: Subscription state changes correctly on approve
- [ ] No TypeScript errors, all routes compile
- [ ] BILLING_TRANSFER_TEST.md passes all 8 scenarios

---

## 📋 Implementation Checklist

### Phase 1: Data Layer (P0, Day 1)
```
- [ ] Add proofFileId: String? to PaymentVerification
- [ ] Run: npx prisma migrate dev --name add_proof_file_to_payment_verification
- [ ] Add SAAS_PAYMENT_SUBMITTED/APPROVED/REJECTED to AuditAction enum
- [ ] Run: npx prisma db push
- [ ] Run: npx prisma generate
```

### Phase 2: Backend Services (P0, Day 1-2)
```
- [ ] Implement TenantBillingController (POST /billing/payments)
- [ ] Add file validation in PaymentService.createPaymentVerification()
- [ ] Update AuditAction usage: PAYMENT_APPROVE → SAAS_PAYMENT_APPROVED
- [ ] Add tests for file ownership validation
- [ ] npm run build (0 errors)
```

### Phase 3: Scheduled Jobs (P1, Day 2-3)
```
- [ ] Create SubscriptionSchedulerService
- [ ] Implement daily expiration check
- [ ] Test: TRIAL > 14 days → EXPIRED
- [ ] Test: ACTIVE > 30 days without payment → PAST_DUE
```

### Phase 4: UI (P1, Day 3-4)
```
- [ ] Build Tenant Billing page (status + history)
- [ ] Build Admin Billing dashboard
- [ ] Wire up approve/reject modals
- [ ] npm run build (0 errors)
```

### Phase 5: Testing (P0, Day 5)
```
- [ ] Manual test: 8 scenarios from BILLING_TRANSFER_TEST.md
- [ ] Integration test: Approval flow end-to-end
- [ ] Security test: Cross-tenant access blocked
- [ ] Audit test: All actions logged correctly
```

---

## 📚 Related Docs

- Current: `apps/api/src/billing/payment.service.ts` (218 lines)
- Current: `apps/api/src/billing/subscription.service.ts` (217 lines)
- Current: `apps/api/src/billing/admin.payment.controller.ts` (81 lines)
- Schema: `apps/api/prisma/schema.prisma` (PaymentVerification model line 484)

---

## 🎯 Recommendation

**GO LIVE STATUS**: 🔴 **NOT READY**

**Why**: Tenants cannot submit payments (no endpoints). Without tenant-facing endpoints, the entire system is blocked.

**Timeline to GO LIVE**: 5 days (with full team focus)
- Day 1: P0 data + backend
- Day 2: P0 services complete
- Day 3: P1 jobs + initial UI
- Day 4: P1 UI complete
- Day 5: Testing + fixes

**Critical Path**: Tenant endpoints > File validation > Audit actions

---

## 📞 Questions for Product

1. Should payment receipts (proofFileId) be optional or required?
2. Should tenants see admin's approval reason if rejected?
3. Should we auto-approve after X hours if no red flags? (No - manual for now)
4. Should we send email notifications on approve/reject?
5. Trial period: 14 days fixed or configurable per plan?

---

**Status**: Ready for implementation
**Last Updated**: Feb 18, 2026
**Owner**: Security Review
