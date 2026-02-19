# AI Actions Contract

**Date**: Feb 18, 2026
**Status**: ✅ IMPLEMENTED
**Purpose**: Define the contract between AI Assistant suggestions and UI/Navigation

---

## 🎯 Overview

The **AI Actions Bridge** converts AI suggested actions into real navigation and UI prefills:
- Validates action type and payload
- Checks user permissions
- Sanitizes inputs (prevents XSS, oversized payloads)
- Routes to correct page
- Opens modals with prefilled data
- **Never** executes mutations automatically

---

## 📋 Action Types (MVP)

### 1. VIEW_TICKETS
Navigate to tickets list for a building.

**Payload**:
```json
{
  "type": "VIEW_TICKETS",
  "payload": {
    "buildingId": "bldg-123"
  }
}
```

**Routing**:
```
/{tenantId}/buildings/{buildingId}/tickets
```

**Permissions Required**:
- `tickets.read`

**Validation**:
- buildingId must match context.buildingId (if provided)
- buildingId must exist in tenant

**UX**:
- Button: "View Tickets"
- Click → Navigate to tickets page
- Applies no additional filters (user can filter manually)

---

### 2. VIEW_PAYMENTS
Navigate to payments/finance page for a building.

**Payload**:
```json
{
  "type": "VIEW_PAYMENTS",
  "payload": {
    "buildingId": "bldg-123"
  }
}
```

**Routing**:
```
/{tenantId}/buildings/{buildingId}/payments
```

**Permissions Required**:
- `payments.review`

**Validation**:
- buildingId must match context.buildingId (if provided)
- buildingId must exist in tenant

**UX**:
- Button: "View Payments"
- Click → Navigate to payments page

---

### 3. VIEW_REPORTS
Navigate to reports (tenant-wide or building-scoped).

**Payload**:
```json
{
  "type": "VIEW_REPORTS",
  "payload": {
    "buildingId": "bldg-123" // optional
  }
}
```

**Routing**:
```
# If buildingId:
/{tenantId}/buildings/{buildingId}/reports

# If no buildingId:
/{tenantId}/reports
```

**Permissions Required**:
- `reports.read`

**Validation**:
- buildingId must match context.buildingId (if provided)
- buildingId must exist in tenant (if provided)

**UX**:
- Button: "View Reports"
- Click → Navigate to reports

---

### 4. SEARCH_DOCS
Navigate to documents with search query applied.

**Payload**:
```json
{
  "type": "SEARCH_DOCS",
  "payload": {
    "query": "insurance",
    "buildingId": "bldg-123", // optional
    "unitId": "unit-456" // optional
  }
}
```

**Routing**:
```
# Full scope (tenant-wide):
/{tenantId}/documents?q={query}

# Building scope:
/{tenantId}/buildings/{buildingId}/documents?q={query}

# Unit scope:
/{tenantId}/buildings/{buildingId}/units/{unitId}?tab=documents&q={query}
```

**Permissions Required**:
- `documents.read`

**Validation**:
- query required (max 200 chars)
- query sanitized (no XSS)
- buildingId/unitId must match context (if provided)

**UX**:
- Button: "Search Documents"
- Click → Navigate with search query
- Search field pre-populated
- Results filtered automatically

---

### 5. DRAFT_COMMUNICATION
Navigate to communications and open composer modal with prefilled title/body.

**Payload**:
```json
{
  "type": "DRAFT_COMMUNICATION",
  "payload": {
    "buildingId": "bldg-123",
    "title": "Important Notice",    // optional
    "body": "Please check..." // optional
  }
}
```

**Routing**:
```
/{tenantId}/buildings/{buildingId}/communications
  ?compose=1
  &title={sanitized_title}
  &body={sanitized_body}
```

**Permissions Required**:
- `communications.publish`

**Validation**:
- buildingId required
- buildingId must match context.buildingId (if provided)
- title max 120 chars
- body max 2000 chars
- Both sanitized (allowed: alphanumeric, Spanish chars, basic punctuation)
- XSS prevention: Input validation on backend

**UX**:
- Button: "Draft Message"
- Click → Navigate to communications page
- Query params signal: Open composer modal
- Modal prefilled with title/body
- User must click "Send" to execute (not automatic)

