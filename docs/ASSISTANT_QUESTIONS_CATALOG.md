# Catálogo de Preguntas del Asistente AI - BuildingOS

> Documento de referencia: TODAS las preguntas que el administrador puede hacer al asistente y que el sistema resuelve determinísticamente.
> Última actualización: 2026-05-04

---

## Arquitectura de Resolución

El asistente tiene **dos capas** de resolución de consultas operativas:

1. **Strict Operational Queries** (`assistant.service.ts`) — Keyword-based, sin LLM. Responde preguntas específicas de **unidad** o **edificio**.
2. **Read-Only Query Service** (`read-only-query.service.ts`) — Intents formales vía API. Responde reportes a nivel **tenant**.

---

## 1. CONSULTAS A NIVEL UNIDAD

> Requieren: `unidad` + `edificio` en el mensaje.  
> Ejemplo: *"departamento 101 del Edificio A"*

### 1.1 Residentes / Ocupantes

**Keywords detectadas:** `residente` | `ocupante` | `inquilino` | `propietario` | `habita` | `vive`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 1 | "¿Cómo se llama el residente del departamento 101 del Edificio A?" | Nombre del ocupante principal + rol |
| 2 | "¿Quién es el residente del apartamento 5B de la Torre B?" | Nombre del ocupante principal + rol |
| 3 | "Nombre del residente de la unidad 301 del bloque C" | Nombre del ocupante principal + rol |
| 4 | "Nombre del residente propietario del local 12 del Edificio Central" | Nombre del propietario |
| 5 | "Nombre del residente del depto 2-14 del sector Norte" | Nombre del ocupante principal + rol |

**Fallbacks cubiertos:**
- Sin ocupantes activos → "no tiene ocupantes activos"
- Múltiples ocupantes primarios → "Hay más de un ocupante primario..."
- Ocupante sin nombre → "tiene ocupante activo, pero sin nombre cargado"
- Falta unidad o edificio → pide ambos con ejemplo

### 1.2 Deuda / Saldo Pendiente

**Keywords detectadas:** `debe` | `cuanto debe` | `deuda` | `saldo` | `adeuda` | `cuanto` | `monto` | `importe`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 6 | "¿Cuánto debe la unidad 101 del Edificio A?" | Monto de deuda pendiente en moneda del tenant |
| 7 | "Deuda del departamento 5B de la Torre B" | Monto de deuda pendiente |
| 8 | "¿Qué saldo pendiente tiene el apartamento 301?" | Monto de deuda pendiente |
| 9 | "¿Cuánto adeuda el local 12 del Edificio Central?" | Monto de deuda pendiente |
| 10 | "¿La unidad 2-14 tiene deuda?" | Sí/No + monto |

**Fallbacks cubiertos:**
- Sin deuda → "no tiene deuda pendiente. Saldo actual: $0,00"
- Falta unidad o edificio → pide ambos con ejemplo

### 1.3 Documentos

**Keywords detectadas:** `documento` | `documentos` | `archivo` | `archivos` | `pdf` | `comprobante` | `comprobantes` | `expediente` | `acta` | `planilla`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 11 | "Documentos del departamento 101 del Edificio A" | Lista de documentos (título + categoría) |
| 12 | "¿Qué archivos tiene la unidad 5B de la Torre B?" | Lista de documentos |
| 13 | "PDFs del apartamento 301" | Lista de documentos |
| 14 | "Comprobantes del local 12 del Edificio Central" | Lista de documentos |
| 15 | "Documentos de la cochera 15 del sector Norte" | Lista de documentos |

**Fallbacks cubiertos:**
- Sin documentos → "no tiene documentos registrados"
- Falta unidad o edificio → pide ambos con ejemplo

### 1.4 Tickets / Reclamos / Averías

