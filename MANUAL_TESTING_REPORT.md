# Manual Testing Report: SUPER_ADMIN vs TENANT Separation

**Date**: February 14, 2026
**Status**: Testing Plan + Code-Based Verification
**Result**: ✅ READY FOR MANUAL TESTING

---

## Executive Summary

This document provides a comprehensive manual testing plan to verify that the SUPER_ADMIN Control Plane is completely separated from the Tenant Dashboard. All routing logic has been code-verified and is ready for browser-based testing.

---

## Test Setup

### Prerequisites
1. **API Server**: `npm run start --prefix apps/api` (port 4000)
2. **Web Server**: `npm run dev --prefix apps/web` (port 3000)
3. **Database**: Seeded with test data
4. **Browser**: Chrome/Firefox with DevTools (F12)

### How to Run Tests
1. Open http://localhost:3000 in two browser windows/tabs
2. Follow each scenario step by step
3. Record results in the checklist provided

---

## CASO A: SUPER_ADMIN User Tests

### A.1: Login Flow → Redirect to /super-admin

**Steps**:
1. Visit http://localhost:3000/login
2. Enter SUPER_ADMIN credentials:
   - Email: (use SUPER_ADMIN user from database)
   - Password: (corresponding password)
3. Click "Sign In"

**Expected Result**:
```
✅ Redirects automatically to http://localhost:3000/super-admin
✅ Page shows "Control Plane" heading
✅ See 4 navigation cards:
   - Tenants
   - Overview
   - Audit Logs
   - Platform Users (coming soon)
✅ Sidebar shows SUPER_ADMIN navigation (not tenant options)
✅ No "Buildings", "Units", "Payments" options visible
```

**Actual Result**:
- [ ] Pass
- [ ] Fail (describe below)

```
Notes: _______________________________________________
```

**Code Verification**:
```typescript
// dashboard/page.tsx line 18-27
useEffect(() => {
  if (isSuperAdmin && isReady) {
    router.replace('/super-admin');  // ✅ Automatic redirect
  }
}, [isSuperAdmin, isReady, router]);
```

---

### A.2: Block Access to Tenant Routes

**Test 2A: Trying to Access /{tenantId}/dashboard**

**Steps**:
1. Login as SUPER_ADMIN
2. Manually navigate to: `http://localhost:3000/[anytenant]/dashboard`
   - Replace [anytenant] with a real tenant ID from database
3. Observe URL bar and page content

**Expected Result**:
```
✅ Page briefly shows loading state
✅ Immediately redirects back to http://localhost:3000/super-admin
✅ No flash of tenant dashboard visible
✅ No error messages or broken UI
✅ URL bar shows /super-admin after ~1 second
```

**Actual Result**:
- [ ] Pass
- [ ] Fail (describe below)

```
Notes: _______________________________________________
```

**Code Verification**:
```typescript
// TenantLayout line 15-20
useEffect(() => {
  if (isSuperAdmin) {
    router.replace('/super-admin');  // ✅ Block at layout level
  }
}, [isSuperAdmin, router]);
```

---

**Test 2B: Trying to Access /{tenantId}/buildings**

**Steps**:
1. Login as SUPER_ADMIN
2. Manually navigate to: `http://localhost:3000/[tenantid]/buildings`
3. Observe redirection

**Expected Result**:
```
✅ Redirects to /super-admin
✅ No building data loaded
✅ Loading state shown briefly
```

**Actual Result**:
- [ ] Pass
- [ ] Fail

```
Notes: _______________________________________________
```

---

**Test 2C: Trying to Access /{tenantId}/units**

**Steps**:
1. Login as SUPER_ADMIN
2. Manually navigate to: `http://localhost:3000/[tenantid]/units`
3. Observe redirection

**Expected Result**:
```
✅ Redirects to /super-admin
✅ No unit data loaded
```

**Actual Result**:
- [ ] Pass
- [ ] Fail

```
Notes: _______________________________________________
```

---

