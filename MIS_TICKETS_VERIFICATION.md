# "Mis Tickets" - Verification Guide

**Purpose**: Step-by-step guide to verify "Mis Tickets" feature is working correctly
**Date**: Feb 16, 2026
**Scope**: Manual testing in development/staging environment

---

## Pre-Test Setup

### Database Preparation
Ensure you have test data:

```sql
-- Unit with tickets and assigned resident
INSERT INTO Unit (id, buildingId, label, unitCode, unitType, occupancyStatus)
VALUES ('unit-test-1', 'building-1', 'Unit 101', 'U101', 'APARTMENT', 'OCCUPIED');

-- Create 2 tickets for unit-test-1
INSERT INTO Ticket (id, tenantId, buildingId, unitId, title, description, category, priority, status, createdByUserId)
VALUES
  ('ticket-101-1', 'tenant-1', 'building-1', 'unit-test-1', 'Broken lock', 'Front door lock is broken', 'MAINTENANCE', 'HIGH', 'OPEN', 'admin-user-id'),
  ('ticket-101-2', 'tenant-1', 'building-1', 'unit-test-1', 'Water leak', 'Bathroom ceiling has water leak', 'EMERGENCY', 'URGENT', 'OPEN', 'admin-user-id');

-- Assign RESIDENT user to unit-test-1
INSERT INTO UnitOccupant (id, userId, unitId, role, createdAt)
VALUES ('occ-1', 'resident-user-id', 'unit-test-1', 'RESIDENT', NOW());

-- Create a RESIDENT user
INSERT INTO User (id, tenantId, email, name, roles)
VALUES ('resident-user-id', 'tenant-1', 'resident@test.com', 'Alice Resident', '["RESIDENT"]');
```

### Seeding Script (Alternative)
If using seeders, ensure seed functions create:
- 1 Unit with label "Unit 101"
- 2 Tickets in that unit (different statuses/priorities)
- 1 RESIDENT user assigned to that unit

---

## Test 1: RESIDENT Views Their Unit's Tickets

### Setup
- **User**: RESIDENT logged in as `resident@test.com`
- **Browser**: Chrome/Firefox Developer Tools open (Network tab visible)
- **Unit**: Navigate to `/tenant-1/buildings/building-1/units/unit-test-1`

### Steps

**Step 1**: Navigate to Unit Dashboard
```
Action: Click URL: /tenant-1/buildings/building-1/units/unit-test-1
Expected:
  - Page loads
  - Unit details shown: "Unit 101", "U101" code visible
  - "My Maintenance Requests" section visible with "Create Request" button
  - 2 tickets displayed in cards
```

**Step 2**: Verify Network Request
```
Action: Open Developer Tools → Network tab
        (if not already open)
Find request:
  - Method: GET
  - URL: /api/buildings/building-1/tickets?unitId=unit-test-1
  - Status: 200 OK
  - Headers: Authorization: Bearer [JWT_TOKEN]
Response body:
  - tickets array with 2 items
  - Each has unitId: "unit-test-1"
  - Includes: id, title, description, status, priority, category, comments[]
```

**Step 3**: Verify Ticket Display
```
Action: Look at rendered tickets in "My Maintenance Requests"
Expected:
  Card 1:
    - Title: "Broken lock"
    - Description preview: "Front door lock is broken"
    - Status badge: "OPEN" (green/blue)
    - Priority badge: "HIGH" (orange)
    - Category: "MAINTENANCE"
    - Comment count shown

  Card 2:
    - Title: "Water leak"
    - Description preview: "Bathroom ceiling has water leak"
    - Status badge: "OPEN"
    - Priority badge: "URGENT" (red)
    - Category: "EMERGENCY"
```

**Expected Result**: ✅ PASS
- Network request returns 200 with 2 tickets filtered by unitId
- Both tickets displayed correctly
- RESIDENT can see only tickets for their assigned unit

---

## Test 2: RESIDENT Creates a Ticket in Their Unit

### Setup
- **User**: RESIDENT logged in as `resident@test.com`
- **Page**: At Unit Dashboard for unit-test-1
- **Network Tab**: Open and monitoring

### Steps

**Step 1**: Click "Create Request" Button
```
Action: Click blue "Create Request" button
Expected:
  - Modal/form appears
  - Title: "Create Ticket"
  - Fields visible:
    - Title (text input)
    - Description (textarea)
    - Category (select dropdown)
    - Priority (select dropdown)
    - Note: unitId is NOT shown (pre-filled server-side)
  - Submit button: "Create Request"
  - Cancel button: "Cancel"
```