**Keywords detectadas:** `ticket` | `tickets` | `reclamo` | `reclamos` | `problema` | `problemas` | `averia` | `falla` | `solicitud` | `incidente` | `reparacion` | `arreglo`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 16 | "Tickets del departamento 101 del Edificio A" | Lista de tickets con estado |
| 17 | "¿Hay reclamos en la unidad 5B de la Torre B?" | Tickets abiertos + recientes |
| 18 | "Problemas del apartamento 301" | Lista de tickets |
| 19 | "Averías del local 12 del Edificio Central" | Lista de tickets |
| 20 | "¿Qué tickets tiene la cochera 15?" | Lista de tickets |

**Fallbacks cubiertos:**
- Sin tickets → "no tiene tickets registrados"
- Falta unidad o edificio → pide ambos con ejemplo

### 1.5 Pagos Recientes

**Keywords detectadas:** `pago` | `pagos` | `transferencia` | `transferencias` | `recibo` | `recibos` | `movimiento` | `movimientos` | `transaccion` | `transacciones`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 21 | "Últimos pagos del departamento 101 del Edificio A" | Lista de pagos (monto, estado, fecha) |
| 22 | "Historial de pagos de la unidad 5B de la Torre B" | Lista de pagos |
| 23 | "Pagos recientes del apartamento 301" | Lista de pagos |
| 24 | "Historial de transferencias del local 12 del Edificio Central" | Lista de pagos |
| 25 | "Recibos recientes de la cochera 15" | Lista de pagos |

**Fallbacks cubiertos:**
- Sin pagos → "no tiene pagos registrados"
- Falta unidad o edificio → pide ambos con ejemplo

---

## 2. CONSULTAS A NIVEL EDIFICIO

> Requieren: `edificio` en el mensaje, **sin** `unidad`.  
> Ejemplo: *"deuda del Edificio A"*

### 2.1 Deuda Total del Edificio

**Keywords detectadas:** `debe` | `cuanto debe` | `deuda` | `saldo` | `adeuda` | `cuanto` | `monto` | `importe`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 26 | "¿Cuánto debe el Edificio A?" | Deuda total del edificio + cantidad de unidades |
| 27 | "Deuda de la Torre B" | Deuda total del edificio |
| 28 | "¿Qué saldo pendiente tiene el bloque C?" | Deuda total del edificio |
| 29 | "¿Cuánto adeuda el sector Norte?" | Deuda total del edificio |
| 30 | "Deuda del complejo residencial" | Deuda total del edificio |

**Fallbacks cubiertos:**
- Sin deuda → "no tiene deuda pendiente. Todas las unidades están al día"
- Edificio no encontrado → pide verificar el nombre

### 2.2 Tickets del Edificio

**Keywords detectadas:** `ticket` | `tickets` | `reclamo` | `reclamos` | `problema` | `problemas` | `averia` | `falla` | `solicitud` | `incidente` | `reparacion` | `arreglo`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 31 | "Tickets del Edificio A" | Lista de tickets recientes + cantidad abiertos |
| 32 | "Reclamos de la Torre B" | Lista de tickets |
| 33 | "Problemas del bloque C" | Lista de tickets |
| 34 | "Averías del sector Norte" | Lista de tickets |
| 35 | "¿Hay tickets en el complejo?" | Lista de tickets |

**Fallbacks cubiertos:**
- Sin tickets → "no tiene tickets registrados"
- Edificio no encontrado → pide verificar el nombre

### 2.3 Morosos / Top Deudores

**Keywords detectadas:** `moroso` | `morosos` | `morosa` | `morosas` | `deudor` | `deudores` | `deudora` | `deudoras` | `quien debe` | `quienes deben` | `quien no pago` | `quienes no pagan` | `top deudores` | `ranking de deuda` | `atrasados` | `atrasadas` | `impagos` | `incobrables`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 36 | "¿Quiénes son los morosos del Edificio A?" | Top 10 deudores ordenados por monto |
| 37 | "Top deudores de la Torre B" | Top 10 deudores |
| 38 | "Ranking de deuda del bloque C" | Top 10 deudores |
| 39 | "¿Quién debe en el sector Norte?" | Top 10 deudores |
| 40 | "Morosos del complejo" | Top 10 deudores |
| 41 | "Deudores del Edificio Central" | Top 10 deudores |

