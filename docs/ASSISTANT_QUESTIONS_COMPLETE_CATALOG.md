# Catálogo de Preguntas y Respuestas del Asistente AI - BuildingOS

> Documento de pruebas: TODAS las preguntas que el asistente puede resolver con sus respuestas esperadas.
> Versión: 2.0 (Incluye Intent Engine v2 + Follow-ups Conversacionales)
> Última actualización: 2026-05-12

---

## Índice

1. [Consultas a Nivel Unidad](#1-consultas-a-nivel-unidad)
2. [Consultas a Nivel Edificio](#2-consultas-a-nivel-edificio)
3. [Follow-ups Conversacionales](#3-follow-ups-conversacionales)
4. [Consultas a Nivel Tenant](#4-consultas-a-nivel-tenant)
5. [Sinónimos Soportados](#5-sinónimos-soportados)
6. [Roles Autorizados](#6-roles-autorizados)

---

## 1. CONSULTAS A NIVEL UNIDAD

> **Requieren:** Identificación de unidad (código o alias) + edificio en el mensaje, o contexto conversacional previo.
> **Permiso requerido:** `units.read` o `payments.review` (según intent)

### 1.1 Residentes / Ocupantes

**Intent:** `unit_residents`
**Keywords:** `residente`, `ocupante`, `inquilino`, `propietario`, `habita`, `vive`, `quien vive`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 1.1 | "¿Cómo se llama el residente del departamento 101 del Edificio A?" | "Juan Pérez (propietario)" |
| 1.2 | "¿Quién es el residente del apartamento 5B de la Torre B?" | "María Gómez (residente)" |
| 1.3 | "Nombre del residente de la unidad 301 del bloque C" | "Carlos López (propietario)" |
| 1.4 | "Nombre del residente propietario del local 12 del Edificio Central" | "Ana Rodríguez (propietario)" |
| 1.5 | "Nombre del residente del depto 2-14 del sector Norte" | "Pedro Martínez (residente)" |
| 1.6 | "¿Quién vive en el apartamento 101 del Edificio A?" | "Luis Torres (residente)" |
| 1.7 | "¿Quién es el inquilino de la unidad 5B?" | "Sofía Ruiz (residente)" |

**Fallbacks:**
- Sin ocupantes → "La unidad no tiene ocupantes activos"
- Múltiples primarios → "Hay más de un ocupante primario..."
- Sin unidad/edificio → Pide ambos con ejemplo

---

### 1.2 Deuda / Saldo Pendiente

**Intent:** `unit_debt`
**Keywords:** `debe`, `cuanto debe`, `deuda`, `saldo`, `adeuda`, `cuanto`, `monto`, `importe`, `meses adeudados`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 2.1 | "¿Cuánto debe la unidad 101 del Edificio A?" | "Deuda total: Bs.S 22.669,45" |
| 2.2 | "Deuda del departamento 5B de la Torre B" | "Deuda total: Bs.S [monto]" |
| 2.3 | "¿Qué saldo pendiente tiene el apartamento 301?" | "Deuda total: Bs.S [monto]" |
| 2.4 | "¿Cuánto adeuda el local 12 del Edificio Central?" | "Deuda total: Bs.S [monto]" |
| 2.5 | "¿La unidad 2-14 tiene deuda?" | "Sí, deuda total: Bs.S [monto]" o "No tiene deuda pendiente" |
| 2.6 | "¿Cuántos meses debe la unidad A-1204?" | "Deuda total: Bs.S 23.888,69 (3 meses adeudados)" |

**Datos incluidos:**
- `totalDebt`: Monto total adeudado
- `overduePeriodCount`: Cantidad de meses/períodos adeudados
- `overduePeriods`: Lista de períodos (ej: `["2026-01", "2026-02", "2026-03"]`)
- `charges`: Array de cargos con concepto, monto, período, estado

**Fallbacks:**
- Sin deuda → "No tiene deuda pendiente. Saldo actual: Bs.S 0,00"
- Sin unidad/edificio → Pide ambos con ejemplo

---

### 1.3 Documentos

**Intent:** `unit_documents`
**Keywords:** `documento`, `documentos`, `archivo`, `archivos`, `pdf`, `comprobante`, `comprobantes`, `expediente`, `acta`, `planilla`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 3.1 | "Documentos del departamento 101 del Edificio A" | Tabla: nombre, tipo, fecha |
| 3.2 | "¿Qué archivos tiene la unidad 5B de la Torre B?" | Lista de documentos |
| 3.3 | "PDFs del apartamento 301" | Lista de documentos |
| 3.4 | "Comprobantes del local 12 del Edificio Central" | Lista de documentos |
| 3.5 | "Documentos de la cochera 15 del sector Norte" | Lista de documentos |

**Fallbacks:**
- Sin documentos → "No tiene documentos registrados"
- Sin unidad/edificio → Pide ambos con ejemplo

---

### 1.4 Tickets / Reclamos / Averías

**Intent:** `unit_tickets`
**Keywords:** `ticket`, `tickets`, `reclamo`, `reclamos`, `problema`, `problemas`, `averia`, `falla`, `solicitud`, `incidente`, `reparacion`, `arreglo`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 4.1 | "Tickets del departamento 101 del Edificio A" | Tabla: título, estado, prioridad, fecha |
| 4.2 | "¿Hay reclamos en la unidad 5B de la Torre B?" | Lista de tickets abiertos/recientes |
| 4.3 | "Problemas del apartamento 301" | Lista de tickets |
| 4.4 | "Averías del local 12 del Edificio Central" | Lista de tickets |
| 4.5 | "¿Qué tickets tiene la cochera 15?" | Lista de tickets |

**Fallbacks:**
- Sin tickets → "No tiene tickets registrados"
- Sin unidad/edificio → Pide ambos con ejemplo

---

### 1.5 Pagos Recientes

**Intent:** `unit_payments`
**Keywords:** `pago`, `pagos`, `transferencia`, `transferencias`, `recibo`, `recibos`, `movimiento`, `movimientos`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 5.1 | "Últimos pagos del departamento 101 del Edificio A" | Tabla: monto, método, estado, fecha |
| 5.2 | "Historial de pagos de la unidad 5B de la Torre B" | Lista de pagos |
| 5.3 | "Pagos recientes del apartamento 301" | Lista de pagos |
| 5.4 | "Historial de transferencias del local 12" | Lista de pagos |
| 5.5 | "Recibos recientes de la cochera 15" | Lista de pagos |
| 5.6 | "Últimas transferencias de la unidad 101" | Lista de pagos |
| 5.7 | "Movimientos de la unidad 5B" | Lista de pagos |

**Filtros soportados:** `period` (YYYY-MM), `status`, `method`, `minAmount`, `maxAmount`

**Fallbacks:**
- Sin pagos → "No tiene pagos registrados"
- Sin unidad/edificio → Pide ambos con ejemplo

---

## 2. CONSULTAS A NIVEL EDIFICIO

> **Requieren:** Identificación del edificio en el mensaje, **sin** especificar unidad.
> **Permiso requerido:** `buildings.read` o `payments.review` (según intent)

### 2.1 Deuda Total del Edificio

**Intent:** `building_debt`
**Keywords:** `debe`, `cuanto debe`, `deuda`, `saldo`, `adeuda`, `cuanto`, `monto`, `importe`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 6.1 | "¿Cuánto debe el Edificio A?" | "Deuda total: Bs.S [monto] ([N] unidades con deuda)" |
| 6.2 | "Deuda de la Torre B" | Deuda total + desglose por unidad |
| 6.3 | "¿Qué saldo pendiente tiene el bloque C?" | Deuda total |
| 6.4 | "¿Cuánto adeuda el sector Norte?" | Deuda total |
| 6.5 | "Deuda del complejo residencial" | Deuda total |

**Datos incluidos:**
- `totalDebt`: Monto total adeudado del edificio
- `totalUnits`: Cantidad de unidades con deuda
- `byUnit`: Array con código de unidad, label, deuda total, deuda pagada, deuda restante

**Fallbacks:**
- Sin deuda → "No tiene deuda pendiente. Todas las unidades están al día"
- Edificio no encontrado → "Edificio no encontrado"

---

### 2.2 Tickets del Edificio

**Intent:** `building_tickets`
**Keywords:** `ticket`, `tickets`, `reclamo`, `reclamos`, `problema`, `problemas`, `averia`, `falla`, `solicitud`, `incidente`, `reparacion`, `arreglo`, `fallas`, `reparaciones`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 7.1 | "Tickets del Edificio A" | Lista de tickets + resumen por estado |
| 7.2 | "Reclamos de la Torre B" | Lista de tickets |
| 7.3 | "Problemas del bloque C" | Lista de tickets |
| 7.4 | "Averías del sector Norte" | Lista de tickets |
| 7.5 | "¿Hay tickets en el complejo?" | Lista de tickets |
| 7.6 | "Fallas del edificio A" | Lista de tickets |
| 7.7 | "Reparaciones del edificio A" | Lista de tickets |

**Datos incluidos:**
- `tickets`: Array con título, estado, prioridad, categoría, fecha
- `statusSummary`: Conteo por estado (OPEN, CLOSED, etc.)
- `total`: Cantidad total de tickets

**Fallbacks:**
- Sin tickets → "No tiene tickets registrados"
- Edificio no encontrado → "Edificio no encontrado"

---

### 2.3 Morosos / Top Deudores

**Intent:** `building_delinquents`
**Keywords:** `moroso`, `morosos`, `morosa`, `morosas`, `deudor`, `deudores`, `deudora`, `deudoras`, `quien debe`, `quienes deben`, `quien no pago`, `quienes no pagan`, `top deudores`, `ranking de deuda`, `atrasados`, `atrasadas`, `impagos`, `incobrables`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 8.1 | "¿Quiénes son los morosos del Edificio A?" | Top 10 deudores ordenados por monto |
| 8.2 | "Top deudores de la Torre B" | Top 10 deudores |
| 8.3 | "Ranking de deuda del bloque C" | Top 10 deudores |
| 8.4 | "¿Quién debe en el sector Norte?" | Top 10 deudores |
| 8.5 | "Morosos del complejo" | Top 10 deudores |
| 8.6 | "Deudores del Edificio Central" | Top 10 deudores |
| 8.7 | "Atrasados del edificio A" | Top 10 deudores |
| 8.8 | "Impagos del edificio A" | Top 10 deudores |

**Datos incluidos:**
- `delinquents`: Array con código de unidad, label, deuda total
- `totalUnitsWithDebt`: Cantidad de unidades morosas
- Ordenados por deuda descendente

**Fallbacks:**
- Sin deudores → "No tiene unidades con deuda pendiente. Todas están al día"
- Edificio no encontrado → "Edificio no encontrado"

---

### 2.4 Estadísticas del Edificio

**Intent:** `building_stats`
**Keywords:** `estadistica`, `estadísticas`, `estadisticas`, `cuantas unidades`, `cuántas unidades`, `resumen`, `informacion del edificio`, `información del edificio`, `datos del edificio`, `como viene`, `como va`, `estado del edificio`, `situacion del edificio`, `cuentas del edificio`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 9.1 | "Estadísticas del Edificio A" | Unidades, tickets, deuda total, deuda promedio |
| 9.2 | "¿Cuántas unidades tiene la Torre B?" | Total de unidades + resumen |
| 9.3 | "Resumen del bloque C" | Estadísticas completas |
| 9.4 | "Información del edificio A" | Estadísticas completas |
| 9.5 | "Datos del edificio A" | Estadísticas completas |
| 9.6 | "Estadísticas del edificio A" (variante) | Estadísticas completas |
| 9.7 | "¿Cómo viene el edificio A?" | Estadísticas completas |
| 9.8 | "Cuentas del edificio A" | Estadísticas completas |

**Datos incluidos:**
- `totalUnits`: Total de unidades
- `billableUnits`: Unidades facturables
- `unitTypeCounts`: Conteo por tipo (apartamento, local, etc.)
- `occupancyCounts`: Conteo por estado de ocupación
- `openTickets`: Tickets abiertos
- `totalTickets`: Total de tickets
- `totalDebt`: Deuda total del edificio
- `averageDebt`: Deuda promedio por unidad

**Fallbacks:**
- Edificio no encontrado → "Edificio no encontrado"

---

### 2.5 Documentos del Edificio

**Intent:** `building_documents`
**Keywords:** `documento`, `documentos`, `archivo`, `archivos`, `pdf`, `comprobante`, `comprobantes`, `expediente`, `acta`, `planilla`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 10.1 | "Documentos del Edificio A" | Lista de documentos del edificio |
| 10.2 | "Archivos de la Torre B" | Lista de documentos |
| 10.3 | "PDFs del bloque C" | Lista de documentos |
| 10.4 | "Comprobantes del sector Norte" | Lista de documentos |
| 10.5 | "Documentos del complejo" | Lista de documentos |
| 10.6 | "Actas del edificio A" | Lista de documentos |
| 10.7 | "Expedientes del edificio A" | Lista de documentos |

**Datos incluidos:**
- `name`: Título del documento
- `type`: Categoría
- `visibility`: Visibilidad
- `isUnitSpecific`: Si es específico de una unidad
- `createdAt`: Fecha de creación

**Fallbacks:**
- Sin documentos → "No tiene documentos registrados"
- Edificio no encontrado → "Edificio no encontrado"

---

### 2.6 Pagos Recientes del Edificio

**Intent:** `building_payments`
**Keywords:** `pago`, `pagos`, `transferencia`, `transferencias`, `recibo`, `recibos`, `cobranza`, `cobranzas`

| # | Pregunta | Respuesta Esperada |
|---|----------|-------------------|
| 11.1 | "Pagos del Edificio A" | Últimos pagos con unidad origen |
| 11.2 | "Últimas transferencias de la Torre B" | Últimos pagos |
| 11.3 | "Recibos del bloque C" | Últimos pagos |
| 11.4 | "Pagos recientes del sector Norte" | Últimos pagos |
| 11.5 | "Transferencias del complejo" | Últimos pagos |
| 11.6 | "Cobranzas del edificio A" | Últimos pagos |
| 11.7 | "Recibos del edificio A" | Últimos pagos |

**Datos incluidos:**
- `payments`: Array con monto, método, estado, fecha, si es específico de unidad
- `sumByMethod`: Suma por método de pago
- `total`: Cantidad de pagos

**Filtros soportados:** `period` (YYYY-MM), `status`, `method`, `minAmount`, `maxAmount`

**Fallbacks:**
- Sin pagos → "No tiene pagos registrados"
- Edificio no encontrado → "Edificio no encontrado"

---

## 3. FOLLOW-UPS CONVERSACIONALES

> **Requieren:** Contexto conversacional previo (al menos un turno con entidades resueltas).
> El sistema detecta follow-ups por: mensajes cortos (< 10 palabras) que empiezan con conjunciones o palabras interrogativas.

### 3.1 Patrones de Follow-up Detectados

| Patrón | Ejemplo | Acción |
|--------|---------|--------|
| `^y\b` | "y cuántos meses" | Reusa último intent + entidades |
| `^cuantos\b` | "cuántos meses debe" | Reusa último intent + entidades |
| `^cuantas\b` | "cuántas personas viven" | Reusa último intent + entidades |
| `^quien\b` | "quién vive ahí" | Reusa último intent + entidades |
| `^donde\b` | "dónde está" | Reusa último intent + entidades |
| `^cuanto\b` | "cuánto debe" | Reusa último intent + entidades |
| `^tiene\b` | "tiene tickets" | Reusa último intent + entidades |
| `^hay\b` | "hay deuda" | Reusa último intent + entidades |
| `^cuales\b` | "cuáles son" | Reusa último intent + entidades |
| `^que\b` | "qué más" | Reusa último intent + entidades |
| `^como\b` | "cómo está" | Reusa último intent + entidades |

### 3.2 Flujos de Follow-up Validados

#### Flujo 1: Deuda + Meses
```
Usuario: "deuda unidad A-1203"
Asistente: "Deuda total: Bs.S 22.669,45 (5 meses adeudados)"

Usuario: "cuántos meses debe"
Asistente: "Deuda total: Bs.S 22.669,45 (5 meses adeudados)"
```

#### Flujo 2: Deuda + Tickets
```
Usuario: "deuda del departamento 101"
Asistente: "Deuda total: Bs.S 15.000,00"

Usuario: "y tiene tickets"
Asistente: [Lista de tickets de la unidad 101]
```

#### Flujo 3: Residentes + Pagos
```
Usuario: "quién vive en el apartamento 5B"
Asistente: "María Gómez (residente)"

Usuario: "cuáles son sus últimos pagos"
Asistente: [Lista de pagos de la unidad 5B]
```

#### Flujo 4: Edificio + Morosos
```
Usuario: "estadísticas del Edificio A"
Asistente: [Resumen del edificio]

Usuario: "y quiénes son los morosos"
Asistente: [Top deudores del Edificio A]
```

#### Flujo 5: Documentos + Más documentos
```
Usuario: "documentos de la unidad 101"
Asistente: [Lista de documentos]

Usuario: "y los del edificio"
Asistente: [Lista de documentos del edificio]
```

### 3.3 Inferencia de Intent en Follow-ups

Cuando el follow-up no trae palabras clave claras, el sistema infiere el intent del mensaje:

| Mensaje Follow-up | Intent Inferido |
|-------------------|-----------------|
| "meses" + "deuda" / "debe" | `unit_debt` |
| "tickets" / "reclamos" | `unit_tickets` o `building_tickets` |
| "pagos" / "transferencias" | `unit_payments` o `building_payments` |
| "residentes" / "vive" / "quién" | `unit_residents` |
| "documentos" / "archivos" | `unit_documents` o `building_documents` |

Si no puede inferir, **reusa el último intent** del contexto.

---

## 4. CONSULTAS A NIVEL TENANT

> **Requieren:** Autenticación API key. No usan lenguaje natural directamente; usan **intents formales**.

### 4.1 Unidades Morosas

**Intent:** `GET_OVERDUE_UNITS`

| # | Pregunta Equivalente | Respuesta Esperada |
|---|---------------------|-------------------|
| 12.1 | "¿Qué unidades tienen deuda vencida?" | Lista de unidades morosas ordenadas por monto |
| 12.2 | "Top morosos del tenant" | Top 5 morosos con monto y edificio |
| 12.3 | "¿Cuántas unidades están morosas?" | Cantidad + preview |

---

### 4.2 Pagos Pendientes de Aprobación

**Intent:** `GET_PENDING_PAYMENTS`

| # | Pregunta Equivalente | Respuesta Esperada |
|---|---------------------|-------------------|
| 13.1 | "¿Hay pagos pendientes de aprobación?" | Cantidad + preview de los 5 primeros |
| 13.2 | "Pagos por revisar" | Cantidad + preview |
| 13.3 | "Transferencias sin aprobar" | Cantidad + monto total pendiente |

---

### 4.3 Tickets Abiertos

**Intent:** `GET_OPEN_TICKETS`

| # | Pregunta Equivalente | Respuesta Esperada |
|---|---------------------|-------------------|
| 14.1 | "¿Qué tickets están abiertos?" | Cantidad + lista de tickets prioritarios |
| 14.2 | "Reclamos sin resolver" | Cantidad + preview |
| 14.3 | "Problemas pendientes" | Tickets abiertos/en progreso |

---

### 4.4 Unidades Vacantes

**Intent:** `GET_VACANT_UNITS`

| # | Pregunta Equivalente | Respuesta Esperada |
|---|---------------------|-------------------|
| 15.1 | "¿Qué unidades están vacantes?" | Lista de unidades vacantes |
| 15.2 | "Departamentos desocupados" | Cantidad + preview |
| 15.3 | "Unidades sin ocupantes" | Lista con edificio |

---

### 4.5 Resumen de Cobranzas

**Intent:** `GET_COLLECTIONS_SUMMARY`

| # | Pregunta Equivalente | Respuesta Esperada |
|---|---------------------|-------------------|
| 16.1 | "Resumen de cobranzas del mes" | Emitido, cobrado, pendiente, tasa de cobranza |
| 16.2 | "¿Cómo va la recaudación?" | Métricas del período actual |
| 16.3 | "Cobranzas del período" | Emitido, cobrado, pendiente, aprobaciones pendientes |

---

## 5. SINÓNIMOS SOPORTADOS

### Edificio
`torre`, `edificio`, `bloque`, `tower`, `building`, `sector`, `pabellon`, `pabellón`, `residencia`, `conjunto`, `complejo`

### Unidad
`unidad`, `apartamento`, `depto`, `departamento`, `apto`, `local`, `oficina`, `casa`, `cochera`, `garage`, `baulera`

### Persona
`residente`, `ocupante`, `inquilino`, `propietario`, `habitante`, `persona`, `dueño`

---

## 6. ROLES AUTORIZADOS

### Consultas Operativas (Todas las de nivel unidad y edificio)
- `SUPER_ADMIN`
- `TENANT_OWNER`
- `TENANT_ADMIN`
- `OPERATOR`

### Restricciones
- `RESIDENT`: Solo puede ver datos de su propia unidad (si está implementado)
- `GUEST`: No puede acceder a datos operativos

---

## 7. RESUMEN DE COBERTURA

| Capa | Intents | Preguntas Documentadas | Follow-ups | Total Interacciones |
|------|---------|----------------------|------------|-------------------|
| **Unidad** | 5 | 33 | 15 | 48 |
| **Edificio** | 6 | 40 | 20 | 60 |
| **Tenant** | 5 | 15 | — | 15 |
| **Follow-ups** | — | — | 25 | 25 |
| **TOTAL** | **16** | **88** | **60** | **148** |

---

## 8. NOTAS DE IMPLEMENTACIÓN

### Pipeline de Resolución v2 (Intent Engine)

```
1. IntentExtractorService (Dual LLM)
   ├── Ollama local (primario, 3s timeout)
   ├── Opencode API (fallback, 5s timeout)
   └── Deterministic fallback (regex keywords)

2. EntityResolverService
   ├── resolveBuilding(alias) → buildingId
   ├── resolveUnit(code, buildingId) → unitId
   └── resolvePerson(name) → personId

3. AmbiguityService
   └── Si hay múltiples matches → Clarification response

4. QueryPlannerService
   └── Build ExecutionPlan (intent + entityIds + filters)

5. QueryExecutorService
   ├── RBAC check (AuthorizeService)
   ├── IntentRegistry lookup
   └── Execute intent executor

6. ResponseFormatterService
   └── Format V2 StructuredResponse
```

### Contexto Conversacional

- **Almacenamiento:** Redis (producción) / Memoria (desarrollo)
- **TTL:** 30-120 minutos configurable
- **Key:** `assistant:context:{tenantId}:{userId}:{conversationId}`
- **Datos guardados:** Solo IDs (no nombres ni montos)
- **Max turns:** 5 últimos turnos

### Feature Flags

- `AI_INTENT_ENGINE_ENABLED`: Activa el endpoint `/chat/v2`
- Desarrollo: Bypass de RBAC y feature guards activo

---

## 9. INVENTARIO DE INVENTOS

| # | Nombre | Archivo | Permiso | Response Types |
|---|--------|---------|---------|----------------|
| 1 | `unit_residents` | `unit-residents.intent.ts` | `units.read` | table, text |
| 2 | `unit_debt` | `unit-debt.intent.ts` | `payments.review` | kpi, text |
| 3 | `unit_documents` | `unit-documents.intent.ts` | `units.read` | table, text |
| 4 | `unit_tickets` | `unit-tickets.intent.ts` | `tickets.read` | table, text |
| 5 | `unit_payments` | `unit-payments.intent.ts` | `payments.review` | table, text |
| 6 | `building_debt` | `building-debt.intent.ts` | `payments.review` | kpi, text |
| 7 | `building_delinquents` | `building-delinquents.intent.ts` | `payments.review` | table, text |
| 8 | `building_stats` | `building-stats.intent.ts` | `buildings.read` | kpi, text, chart |
| 9 | `building_documents` | `building-documents.intent.ts` | `buildings.read` | table, text |
| 10 | `building_tickets` | `building-tickets.intent.ts` | `tickets.read` | table, text |
| 11 | `building_payments` | `building-payments.intent.ts` | `payments.review` | table, text |
| 12 | `expenses_summary` | `expenses-summary.intent.ts` | `payments.review` | kpi, text |
| 13 | `cashflow_compare` | `cashflow-compare.intent.ts` | `payments.review` | chart, text |
| 14 | `vendors_list` | `vendors-list.intent.ts` | `payments.review` | table, text |
| 15 | `communications_send_reminder` | `communications-send-reminder.intent.ts` | `communications.create` | action_list |

**Nota:** Los intents 12-15 son stubs (esqueletos) y aún no tienen queries reales implementadas.

---

*Documento generado automáticamente a partir del código fuente y tests del Intent Engine v2.*
