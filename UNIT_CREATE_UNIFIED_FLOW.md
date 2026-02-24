# Flujo Unificado: Crear Unidad

## Objetivo Completado
**Unificar el flujo "Crear unidad" para ser exactamente el mismo desde:**
- A) `/buildings/:buildingId/units` (contexto de edificio específico)
- B) `/units` (dashboard global de tenant)

## Restricciones Cumplidas
✅ NO crear lógica duplicada
✅ Un solo componente de formulario (`UnitCreateForm`)
✅ Unit.code obligatorio y buildingId obligatorio
✅ Validaciones alineadas (frontend + backend)

---

## Arquitectura

### 1. Componente Unificado: `UnitCreateForm`

**Ubicación**: `apps/web/features/units/components/UnitCreateForm.tsx`

**Props**:
```typescript
interface UnitCreateFormProps {
  tenantId: string;
  buildings: Building[];
  defaultBuildingId?: string;  // Si existe: building pre-selected, selector hidden
  onSuccess: (unit: Unit) => void;
  onCancel: () => void;
  onCreateUnit: (buildingId: string, input: CreateUnitInput) => Promise<Unit>;
}
```

**Comportamiento**:
- Si `defaultBuildingId` existe: selector de building **oculto** (contexto = edificio específico)
- Si NO existe: selector de building **visible y requerido** (contexto = global)
- Campo `code`: **SIEMPRE obligatorio** (validación Zod)
- Campos opcionales: label, unitType, occupancyStatus
- Todos los campos se validan identicamente en ambos contextos

### 2. Flujo A: `/buildings/:buildingId/units`

**Archivo**: `apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/units/page.tsx`

**Uso del componente**:
```tsx
<UnitCreateForm
  tenantId={tenantId}
  buildings={buildings}
  defaultBuildingId={buildingId}  // ← Pre-selected
  onSuccess={handleCreateSuccess}
  onCancel={() => setShowCreateForm(false)}
  onCreateUnit={handleCreateUnit}
/>
```

**Lo que ocurre**:
1. `UnitCreateForm` recibe el `defaultBuildingId` del URL param
2. Selector de building está **oculto** (no necesario seleccionar)
3. Usuario solo llena: code (obligatorio), label, unitType, occupancyStatus
4. Form valida con el mismo schema Zod que contexto global
5. Callback `onCreateUnit` llama al hook `useUnits` del building
6. Después de éxito: refetch automático de unidades del building

### 3. Flujo B: `/units` (Dashboard Global)

**Archivo**: `apps/web/features/units/units.ui.tsx`

**Uso del componente**:
```tsx
<UnitCreateForm
  tenantId={tenantId || ''}
  buildings={buildings}
  // defaultBuildingId omitido intencionalmente
  onSuccess={handleCreateUnitSuccess}
  onCancel={() => setShowForm(false)}
  onCreateUnit={handleCreateUnit}
/>
```

**Lo que ocurre**:
1. `UnitCreateForm` NO recibe `defaultBuildingId`
2. Selector de building está **visible y requerido**
3. Usuario llena: building (obligatorio), code (obligatorio), label, unitType, occupancyStatus
4. Form valida con el **MISMO** schema Zod
5. Callback `onCreateUnit` llama a `useUnits()` (tenant-scoped, lista global)
6. Después de éxito: refetch automático de todas las unidades del tenant

---

## Contrato Unificado

### DTO Input (Exactamente el mismo en ambos flujos)
```typescript
{
  code: string;           // REQUERIDO
  label?: string;         // Opcional
  unitType?: string;      // Opcional: APARTMENT | HOUSE | OFFICE | STORAGE | PARKING | OTHER
  occupancyStatus?: string; // Opcional: UNKNOWN | VACANT | OCCUPIED
  buildingId: string;     // REQUERIDO (implícito en flujo A, explícito en flujo B)
}
```

### Validación (Frontend - Zod)
```typescript
unitSchema = z.object({
  code: z.string().min(1, 'Unit code is required').trim(),
  label: z.string().optional(),
  unitType: z.enum([...]).optional(),
  occupancyStatus: z.enum([...]).optional(),
  buildingId: z.string().min(1, 'Building is required'),
});
```

**Punto Clave**: El schema es **IDÉNTICO** en ambos contextos. No hay lógica condicional.

### Endpoint Backend (Mismo en ambos flujos)
```
POST /tenants/:tenantId/buildings/:buildingId/units
{
  "code": "101",
  "label": "Apt 101",
  "unitType": "APARTMENT",
  "occupancyStatus": "VACANT"
}
```

