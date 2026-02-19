# AI Actions Bridge - Integration Guide

**Date**: Feb 18, 2026
**Status**: ✅ READY FOR INTEGRATION
**Effort**: 15 minutes per page

---

## 🎯 What This Guide Covers

How to integrate AI suggested actions in your tenant pages and modals so that:
1. Action buttons from AI assistant work end-to-end
2. Navigation happens automatically
3. Forms open with prefilled data
4. Permissions are validated client-side

---

## 📦 What You Get (Already Implemented)

### `aiActions.ts` Handler Module (420 lines)
```typescript
// Main function
handleSuggestedAction(action, context): Promise<ActionResult>

// Helper functions
isActionAllowed(actionType, permissions): boolean
getActionLabel(actionType): string

// 6 action handlers (internal)
handleViewTickets()
handleViewPayments()
handleViewReports()
handleSearchDocs()
handleDraftCommunication()
handleCreateTicket()
```

### `SuggestedActionsList` Component (130 lines)
```typescript
// Renders all allowed actions as buttons
// Handles loading/error states
// Validates permissions before showing
// No dependencies except react + next/navigation
```

### `AssistantWidget` (Updated)
```typescript
// Now accepts: permissions prop
// Uses SuggestedActionsList internally
// All action routing automated
```

---

## 🔌 Quick Integration (5 minutes)

### Step 1: Pass Permissions to Widget

**Before**:
```typescript
<AssistantWidget
  tenantId={tenantId}
  currentPage="dashboard"
  buildingId={activeBuilding?.id}
/>
```

**After**:
```typescript
// Get user permissions (from your auth context)
const { permissions } = useAuth(); // or from membership

<AssistantWidget
  tenantId={tenantId}
  currentPage="dashboard"
  buildingId={activeBuilding?.id}
  permissions={permissions}  // <- Add this
/>
```

**Done!** ✅ Action buttons now work.

---

## 📍 Integrating with Pages

### Example 1: Communications Page

File: `apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/communications/page.tsx`

```typescript
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/features/auth';
import CommunicationsList from './components/CommunicationsList';
import ComposerModal from './components/ComposerModal';

export default function CommunicationsPage({ params }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  // AI Actions Bridge sends: ?compose=1&title=X&body=Y
  const openComposer = searchParams.get('compose') === '1';
  const prefillTitle = searchParams.get('title') || '';
  const prefillBody = searchParams.get('body') || '';

  const handleCloseComposer = () => {
    // Clear query params to close modal
    router.push(`/${params.tenantId}/buildings/${params.buildingId}/communications`);
  };

  return (
    <div>
      <CommunicationsList buildingId={params.buildingId} />

      {/* Modal opens if AI action clicked */}
      {openComposer && (
        <ComposerModal
          buildingId={params.buildingId}
          initialTitle={prefillTitle}
          initialBody={prefillBody}
          onClose={handleCloseComposer}
        />
      )}
    </div>
  );
}
```

### Example 2: Tickets Page

File: `apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/tickets/page.tsx`

```typescript
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import TicketsList from './components/TicketsList';
import CreateTicketModal from './components/CreateTicketModal';

export default function TicketsPage({ params }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // AI Actions Bridge sends: ?newTicket=1&title=X&description=Y&unitId=Z
  const openCreateModal = searchParams.get('newTicket') === '1';
  const prefillTitle = searchParams.get('title') || '';
  const prefillDescription = searchParams.get('description') || '';
  const prefillUnitId = searchParams.get('unitId');

  const handleCloseModal = () => {
    router.push(`/${params.tenantId}/buildings/${params.buildingId}/tickets`);
  };

  return (
    <div>
      <TicketsList buildingId={params.buildingId} />

      {/* Modal opens if AI action clicked */}
      {openCreateModal && (
        <CreateTicketModal
          buildingId={params.buildingId}
          unitId={prefillUnitId}
          initialTitle={prefillTitle}
          initialDescription={prefillDescription}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}
```

---

## 🎨 Modal Component Tips

### For Communication Composer

