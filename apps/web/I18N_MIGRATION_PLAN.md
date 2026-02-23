# i18n Migration Plan - BuildingOS

## Overview
Complete migration of BuildingOS UI from hardcoded English strings to centralized Spanish (LATAM) with i18n infrastructure.

**Status**: Phase 1 Complete ✅ | Phase 2 In Progress

## Phase 1: Infrastructure ✅ COMPLETE
- [x] Created `apps/web/src/i18n/` directory
- [x] Created `es-419.json` with 300+ translation keys (Spanish LATAM)
- [x] Created `en.json` placeholder (English)
- [x] Created `i18n/index.ts` with `t()` function and utilities
- [x] Build verification: ✅ 0 errors

## Phase 2: Component Migration (IN PROGRESS)

### Areas to Migrate (Priority Order)

#### Priority 1: Super-Admin Features (Newest, most English strings)
1. **Leads Management** (`apps/web/app/super-admin/leads/`)
   - `page.tsx`: "Leads", "Filter by status", "New Lead", etc.
   - `[id]/page.tsx`: "Lead Information", "Status", "Convert Lead", etc.

2. **Tenants Management** (`apps/web/app/super-admin/tenants/`)
   - List: "Tenants", "Create Tenant", "Change Plan"
   - Detail: Form fields, status messages

3. **Super-Admin Layout** (`apps/web/app/super-admin/layout.tsx`)
   - Navigation: "Control Administrativo", menu items

#### Priority 2: Core Features
1. **Buildings** (`apps/web/features/buildings/`)
   - List/Detail pages
   - Creation/edit forms
   - Breadcrumbs and headers

2. **Units** (`apps/web/features/buildings/`)
   - Unit list and detail
   - Resident assignment
   - Access control messages

3. **Tickets** (`apps/web/features/buildings/components/tickets/`)
   - TicketsList, TicketForm, TicketDetail
   - Status badges, priority badges
   - Empty states

#### Priority 3: Secondary Features
1. **Communications** (`apps/web/features/buildings/components/communications/`)
2. **Documents** (`apps/web/features/buildings/components/documents/`)
3. **Payments/Finanzas** (`apps/web/features/buildings/components/payments/`)
4. **Vendors** (`apps/web/features/buildings/components/vendors/`)

#### Priority 4: Shared Components
1. **Buttons**: Common button text (Save, Cancel, Delete, etc.)
2. **Forms**: Labels, placeholders, validation messages
3. **Empty States**: "No results found", "No data"
4. **Error Messages**: Toast errors, modal errors
5. **Modals**: Confirmation dialogs, form modals

#### Priority 5: Utilities & Hooks
1. **Toast messages** in API calls
2. **Error messages** from API responses
3. **Validation messages** in form hooks
4. **Date formatting** (locale-aware)

### Migration Process

For each file, follow this pattern:

```typescript
// OLD (before)
<h1>Leads</h1>
<button>Create Lead</button>

// NEW (after)
import { t } from '@/i18n';

<h1>{t('superAdmin.leads.title')}</h1>
<button>{t('superAdmin.leads.create')}</button>
```

### Checklist for Each Component

- [ ] Import `t` function: `import { t } from '@/i18n'`
- [ ] Replace all English strings with `t('key')`
- [ ] Test component renders correctly
- [ ] Verify no console warnings for missing keys
- [ ] Commit with message: "i18n: Migrate [ComponentName] to es-419"

---

## Phase 3: Error Handling & API Integration

### Backend Changes
1. **Error Responses**: Return error codes + messageKey instead of English text
2. **Email Templates**: Migrate to `templates/es-419/`
3. **Audit Logging**: Use consistent Spanish labels

### Frontend Changes
1. **Error Handling**: Use error.code to look up messageKey
2. **Toast Messages**: Use `t()` for all API response messages
3. **Validation**: Use `t()` for form validation messages

---

## Phase 4: Advanced Features

### Date & Number Formatting
```typescript
// Use Intl API for locale-aware formatting
const dateFormatter = new Intl.DateTimeFormat('es-419');
const numberFormatter = new Intl.NumberFormat('es-419');
```

### Pluralization & Params
```typescript
// For future: support message parameters
t('payments.total', { count: 5 })
// => "Total 5 pagos"
```

### Component-Level Scoped Translators
```typescript
// Optional: Create scoped t() for components
import { createScopedTranslator } from '@/i18n';

const tLeads = createScopedTranslator('superAdmin.leads');
<h1>{tLeads('title')}</h1> // "Prospectos"
```

---

## Files to Migrate

### Super-Admin (Leads Priority)
```
apps/web/app/super-admin/leads/page.tsx
apps/web/app/super-admin/leads/[id]/page.tsx
apps/web/features/super-admin/leads/useLeads.ts
apps/web/features/super-admin/leads/leads.api.ts
```

### Buildings & Units
```
apps/web/app/[tenantId]/buildings/page.tsx
apps/web/app/[tenantId]/buildings/[buildingId]/page.tsx
apps/web/app/[tenantId]/buildings/[buildingId]/units/page.tsx
apps/web/app/[tenantId]/buildings/[buildingId]/units/[unitId]/page.tsx
apps/web/features/buildings/components/BuildingsList.tsx
apps/web/features/buildings/components/UnitsList.tsx
```

### Tickets
```
apps/web/features/buildings/components/tickets/TicketsList.tsx
apps/web/features/buildings/components/tickets/TicketForm.tsx
apps/web/features/buildings/components/tickets/TicketDetail.tsx
```

### Other Features
```
apps/web/features/buildings/components/communications/*
apps/web/features/buildings/components/documents/*
apps/web/features/buildings/components/payments/*
apps/web/features/buildings/components/vendors/*
```

### Shared Components
```
apps/web/shared/components/ui/*
apps/web/shared/components/marketing/*
```

---

## Success Criteria

- [ ] No English text visible in any user-facing UI
- [ ] All error messages display in Spanish
- [ ] Form validation messages in Spanish
- [ ] Empty states in Spanish
- [ ] Toast notifications in Spanish
- [ ] Email invitations in Spanish
- [ ] Build: 0 TypeScript errors
- [ ] Manual QA: Complete user flow without seeing English

---

## Notes

- **Key Naming Convention**: Use dot notation reflecting feature hierarchy
  - Example: `superAdmin.leads.title`, `buildings.units.create`
- **Fallback Strategy**: If key missing → shows key itself (useful for dev)
- **No Hardcoding**: Exception: Brand names, proper nouns (BuildingOS, tenant names)
- **Dates**: Use `new Intl.DateTimeFormat('es-419')` for locale-aware formatting
- **Future i18n**: Placeholder en.json ready; can expand with browser language detection

---

## Related Files

- Translation system: `apps/web/src/i18n/index.ts`
- Spanish keys: `apps/web/src/i18n/es-419.json`
- English placeholder: `apps/web/src/i18n/en.json`

---

**Last Updated**: Feb 23, 2026
**Next Phase**: Phase 2 - Component Migration (Leads first)
