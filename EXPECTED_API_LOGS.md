# Expected API Logs for Each Operation
**Reference**: Console output when running Phase 1 with development mode enabled

All logs appear in browser DevTools Console (F12 → Console tab)

---

## Building Operations

### 1. Fetch Buildings List

**Operation**: Load buildings page

**Console Output**:
```
[API] GET /tenants/cmlhe1zy60000143er2fl3irs/buildings {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI..."
  }
}

[API RESPONSE] /tenants/cmlhe1zy60000143er2fl3irs/buildings (200) [
  {
    "id": "cmlka9amm0001ekipswl42dbq",
    "tenantId": "cmlhe1zy60000143er2fl3irs",
    "name": "Main Building",
    "address": "123 Main Street",
    "createdAt": "2026-02-13T10:30:00.000Z",
    "updatedAt": "2026-02-13T10:30:00.000Z"
  }
]
```

**Key Points**:
- Method: `GET`
- Status: `200`
- Authorization header: Present with Bearer token
- Response: Array of buildings

---

### 2. Create Building

**Operation**: Click "New Building" → Fill form → Submit

**Form Input**:
```
Name: "Test Building"
Address: "456 Oak Street"
```

**Console Output**:
```
[API] POST /tenants/cmlhe1zy60000143er2fl3irs/buildings {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  body: "{"name":"Test Building","address":"456 Oak Street"}"
}

[API RESPONSE] /tenants/cmlhe1zy60000143er2fl3irs/buildings (201) {
  "id": "cmlkb1xyz0002ekip9xy5klmn",
  "tenantId": "cmlhe1zy60000143er2fl3irs",
  "name": "Test Building",
  "address": "456 Oak Street",
  "createdAt": "2026-02-13T10:35:00.000Z",
  "updatedAt": "2026-02-13T10:35:00.000Z"
}
```

**Key Points**:
- Method: `POST`
- Status: `201` (Created)
- Request body: Includes name and address
- Response: Full building object with new ID
- UI: Building appears in list immediately

---

### 3. Update Building

**Operation**: Click building "View" → Edit name → Save

**Form Input**:
```
Name: "Test Building Updated"
```

**Console Output**:
```
[API] PATCH /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlkb1xyz0002ekip9xy5klmn {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  body: "{"name":"Test Building Updated"}"
}

[API RESPONSE] /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlkb1xyz0002ekip9xy5klmn (200) {
  "id": "cmlkb1xyz0002ekip9xy5klmn",
  "tenantId": "cmlhe1zy60000143er2fl3irs",
  "name": "Test Building Updated",
  "address": "456 Oak Street",
  "createdAt": "2026-02-13T10:35:00.000Z",
  "updatedAt": "2026-02-13T10:36:15.000Z"
}
```

**Key Points**:
- Method: `PATCH`
- Status: `200`
- Request body: Only changed fields
- Response: Full updated object
- UI: Name updates in list/detail

---

### 4. Delete Building

**Operation**: Click "Delete" → Confirm

**Console Output**:
```
[API] DELETE /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlkb1xyz0002ekip9xy5klmn {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}

[API RESPONSE] /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlkb1xyz0002ekip9xy5klmn (200) {
  "success": true
}
```

**Key Points**:
- Method: `DELETE`
- Status: `200`
- Request body: None
- Response: Success confirmation
- UI: Building removed from list immediately

---

## Unit Operations

### 1. Create Unit

**Operation**: In building's Units page → Click "New Unit" → Submit

**Form Input**:
```
Code: "101"
Label: "Apartment 101"
Type: "APARTMENT"
Status: "VACANT"
```

**Console Output**:
```
[API] POST /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlka9amm0001ekipswl42dbq/units {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  body: "{"code":"101","label":"Apartment 101","unitType":"APARTMENT","occupancyStatus":"VACANT"}"
}

[API RESPONSE] /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlka9amm0001ekipswl42dbq/units (201) {
  "id": "cmlka9ana0003ekip7zzunkh5",
  "buildingId": "cmlka9amm0001ekipswl42dbq",
  "tenantId": "cmlhe1zy60000143er2fl3irs",
  "code": "101",
  "label": "Apartment 101",
  "unitCode": "101",
  "unitType": "APARTMENT",
  "occupancyStatus": "VACANT",
  "createdAt": "2026-02-13T10:40:00.000Z",
  "updatedAt": "2026-02-13T10:40:00.000Z"
}
```

**Key Points**:
- Method: `POST`
- Endpoint includes buildingId: `/buildings/cmlka9amm0001ekipswl42dbq/units`
- Status: `201`
- Response: Unit object with all fields
- UI: Unit appears in units list

---

### 2. Delete Unit

**Operation**: In Units page → Click "Delete" on unit → Confirm

**Console Output**:
```
[API] DELETE /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlka9amm0001ekipswl42dbq/units/cmlka9ana0003ekip7zzunkh5 {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}

[API RESPONSE] /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlka9amm0001ekipswl42dbq/units/cmlka9ana0003ekip7zzunkh5 (200) {
  "success": true
}
```

**Key Points**:
- Method: `DELETE`
- Full nested path: `/tenants/.../buildings/.../units/...`
- Status: `200`
- UI: Unit removed immediately

---

## Occupant Operations

### 1. Assign Occupant

**Operation**: In Units list, assign resident to unit