```typescript
interface ComposerModalProps {
  buildingId: string;
  initialTitle?: string;      // <- Prefilled from AI
  initialBody?: string;       // <- Prefilled from AI
  onClose: () => void;
}

export default function ComposerModal({
  buildingId,
  initialTitle = '',
  initialBody = '',
  onClose,
}: ComposerModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);

  // Form works normally
  // User can edit/change prefilled values
  // User clicks "Send" to create

  return (
    <Modal open onClose={onClose}>
      <Form>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
        />
        <TextArea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message"
        />
        <Button onClick={handleSend}>Send</Button>
      </Form>
    </Modal>
  );
}
```

### For Ticket Creator

```typescript
interface CreateTicketModalProps {
  buildingId: string;
  unitId?: string;           // <- Prefilled from AI
  initialTitle?: string;     // <- Prefilled from AI
  initialDescription?: string; // <- Prefilled from AI
  onClose: () => void;
}

export default function CreateTicketModal({
  buildingId,
  unitId,
  initialTitle = '',
  initialDescription = '',
  onClose,
}: CreateTicketModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [selectedUnitId, setSelectedUnitId] = useState(unitId);

  // Form works normally
  // User can edit/change values
  // User clicks "Create" to submit

  return (
    <Modal open onClose={onClose}>
      <Form>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} />
        <Select value={selectedUnitId} onChange={setSelectedUnitId}>
          {/* Unit options */}
        </Select>
        <Button onClick={handleCreate}>Create Ticket</Button>
      </Form>
    </Modal>
  );
}
```

---

## 🔐 Security: What You Don't Have to Do

✅ **Already handled by AI Actions Bridge**:
- Permission validation (button hidden if no permission)
- Building/unit context matching (no cross-building access)
- Input sanitization (XSS prevention, max lengths)
- Action type validation (only known types)

⚠️ **You still must do** (in modal):
- Validate user input in form (custom validation rules)
- Re-validate permissions on backend when submitting
- Sanitize server-side (defense in depth)

Example backend validation:
```typescript
// POST /buildings/:buildingId/communications
@Post(':buildingId/communications')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RequireFeatureGuard)
async createCommunication(@Body() dto: CreateCommunicationDto, @Request() req) {
  // 1. Validate user has communications.publish
  if (!req.user.permissions.includes('communications.publish')) {
    throw new ForbiddenException();
  }

  // 2. Validate buildingId belongs to tenant
  const building = await this.buildings.findOne(dto.buildingId, tenantId);
  if (!building) throw new NotFoundException();

  // 3. Validate title/body are reasonable
  if (!dto.title || dto.title.length > 120) {
    throw new BadRequestException('Title invalid');
  }

  // 4. Save
  return this.communications.create(dto);
}
```

---

## 🧪 Test Scenarios

### Scenario 1: User Clicks "Draft Message"

```
1. AI suggests: DRAFT_COMMUNICATION { buildingId: 'bldg-123', title: 'Test', body: 'Hello' }
2. Widget renders button: "Draft Message"
3. User clicks button
4. AI Actions Bridge:
   - Checks: communications.publish permission ✓
   - Checks: buildingId matches context ✓
   - Routes to: /{tenantId}/buildings/{buildingId}/communications?compose=1&title=Test&body=Hello
5. Communications page loads
6. Detects ?compose=1
7. Opens ComposerModal with initialTitle='Test', initialBody='Hello'
8. User edits message
9. User clicks "Send"
10. Mutation sent to backend
11. Backend re-validates permissions
12. Communication created ✓
```

### Scenario 2: User Without Permission

```
1. AI suggests: VIEW_TICKETS { buildingId: 'bldg-123' }
2. Widget checks: isActionAllowed('VIEW_TICKETS', ['resident.role'])
   -> permissions don't include tickets.read
3. Button is NOT rendered
4. No error shown (silently filtered)
5. User doesn't see the button
```

### Scenario 3: Invalid Building Context