**Step 2**: Fill Form
```
Action: Fill in form fields:
  - Title: "Broken window blinds"
  - Description: "Bedroom window blinds are stuck"
  - Category: "MAINTENANCE"
  - Priority: "LOW"

Expected:
  - Form is valid (no error messages)
  - Submit button is enabled (not grayed out)
```

**Step 3**: Submit Form
```
Action: Click "Create Request" button
Expected:
  - Loading state: button shows spinner
  - Network request made:
    Method: POST
    URL: /api/buildings/building-1/tickets
    Headers: Authorization: Bearer [JWT_TOKEN]
    Body: {
      "title": "Broken window blinds",
      "description": "Bedroom window blinds are stuck",
      "category": "MAINTENANCE",
      "priority": "LOW",
      "unitId": "unit-test-1"  ← Auto-filled by frontend
    }
  - Status: 201 Created
```

**Step 4**: Verify Ticket Created
```
Action: Check response and UI update
Expected:
  - Toast notification: "Ticket created successfully" (green)
  - Modal closes
  - Tickets list refreshes
  - New ticket appears in list:
    - Title: "Broken window blinds"
    - Status: "OPEN"
    - Priority: "LOW"
    - Category: "MAINTENANCE"
  - List now shows 3 tickets total (2 original + 1 new)
```

**Expected Result**: ✅ PASS
- Ticket created with unitId automatically set to user's unit
- Appears immediately in their "My Tickets" list
- No manual unitId parameter needed

---

## Test 3: RESIDENT Views Ticket Detail and Reads Comments

### Setup
- **User**: RESIDENT logged in
- **Page**: At Unit Dashboard showing tickets
- **Tickets**: At least one ticket with comments should exist

### Steps

**Step 1**: Click on a Ticket
```
Action: Click on "Broken lock" ticket card
Expected:
  - Detail modal/view opens
  - Shows full ticket information:
    - Title: "Broken lock"
    - Description: Full text visible
    - Status: "OPEN" (badge, READ-ONLY for RESIDENT)
    - Priority: "HIGH" (badge, READ-ONLY)
    - Category: "MAINTENANCE"
    - Created by: "Admin User" (or creator name)
    - Created at: Timestamp
  - Status note visible: "(Status managed by building staff)" for RESIDENT
```

**Step 2**: Scroll to Comments Section
```
Action: Scroll down in detail view
Expected:
  - "Comments" section visible
  - List of existing comments (if any)
  - Comment form at bottom:
    - Textarea: placeholder "Add your comment..."
    - Button: "Post" (or "Send")
  - No delete/edit buttons on comments (read-only for non-author)
```

**Expected Result**: ✅ PASS
- Ticket details fully visible
- Comments section working
- Read-only view for RESIDENT (cannot change status/priority)

---

## Test 4: RESIDENT Comments on Ticket

### Setup
- **User**: RESIDENT logged in
- **Page**: Ticket detail view open
- **State**: Comment form visible

### Steps

**Step 1**: Write Comment
```
Action: Click comment textarea
        Type: "I've already tried unplugging and replugging the lock."
Expected:
  - Text appears in textarea
  - "Post" button becomes enabled (if validation present)
```

**Step 2**: Submit Comment
```
Action: Click "Post" button
Expected:
  - Loading state: button shows spinner
  - Network request made:
    Method: POST
    URL: /api/buildings/building-1/tickets/ticket-101-1/comments
    Headers: Authorization: Bearer [JWT_TOKEN]
    Body: { "body": "I've already tried unplugging and replugging the lock." }
  - Status: 201 Created
```

**Step 3**: Verify Comment Added
```
Action: Check UI update
Expected:
  - Toast notification: "Comment added" (green)
  - Comment textarea clears
  - New comment appears in list:
    - Author: "Alice Resident" (current user)
    - Timestamp: "just now" or recent time
    - Body: "I've already tried unplugging and replugging the lock."
  - Comment count increased (if shown)
```