**Form Input**:
```
User ID: "cmlhe20130002143es68ik27i" (logged-in user)
Role: "OWNER"
```

**Console Output**:
```
[API] POST /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlka9amm0001ekipswl42dbq/units/cmlka9ana0003ekip7zzunkh5/occupants {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  body: "{"userId":"cmlhe20130002143es68ik27i","role":"OWNER"}"
}

[API RESPONSE] /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlka9amm0001ekipswl42dbq/units/cmlka9ana0003ekip7zzunkh5/occupants (201) {
  "id": "cmlka9ans0005ekipullkna7a",
  "unitId": "cmlka9ana0003ekip7zzunkh5",
  "userId": "cmlhe20130002143es68ik27i",
  "role": "OWNER",
  "user": {
    "id": "cmlhe20130002143es68ik27i",
    "email": "admin@demo.com",
    "name": "Admin Demo"
  },
  "unit": {
    "id": "cmlka9ana0003ekip7zzunkh5",
    "code": "101",
    "label": "Apartment 101"
  },
  "createdAt": "2026-02-13T10:45:00.000Z",
  "updatedAt": "2026-02-13T10:45:00.000Z"
}
```

**Key Points**:
- Method: `POST`
- Full path: `/tenants/.../buildings/.../units/.../occupants`
- Status: `201`
- Response includes user and unit details
- UI: Resident name appears in unit row

---

### 2. Remove Occupant

**Operation**: Click "Remove" on occupant

**Console Output**:
```
[API] DELETE /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlka9amm0001ekipswl42dbq/units/cmlka9ana0003ekip7zzunkh5/occupants/cmlka9ans0005ekipullkna7a {
  headers: {
    Content-Type: "application/json",
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}

[API RESPONSE] /tenants/cmlhe1zy60000143er2fl3irs/buildings/cmlka9amm0001ekipswl42dbq/units/cmlka9ana0003ekip7zzunkh5/occupants/cmlka9ans0005ekipullkna7a (200) {
  "success": true
}
```

**Key Points**:
- Method: `DELETE`
- Full path includes occupantId: `/occupants/cmlka9ans0005ekipullkna7a`
- Status: `200`
- UI: Occupant removed immediately

---

## Error Scenarios

### Error: Unauthorized (Missing Token)

**Scenario**: Try API call without authentication

**Console Output**:
```
[API] GET /tenants/cmlhe1zy60000143er2fl3irs/buildings {
  headers: {
    Content-Type: "application/json",
    Authorization: "NONE"
  }
}

[API ERROR] /tenants/cmlhe1zy60000143er2fl3irs/buildings (401)
Error: Failed to fetch buildings: 401

Error thrown in UI:
"Failed to fetch buildings"
```

**Action**: User redirected to login

---

### Error: Cross-Tenant Access Denied

**Scenario**: Try to access building from different tenant

**Console Output**:
```
[API] GET /tenants/other_tenant_id/buildings/building_from_first_tenant {
  headers: { ... }
}

[API ERROR] /tenants/other_tenant_id/buildings/building_from_first_tenant (403)
Error: Failed to fetch building: 403

Error shown in UI:
"Failed to fetch building"
```

**Result**: 403 Forbidden returned (or 404 depending on API implementation)

---

### Error: Invalid Building ID

**Scenario**: Try to get non-existent building

**Console Output**:
```
[API] GET /tenants/cmlhe1zy60000143er2fl3irs/buildings/nonexistent_id {
  headers: { ... }
}

[API ERROR] /tenants/cmlhe1zy60000143er2fl3irs/buildings/nonexistent_id (404)
Error: Failed to fetch building: 404

Error shown in UI:
"Failed to fetch building"
```

---

## ✅ Verification Checklist

For each operation, verify:

- [ ] Endpoint is correct (method + path)
- [ ] Authorization header is present with Bearer token
- [ ] Request body has correct fields (if applicable)
- [ ] Status code is expected (200/201 for success, 4xx for errors)
- [ ] Response includes all required fields
- [ ] Response includes createdAt/updatedAt timestamps
- [ ] UI updates immediately after success
- [ ] Error message shown when operation fails
- [ ] No localStorage writes detected (only for auth token)
- [ ] Logs appear ONLY in development mode (not in production build)

---

## 🐛 Debugging with Logs

If something isn't working:

1. **Open DevTools**: Press F12
2. **Go to Console tab**: Shows all [API] logs
3. **Look for errors**: [API ERROR] messages
4. **Check status code**: 401 = auth issue, 403 = permission denied, 404 = not found, 500 = server error
5. **Verify headers**: Authorization header should have Bearer token
6. **Check endpoint**: Match against Phase 0 API documentation

---

## 📝 Template for Bug Reports

If you find an issue, include:

```
**What happened**:
[Describe the action]

**Expected**:
[API call shown]
[Response expected]

**Actual**:
[Console output showing error]

**Build**: [Commit hash]
**Browser**: [Chrome/Firefox/Safari version]
```

---

## 🎯 Success = Clear Logs

When everything works correctly, the Console should show a clear pattern:

```
[API] → [METHOD] [ENDPOINT] [HEADERS & BODY]
↓
Backend processes request
↓
[API RESPONSE] → [STATUS] [RESPONSE DATA]
↓
UI updates
```

With **NO localStorage access** for buildings/units/occupants data.