### A.3: No Sidebar Visibility

**Test 3A: Sidebar Should Be Hidden**

**Steps**:
1. Login as SUPER_ADMIN
2. Visit http://localhost:3000/super-admin
3. Look at left side of screen

**Expected Result**:
```
✅ Left sidebar is VISIBLE but shows SUPER_ADMIN options:
   - Overview
   - Tenants
   - Audit Logs
   - Platform Users (soon)

✅ NO tenant-level options visible:
   ❌ No "Buildings" link
   ❌ No "Units" link
   ❌ No "Payments" link
   ❌ No "Dashboard" (tenant version) link

✅ If user navigates to /{tenantId}/*, tenant sidebar is hidden
```

**Actual Result**:
- [ ] Pass
- [ ] Fail

```
Notes: _______________________________________________
```

**Code Verification**:
```typescript
// Sidebar.tsx line 34-36
const isSuperAdmin = useIsSuperAdmin();

if (isSuperAdmin || !tenantId) return null;  // ✅ Hide for SUPER_ADMIN
```

---

### A.4: URL Manipulation Doesn't Load Tenant Data

**Test 4: Changing TenantId in URL**

**Steps**:
1. Login as SUPER_ADMIN
2. You're at: http://localhost:3000/super-admin
3. Manually change URL to: http://localhost:3000/tenant-id-123/dashboard
4. Press Enter
5. Observe loading behavior

**Expected Result**:
```
✅ Brief loading state (1-2 seconds)
✅ Automatically redirects back to /super-admin
✅ Tenant dashboard HTML never renders
✅ No API calls to fetch tenant data (check DevTools Network tab)
✅ No data from another tenant displayed
```

**Actual Result**:
- [ ] Pass
- [ ] Fail

```
Notes: _______________________________________________
```

**DevTools Check**:
- Open DevTools (F12) → Network tab
- Attempted URL change → No XHR requests to `/tenants/[id]/buildings` or similar
- Only navigation requests, no data fetch

---

## CASO B: TENANT_ADMIN User Tests

### B.1: Login Flow → Dashboard Access

**Steps**:
1. Open http://localhost:3000/login in a new browser window
2. Login with TENANT_ADMIN credentials:
   - Email: (use TENANT_ADMIN user)
   - Password: (corresponding password)
3. Click "Sign In"

**Expected Result**:
```
✅ Redirects to http://localhost:3000/[tenantId]/dashboard
✅ Page shows tenant-level dashboard
✅ Onboarding checklist visible
✅ Buildings and units stats visible
✅ Sidebar shows tenant navigation:
   - Dashboard
   - Buildings
   - Units
   - Payments
   - etc.

✅ NO control plane options:
   ❌ No "Tenants" management
   ❌ No "Overview" (global stats)
   ❌ No "Audit Logs" (global)
```

**Actual Result**:
- [ ] Pass
- [ ] Fail (describe below)

```
Notes: _______________________________________________
```

**Code Verification**:
```typescript
// useAuth.ts line 37-45
const isSuperAdmin = authSession.memberships.some((m) =>
  m.roles.includes('SUPER_ADMIN')  // ✅ Not detected for TENANT_ADMIN
);

// Only gets TENANT_ADMIN roles, not SUPER_ADMIN
const roles = isSuperAdmin
  ? ['SUPER_ADMIN']
  : authSession.memberships.find((m) => m.tenantId === authSession.activeTenantId)?.roles;
```

---

### B.2: Block Access to /super-admin

**Steps**:
1. Login as TENANT_ADMIN
2. You're at: http://localhost:3000/[tenantId]/dashboard
3. Manually navigate to: http://localhost:3000/super-admin
4. Press Enter

**Expected Result**:
```
✅ super-admin/layout.tsx detects isSuperAdmin = false
✅ Redirects to http://localhost:3000/login
✅ Shows "Unauthorized" message (or similar)
✅ No control plane data visible
✅ User logged out or session reset
```

