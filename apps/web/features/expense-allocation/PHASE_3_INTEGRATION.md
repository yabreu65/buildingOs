# Expense Allocation Frontend - Phase 3 Integration Guide

## Overview

Phase 3 provides a complete frontend implementation for managing expense allocation categories and periods using React Query hooks and reusable UI components.

## File Structure

```
apps/web/features/expense-allocation/
├── services/
│   ├── expense-categories.api.ts    # API client for categories
│   └── expense-periods.api.ts       # API client for periods
├── hooks/
│   ├── useCategories.ts            # React Query hooks for categories
│   └── usePeriods.ts               # React Query hooks for periods
├── components/
│   ├── CategoriesList.tsx          # Display list of categories
│   ├── CategoryForm.tsx            # Create/edit category form
│   ├── PeriodsList.tsx             # Display list of periods
│   └── index.ts                    # Component exports
├── index.ts                         # Feature exports (api, hooks, components)
└── PHASE_3_INTEGRATION.md          # This file
```

## Quick Start

### 1. Basic Page Integration

```typescript
// app/(tenant)/[tenantId]/buildings/[buildingId]/expense-allocation/page.tsx
'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CategoriesList, CategoryForm, PeriodsList } from '@/features/expense-allocation';
import { UnitCategory } from '@/features/expense-allocation';

export default function ExpenseAllocationPage() {
  const { tenantId, buildingId } = useParams<{ tenantId: string; buildingId: string }>();
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<UnitCategory | undefined>();
  const [showPeriodForm, setShowPeriodForm] = useState(false);

  const handleEditCategory = (category: UnitCategory) => {
    setSelectedCategory(category);
    setShowCategoryForm(true);
  };

  const handleFormSuccess = () => {
    setShowCategoryForm(false);
    setSelectedCategory(undefined);
  };

  return (
    <div className="space-y-8">
      {/* Categories Section */}
      <section>
        <CategoriesList
          buildingId={buildingId}
          onEditCategory={handleEditCategory}
          onAutoAssignClick={() => {}}
        />
      </section>

      {/* Category Form Modal */}
      {showCategoryForm && (
        <CategoryForm
          buildingId={buildingId}
          category={selectedCategory}
          onSuccess={handleFormSuccess}
          onCancel={() => {
            setShowCategoryForm(false);
            setSelectedCategory(undefined);
          }}
        />
      )}

      {/* Create Category Button */}
      {!showCategoryForm && (
        <button
          onClick={() => setShowCategoryForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Nueva Categoría
        </button>
      )}

      {/* Periods Section */}
      <section>
        <PeriodsList
          buildingId={buildingId}
          onCreateClick={() => setShowPeriodForm(true)}
          onPeriodClick={(period) => {
            console.log('Period clicked:', period);
            // Navigate to period detail view
          }}
        />
      </section>
    </div>
  );
}
```

### 2. Using Hooks Directly

```typescript
import { useCategories, useCreateCategory, useDeleteCategory } from '@/features/expense-allocation';

export function MyComponent({ buildingId }: { buildingId: string }) {
  // Fetch categories
  const { data: categories, isPending, error } = useCategories(buildingId);

  // Create mutation
  const { mutateAsync: createCat } = useCreateCategory(buildingId);

  // Delete mutation
  const { mutateAsync: deleteCat } = useDeleteCategory(buildingId);

  const handleCreate = async () => {
    try {
      await createCat({
        name: 'My Category',
        minM2: 40,
        maxM2: 60,
        coefficient: 1.0,
      });
      console.log('Created!');
    } catch (error) {
      console.error('Failed to create:', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCat(id);
      console.log('Deleted!');
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  return (
    <div>
      {isPending && <p>Loading...</p>}
      {error && <p>Error: {error.message}</p>}
      {categories.map((cat) => (
        <div key={cat.id}>
          <p>{cat.name} ({cat.minM2} - {cat.maxM2})</p>
          <button onClick={() => handleDelete(cat.id)}>Delete</button>
        </div>
      ))}
      <button onClick={handleCreate}>Create</button>
    </div>
  );
}
```

## Component Documentation

### CategoriesList

Displays all unit categories for a building with edit/delete actions.

**Props:**
- `buildingId: string` - Building ID
- `onEditCategory: (category: UnitCategory) => void` - Callback when edit button clicked
- `onAutoAssignClick: () => void` - Callback when auto-assign button clicked

**Features:**
- Shows active categories in a table
- Shows inactive (deleted) categories in a separate section
- Auto-assign button with preview data
- Edit/delete buttons per category
- Empty state

### CategoryForm

Modal form to create or edit a unit category.

**Props:**
- `buildingId: string` - Building ID
- `category?: UnitCategory` - Existing category to edit (optional)
- `onSuccess: () => void` - Callback on successful save
- `onCancel: () => void` - Callback to close form

**Features:**
- Client-side validation
- Error display
- Loading state (disables form)
- Edit mode when category is provided

### PeriodsList

Displays all expense periods grouped by status (DRAFT, GENERATED, PUBLISHED).

**Props:**
- `buildingId: string` - Building ID
- `onCreateClick: () => void` - Callback when "New Period" button clicked
- `onPeriodClick: (period: ExpensePeriod) => void` - Callback when period card clicked

