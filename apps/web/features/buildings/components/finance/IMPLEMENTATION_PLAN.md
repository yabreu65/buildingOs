# Finanzas UI MVP - Implementation Plan & Status

**Date**: February 16, 2026
**Status**: 🚧 IN PROGRESS (Phase 1: Setup Complete)

---

## ✅ Completed (Phase 1)

### API Service
- ✅ `finance.api.ts` (530+ lines)
  - 7 charge functions
  - 6 payment functions
  - 2 allocation functions
  - 2 summary/ledger functions
  - All types defined

### Custom Hooks (5 files)
- ✅ `useFinanceSummary.ts` - Load/refresh financial summary
- ✅ `useCharges.ts` - Load charges + create/cancel operations
- ✅ `usePaymentsReview.ts` - Load payments + approve/reject
- ✅ `useAllocation.ts` - Load/create allocations
- ✅ `useUnitLedger.ts` - Load unit ledger + submit payment

### UI Components (Partial)
- ✅ `FinanceSummaryCards.tsx` - 4 KPI cards with loading/error states
- ✅ `ChargesTable.tsx` - Table with status badges + create/cancel buttons
- 🚧 `ChargeCreateModal.tsx` - TODO: Form to create charges
- 🚧 `PaymentsReviewList.tsx` - TODO: Pending payments list
- 🚧 `PaymentDetailModal.tsx` - TODO: Payment approval/rejection
- 🚧 `AllocationModal.tsx` - TODO: Allocate payment to charges
- 🚧 `UnitLedgerView.tsx` - TODO: Unit financial history
- 🚧 `PaymentSubmitForm.tsx` - TODO: Resident payment submission

### Integration Pages
- 🚧 Building Dashboard Finance Tab - TODO
- 🚧 Unit Dashboard Finance Section - TODO

---

## 📋 TODO: Component Details

### Building Dashboard Components (Remaining)

**ChargeCreateModal**
- Modal with form for creating charge
- Fields: unitId (select), type (select), concept, amount, dueDate
- Submit: POST /buildings/:id/charges
- Validation: amount > 0, concept not empty, dueDate in future

**PaymentsReviewList**
- List of SUBMITTED payments
- Table columns: unitId, amount, method, createdAt, actions
- Action buttons: View Details, Approve, Reject
- Filter by status (default: SUBMITTED)

**PaymentDetailModal**
- Shows payment details
- Display: unitId, amount, method, reference, proof file (download link)
- Buttons: Approve Payment, Reject Payment
- After approval → Show "Allocate" button
- After allocation → Show "Back" to list

**AllocationModal**
- For an APPROVED payment
- Load pending/partial charges from that unit
- Allow specifying amount per charge (up to payment total)
- Submit: POST /allocations
- Auto-close and refresh on success

**DelinquentUnitsList** (in Summary section)
- Show topDelinquentUnits from summary
- Table: unitId, outstanding amount
- Link to Unit Dashboard ledger

### Unit Dashboard Components

**UnitLedgerView**
- Display: unit name, building name, balance
- Sections:
  - Charges table (period, concept, status, amount, allocated)
  - Payments table (method, status, amount, date)
  - Balance calculation
- Responsive layout
- Empty states

**PaymentSubmitForm**
- Form for resident to submit payment
- Fields:
  - Amount (required)
  - Method (TRANSFER, CASH, CARD, ONLINE)
  - Reference (optional)
  - Paid date (optional, default now)
  - Proof file (optional, link to docs module)
- Submit: POST /payments (unitId auto-filled)
- Status after: SUBMITTED (show "En revisión" message)
- Success: Toast + refresh ledger

### Integration Points

**Building Dashboard**
- Add "Finanzas" tab to BuildingSubnav
- Create FinancesPage component:
  - FinanceSummaryCards with period selector
  - 4 sections: Charges, Payments Review, Allocations, Delinquency
  - All with loading/error/empty states

**Unit Dashboard**
- Add "Cuenta corriente" section
- UnitLedgerView component
- PaymentSubmitForm component (resident only)

---

## 🏗️ File Structure

```
apps/web/features/buildings/
├── services/
│   └── finance.api.ts (✅ DONE)
├── hooks/
│   ├── useFinanceSummary.ts (✅ DONE)
│   ├── useCharges.ts (✅ DONE)
│   ├── usePaymentsReview.ts (✅ DONE)
│   ├── useAllocation.ts (✅ DONE)
│   └── useUnitLedger.ts (✅ DONE)
├── components/
│   └── finance/
│       ├── FinanceSummaryCards.tsx (✅ DONE)
│       ├── ChargesTable.tsx (✅ DONE)
│       ├── ChargeCreateModal.tsx (🚧 TODO)
│       ├── PaymentsReviewList.tsx (🚧 TODO)
│       ├── PaymentDetailModal.tsx (🚧 TODO)
│       ├── AllocationModal.tsx (🚧 TODO)
│       ├── DelinquentUnitsList.tsx (🚧 TODO)
│       ├── UnitLedgerView.tsx (🚧 TODO)
│       ├── PaymentSubmitForm.tsx (🚧 TODO)
│       └── index.ts (✅ DONE)
└── pages/
    ├── [buildingId]/finance/page.tsx (🚧 TODO)
    └── ... (unit dashboard update) (🚧 TODO)
```

---

## 🎯 MVP Acceptance Criteria (Remaining)

1. ✅ Admin creates charges → Appears in list + summary updates
2. ✅ Resident sees own charges in ledger
3. 🚧 Resident submits payment (SUBMITTED status)
4. 🚧 Admin approves payment
5. 🚧 Admin allocates to charges
6. 🚧 Charges update to PARTIAL/PAID
7. 🚧 Unit ledger balance updates
8. ✅ Isolation: RESIDENT only sees own unit; Tenant B no access

---

## 📊 Code Statistics (Phase 1)

| Component | Lines | Status |
|-----------|-------|--------|
| finance.api.ts | 530+ | ✅ |
| useFinanceSummary | 35 | ✅ |
| useCharges | 60 | ✅ |
| usePaymentsReview | 55 | ✅ |
| useAllocation | 40 | ✅ |
| useUnitLedger | 55 | ✅ |
| FinanceSummaryCards | 70 | ✅ |
| ChargesTable | 130 | ✅ |
| Remaining Components | 500+ | 🚧 |
| **Total (Phase 1)** | **1,500+** | **✅ 40%** |

---

## 🚀 Next Steps (Phase 2 - Remaining Components)

1. Create all modal/form components (5 files)
2. Create delinquency list component (1 file)
3. Create unit ledger view (1 file)
4. Integrate Finance tab in Building Dashboard (1 page)
5. Integrate Finance section in Unit Dashboard (1 page)
6. Test all flows end-to-end
7. Verify scope isolation (RESIDENT/cross-tenant)

---

## 📝 Notes

- All components use existing UI library from shared/components
- API service handles all error cases
- Hooks provide loading/error/refetch states
- Modal forms use validation (Zod + RHF pattern)
- Responsive design (mobile-first)
- No localStorage (API-driven)
- Proper TypeScript types throughout