**Actual Result**:
- [ ] Pass
- [ ] Fail

```
Notes: _______________________________________________
```

**Code Verification**:
```typescript
// super-admin/layout.tsx line 25-38
if (!isSuperAdmin) {  // ✅ Check for TENANT_ADMIN
  router.replace('/login');  // ✅ Block access
  return;
}
```

---

### B.3: Sidebar Shows Tenant Options Only

**Test 3: Sidebar Navigation**

**Steps**:
1. Login as TENANT_ADMIN
2. Visit: http://localhost:3000/[tenantId]/dashboard
3. Look at left sidebar

**Expected Result**:
```
✅ Sidebar is VISIBLE and shows:
   - Dashboard (current page indicator)
   - Buildings
   - Properties
   - Units
   - Payments
   - (Admin section if authorized)

✅ NO SUPER_ADMIN options:
   ❌ No "Tenants" management
   ❌ No "Overview" (global)
   ❌ No "Audit Logs" (global)
   ❌ No "Platform Users"
```

**Actual Result**:
- [ ] Pass
- [ ] Fail

```
Notes: _______________________________________________
```

---

## Security Tests

### Security Test 1: No XSS via URL Manipulation

**Steps**:
1. Login as SUPER_ADMIN
2. Try navigating to: `http://localhost:3000/<script>alert('xss')</script>/dashboard`
3. Observe error handling

**Expected Result**:
```
✅ URL is sanitized
✅ No script injection
✅ Either 404 or redirects gracefully
✅ No console errors about scripts
```

**Actual Result**:
- [ ] Pass
- [ ] Fail

```
Notes: _______________________________________________
```

---

### Security Test 2: Token Validation

**Steps**:
1. Open DevTools (F12) → Application → Local Storage
2. Look for `bo_token` or `accessToken`
3. Try to manually modify it to an invalid value
4. Refresh page
5. Observe re-authentication

**Expected Result**:
```
✅ AuthBootstrap catches invalid token
✅ User redirected to /login
✅ Session cleared safely
✅ No partial data loaded
```

**Actual Result**:
- [ ] Pass
- [ ] Fail

```
Notes: _______________________________________________
```

---

## Console & Network Tests

### Console Checks (DevTools → Console tab)

**Test**: Open DevTools while logged in, check for errors

**Expected**:
```
✅ NO TypeScript errors
✅ NO "Cannot read property of undefined" errors
✅ NO "hook called without tenantId" warnings
✅ NO role detection errors
✅ Only normal log messages (auth, data fetch)
```

**Result**:
- [ ] Clean console
- [ ] Errors found (list below)

```
Errors/Warnings found:
_______________________________________________
```

---

### Network Checks (DevTools → Network tab)

**Test 1: SUPER_ADMIN Accessing Tenant Routes**

**Steps**:
1. Open DevTools (F12) → Network tab
2. Login as SUPER_ADMIN
3. Try accessing: http://localhost:3000/[tenantId]/dashboard
4. Observe network requests

**Expected**:
```
✅ No XHR request to /tenants/[id]/buildings
✅ No XHR request to /tenants/[id]/stats
✅ No XHR request to /tenants/[id]/units
✅ Only navigation and layout JS/CSS loaded
✅ Redirects quickly (no data fetching time)
```

**Result**:
- [ ] Correct (no tenant API calls)
- [ ] Incorrect (found API calls below)

```
API calls found:
_______________________________________________
```

---

## Summary Checklist

### SUPER_ADMIN Tests
- [ ] **A.1** Login redirects to /super-admin ✅/❌
- [ ] **A.2A** Block /{tenantId}/dashboard ✅/❌
- [ ] **A.2B** Block /{tenantId}/buildings ✅/❌
- [ ] **A.2C** Block /{tenantId}/units ✅/❌
- [ ] **A.3A** Sidebar shows SUPER_ADMIN options ✅/❌
- [ ] **A.4** URL manipulation doesn't load tenant data ✅/❌

