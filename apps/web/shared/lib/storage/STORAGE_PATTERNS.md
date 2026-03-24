# Storage Patterns & Centralization

## Overview

This document describes the centralized storage patterns for BuildingOS. All localStorage operations should use the `StorageService` abstraction to ensure consistency, type safety, and proper event handling across the application.

## Why StorageService?

Previously, localStorage was accessed directly throughout the codebase:
- **No validation**: Direct `JSON.parse()` could crash components
- **Scattered logic**: Every storage file had its own `getStorageKey()` and `safeParseArray()`
- **No event propagation**: UI components needed manual refresh logic
- **Multi-tenant confusion**: Inconsistent key patterns across features

StorageService provides:
- ✅ **Single source of truth**: One abstraction for all storage operations
- ✅ **Type safety**: Generics for compile-time type checking
- ✅ **Safe parsing**: Graceful handling of corrupt/stale data
- ✅ **Event propagation**: Automatic UI updates via `useBoStorageTick()`
- ✅ **Multi-tenant isolation**: Consistent key patterns with optional tenant scoping
- ✅ **Centralized error handling**: Errors logged but never thrown

## Key Patterns

### 1. Multi-Tenant Storage Keys

All storage keys follow a consistent pattern for isolation:

```typescript
// Global (non-tenant-scoped)
bo_token           // Auth token
bo_session         // Auth session
bo_last_tenant     // Last active tenant

// Tenant-scoped
bo_buildings_<tenantId>    // Buildings for tenant
bo_units_<tenantId>        // Units for tenant
bo_users_<tenantId>        // Users for tenant
bo_payments_<tenantId>     // Payments for tenant
bo_tenants                 // Super-admin: All tenants
```

### 2. Using StorageService

#### Set Data
```typescript
import { StorageService } from '@/shared/lib/storage';

// Global data (no tenant scope)
StorageService.set('token', 'jwt_token_here');

// Tenant-scoped data
const buildings = [
  { id: 'b1', name: 'Main Building', tenantId: 'tenant_1' },
];
StorageService.set('buildings', buildings, 'tenant_1');
```

#### Get Data
```typescript
import { StorageService } from '@/shared/lib/storage';

// Get with default value
const token = StorageService.get<string>('token');
const buildings = StorageService.get<Building[]>('buildings', 'tenant_1', []);

// Returns null if not found or parse fails
const session = StorageService.get<AuthSession>('session');
if (!session) {
  // Handle missing session
}
```

#### Remove Data
```typescript
// Remove single item
StorageService.remove('token');
StorageService.remove('buildings', 'tenant_1');

// Clear all items for an entity (all tenants)
StorageService.clearEntity('buildings');

// Clear all items for a tenant
StorageService.clearTenant('tenant_1');

// Clear all app data on logout
StorageService.clearPrefix('bo_');
```

### 3. Validation Helpers

#### safeParseArray
```typescript
import { safeParseArray } from '@/shared/lib/storage';

// Returns [] on null, parse error, or non-array
const buildings = safeParseArray<Building>(localStorage.getItem('bo_buildings_t1'));
```

#### normalize
```typescript
import { normalize } from '@/shared/lib/storage';

// For case-insensitive uniqueness checks
const normalizedName = normalize(buildingName);
const isDuplicate = buildings.some((b) => normalize(b.name) === normalizedName);
```

#### Other validators
```typescript
import {
  isValidString,
  isValidArray,
  hasRequiredKeys,
  isValidEmail,
  isValidUUID,
  isInRange
} from '@/shared/lib/storage';

// String validation
if (!isValidString(name)) throw new Error('Name required');

// Array validation
if (!isValidArray<Building>(buildingData)) return [];

// Structural validation
if (!hasRequiredKeys(obj, ['id', 'name', 'email'])) {
  throw new Error('Missing required fields');
}

// Email validation
if (!isValidEmail(email)) throw new Error('Invalid email');

// UUID validation
if (!isValidUUID(id)) throw new Error('Invalid ID format');

// Range validation
if (!isInRange(count, 1, 100)) throw new Error('Count must be 1-100');
```

### 4. Storage Events & UI Updates

All `StorageService` operations automatically emit `bo:storage` events. Components subscribe via `useBoStorageTick()`:

```typescript
import { useBoStorageTick } from '@/shared/lib/storage';
import { StorageService } from '@/shared/lib/storage';

export function MyComponent() {
  // Re-render when storage changes
  const tick = useBoStorageTick();

  const buildings = StorageService.get<Building[]>('buildings', tenantId, []);

  return (
    <div key={tick}>
      {buildings.map((b) => <div key={b.id}>{b.name}</div>)}
    </div>
  );
}
```

**How it works:**
1. Component calls `useBoStorageTick()` which returns a number that changes on every storage update
2. When user performs an action (create, update, delete), the handler calls `StorageService.set/remove/clear*`
3. `StorageService` emits `bo:storage` custom event
4. `useBoStorageTick()` hook detects event and updates state
5. Component re-renders automatically

### 5. Migrating Existing Code

#### Before (Scattered localStorage calls)
```typescript
// In buildings.storage.ts
const getStorageKey = (tenantId: string) => `bo_buildings_${tenantId}`;

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function listBuildings(tenantId: string): Building[] {
  const raw = localStorage.getItem(getStorageKey(tenantId));
  return safeParseArray<Building>(raw);
}

export function createBuilding(tenantId: string, input: CreateBuildingInput): Building {
  const buildings = listBuildings(tenantId);
  const newBuilding = { id: '...', ...input };
  localStorage.setItem(getStorageKey(tenantId), JSON.stringify([...buildings, newBuilding]));
  emitBoStorageChange();
  return newBuilding;
}
```

