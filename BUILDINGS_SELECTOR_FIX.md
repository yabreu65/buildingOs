# Fix: Buildings Selector in Global Units Page

## Problema Reportado
En `/[tenantId]/units`, el selector "Building" listaba opciones **incorrectas**:
- Mostraba edificios hardcodeados: "Edificio Principal", "Edificio Secundario", "Complejo Residencial A"
- No mostraba "Residencia San Cristobal" ni otros edificios reales del tenant
- Los datos venían de localStorage mock, NO del API real

## Root Cause

### Ubicación del Bug
**Archivo**: `apps/web/features/units/units.ui.tsx`

**Línea problemática (antes)**:
```typescript
const loadedBuildings = listBuildings(tenantId);  // ❌ Usa storage mock
const loadedResidents = listResidents(tenantId);
```

### El Problema
1. `listBuildings()` lee de localStorage con clave `bo_buildings_${tenantId}`
2. `seedBuildingsIfEmpty()` crea edificios MOCK si localStorage está vacío:
   ```typescript
   const mockBuildings = [
     { tenantId, name: 'Edificio Principal', address: 'Calle Principal 123' },
     { tenantId, name: 'Edificio Secundario', address: 'Avenida Secundaria 456' },
     { tenantId, name: 'Complejo Residencial A', address: 'Zona A' },
   ];
   ```
3. Cuando usuario crea unidad desde `/units`, ve solo estos edificios falsos
4. Edificios reales del API (incluyendo "Residencia San Cristobal") no aparecen

### Por qué sucedía
- `/buildings` página usa `useBuildings(tenantId)` hook → conecta a API real
- `/units` página usaba `listBuildings(tenantId)` → conecta a localStorage mock
- Dos fuentes de verdad completamente diferentes

## Solución Implementada

### Cambio Clave
**Antes**:
```typescript
// Mock storage
const loadedBuildings = listBuildings(tenantId);
seedBuildingsIfEmpty(tenantId);
```

**Después**:
```typescript
// Real API
const { buildings, loading: buildingsLoading } = useBuildings(tenantId);
```

### Archivo Modificado
`apps/web/features/units/units.ui.tsx`:

1. **Retiré importa**:
   - ❌ `import { listBuildings, seedBuildingsIfEmpty } from './buildings.storage'`
   - ✅ `import { useBuildings } from '../buildings/hooks'`

2. **Reemplazé la lógica**:
   - ❌ `listBuildings(tenantId)` → ✅ `useBuildings(tenantId)`
   - ❌ `seedBuildingsIfEmpty(tenantId)` → eliminado
   - Ahora obtiene datos reales del API al montar el componente

3. **Flujo de datos ahora**:
   ```
   /[tenantId]/units página
   ↓
   UnitCreateForm componente
   ↓
   useBuildings(tenantId) hook
   ↓
   buildingsApi.fetchBuildings(tenantId)
   ↓
   GET /buildings endpoint (real)
   ↓
   Base de datos (edificios reales)
   ```

## Validación: Multi-Tenant & Security

✅ **JWT Authorization**: `useBuildings` usa el hook que aplica JWT automáticamente
✅ **X-Tenant-Id Header**: `buildingsApi.fetchBuildings` envía header correcto
✅ **Tenant Isolation**: API filtra por tenant actual en query
✅ **No Hardcoding**: Cero opciones mock, 100% data-driven

### Request Headers
```
GET /buildings
Authorization: Bearer <JWT_TOKEN>
X-Tenant-Id: <tenant_id_actual>
```

El servidor responde solo con edificios del tenant autenticado.

## Testing

### Antes del Fix
1. Crear building "Residencia San Cristobal" en tenant X
2. Ir a `/units`
3. Click "+ Nueva Unidad"
4. Building selector muestra:
   - ❌ Edificio Principal (hardcodeado)
   - ❌ Edificio Secundario (hardcodeado)
   - ❌ Complejo Residencial A (hardcodeado)
   - ❌ NO muestra "Residencia San Cristobal"

### Después del Fix
1. Crear building "Residencia San Cristobal" en tenant X
2. Ir a `/units`
3. Click "+ Nueva Unidad"
4. Building selector muestra:
   - ✅ "Residencia San Cristobal"
   - ✅ Otros edificios reales del tenant
   - ✅ NO muestra opciones hardcodeadas
   - ✅ Refleja cambios en tiempo real

### Pasos de Verificación
```bash
# 1. Login a tenant
# 2. Crear building via /buildings
# 3. Ir a /units
# 4. Click "+ Nueva Unidad"
# 5. Verificar dropdown lista el building nuevo
# 6. Crear unit con ese building
# 7. Confirmar que unit quedó asociada al building correcto
```

## Criterios de Aceptación

✅ **Dropdown lista "Residencia San Cristobal"** (edificio real del tenant)
✅ **No aparecen opciones hardcodeadas** (Edificio Principal, etc.)
✅ **La creación de unidad funciona** con el building seleccionado
✅ **Buildings actualiza en tiempo real** si se crean nuevos desde `/buildings`

## Implicaciones

### Antes
- `/buildings` y `/units` tenían dos fuentes de datos diferentes
- Inconsistencia: crear building en `/buildings` no reflejaba en `/units`
- Usuarios veían edificios falsos en el selector de `/units`

### Después
- Una única fuente de verdad: Backend API
- Consistencia: todos los edificios siempre actualizados
- User experience: selector muestra datos reales

## Files Changed

| File | Change |
|------|--------|
| `apps/web/features/units/units.ui.tsx` | Reemplazó `listBuildings` (storage) con `useBuildings` (API) |

**LOC Modified**: ~10 líneas (imports + hook call)
**Build Status**: ✅ Both API and Web pass without errors

## No Breaking Changes
- Component `UnitCreateForm` no cambió (mismo props, mismos datos)
- Hook `useUnits` no cambió
- Backend endpoints no cambiaron
- User workflows idénticos, datos correctos

## Related
- Phase 1: Units Page API Integration (completed)
- Phase 2: Unit Creation Flow Unification (completed)
- Phase 3: Buildings Selector Data Source Fix (this work) ✅