**Validación Backend** (app/api/src/units/units.service.ts):
- building existe y pertenece al tenant ✅
- code es requerido ✅
- unique constraint: (buildingId, code) ✅
- Plan limits: maxUnits enforzado ✅

---

## Flujo Post-Create

### Contexto A: Building-Scoped
1. Form submitido vía `handleCreateUnit`
2. Hook `useUnits(tenantId, buildingId)` recibe callback
3. Se crea unit vía API
4. Hook **auto-refetch** de unidades del building
5. UI actualizada (tabla muestra unit nuevo)
6. `onSuccess` callback → cierra form + toast

### Contexto B: Global/Tenant
1. Form submitido vía `handleCreateUnit`
2. Hook `useUnits(tenantId)` (sin buildingId) recibe callback
3. Se crea unit vía API
4. Hook **auto-refetch** de TODAS las unidades del tenant
5. UI actualizada (tabla muestra unit nuevo, respetando filtros)
6. `onSuccess` callback → cierra form + toast

**Resultado**: No hay inconsistencias. Ambos contextos refetch la data correcta y mostrada correcta.

---

## Validaciones por Contexto

| Validación | Flujo A | Flujo B | Backend |
|------------|---------|---------|---------|
| Building selector | Oculto | Visible + required | N/A |
| Code field | Required | Required | Required |
| Building exists | N/A | Server validates | **SÍ** |
| Building pertenece a tenant | N/A | Server validates | **SÍ** |
| Code unique (per building) | Frontend aviso | Frontend aviso | **SÍ** enforced |
| Plan limit maxUnits | Server blocks | Server blocks | **SÍ** enforced |

---

## Código Eliminado (Deduplicado)

### Antes
- Form logic en `/buildings/:buildingId/units` (lines 49-134)
- Form JSX en `/buildings/:buildingId/units` (lines 214-326)
- Form logic en `units.ui.tsx` (React Hook Form con Zod)
- Form JSX en `units.ui.tsx` (DIVs con inputs)

### Después
- ✅ Single `UnitCreateForm` component
- ✅ Single Zod schema
- ✅ Single submit handler (delegado al componente)
- ✅ No duplicación de lógica de validación

**LOC Saved**: ~250 líneas de form boilerplate eliminadas

---

## Files Changed

| File | Type | Change |
|------|------|--------|
| `apps/web/features/units/components/UnitCreateForm.tsx` | **NEW** | Componente unificado |
| `apps/web/features/units/components/index.ts` | **NEW** | Barrel export |
| `apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/units/page.tsx` | Modified | Usa `UnitCreateForm` (removed inline form) |
| `apps/web/features/units/units.ui.tsx` | Modified | Usa `UnitCreateForm` (removed inline form) |

---

## Test Cases (Criterio de Aceptación)

### ✅ Crear unidad desde `/buildings/:buildingId/units`
1. Click "+ New Unit"
2. Building selector **no aparece** (oculto)
3. Llenar: code=101, label=Apt 101
4. Submit → Unit creado
5. Tabla refrescada (unit visible)
6. Toast: "Unit created"

### ✅ Crear unidad desde `/units`
1. Click "+ Nueva Unidad"
2. Building selector **aparece y es requerido**
3. Elegir building
4. Llenar: code=202, label=Apt 202
5. Submit → Unit creado
6. Tabla global refrescada (unit visible)
7. Toast: "Unit created"

### ✅ Validaciones Idénticas
1. Dejar code vacío → Error: "Unit code is required"
2. En flujo B, no elegir building → Error: "Building is required"
3. Llenar todos opcionalmente → Mismo form
4. Tipos de unidad: mismo dropdown en ambos

### ✅ Plan Limits
1. Si plan=BASIC con maxUnits=5, crear 6ta unidad
2. Backend rechaza con 409 Conflict
3. Toast: "Plan limit exceeded"
4. Ambos flujos comportan igual

---

## Notas de Implementación

### Type Safety
- `UnitCreateForm` usa tipos de `units.api.ts` (ApiUnit)
- `/buildings/:buildingId/units` castea respuesta a ApiUnit para compatibilidad
- Ambos contextos manejan Unit type correctamente

### Error Handling
- Formulario muestra errores inline (Zod)
- Plan limit errors manejados por `handlePlanLimitError` en building context
- Global context delega al componente (simplificado)

### Refetch Strategy
- `useUnits` hook tiene métodos create() que refetch automáticamente
- No hay estado duplicado entre componente y página
- Callback `onSuccess` solo maneja UI (toast, close)

---

## Build Status
✅ `npm run build --workspace apps/api` — 0 errors
✅ `npm run build --workspace apps/web` — 0 errors
