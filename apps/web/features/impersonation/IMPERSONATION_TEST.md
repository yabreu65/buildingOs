# SUPER_ADMIN Impersonation Testing Guide

## Acceptance Criteria (10 Manual Tests)

### Test 1: Start Impersonation - Successful Token Mint
**Scenario**: SUPER_ADMIN user clicks "Entrar como soporte" on a tenant
**Expected Result**:
- POST /api/super-admin/impersonation/start called with tenantId
- Response contains impersonationToken, expiresAt, tenant.id, tenant.name
- Token is valid JWT with isImpersonating=true, actorSuperAdminUserId set
- Browser navigates to /{tenantId}/dashboard

**Manual Test**:
```bash
# 1. Login as SUPER_ADMIN
# 2. Navigate to /super-admin
# 3. Open tenant list
# 4. Click "Entrar como soporte" on a tenant
# 5. Verify: Redirects to /{tenantId}/dashboard (should show content, no errors)
```

### Test 2: No Redirect to /super-admin During Impersonation
**Scenario**: After impersonation starts, TenantLayout should not redirect back
**Expected Result**:
- TenantLayout checks isImpersonating=true
- Allows navigation without redirect
- Sidebar shows normally
- ImpersonationBanner visible at top

**Manual Test**:
```bash
# 1. After Test 1 completes (in impersonation)
# 2. Open browser console, check errors
# 3. Verify sidebar is visible (not hidden)
# 4. Verify banner is visible with tenant name
# 5. Navigate through different pages (/dashboard, /buildings, etc)
# 6. NO 404s or redirects should occur
```

### Test 3: ImpersonationBanner Displays Correctly
**Scenario**: Banner shows tenant name and countdown timer
**Expected Result**:
- Amber banner visible
- Shows "Modo Soporte - Impersonando: {TenantName}"
- Countdown timer decrements (e.g., "expira en 59 min")
- "Salir de Impersonation" button visible and clickable

**Manual Test**:
```bash
# 1. During impersonation (Test 1-2 state)
# 2. Wait 5 seconds, observe countdown timer update
# 3. Verify banner text is readable and formatted well
# 4. Don't click exit yet (save for Test 5)
```

### Test 4: Audit Log IMPERSONATION_START Created
**Scenario**: Check audit trail for start event
**Expected Result**:
- GET /api/super-admin/audit-logs?action=IMPERSONATION_START
- Returns log entry with:
  - action: "IMPERSONATION_START"
  - entityType: "Tenant"
  - entityId: {tenantId}
  - metadata.targetTenantId, metadata.targetTenantName, metadata.expiresAt
  - actorUserId: {SA user ID}
  - createdAt: timestamp

**Manual Test**:
```bash
# 1. Navigate to /super-admin (exit impersonation if needed)
# 2. Open DevTools, Network tab
# 3. Filter: "audit-logs"
# 4. Verify recent IMPERSONATION_START entries in response
# OR use curl:
curl -H "Authorization: Bearer {SA_TOKEN}" \
  http://localhost:4000/api/super-admin/audit-logs?action=IMPERSONATION_START
```

### Test 5: End Impersonation - Exit Button Works
**Scenario**: SA clicks "Salir de Impersonation" button
**Expected Result**:
- POST /api/super-admin/impersonation/end called
- Session restored from backup
- Redirects to /super-admin
- Banner disappears
- Sidebar hidden (back to normal SA layout)

**Manual Test**:
```bash
# 1. During impersonation (Test 2-3 state)
# 2. Click "Salir de Impersonation" button
# 3. Verify: Redirects to /super-admin
# 4. Verify: Banner gone
# 5. Verify: Sidebar hidden (not visible)
# 6. Verify: No console errors
```

### Test 6: Audit Log IMPERSONATION_END Created
**Scenario**: Check audit trail for end event
**Expected Result**:
- GET /api/super-admin/audit-logs?action=IMPERSONATION_END
- Returns log entry with:
  - action: "IMPERSONATION_END"
  - entityType: "Tenant"
  - metadata.targetTenantId: {original tenant}

**Manual Test**:
```bash
# 1. After Test 5 (just exited impersonation)
# 2. Open DevTools or use curl to verify audit log
curl -H "Authorization: Bearer {SA_TOKEN}" \
  http://localhost:4000/api/super-admin/audit-logs?action=IMPERSONATION_END
# 3. Verify latest entry matches the tenant from Test 5
```

### Test 7: Token Backup/Restore - SA Session Preserved
**Scenario**: Verify SA session is completely restored after exit
**Expected Result**:
- SA token in localStorage restored (bo_token)
- SA session in localStorage restored (bo_session)
- Impersonation metadata cleared (bo_impersonation)
- Session cookies/JWT unchanged

