# Phase 1 API Integration Test
**Date**: February 13, 2026
**Status**: ✅ Ready for Testing
**Objective**: Verify useBuildings/useUnits/useOccupants operate 100% against API without localStorage fallbacks

---

## 🔍 Code Verification

### ✅ No localStorage Fallbacks in API Service

The `buildings.api.ts` service uses **only** `fetch()` calls to the backend API:
- NO localStorage reads
- NO mock data fallbacks
- NO context.api or old storage layer
- Only real HTTP requests to Phase 0 API endpoints

**Evidence**: All functions in `buildings.api.ts`:
- `fetchBuildings()` → `GET /tenants/:tenantId/buildings`
- `createBuilding()` → `POST /tenants/:tenantId/buildings`
- `updateBuilding()` → `PATCH /tenants/:tenantId/buildings/:buildingId`
- `deleteBuilding()` → `DELETE /tenants/:tenantId/buildings/:buildingId`
- `fetchUnits()` → `GET /tenants/:tenantId/buildings/:buildingId/units`
- `createUnit()` → `POST /tenants/:tenantId/buildings/:buildingId/units`
- `updateUnit()` → `PATCH /tenants/:tenantId/buildings/:buildingId/units/:unitId`
- `deleteUnit()` → `DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId`
- `fetchOccupants()` → `GET /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants`
- `assignOccupant()` → `POST /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants`
- `removeOccupant()` → `DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants/:occupantId`

### ✅ Error Propagation

All errors from API are rethrown without suppression:
```typescript
if (!res.ok) {
  const error = new Error(`Failed to fetch buildings: ${res.status}`);
  logError(endpoint, res.status, error);
  throw error;  // ← Error propagates to UI
}
```

### ✅ Debug Logging (Dev Mode)

Added comprehensive logging in `buildings.api.ts`:
```typescript
// Only logs in development mode
logRequest(method, endpoint, headers, body)  // Shows: method, endpoint, auth token (truncated), body
logResponse(endpoint, status, data)           // Shows: response data
logError(endpoint, status, error)             // Shows: error details
```

---

## 🧪 Manual Test Instructions

### Prerequisites
1. **Backend API running**: `npm run dev` from `apps/api/` (port 4000)
2. **Frontend dev mode**: `npm run dev` from `apps/web/` (port 3000)
3. **Database seeded**: Default seed should have demo user + tenant

### Test Flow

#### Step 1: Login
1. Open http://localhost:3000/login
2. Enter credentials:
   - Email: `admin@demo.com`
   - Password: `Admin123!`
3. Click "Login"
4. You should see the dashboard

**Check DevTools Console**:
- Should show no errors
- No localStorage writes for buildings

#### Step 2: Navigate to Buildings Page
1. URL: `http://localhost:3000/[tenantId]/buildings`
2. Click on "Buildings" if sidebar available, or navigate directly

**Check DevTools Console** (should show):
```
[API] GET /tenants/[tenantId]/buildings {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGc..."
  }
}
[API RESPONSE] /tenants/[tenantId]/buildings (200) [{ id: "...", name: "...", ... }]
```

#### Step 3: Create Building ✅
1. Click "New Building" button
2. Fill form:
   - Building Name: "Test Building 1"
   - Address: "123 Main Street"
3. Click "Create Building"
4. Should see success message

**Check DevTools Console** (should show):
```
[API] POST /tenants/[tenantId]/buildings {
  headers: { ... },
  body: "{\\"name\\":\\"Test Building 1\\",\\"address\\":\\"123 Main Street\\"}"
}
[API RESPONSE] /tenants/[tenantId]/buildings (201) {
  id: "cmlka9amm0001...",
  tenantId: "[tenantId]",
  name: "Test Building 1",
  address: "123 Main Street",
  createdAt: "2026-02-13T...",
  updatedAt: "2026-02-13T..."
}
```

**Expected**: Building appears in list immediately

#### Step 4: Update Building ✅
1. Click "View" on the building you just created
2. Should see building details page
3. (If form exists) Edit name to "Test Building Updated"
4. Click "Save"

**Check DevTools Console** (should show):
```
[API] PATCH /tenants/[tenantId]/buildings/[buildingId] {
  headers: { ... },
  body: "{\\"name\\":\\"Test Building Updated\\"}"
}
[API RESPONSE] /tenants/[tenantId]/buildings/[buildingId] (200) {
  id: "[buildingId]",
  name: "Test Building Updated",
  ...
}
```

#### Step 5: Delete Building ✅
1. Back to buildings list
2. Click "Delete" on the building
3. Confirm deletion

**Check DevTools Console** (should show):
```
[API] DELETE /tenants/[tenantId]/buildings/[buildingId] {
  headers: { ... }
}
[API RESPONSE] /tenants/[tenantId]/buildings/[buildingId] (200) { success: true }
```

**Expected**: Building removed from list immediately

#### Step 6: Create Unit ✅
1. On buildings list, create another building: "Building for Units"
2. Click "View" on it
3. Go to "Units" tab
4. Click "New Unit"
5. Fill form:
   - Unit Code: "101"
   - Label: "Apartment 101"
   - Type: "APARTMENT"
   - Status: "VACANT"
6. Click "Create Unit"

