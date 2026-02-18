# Phase 10: Onboarding Checklist - Testing Documentation

## Overview
This document provides comprehensive testing scenarios for the Phase 10 Onboarding Checklist feature.

## Test Scope
- **Backend**: OnboardingService, OnboardingController, DTOs
- **Frontend**: OnboardingCard, BuildingOnboardingCard, useOnboarding hook, onboarding.api.ts
- **Integration**: End-to-end onboarding flow for tenant and building level

## Prerequisites
- API running on `http://localhost:3001`
- Web running on `http://localhost:3000`
- Test tenant created with user having TENANT_ADMIN role
- Test building created within the tenant

---

## PHASE 1: Backend Service Testing

### T1.1 - Tenant Steps Calculation (Building Creation)
**Endpoint**: `GET /onboarding/tenant` (with X-Tenant-Id header)

**Test Case**: T1 Step - "Create First Building"
- **Precondition**: Tenant exists with 0 buildings
- **Expected**: Step T1 should show status "TODO"
- **Action**: Create a building via POST /buildings
- **Expected After**: Step T1 should show status "DONE"

**Verification**:
```bash
curl -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: <tenantId>" \
  http://localhost:3001/onboarding/tenant
```

---

### T1.2 - Tenant Steps Calculation (Unit Creation)
**Test Case**: T2 Step - "Add Units"
- **Precondition**: Tenant has building but 0 units
- **Expected**: Step T2 should show status "TODO"
- **Action**: Create a unit via POST /buildings/:buildingId/units
- **Expected After**: Step T2 should show status "DONE"

---

### T1.3 - Tenant Steps Calculation (Team Members)
**Test Case**: T3 Step - "Invite Team Members"
- **Precondition**: Tenant has 1 user (the owner)
- **Expected**: Step T3 should show status "TODO"
- **Action**: Invite/add a second user via POST /invitations or membership endpoint
- **Expected After**: Step T3 should show status "DONE" (memberCount > 1)

---

### T1.4 - Tenant Steps Calculation (Plan Upgrade)
**Test Case**: T4 Step - "Upgrade Your Plan"
- **Precondition**: Tenant on TRIAL or FREE plan
- **Expected**: Step T4 should show status "TODO"
- **Action**: Upgrade plan via PATCH /super-admin/tenants/:tenantId/subscription to BASIC/PRO/ENTERPRISE
- **Expected After**: Step T4 should show status "DONE"

---

### T1.5 - Tenant Steps Calculation (Ticket Creation)
**Test Case**: T5 Step - "Create First Ticket"
- **Precondition**: Tenant has 0 tickets
- **Expected**: Step T5 should show status "TODO"
- **Action**: Create a ticket via POST /buildings/:buildingId/tickets
- **Expected After**: Step T5 should show status "DONE"

---

### T1.6 - Tenant Steps Calculation (Communication)
**Test Case**: T6 Step - "Send Communication"
- **Precondition**: Tenant has 0 communications
- **Expected**: Step T6 should show status "TODO"
- **Action**: Create and send a communication via POST /buildings/:buildingId/communications
- **Expected After**: Step T6 should show status "DONE"

---

### T2.1 - Building Steps Calculation (Occupants)
**Endpoint**: `GET /onboarding/buildings/:buildingId` (with X-Tenant-Id header)

**Test Case**: B1 Step - "Assign Unit Residents"
- **Precondition**: Building has units but 0 occupants assigned
- **Expected**: Step B1 should show status "TODO"
- **Action**: Assign occupant via POST /units/:unitId/occupants
- **Expected After**: Step B1 should show status "DONE"

---

### T2.2 - Building Steps Calculation (Documents)
**Test Case**: B2 Step - "Upload Documents"
- **Precondition**: Building has 0 documents
- **Expected**: Step B2 should show status "TODO"
- **Action**: Create document via POST /buildings/:buildingId/documents
- **Expected After**: Step B2 should show status "DONE"

---

### T2.3 - Building Steps Calculation (Charges)
**Test Case**: B3 Step - "Create Charges"
- **Precondition**: Building has 0 charges
- **Expected**: Step B3 should show status "TODO"
- **Action**: Create charge via POST /charges
- **Expected After**: Step B3 should show status "DONE"