#### After (Using StorageService)
```typescript
// Remove getStorageKey() and safeParseArray() - not needed anymore
import { StorageService } from '@/shared/lib/storage';
import { emitBoStorageChange } from '@/shared/lib/storage';

export function listBuildings(tenantId: string): Building[] {
  return StorageService.get<Building[]>('buildings', tenantId, []);
}

export function createBuilding(tenantId: string, input: CreateBuildingInput): Building {
  const buildings = listBuildings(tenantId);
  const newBuilding = { id: '...', ...input };

  // StorageService.set() automatically handles JSON.stringify() and emits event
  StorageService.set('buildings', [...buildings, newBuilding], tenantId);

  return newBuilding;
}
```

## Multi-Tenant Isolation Checklist

When working with storage, ensure:

- [ ] Storage keys include `tenantId` when appropriate (✓ pattern: `bo_<entity>_<tenantId>`)
- [ ] `StorageService.get()` is passed the correct `tenantId`
- [ ] `StorageService.set/remove()` operations specify `tenantId`
- [ ] Unit tests verify tenant isolation (cross-tenant data is not visible)
- [ ] `useBoStorageTick()` is called in components displaying tenant data

Example violation:
```typescript
// ❌ BAD: Loses tenantId, mixes data from all tenants
const allBuildings = StorageService.get<Building[]>('buildings', undefined, []);

// ✅ GOOD: Properly scoped
const myBuildings = StorageService.get<Building[]>('buildings', tenantId, []);
```

## Error Handling

StorageService never throws errors. Instead:

1. **Parse errors**: Returns `null` or default value
2. **Set/remove errors**: Logged to console, operation skipped
3. **Browser quota exceeded**: Logged, operation fails silently

This prevents localStorage issues from crashing the app:

```typescript
// Safe: Returns [] on parse error, not throws
const buildings = StorageService.get<Building[]>('buildings', tenantId, []);

// Safe: Missing building won't throw, handled gracefully
const building = StorageService.get<Building>('building', tenantId);
if (!building) {
  // Handle missing data
}
```

## Performance Notes

1. **Limit data size**: localStorage is not a database. Keep entries < 5MB total
2. **Batch operations**: Update multiple items in one `set()` call when possible
3. **Clean on logout**: Call `StorageService.clearTenant()` or `StorageService.clearPrefix()` to prevent memory leaks
4. **Use default values**: Pass default values to avoid repeated get() calls

## Testing

```typescript
import { StorageService } from '@/shared/lib/storage';

// Reset between tests
beforeEach(() => {
  StorageService.clearPrefix('bo_');
  localStorage.clear();
});

// Test set/get
it('should store and retrieve buildings', () => {
  const buildings = [{ id: 'b1', name: 'Building 1' }];
  StorageService.set('buildings', buildings, 'tenant_1');

  const result = StorageService.get<Building[]>('buildings', 'tenant_1', []);
  expect(result).toEqual(buildings);
});

// Test multi-tenant isolation
it('should isolate data by tenant', () => {
  StorageService.set('buildings', [{ id: 'b1', name: 'T1 Building' }], 'tenant_1');
  StorageService.set('buildings', [{ id: 'b2', name: 'T2 Building' }], 'tenant_2');

  const t1 = StorageService.get<Building[]>('buildings', 'tenant_1', []);
  const t2 = StorageService.get<Building[]>('buildings', 'tenant_2', []);

  expect(t1[0].name).toBe('T1 Building');
  expect(t2[0].name).toBe('T2 Building');
});

// Test error handling
it('should return default on parse error', () => {
  localStorage.setItem('bo_buildings_tenant_1', '{invalid json');
  const result = StorageService.get<Building[]>('buildings', 'tenant_1', []);
  expect(result).toEqual([]);
});
```

## Migration Roadmap

### Phase 1 ✅ (COMPLETED)
- Created `StorageService`, `storage.validation.ts`, `index.ts`, documentation
- No breaking changes to existing storage files
- New code can opt-in to using StorageService

### Phase 2 (NEXT)
- Refactor storage files to use StorageService internally
- Remove duplicate `getStorageKey()` and `safeParseArray()` implementations
- Simplify storage file APIs

### Phase 3 (LATER)
- Migrate all component storage calls to StorageService
- Replace direct localStorage.getItem/setItem with StorageService.get/set
- Remove deprecated patterns from codebase

## FAQ

**Q: Should I still use the storage files (buildings.storage.ts)?**
A: Yes! Storage files are still the recommended abstraction for business logic (createBuilding, updateBuilding, etc.). They internally use StorageService.

**Q: When do I use StorageService directly?**
A: When you need quick access to raw data (list, get, remove). For complex operations (create with validation, update with checks), use the domain storage file.

**Q: What happens if localStorage is full?**
A: StorageService catches the QuotaExceededError and logs it. The operation silently fails, but the app doesn't crash.

**Q: Can I use localStorage in SSR?**
A: No. StorageService checks `typeof window !== 'undefined'` before any operation. Operations in SSR context are silently skipped.

**Q: How do I debug storage issues?**
A: Use `StorageService.getAllKeys()` or `StorageService.getTenantKeys(tenantId)` to inspect current storage.

## References

- [Event Propagation](./events.ts) - How storage changes trigger UI updates
- [React Hook](./useBoStorage.ts) - useBoStorageTick for reactive components
- [Validation](./storage.validation.ts) - Safe parsing and type checking helpers