**Check DevTools Console** (should show):
```
[API] POST /tenants/[tenantId]/buildings/[buildingId]/units {
  headers: { ... },
  body: "{\\"code\\":\\"101\\",\\"label\\":\\"Apartment 101\\",...}"
}
[API RESPONSE] /tenants/[tenantId]/buildings/[buildingId]/units (201) {
  id: "cmlka9ana...",
  buildingId: "[buildingId]",
  code: "101",
  label: "Apartment 101",
  unitType: "APARTMENT",
  occupancyStatus: "VACANT",
  ...
}
```

#### Step 7: Delete Unit ✅
1. In Units page, click "Delete" on the unit
2. Confirm

**Check DevTools Console** (should show):
```
[API] DELETE /tenants/[tenantId]/buildings/[buildingId]/units/[unitId] {
  headers: { ... }
}
[API RESPONSE] /tenants/[tenantId]/buildings/[buildingId]/units/[unitId] (200) { success: true }
```

---

## 📊 Test Results Template

Copy this template and fill in as you test:

```
TEST DATE: [DATE]
TESTER: [NAME]
BUILD: [COMMIT HASH]

=== BUILDINGS ===
✅ Fetch buildings list
   Endpoint: GET /tenants/:tenantId/buildings
   Status: 200
   Response count: [N] buildings

✅ Create building
   Endpoint: POST /tenants/:tenantId/buildings
   Status: 201
   Building ID: [ID]
   Name: [NAME]

✅ Update building
   Endpoint: PATCH /tenants/:tenantId/buildings/:buildingId
   Status: 200
   Updated field: name="[NEW NAME]"

✅ Delete building
   Endpoint: DELETE /tenants/:tenantId/buildings/:buildingId
   Status: 200

=== UNITS ===
✅ Create unit
   Endpoint: POST /tenants/:tenantId/buildings/:buildingId/units
   Status: 201
   Unit ID: [ID]
   Code: [CODE]

✅ Delete unit
   Endpoint: DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId
   Status: 200

=== OCCUPANTS ===
✅ Assign occupant
   Endpoint: POST /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants
   Status: 201
   Occupant ID: [ID]
   Role: [OWNER|RESIDENT]

✅ Remove occupant
   Endpoint: DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants/:occupantId
   Status: 200

=== ERROR HANDLING ===
✅ Cross-tenant access blocked
   Attempted: GET /tenants/[OTHER_TENANT]/buildings/[BUILDING_ID]
   Result: 404 "Building not found or does not belong to this tenant"

✅ Invalid token handling
   Attempted: GET /tenants/:tenantId/buildings (with invalid token)
   Result: 401 "Unauthorized"

=== CONCLUSION ===
All CRUD operations working against real API.
No localStorage usage detected.
Errors properly propagated to UI.
```

---

## 🔍 DevTools Console Verification Checklist

- [ ] No "localStorage.getItem" calls for buildings/units/occupants
- [ ] No "localStorage.setItem" calls for buildings/units/occupants
- [ ] All API calls show correct Authorization header
- [ ] All API calls show correct endpoint path with tenantId
- [ ] All responses show correct HTTP status codes (200/201/404/etc)
- [ ] All create operations return full object with ID
- [ ] All delete operations remove from UI immediately
- [ ] Error messages appear when API fails
- [ ] No "undefined" values in API responses
- [ ] Timestamps present in responses (createdAt, updatedAt)

---

## 🐛 Debugging

If you encounter issues:

### "Authorization header missing"
- Check if logged in
- Check if token exists: `localStorage.getItem('bo_auth_token')`

### "404 Building not found"
- Verify you're using correct tenantId from URL
- Check if building actually exists on backend
- Verify you have membership in that tenant

### "Network request failed"
- Check backend is running: `curl http://localhost:4000/health`
- Check CORS settings if API on different port
- Check Network tab for actual response

### "localStorage being written"
- Should NEVER happen for buildings/units/occupants
- Only auth token should be in localStorage
- If you see `bo_buildings_*` or similar, there's a bug

---

## ✅ Success Criteria

Test is **SUCCESSFUL** when:

1. ✅ All CRUD operations complete without errors
2. ✅ DevTools shows correct API endpoints and headers
3. ✅ No localStorage accesses for buildings/units/occupants
4. ✅ Errors from API are shown to user (not swallowed)
5. ✅ UI updates immediately after CRUD operations
6. ✅ Cross-tenant access is blocked
7. ✅ All HTTP status codes are correct

---

## 📝 Expected Console Output Example

```
[API] POST /tenants/abc123/buildings {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  body: "{"name":"My Building","address":"123 Main St"}"
}

[API RESPONSE] /tenants/abc123/buildings (201) {
  id: "cmlka9amm0001ekipswl42dbq",
  tenantId: "abc123",
  name: "My Building",
  address: "123 Main St",
  createdAt: "2026-02-13T12:00:00.000Z",
  updatedAt: "2026-02-13T12:00:00.000Z"
}
```

Every API call should show a similar pattern in the console during development mode.

---

## 🎯 Next Steps

After confirming all operations work:
1. Run build: `npm run build` (should pass)
2. Commit the logging improvements
3. Begin Phase 1 form/modal implementation
4. Add loading indicators during API calls
5. Add error toast notifications