**Features:**
- Groups periods by status
- Shows amount in local currency format
- Shows due date
- Clickable cards for navigation
- Empty state

## React Query Hooks Reference

### Categories Hooks

```typescript
// Fetch all categories
const { data, isPending, error } = useCategories(buildingId);

// Create category
const { mutateAsync, isPending } = useCreateCategory(buildingId);
await mutateAsync({ name: 'Cat A', minM2: 40, maxM2: 60, coefficient: 1.0 });

// Update category
const { mutateAsync, isPending } = useUpdateCategory(buildingId);
await mutateAsync({
  categoryId: 'id',
  data: { name: 'New Name' }
});

// Delete category
const { mutateAsync, isPending } = useDeleteCategory(buildingId);
await mutateAsync(categoryId);

// Auto-assign preview (read-only)
const { data: previewResult } = useAutoAssignPreview(buildingId, false);

// Auto-assign and save
const { mutateAsync } = useAutoAssign(buildingId);
await mutateAsync(false); // force=false
```

### Periods Hooks

```typescript
// Fetch all periods
const { data, isPending } = usePeriods(buildingId, year, month, status);

// Fetch single period with charges
const { data: period } = usePeriod(buildingId, periodId);

// Create period
const { mutateAsync } = useCreatePeriod(buildingId);
await mutateAsync({
  year: 2026,
  month: 1,
  totalToAllocate: 300000,
  dueDate: '2026-02-01',
  concept: 'Expensas Comunes - Enero',
});

// Update period
const { mutateAsync } = useUpdatePeriod(buildingId, periodId);
await mutateAsync({ totalToAllocate: 350000 });

// Delete period
const { mutateAsync } = useDeletePeriod(buildingId);
await mutateAsync(periodId);

// Generate charges (DRAFT → GENERATED)
const { mutateAsync } = useGenerateCharges(buildingId, periodId);
await mutateAsync();

// Publish period (GENERATED → PUBLISHED)
const { mutateAsync } = usePublishPeriod(buildingId, periodId);
await mutateAsync();
```

## API Layer

All API calls go through the centralized `apiClient` with automatic:
- Authorization header injection
- 401 → logout/redirect
- Error message parsing
- TypeScript inference

See `services/expense-categories.api.ts` and `services/expense-periods.api.ts` for available functions.

## Error Handling

The hooks automatically:
- Invalidate related queries on mutation success
- Return errors via the `error` property
- Provide `isPending` for loading states

For UI feedback:
- Use toast notifications: `const { toast } = useToast(); toast('Success!', 'success')`
- Show error messages inline with the `error` property
- Display loading skeletons via `isPending`

## Next Steps

1. **Create the main page** (`app/.../expense-allocation/page.tsx`)
2. **Add sub-navigation** to the building layout (if needed)
3. **Implement PeriodForm** for creating/editing periods
4. **Implement PeriodDetail** view to show charges and actions
5. **Add toasts** for user feedback
6. **Test with E2E tests** (Playwright)

## Example: Full Period Management Page

```typescript
'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PeriodsList, PeriodForm, PeriodDetail } from '@/features/expense-allocation';
import { ExpensePeriod } from '@/features/expense-allocation';

export default function PeriodsPage() {
  const { buildingId } = useParams<{ buildingId: string }>();
  const [showForm, setShowForm] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<ExpensePeriod | null>(null);

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Main List */}
      <div className="col-span-2">
        <PeriodsList
          buildingId={buildingId}
          onCreateClick={() => setShowForm(true)}
          onPeriodClick={setSelectedPeriod}
        />
      </div>

      {/* Detail Sidebar */}
      {selectedPeriod ? (
        <PeriodDetail
          buildingId={buildingId}
          period={selectedPeriod}
          onClose={() => setSelectedPeriod(null)}
        />
      ) : (
        <div className="bg-gray-50 rounded-lg p-6 text-center">
          <p className="text-gray-500">Selecciona un período para ver detalles</p>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <PeriodForm
          buildingId={buildingId}
          onSuccess={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
```

## Troubleshooting

### "Cannot find module" errors
```bash
# Make sure the feature folder structure is correct and index.ts files export all components
ls apps/web/features/expense-allocation/
```

### Hooks not fetching data
- Check that `buildingId` is not undefined
- Verify the `enabled` condition in query hooks
- Check React Query DevTools for query state

### Forms not submitting
- Check console for error messages
- Verify the API endpoint is correct (e.g., `/buildings/{buildingId}/expense-categories`)
- Ensure JWT token is valid

### Invalid category error (409 Conflict)
- Likely range overlap. Check ranges of existing categories
- Ranges must not overlap: `minM2 <= existMax && newMax >= existMin` returns true = conflict

## Summary

Phase 3 provides:
- ✅ API services with proper TypeScript inference
- ✅ React Query hooks for all CRUD operations
- ✅ Reusable UI components (List, Form)
- ✅ Proper error/loading states
- ✅ Multi-tenant isolation via buildingId
- ✅ Follows BuildingOS frontend patterns

Ready for integration into the building dashboard!