```
1. User in bldg-123 context
2. AI suggests: VIEW_TICKETS { buildingId: 'bldg-456' }
3. Widget renders button (permission exists)
4. User clicks
5. AI Actions Bridge validates: buildingId mismatch
6. Returns error: "Building mismatch - cannot access"
7. Toast/error displayed
8. No navigation
```

---

## 📊 Expected File Changes

### Files Already Updated ✅
- `apps/web/features/assistant/components/AssistantWidget.tsx` (added permissions prop)
- `apps/web/features/assistant/index.ts` (exported new components)

### Files You Need to Update

Per page that should support AI actions:

**Communications page**:
- Read `?compose=1`, `?title=X`, `?body=Y`
- Open modal when `compose=1`
- Pass `initialTitle` and `initialBody` to modal

**Tickets page**:
- Read `?newTicket=1`, `?title=X`, `?description=Y`, `?unitId=Z`
- Open modal when `newTicket=1`
- Pass initial values and unitId to modal

**Optional: Other pages**
- Tickets: Support `?newTicket=1` query params
- Communications: Support `?compose=1` query params
- Documents: Support `?q=query` on search
- Reports: No modal needed, just route

---

## 🚀 Rollout Plan

### Phase 1: Widget Integration (30 min)
1. Add `permissions` prop to AssistantWidget
2. Test in one page (e.g., tickets page)
3. Verify buttons render and hide based on permissions

### Phase 2: Modal Prefills (30 min per page)
1. Communications page: Add composer modal prefill support
2. Tickets page: Add creation modal prefill support
3. Test end-to-end: AI suggestion → Modal opens → Form prefilled → User submits

### Phase 3: Full Rollout (1 hour)
1. Deploy to staging
2. Manual testing: All 6 action types
3. Production deployment

---

## 📋 Acceptance Criteria

- [ ] AssistantWidget accepts `permissions` prop
- [ ] SuggestedActionsList filters buttons by permission
- [ ] Communications page supports `?compose=1&title=X&body=Y`
- [ ] Tickets page supports `?newTicket=1&title=X&description=Y&unitId=Z`
- [ ] ComposerModal shows prefilled title/body
- [ ] CreateTicketModal shows prefilled title/description/unitId
- [ ] User can edit prefilled values
- [ ] User must click "Send"/"Create" to execute (not automatic)
- [ ] Build: 0 TypeScript errors
- [ ] Manual test: All 6 action types work

---

## 🎓 Code Examples

### Full Communications Integration

```typescript
// pages/communications/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ComposerModal from './components/ComposerModal';
import CommunicationsList from './components/CommunicationsList';

export default function CommunicationsPage({ params }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [communicationCreated, setCommunicationCreated] = useState(false);

  // AI Actions Bridge opens modal with prefills
  const isComposing = searchParams.get('compose') === '1';
  const prefillTitle = searchParams.get('title') || '';
  const prefillBody = searchParams.get('body') || '';

  const handleCloseComposer = () => {
    // Clear params
    router.push(`/${params.tenantId}/buildings/${params.buildingId}/communications`);
  };

  const handleCommunicationCreated = () => {
    // Refresh list and close
    setCommunicationCreated(true);
    handleCloseComposer();
  };

  return (
    <div className="p-6">
      <h1>Communications</h1>

      {/* List of past communications */}
      <CommunicationsList
        buildingId={params.buildingId}
        key={communicationCreated ? 'refreshed' : 'normal'}
      />

      {/* Modal opens when AI action clicked */}
      {isComposing && (
        <ComposerModal
          buildingId={params.buildingId}
          initialTitle={prefillTitle}
          initialBody={prefillBody}
          onClose={handleCloseComposer}
          onCreated={handleCommunicationCreated}
        />
      )}
    </div>
  );
}
```

---

## 🔗 Related Documentation

- **AI_ACTIONS_CONTRACT.md** — Detailed action specs
- **AI_ASSISTANT_IMPLEMENTATION.md** — Backend implementation
- **QUICK_START_AI_ASSISTANT.md** — Widget quickstart

---

**Status**: Ready for implementation
**Date**: February 18, 2026
**Owner**: Engineering Team
