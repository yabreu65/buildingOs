# QA Setup: Preparar 2 Buildings para Test 3

## Objetivo
Asegurar que existan **mínimo 2 buildings** en el tenant para ejecutar Test 3 (duplicados en buildings distintos).

---

## Opción 1: Seed Automático (RECOMENDADA - Sin manual)

### ¿Cómo funciona?
- Al cargar la página de **Units**, se ejecuta automáticamente `seedBuildingsIfEmpty(tenantId)`
- Esto crea 3 buildings por defecto si la lista está vacía

### Pasos
1. ✅ Abrir la pantalla de **Units**
2. ✅ Verificar que aparezcan buildings en el dropdown (dropdown "Edificio")
3. ✅ Si aparecen buildings → **DONE**, puedes usar cualquiera de ellos

### Verificación
En **DevTools → Application → Local Storage**:
- Buscar key: `bo_buildings_<tenantId>`
- Verificar que existan registros como:
```json
[
  { "id": "building_...", "name": "Edificio Principal", "address": "..." },
  { "id": "building_...", "name": "Edificio Secundario", "address": "..." },
  { "id": "building_...", "name": "Complejo Residencial A", "address": "..." }
]
```

**Si ves esto → Opción 1 completada ✓**

---

## Opción 2: Manual Setup (Si Opción 1 no crea buildings)

### Paso 1: Abrir DevTools
```
Chrome/Firefox: F12 → Application (Chrome) o Storage (Firefox)
→ Local Storage → https://<tu-dominio>
```

### Paso 2: Ubicar o crear la key de buildings
Buscar en la lista de keys: `bo_buildings_<tenantId>`

**Si existe:**
- Click en la key
- Ver el contenido actual
- Modificar (ver Paso 4)

**Si NO existe:**
- Click derecho en Local Storage
- Crear nueva key: `bo_buildings_<tenantId>`

### Paso 3: Obtener tu tenantId actual
En la URL:
```
https://localhost:3000/tenant/[ESTE_ES_TU_TENANT_ID]/units
```
O en DevTools → Network → ver requests, buscar tenantId.

### Paso 4: Pegar este JSON
En el valor de la key `bo_buildings_<tenantId>`, copiar y pegar:

```json
[
  {
    "id": "building_test_a",
    "tenantId": "REEMPLAZA_CON_TU_TENANT_ID",
    "name": "Edificio A",
    "address": "Calle A 123"
  },
  {
    "id": "building_test_b",
    "tenantId": "REEMPLAZA_CON_TU_TENANT_ID",
    "name": "Edificio B",
    "address": "Calle B 456"
  }
]
```

**Importante:** Reemplazar `REEMPLAZA_CON_TU_TENANT_ID` con tu ID actual.

### Paso 5: Guardar
- Click fuera o presionar Enter
- Refrescar la página (F5)
- Verificar que el dropdown de Edificio muestre "Edificio A" y "Edificio B"

**Listo para Test 3 ✓**

---

## Verificación Rápida (Ambas Opciones)

Después de cualquier opción, verificar:

1. **En la UI (Units page):**
   - [ ] Abrir formulario "Crear nueva unidad"
   - [ ] Dropdown "Edificio" muestra al menos 2 opciones
   - [ ] Al menos una se llama "Edificio A" (o similar)
   - [ ] Al menos otra se llama "Edificio B" (o similar)

2. **En localStorage (DevTools):**
   - [ ] Key existe: `bo_buildings_<tenantId>`
   - [ ] Contiene JSON array con 2+ elementos
   - [ ] Cada elemento tiene: `id`, `tenantId`, `name`, `address`

---

## Para Test 3: Pasos Exactos

Una vez que tengas 2 buildings:

1. **Crear Unidad 1:**
   - Edificio: "Edificio A"
   - Label: `"Apto 101"`
   - Click Guardar
   - ✓ Debe crearse exitosamente

2. **Crear Unidad 2:**
   - Edificio: "Edificio B"
   - Label: `"Apto 101"` (mismo label, diferente building)
   - Click Guardar
   - ✓ Debe crearse exitosamente

3. **Verificar en tabla:**
   - Ambas unidades aparecen
   - Mismo label "Apto 101"
   - Edificios diferentes ("Edificio A" vs "Edificio B")

---

## Troubleshooting

### Problema: No aparecen buildings en dropdown
**Solución:**
1. Refrescar página (F5)
2. Abrir DevTools → Console
3. Buscar errores
4. Si hay error sobre `seedBuildingsIfEmpty`, ejecutar manualmente en console:
   ```javascript
   // Nota: esto es para debug, no es producción
   console.log('Seed buildings manually')
   ```

### Problema: Se creó Unidad 1 pero no Unidad 2
**Verificar:**
1. ¿Ingresé el label exactamente igual? (case-sensitive en parte)
2. ¿Seleccioné building DIFERENTE en dropdown?
3. Ver error en feedback message (abajo del form)
4. Si dice "Ya existe unidad", probablemente pasó al Test 2 (error esperado)

### Problema: localStorage se ve corrupto
**Solución:**
- Limpiar todo y empezar desde 0
- Abrir DevTools → Application → Local Storage
- Click derecho → Clear All
- Refrescar página
- Ejecutar Opción 1 (seed automático)

---

## Documentación de Referencia
- `buildings.storage.ts` — Cómo funcionan los buildings
- `units.ui.tsx` — Cómo se cargan en el dropdown
- `QA_CHECKLIST.md` — Test 3 (Test Case completo)