**Fallbacks cubiertos:**
- Sin deudores → "no tiene unidades con deuda pendiente"
- Edificio no encontrado → pide verificar el nombre

### 2.4 Estadísticas del Edificio

**Keywords detectadas:** `estadistica` | `estadísticas` | `estadisticas` | `cuantas unidades` | `cuántas unidades` | `resumen` | `informacion del edificio` | `información del edificio` | `datos del edificio` | `como viene` | `como va` | `estado del edificio` | `situacion del edificio` | `cuentas del edificio`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 42 | "Estadísticas del Edificio A" | Unidades, tickets, deuda total, deuda promedio |
| 43 | "¿Cuántas unidades tiene la Torre B?" | Unidades + resumen completo |
| 44 | "Resumen del bloque C" | Estadísticas completas |
| 45 | "Información del edificio A" | Estadísticas completas |
| 46 | "Datos del edificio A" | Estadísticas completas |
| 47 | "Estadísticas del edificio A" | Estadísticas completas |

**Fallbacks cubiertos:**
- Edificio no encontrado → pide verificar el nombre

### 2.5 Documentos del Edificio

**Keywords detectadas:** `documento` | `documentos` | `archivo` | `archivos` | `pdf` | `comprobante` | `comprobantes` | `expediente` | `acta` | `planilla`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 48 | "Documentos del Edificio A" | Lista de documentos del edificio |
| 49 | "Archivos de la Torre B" | Lista de documentos |
| 50 | "PDFs del bloque C" | Lista de documentos |
| 51 | "Comprobantes del sector Norte" | Lista de documentos |
| 52 | "Documentos del complejo" | Lista de documentos |

**Fallbacks cubiertos:**
- Sin documentos → "no tiene documentos registrados"
- Edificio no encontrado → pide verificar el nombre

### 2.6 Pagos Recientes del Edificio

**Keywords detectadas:** `pago` | `pagos` | `transferencia` | `transferencias` | `recibo` | `recibos` | `cobranza` | `cobranzas`

| # | Pregunta | Qué responde |
|---|----------|--------------|
| 53 | "Pagos del Edificio A" | Últimos pagos con unidad origen |
| 54 | "Últimas transferencias de la Torre B" | Últimos pagos |
| 55 | "Recibos del bloque C" | Últimos pagos |
| 56 | "Pagos recientes del sector Norte" | Últimos pagos |
| 57 | "Transferencias del complejo" | Últimos pagos |

**Fallbacks cubiertos:**
- Sin pagos → "no tiene pagos registrados"
- Edificio no encontrado → pide verificar el nombre

---

## 3. CONSULTAS A NIVEL TENANT (Read-Only Query Service)

> Requieren autenticación API key. No usan lenguaje natural directamente; usan **intents formales**.  
> Estas son las preguntas que se mapean a esos intents.

### 3.1 Unidades Morosas

**Intent:** `GET_OVERDUE_UNITS`

| # | Pregunta equivalente | Qué responde |
|---|---------------------|--------------|
| 58 | "¿Qué unidades tienen deuda vencida?" | Lista de unidades morosas ordenadas por monto |
| 59 | "Top morosos del tenant" | Top 5 morosos con monto y edificio |
| 60 | "¿Cuántas unidades están morosas?" | Cantidad + preview |

### 3.2 Pagos Pendientes de Aprobación

**Intent:** `GET_PENDING_PAYMENTS`

| # | Pregunta equivalente | Qué responde |
|---|---------------------|--------------|
| 61 | "¿Hay pagos pendientes de aprobación?" | Cantidad + preview de los 5 primeros |
| 62 | "Pagos por revisar" | Cantidad + preview |
| 63 | "Transferencias sin aprobar" | Cantidad + monto total pendiente |

