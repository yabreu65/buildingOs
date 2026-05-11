# 📋 Catálogo Completo de Preguntas - Asistente AI BuildingOS

## ✅ Funcionando Correctamente (Determinístico)

### 1. RESIDENTES / OCUPANTES (Unit-Level)

**Keywords:** residente, ocupante, inquilino, propietario, habita, vive, reside, ocupa, arrendatario, locatario, titular, habitante, dueño

> **⚠️ Nota importante:** Los códigos de unidad en San Cristóbal tienen **4 dígitos** (piso de 2 dígitos + departamento de 2 dígitos). Ejemplo: `0101` = Piso 1, Depto 1. El **displayCode** visible se forma como `${alias}-${code}`: `A-0101`, `B-0102`.

#### Preguntas con unidad + edificio específicos (formato alias explícito):
- "Quien vive en A-0101" ✅
- "Residente del apartamento B-0102" ✅
- "Inquilino del depto A-0103" ✅
- "Propietario del departamento B-0104" ✅
- "Quien habita en la unidad A-0105" ✅
- "Ocupante del apartamento A-0106" ✅
- "Persona que vive en el depto B-0107" ✅
- "Dueño del apartamento A-0108" ✅
- "Habitante de la unidad B-0201" ✅
- "Arrendatario del depto A-1101" ✅
- "Locatario del apartamento B-1102" ✅
- "Titular de la unidad A-1103" ✅

#### Preguntas con formato compacto (sin guion):
- "Quien vive en A0101" ✅
- "Residente de B0102" ✅
- "Inquilino de A0103" ✅

#### Preguntas con reverse pattern:
- "Residente de 0101 de la A" ✅
- "Quien vive en 0102 del edificio B" ✅
- "Inquilino de 0103 de la Torre A" ✅

#### Variaciones sin edificio (auto-resolución o ambigüedad):
- "Quien reside en el departamento 0101" → Si 1 edificio: auto-resuelve como A-0101. Si 2+ edificios: "Necesito que me indiques el edificio. Por ejemplo: A-0101 o B-0101."
- "Quien ocupa el departamento 0102" → Mismo comportamiento según cantidad de edificios.

---

### 2. DEUDA (Unit-Level)

**Keywords:** debe, cuanto debe, deuda, saldo, adeuda, cuanto, monto, importe, estado de cuenta

#### Preguntas con unidad + edificio (formato alias):
- "Cuanto debe A-0101"
- "Deuda del apartamento B-0102"
- "Que saldo tiene A-0103"
- "Cuanto adeuda B-0104"
- "Monto de deuda de A-0105"
- "Importe pendiente del apartamento B-0106"
- "La unidad A-0107 esta al dia"
- "Deuda de B-0201"
- "Expensas de A-0108"
- "Cuanto debe el apto B-0109"
- "Situacion de pagos de la unidad A-1101"
- "Estado de cuenta del departamento B-1102"

#### Preguntas con formato compacto:
- "Deuda de A0101"
- "Saldo de B0102"

#### Preguntas con reverse pattern:
- "Cuanto debe 0101 de la A"
- "Deuda de 0102 del edificio B"

---

### 3. DOCUMENTOS (Unit-Level)

**Keywords:** documento, documentos, archivo, archivos, pdf, comprobante, comprobantes, expediente, acta, planilla

#### Preguntas con unidad + edificio (formato alias):
- "Documentos del departamento A-0101"
- "Archivos del apartamento B-0102"
- "PDFs de la unidad A-0103"
- "Comprobantes del depto B-0104"
- "Planillas del departamento A-0105"
- "Expedientes del apartamento B-0106"

---

### 4. TICKETS (Unit-Level)

**Keywords:** ticket, tickets, reclamo, reclamos, problema, problemas, averia, averias, falla, fallas, solicitud, solicitudes, incidente, incidentes, reparacion, arreglo

#### Preguntas con unidad + edificio (formato alias):
- "Tickets del departamento A-0101"
- "Reclamos del apartamento B-0102"
- "Problemas de la unidad A-0103"
- "Averias del depto B-0104"
- "Solicitudes del departamento A-0105"
- "Incidentes del apartamento B-0106"

---

### 5. PAGOS (Unit-Level)

**Keywords:** pago, pagos, transferencia, transferencias, recibo, recibos, movimiento, movimientos, transaccion, transacciones, abono, abonos, cobro, cobros

#### Preguntas con unidad + edificio (formato alias):
- "Ultimos pagos del departamento A-0101"
- "Historial de pagos del apartamento B-0102"
- "Transferencias de la unidad A-0103"
- "Recibos del depto B-0104"
- "Movimientos del departamento A-0105"
- "Transacciones del apto B-0106"
- "Cobros de la unidad A-0107"
- "Abonos del departamento B-0108"

---

### 5.1 ESTACIONAMIENTOS (Unit-Level)

**Keywords:** estacionamiento, puesto, cochera, garage, parking