**Implementation Notes**:
- `?compose=1` signals to page: open modal
- Communication composer reads query params on mount
- Clears params after user dismisses modal (no state leak)

---

### 6. CREATE_TICKET
Navigate to tickets and open creation modal with prefilled title/description/unitId.

**Payload**:
```json
{
  "type": "CREATE_TICKET",
  "payload": {
    "buildingId": "bldg-123",
    "unitId": "unit-456", // optional
    "title": "Fix door lock", // optional
    "description": "Door lock broken..." // optional
  }
}
```

**Routing**:
```
# Building scope:
/{tenantId}/buildings/{buildingId}/tickets
  ?newTicket=1
  &title={sanitized_title}
  &description={sanitized_description}

# Unit scope (if unitId):
/{tenantId}/buildings/{buildingId}/units/{unitId}
  ?newTicket=1
  &title={sanitized_title}
  &description={sanitized_description}
  &unitId={unitId}
```

**Permissions Required**:
- `tickets.write`

**Validation**:
- buildingId required
- buildingId must match context.buildingId (if provided)
- unitId (if provided) must match context.unitId
- title max 120 chars
- description max 2000 chars
- Both sanitized

**UX**:
- Button: "Create Ticket"
- Click → Navigate to unit or building page
- Query params signal: Open creation modal
- Modal prefilled with title/description/unitId
- User must click "Create" to execute (not automatic)

---

## 🔒 Security Rules

### 1. Validation
```typescript
// All actions validated before routing
if (!action || !action.type) return error

// Type must be known
validTypes = ['VIEW_TICKETS', 'VIEW_PAYMENTS', 'VIEW_REPORTS',
              'SEARCH_DOCS', 'DRAFT_COMMUNICATION', 'CREATE_TICKET']
if (!validTypes.includes(action.type)) return error
```

### 2. Permission Checking
```typescript
// Frontend: Check before rendering button
const allowed = isActionAllowed(actionType, userPermissions)
if (!allowed) hideButton()

// Backend: Re-validate on payload save
// (When composer/ticket creator sends actual mutation)
```

### 3. Sanitization
```typescript
// Input limits and XSS prevention
title    = sanitize(input, maxLength: 120)
description = sanitize(input, maxLength: 2000)
query    = sanitize(input, maxLength: 200)

// Sanitize function:
// - Trims whitespace
// - Limits to maxLength
// - Removes dangerous chars
// - Allows: alphanumeric, Spanish chars (áéíóú), basic punctuation (.,'!?-)
// - URL-encodes when passed as query param
```

### 4. Context Validation
```typescript
// Verify requested resource matches accessible context
if (action.buildingId && context.buildingId) {
  if (action.buildingId !== context.buildingId) {
    return error("Building mismatch")
  }
}

if (action.unitId && context.unitId) {
  if (action.unitId !== context.unitId) {
    return error("Unit mismatch")
  }
}
```

### 5. No Auto-Execution
```typescript
// All actions ONLY navigate/prefill, never execute mutations
✓ Route to page
✓ Open modal with data
✗ Create resource
✗ Send message
✗ Save payment

// User must confirm/click "Send"/"Create" in modal
```

---

## 📊 Error Handling

### Frontend (in SuggestedActionsList)

```json
{
  "success": false,
  "error": "string error message"
}
```

**Error Messages** (user-friendly):
- `"Building context required for tickets"`
- `"Building mismatch - cannot access"`
- `"You do not have permission to view tickets"`
- `"Search query required"`
- `"Invalid action"`
- `"Unknown action type: X"`

**UX**:
- Toast/inline error message appears
- Button text: "View Tickets" → remains unchanged
- User can retry or close

---

## 🧪 Test Cases

### Scenario 1: Happy Path (Has Permission)
```
User: OPERATOR with tickets.read permission
Action: VIEW_TICKETS { buildingId: 'bldg-123' }
Context: tenantId='tenant-1', buildingId='bldg-123'

Expected:
✓ Button renders
✓ Click navigates to /{tenantId}/buildings/{buildingId}/tickets
✓ No error
```

### Scenario 2: Missing Permission
```
User: RESIDENT (no tickets.read)
Action: VIEW_TICKETS { buildingId: 'bldg-123' }

Expected:
✓ Button does NOT render
✓ No error shown (just hidden)
```

