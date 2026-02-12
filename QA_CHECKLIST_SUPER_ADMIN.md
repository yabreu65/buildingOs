# Phase 5: QA Checklist - SUPER_ADMIN Dashboard

**Version**: MVP v0 | **Date**: 2026-02-11 | **Status**: Ready for QA

## Test Plan Overview

This document outlines 10+ comprehensive test cases for the SUPER_ADMIN Dashboard MVP. Tests are organized into categories:
1. Authentication & Authorization (3 tests)
2. Dashboard Overview (2 tests)
3. Tenant Management - CRUD (4 tests)
4. Tenant Search & Filter (2 tests)
5. Form Validation (2 tests)
6. Component Interactions (2 tests)
7. Storage & Persistence (2 tests)

---

## Category 1: Authentication & Authorization (3 tests)

### Test 1.1: SUPER_ADMIN Role Access Control
**Scenario**: Verify that only users with SUPER_ADMIN role can access the SUPER_ADMIN Dashboard

**Steps**:
1. Open app and navigate to `/super-admin/overview`
2. If not authenticated:
   - Verify browser redirects to `/login`
3. If authenticated but without SUPER_ADMIN role:
   - Verify browser redirects to `/login`
4. If authenticated with SUPER_ADMIN role:
   - Verify dashboard loads
   - Verify sidebar shows "SUPER_ADMIN" label

**Expected Result**: ✅ Only SUPER_ADMIN users can access the dashboard

**Test File**: `__tests__/auth.integration.test.ts` (to create)

---

### Test 1.2: Session Persistence After Page Reload
**Scenario**: Verify user stays logged in after page reload

**Steps**:
1. Login as SUPER_ADMIN user
2. Navigate to `/super-admin/tenants`
3. Refresh page (Cmd+R or F5)
4. Wait for page to load

**Expected Result**: ✅ User stays on `/super-admin/tenants` without being redirected to `/login`

**Verification**: Check browser console for no 401 errors

---

### Test 1.3: Auth Bootstrap Handles Network Errors Gracefully
**Scenario**: App continues working if `/auth/me` fails (network error vs 401)

**Steps**:
1. Login normally and navigate to `/super-admin/tenants`
2. Open DevTools → Network tab
3. Throttle connection to "Offline"
4. Reload page
5. Set throttle back to "Online"

**Expected Result**:
- ✅ Page shows "Cargando..." briefly
- ✅ User sees cached data from localStorage
- ✅ App doesn't fully clear auth on network errors
- ✅ Auth clears only on 401 status

---

## Category 2: Dashboard Overview (2 tests)

### Test 2.1: Overview Page Loads with Demo Data
**Scenario**: Verify overview page displays statistics widgets and demo tenants

**Steps**:
1. Navigate to `/super-admin/overview`
2. Wait for page to load

**Expected Result**: ✅ Page displays 6 metric widgets:
- Total Tenants (should show 3 for demo data)
- Tenants Activos (green color)
- Tenants Trial (blue color)
- Tenants Suspendidos (red color)
- Total Edificios (shows 0 - placeholder)
- Total Unidades (shows 0 - placeholder)

**Verification**:
- Widgets have correct background colors
- Values are visible and readable
- "Crear Tenant" button is clickable
- "Ver Tenants" button is clickable

---

### Test 2.2: Overview Metrics Update After Tenant Changes
**Scenario**: Verify statistics update when tenant status changes

**Steps**:
1. Note current "Tenants Activos" count (should be 1 for demo)
2. Click "Ver Tenants"
3. Find "Condominio Flores" (currently ACTIVE)
4. Click "Suspender" button
5. Return to `/super-admin/overview`

**Expected Result**: ✅ "Tenants Activos" count decreases by 1

---

## Category 3: Tenant Management - CRUD (4 tests)

### Test 3.1: Create Tenant via Wizard
**Scenario**: Create a new tenant using the 3-step wizard

**Steps**:
1. Click "+ Crear Tenant" button
2. **Step 1**:
   - Enter name: "QA Test Tenant"
   - Select type: "ADMINISTRADORA"
   - Click "Siguiente"
3. **Step 2**:
   - Select plan: "BASIC"
   - Enter email: "qa@test.com"
   - Click "Siguiente"
4. **Step 3**:
   - Verify all data is correct
   - Click "Crear Tenant"