#### Preguntas con estacionamiento + edificio (formato alias):
- "Quien tiene el estacionamiento A-P001"
- "Dueño del puesto B-P002"
- "Deuda del estacionamiento A-P003"
- "Tickets de la cochera B-P004"
- "Pagos del puesto A-P005"

#### Preguntas con formato compacto:
- "Quien tiene A-P001"
- "Dueño de B-P002"

#### Notas sobre estacionamientos:
- Los estacionamientos tienen código `P001`, `P002`, etc.
- El **displayCode** es `A-P001`, `B-P002`.
- Pueden estar **asociados a un apartamento** (heredan el ocupante) o ser **del condominio** (sin propietario asignado).
- Si pregunta por un estacionamiento asociado, el asistente indica el apartamento correspondiente.

---

## 🏢 Building-Level (Nivel Edificio)

### 6. DEUDA TOTAL DEL EDIFICIO

**Keywords:** debe, deuda, saldo, adeuda, monto, importe, expensas, total adeudado

#### Preguntas con edificio (sin unidad específica):
- "Cuanto debe el edificio A"
- "Deuda del edificio B"
- "Que saldo tiene el edificio A"
- "Monto adeudado del edificio B"
- "Importe pendiente del edificio A"
- "Expensas del edificio B"
- "Total adeudado del edificio A"

**Respuesta:** Deuda total del edificio + cantidad de unidades con deuda

---

### 7. TICKETS DEL EDIFICIO

**Keywords:** ticket, tickets, reclamo, reclamos, problema, problemas, falla, fallas, solicitud, solicitudes, incidente, incidentes, reparacion, arreglo

#### Preguntas con edificio (sin unidad):
- "Tickets del edificio A"
- "Reclamos del edificio B"
- "Problemas del edificio A"
- "Fallas del edificio B"
- "Solicitudes del edificio A"
- "Incidentes del edificio B"
- "Reparaciones del edificio A"

**Respuesta:** Lista de tickets + conteo de abiertos

---

### 8. MOROSOS / TOP DEUDORES

**Keywords:** moroso, morosos, morosa, morosas, deudor, deudores, deudora, deudoras, quien debe, quienes deben, quien no pago, quienes no pagan, top deudores, ranking de deuda, atrasados, atrasadas, impagos, incobrables

#### Preguntas con edificio:
- "Quienes son los morosos del edificio A"
- "Top deudores del edificio B"
- "Ranking de deuda del edificio A"
- "Atrasados del edificio B"
- "Impagos del edificio A"
- "Deudores del edificio B"
- "Unidades que no pagan del edificio A"
- "Listado de morosos del edificio B"
- "Quien debe mas del edificio A"
- "Mayores deudores del edificio B"

**Respuesta:** Top 10 unidades con mayor deuda + total adeudado (se muestra con displayCode: A-0101, B-0102)

---

### 9. ESTADÍSTICAS DEL EDIFICIO

**Keywords:** estadistica, estadísticas, estadisticas, cuantas unidades, cuántas unidades, resumen, informacion del edificio, información del edificio, datos del edificio, como viene, como va, estado del edificio, situacion del edificio, cuentas del edificio

#### Preguntas con edificio:
- "Estadisticas del edificio A"
- "Cuantas unidades tiene el edificio B"
- "Resumen del edificio A"
- "Como viene el edificio B"
- "Cuentas del edificio A"
- "Informacion general del edificio B"
- "Datos del edificio A"
- "Situacion del edificio B"
- "Cuanto se debe en total en el edificio A"
- "Balance del edificio B"

**Respuesta:** Unidades, tickets abiertos, deuda total, promedio por unidad

---

### 10. DOCUMENTOS DEL EDIFICIO

**Keywords:** documento, documentos, archivo, archivos, pdf, comprobante, comprobantes, expediente, acta, planilla

#### Preguntas con edificio (sin unidad):
- "Documentos del edificio A"
- "Archivos del edificio B"
- "Actas del edificio A"
- "Reglamentos del edificio B"
- "Planos del edificio A"

**Respuesta:** Lista de documentos del edificio (sin filtro por unidad)

---

### 11. PAGOS DEL EDIFICIO

**Keywords:** pago, pagos, transferencia, transferencias, recibo, recibos, cobranza, cobranzas, recaudacion, ingresos

#### Preguntas con edificio (sin unidad):
- "Pagos del edificio A"
- "Transferencias del edificio B"
- "Recibos del edificio A"
- "Cobranzas del edificio B"
- "Ingresos del edificio A"
- "Recaudacion del edificio B"

**Respuesta:** Últimos pagos del edificio con info de unidad (displayCode)

---

## 🔄 Formatos de Referencia a Unidades (Parser)

El asistente soporta múltiples formatos para referirse a una unidad:

### 1. Alias explícito con guion (recomendado)
`A-0101`, `B-0201`, `C-1201`

- "Quién vive en A-0101"
- "Deuda de B-0201"
- "Tickets de C-1201"

### 2. Compacto sin guion
`A0101`, `B0101`, `C0201`