### Scenario 3: Context Mismatch
```
User: OPERATOR in bldg-123
Action: VIEW_TICKETS { buildingId: 'bldg-456' }
Context: buildingId='bldg-123'

Expected:
✗ Button might render (permission exists)
✓ Click shows error: "Building mismatch - cannot access"
✗ No navigation
```

### Scenario 4: Prefill with Sanitization
```
User: TENANT_ADMIN
Action: DRAFT_COMMUNICATION {
  buildingId: 'bldg-123',
  title: 'Important notice (please read)',
  body: 'Please check your payment status<script>alert("xss")</script>'
}

Expected:
✓ Navigate to communications page with params:
  ?compose=1&title=Important%20notice&body=Please%20check...
✓ Script tag removed (sanitized)
✓ Modal opens with safe title/body
```

### Scenario 5: Unknown Action Type
```
User: Anyone
Action: { type: 'INVALID_ACTION' }

Expected:
✗ Button does NOT render
✓ No navigation
✓ Console error (logged)
```

---

## 🔄 Flow Diagram

```
User asks AI something
         ↓
AI responds with suggestedActions[]
         ↓
AssistantWidget renders SuggestedActionsList
         ↓
SuggestedActionsList:
  - Filters actions by permission
  - For each allowed action, render button
         ↓
User clicks "View Tickets" button
         ↓
handleSuggestedAction() called:
  1. Validate action.type
  2. Check user permission
  3. Validate payload/context
  4. Sanitize inputs
  5. Route to page
  6. Open modal (if needed)
         ↓
Page loads with prefilled data
         ↓
User sees form/list with suggested data
         ↓
User confirms/clicks "Create"/"Send"
         ↓
Mutation sent to backend
         ↓
Backend re-validates (redundant but safe)
         ↓
Resource created (or not, if validation fails)
```

---

## 📝 Implementation Checklist

### Backend
- ✅ SuggestedAction type with 6 action types
- ✅ AssistantController returns suggestedActions array
- ✅ RBAC filtering (service-level)
- ✅ No action execution (just return structure)

### Frontend
- ✅ aiActions.ts: handleSuggestedAction() main handler
- ✅ aiActions.ts: 6 action handlers (handleViewTickets, etc.)
- ✅ aiActions.ts: Sanitization (120 char titles, 2000 char bodies)
- ✅ aiActions.ts: Permission checking (isActionAllowed)
- ✅ SuggestedActionsList.tsx: Render buttons with permission check
- ✅ SuggestedActionsList.tsx: Error handling and display
- ✅ AssistantWidget: Integration of SuggestedActionsList
- ✅ AssistantWidget: Accept permissions prop

### Pages/Modals (Not in scope, but compatible)
- `CommunicationComposer`: Must read `?compose=1&title=X&body=Y`
- `CreateTicketModal`: Must read `?newTicket=1&title=X&description=Y&unitId=Z`

---

## 🔗 Related Files

**Frontend**:
- `apps/web/features/assistant/handlers/aiActions.ts` (420 lines)
- `apps/web/features/assistant/components/SuggestedActionsList.tsx` (130 lines)
- `apps/web/features/assistant/components/AssistantWidget.tsx` (updated)

**Backend**:
- `apps/api/src/assistant/assistant.service.ts` (filter actions by RBAC)
- `apps/api/src/assistant/assistant.controller.ts` (return suggestedActions)

---

## ✅ Acceptance Criteria

| # | Criterion | Status |
|----|-----------|--------|
| 1 | 6 action types defined | ✅ |
| 2 | Validation on action.type | ✅ |
| 3 | Permission check before render | ✅ |
| 4 | Sanitization (max lengths) | ✅ |
| 5 | Context validation (no cross-building) | ✅ |
| 6 | Error handling (user-friendly messages) | ✅ |
| 7 | No auto-execution (only navigate/prefill) | ✅ |
| 8 | SuggestedActionsList component | ✅ |
| 9 | AssistantWidget integration | ✅ |
| 10 | Build: 0 TypeScript errors | ✅ |

---

**Status**: Implementation complete, ready for testing
**Date**: February 18, 2026
**Owner**: Engineering Team