**Manual Test**:
```bash
# 1. Before impersonation: Check localStorage
# > localStorage.getItem('bo_token') // Should show SA token
# > localStorage.getItem('bo_session') // Should show SA session

# 2. Start impersonation
# > localStorage.getItem('bo_token') // Should show DIFFERENT token

# 3. Exit impersonation
# > localStorage.getItem('bo_token') // Should match original SA token
# > localStorage.getItem('bo_session') // Should match original SA session
# > localStorage.getItem('bo_impersonation') // Should be null or ""
```

### Test 8: Cross-Tenant Access Blocked During Impersonation
**Scenario**: SA impersonating Tenant A tries to access Tenant B
**Expected Result**:
- TenantAccessGuard checks impersonatedTenantId matches URL tenantId
- If mismatch: 403 Forbidden
- Same 404/403 for resources in other tenant

**Manual Test**:
```bash
# 1. Start impersonation of "Tenant A" (get tenantA.id)
# 2. Navigate to /{tenantB.id}/dashboard (use different tenant)
# 3. Verify: 403 Forbidden or redirect back to impersonated tenant
# 4. OR: Manually call API for Tenant B while impersonating A
curl -H "Authorization: Bearer {IMPERSONATION_TOKEN}" \
  http://localhost:4000/api/buildings?tenantId={tenantB.id}
# 5. Should get 403 or error
```

### Test 9: Token Expiry After 60 Minutes
**Scenario**: Impersonation token naturally expires
**Expected Result**:
- Token issued with exp claim = now + 3600 seconds
- After 60 minutes, JWT is no longer valid
- JwtStrategy throws UnauthorizedException
- Any API call fails with 401
- User can still click "Salir" button (uses same expired token, audit fails silently but cleanup happens client-side)

**Manual Test** (can skip in immediate testing, but verify structure):
```bash
# 1. Decode impersonation token (jwt.io or similar)
# > Copy token from localStorage.getItem('bo_token')
# 2. Check 'exp' claim: should be ~ 3600 seconds in future
# 3. To test expiry: manually set an earlier expiry in DevTools and refresh
# 4. Verify: API calls fail with 401 after expiry
# 5. Verify: User can still exit and restore session
```

### Test 10: SUPER_ADMIN Role Lost in Impersonation Context
**Scenario**: Verify SA becomes TENANT_ADMIN during impersonation
**Expected Result**:
- JwtStrategy.validate() receives isImpersonating=true
- Returns synthetic membership with role: ['TENANT_ADMIN']
- isSuperAdmin property is false
- useIsSuperAdmin() returns false during impersonation
- Sidebar shows normal tenant menu (not hidden)
- No super-admin-only features visible

**Manual Test**:
```bash
# 1. During impersonation
# 2. Open Console
# > const session = JSON.parse(localStorage.getItem('bo_session'))
# > session.memberships[0].roles // Should show ['TENANT_ADMIN']
# 3. Navigate to pages that check SUPER_ADMIN role (e.g., /super-admin)
# 4. Verify: Redirect occurs or access denied
# 5. Verify: Permission checks work correctly (can view unit, but not create tenant)
```

---

## Security Tests (Edge Cases)

### Security Test: No Privilege Escalation
- SA impersonates Tenant A as TENANT_ADMIN (NOT SUPER_ADMIN)
- Verify: Cannot access /super-admin, cannot modify other tenants
- Verify: Cannot change JWT to add SUPER_ADMIN role manually
- Result: ✅ Same as accepted TENANT_ADMIN (limited access)

### Security Test: No Cross-Tenant Access
- SA impersonates Tenant A, tries to:
  - List buildings of Tenant B: 403
  - Create charge for Tenant B unit: 403
  - Update Tenant B settings: 403
- Result: ✅ All blocked

### Security Test: No Token Reuse After Exit
- SA exits impersonation
- Keeps old impersonationToken, tries to use it: 401 (expired/not in context)
- Result: ✅ Fails silently, API error

### Security Test: Audit Trail Complete
- All impersonations logged with: actor ID, tenant ID, timestamp, action
- No gaps or missing entries
- Result: ✅ Verified in IMPERSONATION_START/END logs

---

## Rollback & Cleanup (if implementation fails)

1. Remove `IMPERSONATION_START`, `IMPERSONATION_END` from AuditAction enum
2. Drop migration (if needed)
3. Remove impersonation-related methods from SuperAdminService
4. Remove impersonation endpoints from controller
5. Revert JWT strategy changes
6. Remove frontend files and imports
7. Revert TenantLayout, Sidebar, AppShell, TenantActions

---

## Notes

- All tests assume:
  - Backend API is running on http://localhost:4000
  - Frontend is running on http://localhost:3000
  - Valid SUPER_ADMIN token available
  - At least 2 test tenants exist

- Tests can be run in any order, except Test 5 should come after Tests 1-4
- Test 9 can be deferred to later (long wait time)
- Use browser DevTools for localStorage inspection
- Use curl or Postman for direct API testing