- "Tickets de B0101"
- "Documentos de A0101"

### 3. Reverse pattern
`{code} de la {alias}` o `{code} del edificio {alias}`

- "Residente de 0101 de la A"
- "Deuda de 0201 del edificio B"
- "Pagos de 1201 de la Torre C"

### 4. Solo código (auto-resolución / ambigüedad)
`{code}`

- "Quién vive en 0101"
- "Deuda de 0201"

**Reglas de resolución:**
- **Tenant con 1 edificio:** `0101` → auto-resuelve como `A-0101`
- **Tenant con 2+ edificios:** `0101` → mensaje de ambigüedad:
  > "Necesito que me indiques el edificio. Por ejemplo: A-0101 o B-0101."

---

## 🤖 Classifier (Nivel 2 - Lenguaje Natural)

Cuando los keywords estrictos no matchean, el classifier detecta la intención y sugiere navegación:

### Preguntas que activan el classifier:

#### DEUDA/SALDOS (sugiere Finanzas):
- "Estoy al dia con las expensas"
- "Todo esta pagado"
- "No debo nada verdad"
- "Como anda la cobranza"
- "Me puedes decir si debo algo"

#### TICKETS/RECLAMOS (sugiere Tickets):
- "Hay algun problema en el edificio"
- "Necesito ver si hay reclamos"
- "Hay algo roto en el edificio"

#### DOCUMENTOS (sugiere Archivos):
- "Necesito ver los documentos"
- "Quiero revisar los papeles"
- "Donde estan los archivos"

#### PAGOS (sugiere Finanzas):
- "Quiero ver los pagos recientes"
- "Todo bien con los pagos"

#### RESIDENTES (sugiere Reportes):
- "Quien habita aca" (muy ambiguo, puede ir a fallback)
- "Los inquilinos estan al dia"

#### ESTADÍSTICAS (sugiere Reportes):
- "Como viene el complejo" (muy ambiguo, puede ir a fallback)
- "Cuantas unidades tenemos"

---

## 💬 Fallback (Nivel 3 - Conversación General)

Preguntas que no matchean con ninguna categoría operativa:

- "Buenos dias"
- "Gracias por la ayuda"
- "Cual es el clima hoy"
- "Hola"
- "Adios"

**Respuesta:** Mensaje educado sugiriendo especificar unidad y edificio

---

## ❌ NO Soportado (Va a Fallback)

### Sin edificio específico en building-level:
- "Cuanto se debe en total" ❌ (necesita edificio)
- "Quienes son los morosos" ❌ (necesita edificio)
- "Estadisticas del complejo" ❌ (necesita edificio específico)

### Edificio inexistente:
- "Deuda de la Torre Z" ❌ (edificio no existe)
- "Tickets del departamento 9999" ❌ (unidad no existe)

### Preguntas no operativas:
- "Que hora es"
- "Cual es el clima"
- "Contame un chiste"

---

## 📊 Resumen por Categoría

| Categoría | Unit-Level | Building-Level | Classifier |
|-----------|-----------|----------------|------------|
| Residentes | ✅ 15+ preguntas | ❌ No aplica | ⚠️ Parcial |
| Deuda | ✅ 12+ preguntas | ✅ 7+ preguntas | ✅ Activo |
| Documentos | ✅ 6+ preguntas | ✅ 5+ preguntas | ✅ Activo |
| Tickets | ✅ 6+ preguntas | ✅ 6+ preguntas | ✅ Activo |
| Pagos | ✅ 8+ preguntas | ✅ 6+ preguntas | ✅ Activo |
| Estacionamientos | ✅ 5+ preguntas | ❌ No aplica | ⚠️ Parcial |
| Morosos | ❌ No aplica | ✅ 10+ preguntas | ⚠️ Parcial |
| Estadísticas | ❌ No aplica | ✅ 10+ preguntas | ⚠️ Parcial |

**Total estimado:** 75+ preguntas operativas + 10+ preguntas classifier + fallback conversacional

---

## 🔧 Formato Recomendado

Para máxima precisión, usar formato: **[Categoría] + [Unidad]**

**Ejemplos óptimos:**
- "Deuda de A-0101" ← Más corto y preciso
- "Tickets del edificio B"
- "Quien vive en B-0102"
- "Morosos del edificio A"
- "Documentos de A0101" ← Compacto, también válido
- "Residente de 0101 de la A" ← Reverse pattern
- "Dueño del estacionamiento A-P001" ← Estacionamiento con alias
- "Deuda del puesto B-P002" ← Estacionamiento con alias

**Ejemplos ambiguos (van al classifier):**
- "Estoy al día" → Sugiere Finanzas
- "Hay problemas" → Sugiere Tickets
- "Quiero ver documentos" → Sugiere Archivos

**Ejemplos con ambigüedad de edificio:**
- "Deuda de 0101" → Si hay 2+ edificios, pide especificar: "¿Te refieres a A-0101 o B-0101?"
