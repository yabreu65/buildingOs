# Phase 1: End-to-End Testing Plan
**Date**: 15 Feb 2026
**Status**: 🔴 READY FOR EXECUTION
**Environment**: Real API + Frontend (no mock/localStorage)

---

## 📋 Requerimientos

### 1. Buildings CRUD (API)
```
POST   /tenants/:tenantId/buildings
GET    /tenants/:tenantId/buildings
PATCH  /tenants/:tenantId/buildings/:buildingId
DELETE /tenants/:tenantId/buildings/:buildingId
```

### 2. Units CRUD (API)
```
POST   /tenants/:tenantId/buildings/:buildingId/units
GET    /tenants/:tenantId/buildings/:buildingId/units
PATCH  /tenants/:tenantId/buildings/:buildingId/units/:unitId
DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId
```

### 3. Occupants (API)
```
POST   /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants
GET    /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants
DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants/:occupantId
```

### 4. Headers
```
X-Tenant-Id: (extraído del route /{tenantId}/...)
Authorization: Bearer <token>
```

### 5. State
```
No localStorage para buildings/units/occupants
Refresh mantiene contexto (re-fetch desde API)
```

---

## 🧪 Test Scenarios

### Test Set A: Buildings CRUD

#### A.1: List Buildings
```
URL: http://localhost:3000/{tenantId}/buildings
Method: GET
API Call: GET /tenants/{tenantId}/buildings
Expected: Lista de buildings en tabla
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### A.2: Create Building
```
URL: http://localhost:3000/{tenantId}/buildings
Action: Click "New Building" → form → submit
API Call: POST /tenants/{tenantId}/buildings
Body: { name, address }
Expected: Building creado y visible en tabla
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### A.3: Edit Building
```
URL: http://localhost:3000/{tenantId}/buildings
Action: Click edit → cambiar datos → submit
API Call: PATCH /tenants/{tenantId}/buildings/{buildingId}
Expected: Cambios visibles inmediatamente
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### A.4: Delete Building
```
URL: http://localhost:3000/{tenantId}/buildings
Action: Click delete → confirm
API Call: DELETE /tenants/{tenantId}/buildings/{buildingId}
Expected: Building removido de tabla
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### A.5: Refresh Buildings Page
```
URL: http://localhost:3000/{tenantId}/buildings
Action: F5 refresh
Expected: Data re-fetched from API, page renders correctly
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

---

### Test Set B: Units CRUD

#### B.1: List Units
```
URL: http://localhost:3000/{tenantId}/buildings/{buildingId}/units
Method: GET
API Call: GET /tenants/{tenantId}/buildings/{buildingId}/units
Expected: Lista de units en tabla
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### B.2: Create Unit
```
URL: http://localhost:3000/{tenantId}/buildings/{buildingId}/units
Action: Click "New Unit" → form → submit
API Call: POST /tenants/{tenantId}/buildings/{buildingId}/units
Body: { label, unitCode, unitType }
Expected: Unit creado y visible en tabla
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### B.3: Edit Unit
```
URL: http://localhost:3000/{tenantId}/buildings/{buildingId}/units
Action: Click edit → cambiar datos → submit
API Call: PATCH /tenants/{tenantId}/buildings/{buildingId}/units/{unitId}
Expected: Cambios visibles inmediatamente
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### B.4: Delete Unit
```
URL: http://localhost:3000/{tenantId}/buildings/{buildingId}/units
Action: Click delete → confirm
API Call: DELETE /tenants/{tenantId}/buildings/{buildingId}/units/{unitId}
Expected: Unit removido de tabla
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### B.5: Refresh Units Page
```
URL: http://localhost:3000/{tenantId}/buildings/{buildingId}/units
Action: F5 refresh
Expected: Data re-fetched from API, page renders correctly
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

---

### Test Set C: Occupants

#### C.1: List Occupants (if available in Phase 1)
```
Status: [ ] NOT IN PHASE 1 / [ ] TESTED
```

#### C.2: Assign Occupant (if available in Phase 1)
```
URL: http://localhost:3000/{tenantId}/buildings/{buildingId}/units/{unitId}
Action: Click "Assign Resident" → select user → confirm
API Call: POST /tenants/{tenantId}/buildings/{buildingId}/units/{unitId}/occupants
Expected: Occupant assigned to unit
Status: [ ] NOT IN PHASE 1 / [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### C.3: Unassign Occupant (if available in Phase 1)
```
Action: Click "Remove" on occupant
API Call: DELETE /tenants/{tenantId}/buildings/{buildingId}/units/{unitId}/occupants/{occupantId}
Expected: Occupant removed from unit
Status: [ ] NOT IN PHASE 1 / [ ] PASS / [ ] FAIL
Notes: _____________________
```

---

### Test Set D: Context & State Management

#### D.1: X-Tenant-Id Header Validation
```
Action: Open DevTools Network tab
Perform: Create/Edit/Delete operation
Check: All API requests have correct X-Tenant-Id header
Expected: X-Tenant-Id matches route /{tenantId}
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### D.2: Multi-Page Navigation
```
Action: Buildings → Building 1 → Units → Create Unit → Refresh
Expected: Todos los datos correctos, no hay pérdida de contexto
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### D.3: Deep Link Refresh (Buildings)
```
URL: http://localhost:3000/{tenantId}/buildings/{buildingId}/units
Action: Bookmark this URL → close tab → open bookmark → F5 refresh
Expected: Page loads correctly, buildings/units list visible
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### D.4: Deep Link Refresh (Units)
```
Similar to D.3 but for units
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

---

### Test Set E: Error Handling & Edge Cases

#### E.1: Console Check
```
Action: Open DevTools Console tab
Perform: All CRUD operations
Expected: NO errors, warnings, or TypeScript errors
Status: [ ] PASS / [ ] FAIL
Errors found: _____________________
```

#### E.2: Network Requests
```
Action: Open DevTools Network tab
Filter: XHR only
Perform: All CRUD operations
Check:
  - Correct endpoints called
  - Correct HTTP methods (POST/PATCH/DELETE/GET)
  - Correct status codes (200, 201, 204)
  - Response time reasonable