**Expected Result**: ✅ PASS
- Comment successfully added
- Appears immediately in thread
- Scope validation passed (user can comment on their unit's ticket)

---

## Test 5: RESIDENT Blocked from Accessing Other's Unit (Access Control)

### Setup
- **User**: RESIDENT logged in as `alice@test.com` (only has unit-test-1)
- **Attacker Action**: Manually change URL to access unit-test-2 (different unit)

### Steps

**Step 1**: Try to Access Other's Unit
```
Action: Manually navigate to: /tenant-1/buildings/building-1/units/unit-test-2
        (unit-test-2 belongs to another RESIDENT)
Expected:
  - Page loads
  - UnitDashboardPage checks access:
    - isOccupantOfUnit = false (alice not in unit-test-2's occupants)
    - hasAccess = false
  - Shows "Access Denied" message with Lock icon
  - Message: "You don't have permission to access this unit. Residents can only view their assigned units."
  - "Go Back" button visible
```

**Expected Result**: ✅ PASS
- Frontend access control prevents rendering unit details
- No "My Maintenance Requests" section shown
- User gets clear error message
- Security boundary enforced at frontend level

---

## Test 6: RESIDENT Blocked from Accessing Other's Unit (API Level)

### Setup
- **User**: RESIDENT logged in as `alice@test.com` (only has unit-test-1)
- **Developer Tools**: Network tab open, monitoring API calls
- **Attacker Action**: Make direct API call for other's unit

### Steps

**Step 1**: Make Direct API Request
```
Using curl/Postman/Browser console:

curl -H "Authorization: Bearer RESIDENT_JWT_TOKEN" \
     "http://localhost:3000/api/buildings/building-1/tickets?unitId=unit-test-2"
```

**Expected Response**: ❌ 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Unit not found or does not belong to you",
  "error": "Not Found"
}
```

**Explanation**:
- Controller detects RESIDENT role
- Calls validateResidentUnitAccess(tenantId, alice_id, "unit-test-2")
- Service queries: "Do I (alice) have access to unit-test-2?"
- Answer: No
- Returns 404 (same as if unit doesn't exist - no enumeration)

**Expected Result**: ✅ PASS
- Backend scope validation working
- Even if frontend is bypassed, user gets 404
- No tickets from other units returned
- No error details leaked

---

## Test 7: ADMIN Can View Any Unit's Tickets

### Setup
- **User**: TENANT_ADMIN logged in as `admin@test.com`
- **Role**: TENANT_ADMIN (can manage all units)
- **Unit**: Navigate to unit-test-2 (not their assigned unit)

### Steps

**Step 1**: Access Another User's Unit
```
Action: Navigate to: /tenant-1/buildings/building-1/units/unit-test-2
Expected:
  - Page loads successfully
  - UnitDashboardPage checks access:
    - isAdmin = true (TENANT_ADMIN has full access)
    - hasAccess = true
  - Unit details displayed
  - "My Maintenance Requests" section appears
```

**Step 2**: View Tickets
```
Action: Observe ticket list for unit-test-2
Expected:
  - Network request: GET /buildings/building-1/tickets?unitId=unit-test-2
  - Status: 200 OK
  - Response includes all tickets for unit-test-2
  - No scope validation errors
  - All tickets for this unit displayed
```

**Step 3**: Verify Admin Can Manage
```
Action: Try to create/comment on ticket
Expected:
  - "Create Request" button works
  - Can fill form and submit
  - POST request succeeds
  - Comments can be added
  - Full management capabilities available
```

**Expected Result**: ✅ PASS
- Admin access works normally
- No scope restrictions on non-RESIDENT roles
- Can view/create/comment on any unit's tickets
- Full backward compatibility

---

## Test 8: Create Ticket Without unitId (Building-Level)

### Setup
- **User**: RESIDENT logged in
- **Page**: Building Dashboard (not Unit Dashboard)
- **Intention**: Create building-level (not unit-specific) ticket

### Steps

**Step 1**: Navigate to Building Tickets Tab
```
Action: Go to /tenant-1/buildings/building-1/tickets (building-level tickets)
Expected:
  - Building Tickets page loads
  - List of all building's tickets shown
  - "Create Ticket" button visible
```

**Step 2**: Create Ticket Without Unit
```
Action: Click "Create Ticket"
        Fill form:
          - Title: "Building hallway dark"
          - Description: "Hallway lights are out"
          - Category: "MAINTENANCE"
          - Priority: "MEDIUM"
          - Unit: [Leave blank/null]
        Submit

Expected:
  - POST request to /buildings/building-1/tickets
  - Body includes: unitId: null
  - Status: 201 Created
  - Scope validation skipped (unitId is null, so no validation)
```

**Step 3**: Verify Ticket Created
```
Action: Check building tickets list
Expected:
  - New ticket appears in list
  - unitId: null (building-level, not unit-specific)
  - Visible to all RESIDENTs and admins
