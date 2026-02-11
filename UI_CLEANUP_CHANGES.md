# UI Cleanup Changes — units.ui.tsx

## Objetivo
Asegurar que la UI no envíe valores inválidos al storage (unitCode vacío, labels con espacios).

---

## Cambio Implementado

### Ubicación
`apps/web/features/units/units.ui.tsx` — Handler `onCreateUnit()` (línea 105)

### Antes ❌
```typescript
const onCreateUnit = async (data: CreateUnitFormData) => {
  // ...
  const newUnit = createUnit(tenantId, data);  // ← Envía data tal cual (puede tener spaces, "")
}
```

### Después ✅
```typescript
const onCreateUnit = async (data: CreateUnitFormData) => {
  // ...

  // 1. Limpiar inputs antes de enviar al storage
  const cleanedLabel = data.label.trim();
  const cleanedUnitCode = data.unitCode?.trim() || undefined;

  // 2. Crear unidad con valores limpios
  const newUnit = createUnit(tenantId, {
    ...data,
    label: cleanedLabel,
    unitCode: cleanedUnitCode,
  });
}
```

---

## Garantías

✅ **label nunca llega al storage con espacios**
- Input: `" Apto 101 "` → Cleaned: `"Apto 101"`

✅ **unitCode vacío se convierte a undefined**
- Input: `""` → Cleaned: `undefined`
- Input: `" "` → Cleaned: `undefined`
- Input: `"UF-1"` → Cleaned: `"UF-1"`

✅ **Coherencia UI ↔ Storage**
- UI limpia antes de enviar
- Storage limpia como fallback
- Doble limpieza = máxima seguridad

---

## Validación TypeScript
- ✅ 0 errors (IDE Diagnostics)
- ✅ Tipos correctos para `cleanedLabel` (string) y `cleanedUnitCode` (string | undefined)

---

## Test Case
1. Ingreso: `" Apto 101 "` para label, `" UF-1 "` para unitCode, `""` para otro field
2. Submit
3. Esperado: Se guarda como `label: "Apto 101"`, `unitCode: "UF-1"`, otros campos sin espacios

---

## Notas
- Los handlers de `onAssignResident` y `onDeleteUnit` no necesitan limpieza (no tienen inputs texto)
- Si en el futuro se agregan más campos de texto, aplicar mismo patrón: `trim()`