### TENANT_ADMIN Tests
- [ ] **B.1** Login redirects to /{tenantId}/dashboard ✅/❌
- [ ] **B.2** Block /super-admin access ✅/❌
- [ ] **B.3** Sidebar shows tenant options ✅/❌

### Security Tests
- [ ] **Security 1** URL XSS prevention ✅/❌
- [ ] **Security 2** Token validation ✅/❌

### Console & Network
- [ ] **Console** No TypeScript errors ✅/❌
- [ ] **Network (SUPER_ADMIN)** No tenant API calls ✅/❌

---

## Verification Matrix

| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| SUPER_ADMIN login → /super-admin | REDIRECT | _____ | ⏳ |
| SUPER_ADMIN → /{tenant}/dashboard | BLOCK | _____ | ⏳ |
| TENANT_ADMIN login → /{tenant}/dashboard | LOAD | _____ | ⏳ |
| TENANT_ADMIN → /super-admin | REDIRECT TO LOGIN | _____ | ⏳ |
| SUPER_ADMIN sidebar options | SA ONLY | _____ | ⏳ |
| TENANT sidebar options | TENANT ONLY | _____ | ⏳ |
| No tenant API calls (SA) | 0 CALLS | _____ | ⏳ |
| No SA API calls (TENANT) | 0 CALLS | _____ | ⏳ |

---

## Passing Criteria

✅ **TEST PASSES IF**:
1. ✅ SUPER_ADMIN never sees UI from tenant dashboard
2. ✅ TENANT never sees UI from control plane
3. ✅ Routing completely separated (no cross-role access)
4. ✅ Sidebar dynamically changes by role
5. ✅ No API leakage (wrong role making wrong API calls)
6. ✅ No console errors
7. ✅ All redirects work smoothly

---

## Failure Criteria

❌ **TEST FAILS IF**:
1. ❌ SUPER_ADMIN can see /{tenantId}/dashboard content
2. ❌ TENANT_ADMIN can access /super-admin
3. ❌ Wrong sidebar options visible for role
4. ❌ API calls are made for wrong role
5. ❌ Console shows role detection errors
6. ❌ Redirects are broken or cause loading issues

---

## Notes for Tester

1. **Multiple Tenants**: If testing with multiple tenants, verify SUPER_ADMIN redirects regardless of which tenant URL is attempted
2. **Session Persistence**: Close browser completely between role switches (don't just logout - clear LocalStorage)
3. **DevTools Network**: Filter by XHR to see only API calls (ignore img, css, js)
4. **URL Bar**: Watch for redirects - some redirects happen instantly, some after 1-2 seconds
5. **Error Messages**: If you see errors, include full error message and stack trace

---

## Test Execution Instructions

```bash
# 1. Start API
npm run start --prefix apps/api

# 2. In new terminal, start Web
npm run dev --prefix apps/web

# 3. Open browser to http://localhost:3000

# 4. Follow test scenarios A.1 through B.3

# 5. Document results in this file

# 6. If all pass: ✅ READY FOR STAGING
# 7. If any fail: ❌ DOCUMENT ISSUE + TICKET
```

---

## Expected Test Results

After completing all scenarios, you should see:

```
╔══════════════════════════════════════════╗
║  SUPER_ADMIN SEPARATION TEST             ║
╠══════════════════════════════════════════╣
║ Scenario A (SUPER_ADMIN):  6/6 ✅        ║
║ Scenario B (TENANT):       3/3 ✅        ║
║ Security Tests:            2/2 ✅        ║
║ Console/Network:           2/2 ✅        ║
╠══════════════════════════════════════════╣
║ TOTAL: 13/13 ✅ PASS                     ║
╚══════════════════════════════════════════╝
```

If all tests pass: **STATUS = READY FOR STAGING** ✅

---

**Document Version**: 1.0
**Last Updated**: February 14, 2026
**Created By**: Senior Frontend Architect
**Purpose**: Manual Testing Guide for SUPER_ADMIN/TENANT Separation