Expected: All requests successful
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### E.3: Empty State (No Buildings)
```
Action: Delete all buildings
Expected: "No buildings" message displays correctly
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

#### E.4: Empty State (No Units)
```
Action: Create building with no units
Navigate: /{tenantId}/buildings/{buildingId}/units
Expected: "No units" message displays correctly
Status: [ ] PASS / [ ] FAIL
Notes: _____________________
```

---

## 📝 Test Data

### Required Data Setup
```
Tenant: Use existing tenant from authentication
Building: Will be created during tests
  - Name: "Test Building 1"
  - Address: "123 Main St"

Unit: Will be created during tests
  - Label: "Unit 101"
  - Code: "u101"
  - Type: "APARTMENT"
```

---

## ✅ Acceptance Criteria

### Must Pass (Critical)
- [ ] All CRUD operations work (Create, Read, Update, Delete)
- [ ] API is called correctly (no localStorage usage)
- [ ] X-Tenant-Id header present on all requests
- [ ] Refresh maintains context and reloads data
- [ ] No console errors

### Nice to Have
- [ ] Occupants functionality works
- [ ] Loading states visible during API calls
- [ ] Success/error toasts show for operations
- [ ] Form validation works

---

## 🔍 Instructions

### Setup
```bash
1. Terminal 1: npm run start --prefix apps/api
2. Terminal 2: npm run dev --prefix apps/web
3. Open browser: http://localhost:3000/login
4. Login as TENANT_ADMIN
```

### Execution
```bash
1. Open this document side-by-side with browser
2. Execute each test case (A.1 → A.5 → B.1 → B.5 → C... → D... → E...)
3. For each test:
   - Perform action
   - Check console (F12 → Console)
   - Check network (F12 → Network)
   - Mark PASS/FAIL
   - Note any issues
```

### Documentation
```bash
1. After each test set, save this file
2. After all tests, create final report
3. Include screenshots if issues found
```

---

## 📊 Test Execution Summary (to be filled)

### Buildings CRUD
- A.1 (List): [ ] PASS / [ ] FAIL
- A.2 (Create): [ ] PASS / [ ] FAIL
- A.3 (Edit): [ ] PASS / [ ] FAIL
- A.4 (Delete): [ ] PASS / [ ] FAIL
- A.5 (Refresh): [ ] PASS / [ ] FAIL

**Sub-Total A**: ___/5 PASS

### Units CRUD
- B.1 (List): [ ] PASS / [ ] FAIL
- B.2 (Create): [ ] PASS / [ ] FAIL
- B.3 (Edit): [ ] PASS / [ ] FAIL
- B.4 (Delete): [ ] PASS / [ ] FAIL
- B.5 (Refresh): [ ] PASS / [ ] FAIL

**Sub-Total B**: ___/5 PASS

### Occupants
- C.1 (List): [ ] NOT IN PHASE 1 / [ ] PASS / [ ] FAIL
- C.2 (Assign): [ ] NOT IN PHASE 1 / [ ] PASS / [ ] FAIL
- C.3 (Unassign): [ ] NOT IN PHASE 1 / [ ] PASS / [ ] FAIL

**Sub-Total C**: ___/3 PASS (or NOT IN PHASE 1)

### Context & State
- D.1 (Headers): [ ] PASS / [ ] FAIL
- D.2 (Navigation): [ ] PASS / [ ] FAIL
- D.3 (Deep Refresh 1): [ ] PASS / [ ] FAIL
- D.4 (Deep Refresh 2): [ ] PASS / [ ] FAIL

**Sub-Total D**: ___/4 PASS

### Error Handling
- E.1 (Console): [ ] PASS / [ ] FAIL
- E.2 (Network): [ ] PASS / [ ] FAIL
- E.3 (Empty State 1): [ ] PASS / [ ] FAIL
- E.4 (Empty State 2): [ ] PASS / [ ] FAIL

**Sub-Total E**: ___/4 PASS

### TOTAL
```
A: ___/5
B: ___/5
C: ___/3 (or 0 if not in phase)
D: ___/4
E: ___/4
─────────
TOTAL: ___/21 PASS (or ___/18 if C not in phase)
```

---

## 🎯 Final Status

**All Tests PASS?**: [ ] YES → PHASE 1 COMPLETE ✅ / [ ] NO → Document issues

**Critical Issues Found**:
```
_________________________________________________________________
```

**Recommendation**:
[ ] Ready for Staging
[ ] Needs Fixes (describe above)

---

**Test Plan Created**: 2026-02-15
**Ready for Execution**: YES ✅

