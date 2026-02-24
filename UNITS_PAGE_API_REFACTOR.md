# Units Page Refactor: API Integration Complete ✅

## Objetivo Completado
**`/[tenantId]/units` debe mostrar TODAS las unidades del tenant y reflejar nuevas unidades creadas.**

Antes: Solo usaba localStorage, mostraba unidades de un edificio específico
Después: Consume API backend, muestra TODAS las unidades del tenant, reflejos en tiempo real

---

## Backend Implementation

### 1. New Endpoint: GET /tenants/:tenantId/units
**File**: `apps/api/src/units/units.controller.ts`

Agregué un nuevo controlador tenant-scoped (además del existente building-scoped):

```typescript
@Get()
findAllByTenant(
  @TenantParam() tenantId: string,
  @Query('buildingId') buildingId?: string,
)
```

**Features:**
- ✅ Lista TODAS las unidades para un tenant
- ✅ Filtro opcional por buildingId (`?buildingId=xyz`)
- ✅ Multi-tenant isolation via `building.tenantId` constraint
- ✅ Ordena por nombre de edificio + label

### 2. Service Method: findAllByTenant()
**File**: `apps/api/src/units/units.service.ts`

```typescript
async findAllByTenant(tenantId: string, buildingId?: string) {
  const where: any = {
    building: { tenantId }, // Multi-tenant security
  };

  if (buildingId) where.buildingId = buildingId;

  return await this.prisma.unit.findMany({
    where,
    include: {
      building: { select: { id: true, name: true } },
      unitOccupants: { include: { user: true } },
    },
    orderBy: [{ building: { name: 'asc' } }, { label: 'asc' }],
  });
}
```

### 3. Module Registration
**File**: `apps/api/src/units/units.module.ts`

Registré el nuevo `BuildingUnitsController` para mantener el endpoint building-scoped existente:

```typescript
controllers: [UnitsController, BuildingUnitsController]
```

Esto permite ambos:
- `GET /tenants/:tenantId/units` (tenant-level, nuevo)
- `GET /tenants/:tenantId/buildings/:buildingId/units` (building-level, existente)

---

## Frontend Implementation

### 1. API Service
**File**: `apps/web/features/units/units.api.ts` (NEW)

Creé un servicio completo que envuelve los endpoints:

```typescript
export async function listUnitsByTenant(
  tenantId: string,
  buildingId?: string,
): Promise<Unit[]>

export async function createUnit(tenantId, buildingId, input): Promise<Unit>
export async function updateUnit(tenantId, buildingId, unitId, input): Promise<Unit>
export async function deleteUnit(tenantId, buildingId, unitId): Promise<void>
```

**Features:**
- ✅ Automatic JWT injection via getHeaders()
- ✅ Dev logging (request/response)
- ✅ Error handling con mensajes claros
- ✅ Type-safe interfaces para Unit, Building, etc.

### 2. Custom Hook: useUnits
**File**: `apps/web/features/units/useUnits.ts` (NEW)

```typescript
const { units, loading, error, refetch, createUnit, updateUnit, deleteUnit } = useUnits({
  tenantId,
  buildingId?: string // optional filter
});
```

**Capabilities:**
- ✅ Auto-fetch on mount y cuando cambian las dependencias
- ✅ Automatic refetch después de create/update/delete
- ✅ Loading y error states
- ✅ Methods: createUnit, updateUnit, deleteUnit
- ✅ Manual refetch vía refetch()

### 3. Refactored Component: units.ui.tsx
**File**: `apps/web/features/units/units.ui.tsx`

Cambios principales:
```typescript
// Antes: import { listUnits, createUnit, deleteUnit } from './units.storage';
// Después:
const { units, loading, error, refetch, createUnit, deleteUnit } = useUnits({ tenantId });
```

**Updates:**
- ✅ Reemplazó localStorage imports con hook
- ✅ Agregó loading y error states
- ✅ Actualizó handlers para usar API
- ✅ Cambió campo 'unitCode' → 'code' (match API)
- ✅ Tabla ahora muestra building info desde API response
- ✅ Delete modal ahora requiere buildingId (necesario para API call)

---

## Key Changes Summary

| Aspecto | Antes | Después |
|---------|-------|---------|
| **Data Source** | localStorage | Backend API |
| **Scope** | Un edificio | Todos los edificios del tenant |
| **Building Lookup** | Desde storage | Incluido en response |
| **Real-time Updates** | No | Sí (refetch after mutations) |
| **Multi-tenant Safe** | Limitado | Full isolation via building.tenantId |
| **Error Handling** | Básico | Completo con logging |

---

## Field Naming

Backend API usa:
- `code` (no `unitCode`)
- `building` (included in response)
- `unitOccupants` (array of occupants)

Frontend form ahora usa:
- `code` input field
- `{unit.code}` display
- `{unit.building?.name}` para mostrar edificio

---

## Testing

### Build Status
```bash
✅ npm run build --workspace apps/api    # OK
✅ npm run build --workspace apps/web    # OK
```

### Endpoints Available
```
GET /tenants/:tenantId/units
GET /tenants/:tenantId/units?buildingId=xyz
GET /tenants/:tenantId/buildings/:buildingId/units  (legacy)
POST /tenants/:tenantId/buildings/:buildingId/units
PATCH /tenants/:tenantId/buildings/:buildingId/units/:unitId
DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId
```

---

## Future Enhancements (Out of Scope)

1. **Occupants API Integration**: Currently resident assignment still uses storage layer
   - Pending: Full occupants CRUD API endpoints

2. **Building Filter Selector**: Component UI ready, could add dropdown to filter by buildingId

3. **Pagination**: Could add limit/skip params to API for large datasets

4. **Real-time Sync**: Could implement WebSocket subscriptions for multi-user editing

---

## Files Changed

| File | Type | Change |
|------|------|--------|
| `apps/api/src/units/units.controller.ts` | Modified | Added tenant-scoped endpoint |
| `apps/api/src/units/units.service.ts` | Modified | Added findAllByTenant method |
| `apps/api/src/units/units.module.ts` | Modified | Register BuildingUnitsController |
| `apps/web/features/units/units.api.ts` | Created | API service wrapper |
| `apps/web/features/units/useUnits.ts` | Created | Custom React hook |
| `apps/web/features/units/units.ui.tsx` | Modified | Use API instead of storage |
| `apps/web/shared/components/layout/SessionRefreshPrompt.tsx` | Fixed | Correct import paths |

**Total**: 7 files (5 modified, 2 created)

---

## Next Steps (Optional)

1. Add building filter dropdown to units page UI
2. Implement occupants API for resident assignment functionality
3. Add pagination support to the endpoint
4. Consider caching strategy for large unit lists
5. Add unit search/filter capabilities