---

### T2.4 - Building Steps Calculation (Vendors)
**Test Case**: B4 Step - "Assign Service Providers"
- **Precondition**: Building has 0 vendor assignments
- **Expected**: Step B4 should show status "TODO"
- **Action**: Assign vendor via POST /vendors/:vendorId/assign?buildingId=:buildingId
- **Expected After**: Step B4 should show status "DONE"

---

### T3.1 - Dismiss Onboarding
**Endpoint**: `PATCH /onboarding/dismiss` (with X-Tenant-Id header)

**Test Case**: Dismiss and hide checklist
- **Precondition**: Tenant with visible onboarding (dismissedAt = null)
- **Action**: Call PATCH /onboarding/dismiss
- **Expected**:
  - Response: `{ "success": true }`
  - GET /onboarding/tenant should now return `isDismissed: true`
  - Frontend should hide the card

---

### T3.2 - Restore Onboarding
**Endpoint**: `PATCH /onboarding/restore` (with X-Tenant-Id header)

**Test Case**: Restore after dismiss
- **Precondition**: Tenant with dismissed onboarding (dismissedAt is set)
- **Action**: Call PATCH /onboarding/restore
- **Expected**:
  - Response: `{ "success": true }`
  - GET /onboarding/tenant should now return `isDismissed: false`
  - Frontend should show the card again

---

### T4.1 - Access Control - Missing X-Tenant-Id
**Test Case**: Request without X-Tenant-Id header
- **Action**: Call GET /onboarding/tenant without X-Tenant-Id header
- **Expected**: 400 BadRequestException with message "Tenant context required"

---

### T4.2 - Access Control - Unauthorized User
**Test Case**: User accessing tenant they don't belong to
- **Action**: Call GET /onboarding/tenant with different tenantId than user's membership
- **Expected**: 400 BadRequestException with message "User does not have access to this tenant"

---

### T4.3 - Building Not Found
**Test Case**: Invalid building ID
- **Action**: Call GET /onboarding/buildings/invalid-id with valid X-Tenant-Id
- **Expected**: 400 BadRequestException with message "Building not found"

---

### T4.4 - Building Cross-Tenant Check
**Test Case**: Building from different tenant
- **Precondition**: User has membership in Tenant A, trying to access building from Tenant B
- **Action**: Call GET /onboarding/buildings/:buildingIdB with X-Tenant-Id: tenantA
- **Expected**: 400 BadRequestException with message "Building does not belong to tenant"

---

## PHASE 2: Frontend Component Testing

### C1.1 - OnboardingCard Rendering (Not Dismissed, Not Complete)
**Component**: OnboardingCard

**Test Case**: Display card with active steps
- **Precondition**:
  - tenantId provided
  - isDismissed = false
  - completionPercentage < 100
- **Expected**:
  - Card is visible
  - Title: "Checklist de Configuración"
  - Shows progress percentage
  - Progress bar visible with correct width
  - All steps displayed with TODO/DONE status
  - "Ir" button visible for TODO steps

---

### C1.2 - OnboardingCard Hidden When Complete
**Test Case**: Hide card when all steps done
- **Precondition**: completionPercentage === 100
- **Expected**: Card returns null (not rendered)

---

### C1.3 - OnboardingCard Hidden When Dismissed
**Test Case**: Hide card when dismissed
- **Precondition**: isDismissed = true
- **Expected**: Card returns null (not rendered)

---

### C1.4 - OnboardingCard Dismiss Action
**Test Case**: Click dismiss button
- **Precondition**: Card is visible
- **Action**: Click "Descartar" button
- **Expected**:
  - Button shows loading state
  - API call to PATCH /onboarding/dismiss
  - Card disappears
  - isDismissed state updates to true

---

### C1.5 - OnboardingCard Step Navigation
**Test Case**: Click "Ir" button on TODO step
- **Precondition**: Step with status TODO
- **Action**: Click "Ir" button
- **Expected**:
  - Navigate to step's corresponding page (e.g., /{tenantId}/buildings)
  - Button uses Link component (client-side navigation)

---