**Expected Result**: ✅
- Page shows success message
- Browser redirects to `/super-admin/tenants`
- New tenant appears in list with status "TRIAL"
- Tenant has BASIC plan limits (5 buildings, 50 units, 100 users)

---

### Test 3.2: Update Tenant Status
**Scenario**: Change tenant from TRIAL to ACTIVE

**Steps**:
1. Navigate to `/super-admin/tenants`
2. Find "Acme Corporation" tenant
3. Click "Suspender" button (or "Activar" if already suspended)
4. Verify success message appears

**Expected Result**: ✅
- Tenant status badge changes (green → red or vice versa)
- Button text changes accordingly
- Success message displays for 3 seconds
- Status persists after page reload

---

### Test 3.3: Update Tenant Plan
**Scenario**: Update tenant plan and verify limits recalculate

**Steps**:
1. From tenants list, locate a tenant
2. (Future) Click "Edit" or "Detalles" button
3. Change plan from FREE to PRO
4. Save changes

**Expected Result**: ✅
- Plan updates
- Limits recalculate (20 buildings, 500 units, 500 users)
- Display reflects new plan

**Note**: Edit functionality to be implemented in Phase 5.5

---

### Test 3.4: Delete Tenant
**Scenario**: Remove a tenant from the system

**Steps**:
1. Create a test tenant: "Temporary Tenant"
2. Find tenant in list
3. (Future) Click "Delete" or "Eliminar" button
4. Confirm deletion

**Expected Result**: ✅
- Tenant removed from list
- Cannot find tenant by search
- Global stats update (total count decreases)

**Note**: Delete UI not yet implemented in MVP

---

## Category 4: Tenant Search & Filter (2 tests)

### Test 4.1: Search Tenants by Name
**Scenario**: Find tenants using the search box

**Steps**:
1. Navigate to `/super-admin/tenants`
2. Type "Acme" in search box
3. Observe table updates

**Expected Result**: ✅
- Only "Acme Corporation" displays
- Search is case-insensitive
- Partial matches work (searching "Corp" shows "Acme Corporation")

**Additional Steps**:
- Clear search box
- Verify all 3 demo tenants return

---

### Test 4.2: Filter Tenants by Status
**Scenario**: Filter tenant list by status

**Steps**:
1. Navigate to `/super-admin/tenants`
2. Click status filter dropdown
3. Select "ACTIVE"
4. Observe table updates

**Expected Result**: ✅
- Only active tenants display (1 for demo data)
- Dropdown shows all status options: "Todos los estados", "Activo", "Trial", "Suspendido"

**Additional Steps**:
- Select "Trial" filter
- Verify 2 tenants display
- Select "Todos los estados"
- Verify all 3 tenants return

---

## Category 5: Form Validation (2 tests)

### Test 5.1: Tenant Creation Form Validation
**Scenario**: Verify form validates input before submission

**Steps**:
1. Navigate to `/super-admin/tenants/create`
2. **Test case: Empty name**
   - Leave name empty
   - Try to submit
   - Verify error shows: "El nombre debe tener al menos 2 caracteres"

3. **Test case: Short name**
   - Enter "A" in name
   - Click next or submit
   - Verify same error

4. **Test case: Long name (101 chars)**
   - Enter name with 101+ characters
   - Verify error: "El nombre no puede exceder 100 caracteres"

5. **Test case: Invalid email**
   - Enter email without @
   - Verify error: "Email inválido"

**Expected Result**: ✅ All validation errors display correctly below fields

---

### Test 5.2: Step Navigation in Wizard
**Scenario**: Verify wizard steps work correctly

**Steps**:
1. Navigate to `/super-admin/tenants/create`
2. Verify "Paso 1 de 3" shows
3. Progress bar shows 1 filled segment
4. "Atrás" button is disabled
5. Fill name and select type
6. Click "Siguiente"
7. Verify now shows "Paso 2 de 3"
8. Progress bar shows 2 filled segments
9. "Atrás" button is enabled

**Expected Result**: ✅
- Step counter updates correctly
- Progress bar fills incrementally
- Can navigate forward and backward
- Cannot submit incomplete forms

---

## Category 6: Component Interactions (2 tests)

### Test 6.1: Tenant Actions Buttons Work Correctly
**Scenario**: Verify row action buttons trigger correct operations