```

**Expected Result**: ✅ PASS
- Building-level tickets allowed (no unitId required)
- Scope validation only applies when unitId provided
- RESIDENT can create building-level issues

---

## Test 9: RESIDENT Reassignment Changes Access

### Setup
- **User**: alice@test.com (currently has unit-a access)
- **Database**: UnitOccupant exists for alice → unit-a
- **Action**: Admin removes alice from unit-a and adds to unit-b

### Steps

**Step 1**: Before Removal
```
Action: alice views unit-a tickets
        GET /buildings/building-1/tickets?unitId=unit-a
Expected:
  - Status: 200 OK
  - Tickets returned for unit-a
```

**Step 2**: Admin Removes Alice from Unit-A
```
Action (as admin): DELETE /occupants/unit-a/alice
Expected:
  - alice's UnitOccupant record deleted
  - alice no longer in unit-a's occupants
```

**Step 3**: After Removal (Old Unit)
```
Action: alice tries to view unit-a tickets again
        GET /buildings/building-1/tickets?unitId=unit-a
Expected:
  - validateResidentUnitAccess called
  - getUserUnitIds returns: [] (no units)
  - Validation fails: [] does not include "unit-a"
  - Status: 404 Not Found
  - Message: "Unit not found or does not belong to you"
```

**Step 4**: Admin Adds Alice to Unit-B
```
Action (as admin): POST /occupants/unit-b/alice with role=RESIDENT
Expected:
  - New UnitOccupant record created
  - alice now in unit-b's occupants
```

**Step 5**: After Assignment (New Unit)
```
Action: alice views unit-b tickets
        GET /buildings/building-1/tickets?unitId=unit-b
Expected:
  - validateResidentUnitAccess called
  - getUserUnitIds returns: ["unit-b"]
  - Validation passes: ["unit-b"] includes "unit-b"
  - Status: 200 OK
  - Tickets returned for unit-b
```

**Expected Result**: ✅ PASS
- Access revoked immediately after removal
- Access granted immediately after assignment
- No caching issues
- Changes atomic and effective immediately

---

## Verification Checklist

### Frontend Verification
- [ ] Unit Dashboard loads for authorized users
- [ ] "My Maintenance Requests" section visible
- [ ] Tickets pre-filtered by unitId (no manual selection)
- [ ] "Create Request" button works
- [ ] Form submission includes pre-filled unitId
- [ ] Comments work (add/view)
- [ ] Access Denied shown for unauthorized users
- [ ] No 404 errors in browser console

### API Verification
- [ ] GET /buildings/:buildingId/tickets?unitId=X returns 200 for authorized RESIDENT
- [ ] GET /buildings/:buildingId/tickets?unitId=X returns 404 for unauthorized RESIDENT
- [ ] POST /buildings/:buildingId/tickets with unitId validates access
- [ ] GET /buildings/:buildingId/tickets/:ticketId validates unit access
- [ ] POST /buildings/:buildingId/tickets/:ticketId/comments validates unit access
- [ ] Admin role bypasses validation
- [ ] No sensitive information in error messages

### Security Verification
- [ ] RESIDENT cannot enumerate units (same 404 for all unauthorized)
- [ ] RESIDENT cannot see other's tickets (404 or empty)
- [ ] RESIDENT cannot create in other's unit (404)
- [ ] RESIDENT cannot comment on other's tickets (404)
- [ ] Reassignment immediately changes access
- [ ] JWT token validated on every request
- [ ] No credentials in logs or console

### Data Verification
- [ ] Tickets have correct unitId
- [ ] Comments linked to correct tickets
- [ ] No cross-tenant data visible
- [ ] Timestamps accurate
- [ ] User info correct (name, email, phone)

---

## Summary

**All tests should result in ✅ PASS**

If any test fails:
1. Check browser console for errors
2. Check Network tab for failed requests (4xx, 5xx)
3. Check backend logs for validation errors
4. Verify JWT token is valid (not expired)
5. Verify test data is correctly seeded
6. Check that RESIDENT unit-scope enforcement code is deployed

**Expected Outcome**: "Mis Tickets" feature fully working with:
- ✅ Access control at frontend (UnitDashboard)
- ✅ Scope validation at backend (TicketsController + TicketsService)
- ✅ Reusing existing endpoints (no new API needed)
- ✅ Clear security boundaries (404 for unauthorized)
- ✅ Full feature parity with Building Dashboard Tickets