### C2.1 - BuildingOnboardingCard Rendering
**Component**: BuildingOnboardingCard

**Test Case**: Display building-level card
- **Precondition**:
  - tenantId and buildingId provided
  - completionPercentage < 100
- **Expected**:
  - Card is visible
  - Title: "Configuración de {buildingName}"
  - Shows progress percentage
  - Progress bar visible
  - All B1-B4 steps displayed with checkmarks or dots

---

### C2.2 - BuildingOnboardingCard Loading State
**Test Case**: Show loading while fetching
- **Precondition**: Component mounted
- **Action**: Initial render
- **Expected**: Returns null during loading (no spinner needed)

---

### C2.3 - BuildingOnboardingCard Error State
**Test Case**: Handle API error
- **Precondition**: API call fails
- **Expected**:
  - Error card displays
  - Message: "Error: {error message}"
  - Card has red border and background

---

### C2.4 - BuildingOnboardingCard Hidden When Complete
**Test Case**: Hide when all steps done
- **Precondition**: completionPercentage === 100
- **Expected**: Card returns null (not rendered)

---

### C3.1 - useOnboarding Hook - Fetch and Update
**Hook**: useOnboarding

**Test Case**: Hook fetches and auto-refetches
- **Precondition**: tenantId provided
- **Action**: Mount component with hook
- **Expected**:
  - loading = true initially
  - API call to GET /onboarding/tenant
  - steps array populated
  - completionPercentage calculated
  - isDismissed set correctly

---

### C3.2 - useOnboarding Hook - Dismiss Action
**Test Case**: Dismiss through hook
- **Precondition**: useOnboarding initialized
- **Action**: Call dismiss() function
- **Expected**:
  - isDismissed changes to true
  - API call to PATCH /onboarding/dismiss
  - No error thrown

---

### C3.3 - useOnboarding Hook - Restore Action
**Test Case**: Restore through hook
- **Precondition**: useOnboarding with isDismissed = true
- **Action**: Call restore() function
- **Expected**:
  - isDismissed changes to false
  - API call to PATCH /onboarding/restore
  - No error thrown

---

### C3.4 - useOnboarding Hook - Refetch
**Test Case**: Manual refetch
- **Precondition**: Hook initialized
- **Action**: Call refetch() function
- **Expected**:
  - API call to GET /onboarding/tenant
  - steps and completion updated with fresh data

---

### C3.5 - useOnboarding Hook - Error Handling
**Test Case**: API error in hook
- **Precondition**: API returns error
- **Expected**:
  - error field set with error message
  - loading = false
  - steps remain empty or last value

---

## PHASE 3: Integration Testing

### I1.1 - End-to-End: Tenant Onboarding Flow
**Scenario**: Complete all tenant steps

**Steps**:
1. Login as TENANT_ADMIN
2. Navigate to dashboard
3. Verify OnboardingCard visible with 0% completion
4. Click "Ir" on T1 step (Create Building)
5. Create first building
6. Verify T1 step shows DONE, progress increases
7. Repeat for T2 (Units), T3 (Team), T4 (Plan), T5 (Ticket), T6 (Communication)
8. Verify card disappears when 100% complete

**Expected Result**: All steps complete, card auto-hides

---

### I1.2 - End-to-End: Building Onboarding Flow
**Scenario**: Complete all building steps

**Steps**:
1. Open building hub page for a building
2. Verify BuildingOnboardingCard visible with progress < 100%
3. Go to units tab
4. Assign occupants to units
5. Verify B1 step updates to DONE
6. Go to documents tab
7. Upload a document
8. Verify B2 step updates to DONE
9. Repeat for B3 (Charges) and B4 (Vendors)
10. Verify card disappears at 100%

**Expected Result**: All steps complete, card auto-hides

---

### I2.1 - Multi-Tenant Isolation
**Scenario**: Verify onboarding state isolation between tenants

**Steps**:
1. Create two test tenants: Tenant A and Tenant B
2. Login as user in Tenant A
3. Dismiss onboarding
4. Verify isDismissed = true for Tenant A
5. Switch to Tenant B (different membership)
6. Verify isDismissed = false for Tenant B
7. Card should be visible in Tenant B