**Steps**:
1. Navigate to `/super-admin/tenants`
2. Find "Acme Corporation"
3. Click "Entrar" button
4. Verify browser navigates to `/tenant/[tenantId]/dashboard`

**Expected Result**: ✅
- User enters tenant context
- Active tenant is set in localStorage
- Tenant dashboard loads

---

### Test 6.2: Empty State Messaging
**Scenario**: Verify appropriate message when no tenants exist

**Steps**:
1. Clear all tenants from localStorage (via DevTools)
2. Navigate to `/super-admin/tenants`
3. Observe table area

**Expected Result**: ✅
- Shows message: "Sin tenants registrados"
- "+ Crear Tenant" button is still visible and clickable
- No table headers displayed

---

## Category 7: Storage & Persistence (2 tests)

### Test 7.1: Tenant Data Persists After Page Reload
**Scenario**: Verify tenant data remains after browser reload

**Steps**:
1. Create new tenant: "Persistence Test"
2. Navigate to `/super-admin/tenants`
3. Verify tenant appears in list
4. Press F5 (page reload)
5. Verify tenant still appears

**Expected Result**: ✅ Tenant data survives page reload

**Verification**: Check localStorage (`bo_tenants` key) in DevTools

---

### Test 7.2: Status Changes Persist
**Scenario**: Verify status changes to localStorage

**Steps**:
1. Navigate to `/super-admin/tenants`
2. Note initial status of "Acme Corporation": "TRIAL" (blue badge)
3. Click "Suspender"
4. Verify status changes to "SUSPENDED" (red badge)
5. Open DevTools → Application → LocalStorage
6. Find `bo_tenants` key
7. Reload page
8. Verify status is still "SUSPENDED"

**Expected Result**: ✅
- Status change is immediate in UI
- Status persists in localStorage JSON
- Status survives page reload

---

## Automated Test Files

### Test Files Created
1. **`__tests__/tenants.storage.test.ts`** (32 tests)
   - CRUD operations: create, read, update, delete
   - Search and filtering
   - Validation and limits
   - Statistics calculations

2. **`__tests__/super-admin.utils.test.ts`** (24 tests)
   - Label formatting
   - Date formatting
   - Validation functions
   - Usage calculations
   - Sorting functionality

### To Run Tests
```bash
# If Jest/Vitest is configured:
npm test

# Or specific file:
npm test tenants.storage.test.ts
npm test super-admin.utils.test.ts
```

---

## Browser Testing Checklist

### Desktop (Chrome/Edge/Firefox)
- [ ] All pages load without errors
- [ ] Responsive layout works
- [ ] Forms are interactive
- [ ] Buttons are clickable
- [ ] Search/filter work smoothly

### Mobile (Safari/Chrome Mobile)
- [ ] Dashboard is readable on 375px width
- [ ] Sidebar collapses or hides appropriately
- [ ] Buttons are tap-friendly (44x44px minimum)
- [ ] Forms are usable with mobile keyboard

### Accessibility
- [ ] All interactive elements are keyboard-navigable
- [ ] Form labels are associated with inputs
- [ ] Color is not the only differentiator (status badges have text)
- [ ] Text contrast is adequate

---

## Critical Issues to Watch

🔴 **CRITICAL** (Must fix before release):
- Users can access SUPER_ADMIN dashboard without SUPER_ADMIN role
- Tenant creation fails or doesn't persist
- Page reload clears auth for no reason
- Form submissions show wrong error messages

🟡 **HIGH** (Should fix before release):
- Slow performance loading 100+ tenants
- Search doesn't work case-insensitively
- Page transitions are janky
- Empty states not shown

🟢 **LOW** (Nice to have):
- Animations don't feel smooth
- Font sizes could be adjusted
- Hover states could be more obvious

---

## Sign-Off Template

**QA Tester**: ________________
**Date**: ________________
**Build/Version**: ________________

**Overall Status**: [ ] PASS  [ ] FAIL  [ ] CONDITIONAL

**Issues Found**:
1. ...
2. ...

**Notes**:
```
[Add any additional observations or edge cases found]
```

---

## Next Steps

After QA is complete:
1. ✅ Fix any critical issues
2. ✅ Re-test fixed functionality
3. ✅ Document any limitations
4. ✅ Get sign-off from product team
5. ✅ Proceed to Phase 5.5: Minor Enhancements (if needed)
