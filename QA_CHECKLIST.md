# ✅ Units v1 MVP — QA Checklist

## Instrucciones
Ejecutar cada test case y marcar como ✓ cuando pase. Documentar cualquier error encontrado.

---

## Test Cases (10 obligatorios)

### Test 1: Limpieza de label (trim)
**Scenario:** Crear unidad con espacios alrededor del label
- [ ] Crear unidad con label `" Apto 101 "`
- [ ] Verificar en localStorage que se guarda como `"Apto 101"` (sin espacios)
- [ ] Expected: label limpio en storage

**Evidence:** Screenshot de localStorage mostrando:
```json
{ "label": "Apto 101", ... }
```

---

### Test 2: Duplicado de label después de limpieza
**Scenario:** Crear dos unidades con mismo label pero diferente whitespace
- [ ] Crear unidad A con label `"Apto 101"`
- [ ] Intentar crear unidad B con label `" apto 101 "` en **mismo building**
- [ ] Expected: ERROR "Ya existe una unidad con el label..."

**Evidence:** Screenshot de error mensaje en UI

---

### Test 3: Mismo label en diferente building
**Scenario:** Label duplicado es OK en buildings distintos
- [ ] Tener dos buildings: "Edificio A" y "Edificio B"
- [ ] Crear "Apto 101" en Edificio A
- [ ] Crear "Apto 101" en Edificio B
- [ ] Expected: AMBAS se crean exitosamente

**Evidence:** Screenshot de tabla mostrando dos unidades "Apto 101" con diferentes buildings

---

### Test 4: Limpieza de unitCode (trim)
**Scenario:** unitCode con espacios
- [ ] Crear unidad con unitCode `" UF-1 "`
- [ ] Verificar en localStorage que se guarda como `"UF-1"` (sin espacios)
- [ ] Expected: unitCode limpio

**Evidence:** localStorage dump:
```json
{ "unitCode": "UF-1", ... }
```

---

### Test 5: Limpieza de unitCode vacío → undefined
**Scenario:** unitCode vacío no se guarda como string ""
- [ ] Crear unidad SIN unitCode (campo vacío)
- [ ] Verificar en localStorage que unitCode es `undefined` (no `""`)
- [ ] Expected: campo no existe o es undefined

**Evidence:** localStorage muestra:
```json
{ "label": "Apto 102", "unitCode": undefined }
// O simplemente no aparece el field
```

---

### Test 6: Duplicado de unitCode en mismo building
**Scenario:** unitCode duplicado bloquea en mismo building
- [ ] Crear unidad A con unitCode `"UF-1"`
- [ ] Intentar crear unidad B con unitCode `" uf-1 "` en **mismo building**
- [ ] Expected: ERROR "Ya existe una unidad con el código..."

**Evidence:** Screenshot de error

---

### Test 7: Asignar residente crea activo
**Scenario:** Asignar residente crea UnitResident con endAt=null
- [ ] Crear unidad "Apto 101"
- [ ] Click en "Asignar" → modal
- [ ] Seleccionar residente "Juan Pérez"
- [ ] Click "Guardar"
- [ ] Verificar tabla: muestra "Juan Pérez" en columna "Residente"
- [ ] Verificar localStorage:
  - `bo_unit_residents_<tenantId>` debe tener 1 registro con `endAt: null`
- [ ] Expected: Residente activo visible

**Evidence:**
- Screenshot de tabla
- localStorage dump mostrando UnitResident con `endAt: null`

---

### Test 8: Cambiar residente (soft-delete histórico)
**Scenario:** Cambiar residente setea endAt en anterior y crea nuevo activo
- [ ] Con unidad "Apto 101" con residente "Juan Pérez"
- [ ] Click "Asignar" → seleccionar "María García"
- [ ] Tabla debe mostrar "María García" (no Juan)
- [ ] Verificar localStorage:
  - 2 registros en `bo_unit_residents_<tenantId>` para unitId="Apto 101"
  - Juan: `endAt: "2026-02-11T..."` (timestamp)
  - María: `endAt: null`
- [ ] Expected: Histórico preservado

**Evidence:**
- Screenshot de tabla
- localStorage mostrando 2 registros con timestamps correctos

---

### Test 9: Desasignar residente
**Scenario:** Desasignar setea endAt en activo y deja sin residente
- [ ] Con unidad "Apto 101" con residente "María García"
- [ ] Click "Asignar" → dejar campo vacío → "Guardar"
- [ ] Tabla debe mostrar "—" en columna Residente (sin residente)
- [ ] Verificar localStorage:
  - María: `endAt: "2026-02-11T..."` (ahora tiene timestamp)
  - `getActiveResident()` retorna null
- [ ] Expected: Residente desasignado

**Evidence:**
- Screenshot de tabla con "—"
- localStorage dump mostrando endAt en último registro

---

### Test 10: Migración - unidades sin buildingId
**Scenario:** Data vieja sin buildingId se migra correctamente
- [ ] Simular data vieja en localStorage:
  ```json
  {
    "bo_units_test": [
      {
        "id": "unit_old_1",
        "tenantId": "test",
        "label": "Apto Viejo",
        "residentName": "Alguien"
        // Nota: no tiene buildingId
      }
    ]
  }
  ```
- [ ] Cargar la página (trigger listUnits)
- [ ] Verificar en localStorage que se migró:
  - buildingId asignado al primer building seeded
  - residentName eliminado
  - updatedAt seteado
  - No errores de pantalla
- [ ] Expected: Data vieja funcional como data nueva

**Evidence:**
- Screenshot sin errores en UI
- localStorage dump mostrando unidad migrada con buildingId válido

---

## Summary Screenshot Requirements

### Antes de dar OK a merge, adjuntar:

1. **Video 30s** mostrando:
   - Crear unidad con label con espacios → se guarda limpio
   - Intentar duplicado label en mismo building → ERROR
   - Crear mismo label en otro building → OK
   - Asignar residente → tabla actualiza
   - Cambiar residente 2 veces → historial correcto
   - Desasignar → tabla muestra "—"

2. **Screenshots** de localStorage (Dev Tools → Application → Local Storage):
   ```
   bo_buildings_<tenantId>   [3 buildings seeded]
   bo_units_<tenantId>       [3+ unidades con buildingId limpio]
   bo_unit_residents_<tenantId> [historial con endAt timestamps]
   bo_users_<tenantId>       [5 usuarios seeded]
   ```

3. **Test Log** (marcar ✓ en cada test):
   ```
   Test 1: ✓ PASS
   Test 2: ✓ PASS
   Test 3: ✓ PASS
   Test 4: ✓ PASS
   Test 5: ✓ PASS
   Test 6: ✓ PASS
   Test 7: ✓ PASS
   Test 8: ✓ PASS
   Test 9: ✓ PASS
   Test 10: ✓ PASS
   ```

---

## Criterio de Aprobación
✅ **MERGE OK** cuando:
- [x] Todos 10 tests PASS
- [x] Video 30s muestra flujo completo
- [x] localStorage dump adjunto
- [x] Test log con ✓ en cada uno

❌ **NO MERGE** si:
- Algún test falla
- Errores de TypeScript
- Data inconsistencia en storage