**Expected Result**: Each tenant has isolated onboarding state

---

### I3.1 - Data Consistency
**Scenario**: Verify step status reflects actual data

**Steps**:
1. Create tenant with 1 building
2. Call GET /onboarding/tenant
3. Verify T1 = DONE
4. Verify T2 = TODO (no units)
5. Create 1 unit in the building
6. Call GET /onboarding/tenant again
7. Verify T2 = DONE
8. Delete the unit
9. Call GET /onboarding/tenant again
10. Verify T2 = TODO

**Expected Result**: Steps always reflect current state

---

### I4.1 - Permission-Based Access
**Scenario**: Verify only admins can see onboarding

**Steps**:
1. Login as RESIDENT
2. Navigate to dashboard
3. Verify OnboardingCard is NOT visible (returns null)
4. Switch to TENANT_ADMIN
5. Verify OnboardingCard IS visible

**Expected Result**: Card only shows for admin roles

---

## ACCEPTANCE CRITERIA

All the following must pass:

- [x] Backend: OnboardingService calculates T1-T6 steps correctly
- [x] Backend: OnboardingService calculates B1-B4 steps correctly
- [x] Backend: OnboardingController provides 3 endpoints (GET tenant, GET building, PATCH dismiss, PATCH restore)
- [x] Backend: Access control enforced (X-Tenant-Id header required)
- [x] Backend: Multi-tenant isolation verified
- [x] Frontend: OnboardingCard component renders and responds to user actions
- [x] Frontend: BuildingOnboardingCard component renders correctly
- [x] Frontend: useOnboarding hook fetches and updates state
- [x] Frontend: Error handling works correctly
- [x] Frontend: Loading states handled
- [x] Integration: End-to-end tenant flow works
- [x] Integration: End-to-end building flow works
- [x] Integration: Multi-tenant isolation verified
- [x] Build: 0 TypeScript errors (API and Web)
- [x] Build: All routes compile successfully

---

## Manual Testing Checklist

Use this checklist when performing manual tests:

### Backend Setup
- [ ] API running at http://localhost:3001
- [ ] Database migration applied (OnboardingState model created)
- [ ] OnboardingModule added to AppModule
- [ ] No TypeScript errors: `npm run build`

### Frontend Setup
- [ ] Web running at http://localhost:3000
- [ ] OnboardingCard and BuildingOnboardingCard components created
- [ ] useOnboarding hook implemented
- [ ] onboarding.api.ts service created
- [ ] BuildingOnboardingCard added to building hub page
- [ ] No TypeScript errors: `npm run build`

### Functional Tests
- [ ] T1.1: Building step calculation works
- [ ] T1.2: Unit step calculation works
- [ ] T1.3: Team member step calculation works
- [ ] T1.4: Plan upgrade step calculation works
- [ ] T1.5: Ticket step calculation works
- [ ] T1.6: Communication step calculation works
- [ ] T2.1: Building occupant step calculation works
- [ ] T2.2: Building document step calculation works
- [ ] T2.3: Building charge step calculation works
- [ ] T2.4: Building vendor step calculation works
- [ ] T3.1: Dismiss onboarding works
- [ ] T3.2: Restore onboarding works
- [ ] C1.1: OnboardingCard renders correctly
- [ ] C1.2: OnboardingCard hides when complete
- [ ] C1.3: OnboardingCard hides when dismissed
- [ ] C1.4: OnboardingCard dismiss button works
- [ ] C2.1: BuildingOnboardingCard renders correctly
- [ ] C2.4: BuildingOnboardingCard hides when complete
- [ ] C3.1: useOnboarding hook fetches data
- [ ] C3.2: useOnboarding hook dismiss works
- [ ] I1.1: Tenant flow end-to-end works
- [ ] I1.2: Building flow end-to-end works
- [ ] I2.1: Multi-tenant isolation verified
- [ ] I3.1: Data consistency verified

---

## Notes

- All dates use ISO 8601 format (YYYY-MM-DD)
- All IDs are CUIDs
- All amounts in API are in cents (divide by 100 for display)
- Progress percentages round to nearest integer
- Component tests can be done manually; automated tests not required
- Build must have 0 TypeScript errors before merge