### 3.3 Tickets Abiertos

**Intent:** `GET_OPEN_TICKETS`

| # | Pregunta equivalente | Qué responde |
|---|---------------------|--------------|
| 64 | "¿Qué tickets están abiertos?" | Cantidad + lista de tickets prioritarios |
| 65 | "Reclamos sin resolver" | Cantidad + preview |
| 66 | "Problemas pendientes" | Tickets abiertos/en progreso |

### 3.4 Unidades Vacantes

**Intent:** `GET_VACANT_UNITS`

| # | Pregunta equivalente | Qué responde |
|---|---------------------|--------------|
| 67 | "¿Qué unidades están vacantes?" | Lista de unidades vacantes |
| 68 | "Departamentos desocupados" | Cantidad + preview |
| 69 | "Unidades sin ocupantes" | Lista con edificio |

### 3.5 Resumen de Cobranzas

**Intent:** `GET_COLLECTIONS_SUMMARY`

| # | Pregunta equivalente | Qué responde |
|---|---------------------|--------------|
| 70 | "Resumen de cobranzas del mes" | Emitido, cobrado, pendiente, tasa de cobranza |
| 71 | "¿Cómo va la recaudación?" | Métricas del período actual |
| 72 | "Cobranzas del período" | Emitido, cobrado, pendiente, aprobaciones pendientes |

---

## 4. SINÓNIMOS SOPORTADOS

### Edificio
`torre`, `edificio`, `bloque`, `tower`, `building`, `sector`, `pabellon`, `pabellón`, `residencia`, `conjunto`, `complejo`

### Unidad
`unidad`, `apartamento`, `depto`, `departamento`, `apto`, `local`, `oficina`, `casa`, `cochera`, `garage`, `baulera`

---

## 5. ROLES AUTORIZADOS

Todas las consultas operativas requieren uno de estos roles:
- `SUPER_ADMIN`
- `TENANT_OWNER`
- `TENANT_ADMIN`
- `OPERATOR`

Los roles `RESIDENT` y `GUEST` no pueden acceder a datos operativos.

---

## 6. COBERTURA TOTAL

| Capa | Categorías | Preguntas documentadas | Variaciones adicionales testeadas |
|------|-----------|----------------------|--------------------------------|
| **Unidad** | 5 | 25 | 6 |
| **Edificio** | 6 | 32 | 8 |
| **Tenant** | 5 | 15 | — |
| **TOTAL** | **16** | **72** | **14** |

---

## 7. NOTAS DE IMPLEMENTACIÓN

### Pipeline de Resolución (orden de evaluación)

```
1. tryResolveStrictBuildingDebtQuestion
2. tryResolveStrictBuildingTicketsQuestion
3. tryResolveStrictBuildingDelinquentsQuestion
4. tryResolveStrictBuildingStatsQuestion
5. tryResolveStrictBuildingDocumentsQuestion
6. tryResolveStrictBuildingPaymentsQuestion
7. tryResolveStrictResidentNameQuestion
8. tryResolveStrictUnitDebtQuestion
9. tryResolveStrictUnitDocumentsQuestion
10. tryResolveStrictUnitTicketsQuestion
11. tryResolveStrictUnitPaymentsQuestion
```

> **Importante:** Las queries a nivel edificio se evalúan **antes** que las de unidad. Esto permite que `"deuda del Edificio A"` vaya al resolver de edificio, y `"deuda del depto 101 del Edificio A"` vaya al de unidad.

### Fallbacks Globales

Si NINGÚN strict resolver matchea, el sistema:
1. Intenta usar el Read-Only Query Service (si hay API key e intent formal)
2. Usa el MockAiProvider con respuesta educada en español que sugiere navegación
3. NUNCA inventa datos operativos
