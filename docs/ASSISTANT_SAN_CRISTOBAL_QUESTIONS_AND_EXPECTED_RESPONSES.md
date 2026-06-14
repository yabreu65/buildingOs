# Preguntas y Respuestas Esperadas - San Cristobal

Documento operativo para Residencia San Cristobal.
Resume las preguntas realmente testeadas, la ruta que responde, la expectativa correcta y el estado observado en la ultima verificacion E2E.

## Conteos Globales

Antes de bajar a San Cristobal, hay que separar tres numeros distintos que hoy conviven en la documentacion.

| Fuente | Numero | Qué significa |
|---|---:|---|
| `docs/ASSISTANT_QUESTIONS_COMPLETE_CATALOG.md` resumen de cobertura | `148` | Total global documentado: `88` preguntas + `60` follow-ups. |
| `docs/ASSISTANT_QUESTIONS_COMPLETE_CATALOG.md` filas numeradas explícitas | `87` | Filas realmente enumeradas en tablas del documento. |
| Este documento de San Cristobal | `77` | Interacciones ya aterrizadas a San Cristobal: `66` legacy + `11` oficiales V2. |

### Aclaración importante

- El `148` sale del resumen interno del catálogo global, no de 148 filas individuales una por una.
- Los `60 follow-ups` están agregados como cobertura conceptual. El documento fuente explicita patrones, flujos y reglas de inferencia, pero NO lista 60 utterances únicas en tablas separadas.
- Por eso, si en algún momento te quedó la idea de `211`, hoy no está respaldada por ningún `.md` del repo.

## Mapeo del Catálogo Global a San Cristobal

| Bloque global | Conteo fuente | Aplica al seed de San Cristobal | Estado en San Cristobal | Nota |
|---|---:|---|---|---|
| Preguntas de nivel unidad | `33` según resumen global | Sí | Parcialmente aterrizado | En tests legacy quedaron 32 casos de unidad/frontera-persona-estacionamiento; en V2 hay 5 intents reales de unidad. |
| Preguntas de nivel edificio | `40` según resumen global | Sí | Parcialmente aterrizado | En tests legacy quedaron 27 casos de edificio/frontera; en V2 hay 6 intents reales de edificio. |
| Preguntas de nivel tenant | `15` según resumen global | Sí, pero fuera del chat natural actual | No aterrizado en este doc | Requieren API key e intents formales (`GET_*`), no las cubrimos en los E2E de `/assistant/chat` o `/assistant/chat/v2`. |
| Follow-ups conversacionales | `60` según resumen global | Sí | No aterrizado 1 a 1 | El catálogo global describe patrones y flujos, pero San Cristobal todavía no tiene un doc exhaustivo pregunta por pregunta para follow-ups. |

## Qué cubre este documento hoy

| Cobertura | Cantidad | Estado |
|---|---:|---|
| Preguntas legacy `/assistant/chat` | `66` | Documentadas una por una abajo |
| Preguntas oficiales `/assistant/chat/v2` | `11` | Documentadas una por una abajo |
| Preguntas tenant `GET_*` | `0` | Pendiente de aterrizar a San Cristobal |
| Follow-ups documentados 1 a 1 | `0` | Pendiente de aterrizar a San Cristobal |

## Qué faltaría para cubrir el catálogo global completo

1. Traducir las `15` consultas de tenant a casos reales del seed de San Cristobal.
2. Crear una batería de follow-ups reales para San Cristobal, no solo reglas generales.
3. Resolver el desfasaje entre el resumen global (`148`) y las filas explícitas (`87`) para que el conteo deje de ser ambiguo.

## Quick Path

1. Si querés saber si una pregunta ya está cubierta en San Cristobal, buscala por `ID` o por texto.
2. Si querés validar la ruta legacy, mirá la columna `Estado legacy`.
3. Si querés validar la ruta oficial, mirá la sección `/chat/v2` con `Intent esperado` y `Estado V2`.

## Cómo leer este documento

| Campo | Significa |
|---|---|
| `Respuesta correcta esperada` | Lo que conceptualmente debe contestar el assistant para considerarse correcto en San Cristobal. |
| `OK` | La respuesta pasó la validación relevante. |
| `WARNING` | Respondió datos reales, pero el texto no incluyó alguna keyword esperada del contrato del test legacy. |
| `FAIL` | Cayó al fallback o no respondió datos reales. |

## Legacy `/assistant/chat`

### A. Residentes / Ocupantes

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| A1 | `Quien vive en el departamento A-0101` | Debe identificar residente principal de `A-0101` y sugerir `VIEW_REPORTS`. | OK | Cobertura real por unidad. |
| A2 | `Residente del apartamento A-0102` | Debe identificar residente principal de `A-0102` y sugerir `VIEW_REPORTS`. | OK | Cobertura real por unidad. |
| A3 | `Inquilino del depto B-0103` | Debe identificar residente principal de `B-0103` y sugerir `VIEW_REPORTS`. | OK | Cobertura real por unidad. |
| A4 | `Propietario del departamento A-0104` | Debe responder el ocupante principal de `A-0104`, idealmente mencionando rol propietario. | WARNING | Responde la unidad, pero no incluye keyword `propietario`. |
| A5 | `Quien habita en la unidad B-0105` | Debe identificar residente principal de `B-0105` y sugerir `VIEW_REPORTS`. | OK | Cobertura real por unidad. |
| A6 | `Ocupante del apartamento A-0106` | Debe identificar residente principal de `A-0106` y sugerir `VIEW_REPORTS`. | OK | Cobertura real por unidad. |
| A7 | `Residente del departamento A-9999` | Debe indicar que no encontró la unidad. | OK | Manejo correcto de inexistente. |
| A8 | `Quien vive en A-1203` | Debe identificar residente principal de `A-1203` usando formato opaco. | OK | Soporta código opaco. |
| A9 | `Residente de B-1203` | Debe identificar residente principal de `B-1203` usando formato opaco. | OK | Soporta código opaco. |

### B. Deuda por unidad

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| B1 | `Cuanto debe el departamento A-0101` | Debe devolver deuda de `A-0101` con monto y navegación a `VIEW_PAYMENTS`. | OK | Contrato más estricto del bloque. |
| B2 | `Deuda del apartamento B-0102` | Debe devolver deuda de `B-0102`. | OK | Cobertura real. |
| B3 | `Que saldo tiene el depto A-0103` | Debe devolver deuda/saldo real de `A-0103`. | WARNING | Responde deuda real, pero sin keyword `saldo`. |
| B4 | `Cuanto adeuda la unidad B-0104` | Debe devolver deuda real de `B-0104`. | WARNING | Responde deuda real, pero sin keyword `adeuda`. |
| B5 | `Monto de deuda del departamento A-0105` | Debe devolver monto de deuda real de `A-0105`. | WARNING | Responde deuda real, pero sin keyword `monto`. |
| B6 | `Importe pendiente del apartamento A-0106` | Debe devolver deuda real de `A-0106`. | WARNING | Responde deuda real, pero sin keyword `importe`. |
| B7 | `La unidad B-0107 esta al dia` | Debe indicar si tiene o no deuda actual. | WARNING | Responde situación real, pero no incluye `saldo`. |
| B8 | `Deuda del departamento A-0201` | Debe devolver deuda real de `A-0201`. | OK | Cobertura real. |
| B9 | `Deuda de la unidad A-1203` | Debe devolver deuda real de `A-1203`. | OK | Código opaco soportado. |
| B10 | `Deuda de la unidad B-1203` | Debe devolver deuda real de `B-1203`. | OK | Código opaco soportado. |

### C. Documentos por unidad

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| C1 | `Documentos del departamento A-0101` | Debe listar documentos o indicar que la unidad no tiene documentos registrados. | OK | Respuesta real por ausencia o presencia. |
| C2 | `Archivos del apartamento B-0102` | Debe listar documentos o indicar ausencia. | OK | Cobertura real. |
| C3 | `PDFs de la unidad A-0103` | Debe listar documentos o indicar ausencia. | OK | Cobertura real. |
| C4 | `Comprobantes del depto B-0104` | Debe listar documentos o indicar ausencia. | OK | Cobertura real. |

### D. Tickets por unidad

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| D1 | `Tickets del departamento A-0101` | Debe listar tickets o indicar que no tiene tickets registrados. | OK | Cobertura real. |
| D2 | `Reclamos del apartamento B-0102` | Debe listar tickets/reclamos o indicar ausencia. | WARNING | Respuesta real, sin keyword `reclamo`. |
| D3 | `Problemas de la unidad A-0103` | Debe listar tickets/problemas o indicar ausencia. | WARNING | Respuesta real, sin keyword `problema`. |
| D4 | `Averias del depto B-0104` | Debe listar tickets/averías o indicar ausencia. | WARNING | Respuesta real, sin keyword `averia`. |

### E. Pagos por unidad

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| E1 | `Ultimos pagos del departamento A-0101` | Debe listar pagos recientes o indicar ausencia. | OK | Cobertura real. |
| E2 | `Historial de pagos del apartamento B-0102` | Debe listar pagos recientes/historial. | WARNING | Respuesta real, sin keyword `historial`. |
| E3 | `Transferencias de la unidad A-0103` | Debe listar pagos por unidad. | WARNING | Respuesta real, sin keyword `transferencia`. |
| E4 | `Recibos del depto B-0104` | Debe listar pagos/recibos. | WARNING | Respuesta real, sin keyword `recibo`. |
| E5 | `Movimientos del departamento A-0105` | Debe listar pagos/movimientos. | WARNING | Respuesta real, sin keyword `movimiento`. |

### F. Deuda por edificio

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| F1 | `Cuanto debe la Torre A` | Debe devolver deuda total de Torre A. | OK | Cobertura real por edificio. |
| F2 | `Deuda de la Torre B` | Debe devolver deuda total de Torre B. | OK | Cobertura real por edificio. |
| F3 | `Que saldo tiene el edificio A` | Debe devolver deuda/saldo total del edificio A. | WARNING | Respuesta real, sin keyword `saldo`. |
| F4 | `Monto adeudado del complejo` | Debe devolver deuda total del complejo/tenant. | WARNING | Respuesta real, sin keyword `monto`. |
| F5 | `Importe pendiente de la torre` | Debe devolver deuda total del edificio/torre. | FAIL | Cae al fallback genérico. |

### G. Tickets por edificio

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| G1 | `Tickets de la Torre A` | Debe listar tickets del edificio o indicar ausencia. | OK | Cobertura real. |
| G2 | `Reclamos de la Torre B` | Debe listar tickets/reclamos del edificio. | WARNING | Respuesta real, sin keyword `reclamo`. |
| G3 | `Problemas del edificio A` | Debe listar tickets/problemas del edificio. | WARNING | Respuesta real, sin keyword `problema`. |
| G4 | `Fallas de la Torre A` | Debe listar tickets/fallas del edificio. | WARNING | Respuesta real, sin keyword `falla`. |

### H. Morosos por edificio

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| H1 | `Quienes son los morosos de la Torre A` | Debe listar unidades/deudores morosos de Torre A. | WARNING | Respuesta real, sin keyword `moroso`. |
| H2 | `Top deudores de la Torre B` | Debe listar ranking de deudores de Torre B. | OK | Cobertura real. |
| H3 | `Ranking de deuda del edificio A` | Debe listar ranking deudor del edificio A. | WARNING | Respuesta real, sin keyword `ranking`. |
| H4 | `Atrasados de la Torre A` | Debe listar morosos/atrasados. | WARNING | Respuesta real, sin keyword `atrasados`. |
| H5 | `Impagos de la Torre B` | Debe listar morosos/impagos. | WARNING | Respuesta real, sin keyword `impagos`. |
| H6 | `Deudores del complejo` | Debe listar deudores a nivel complejo. | FAIL | Cae al fallback genérico. |

### I. Estadísticas por edificio

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| I1 | `Estadisticas de la Torre A` | Debe devolver resumen estadístico del edificio. | WARNING | Respuesta real, sin keyword `estadisticas`. |
| I2 | `Cuantas unidades tiene la Torre B` | Debe devolver cantidad de unidades de Torre B. | OK | Cobertura real. |
| I3 | `Resumen del edificio A` | Debe devolver resumen del edificio A. | WARNING | Respuesta real, sin keyword `resumen`. |
| I4 | `Como viene la Torre A` | Debe devolver estado/resumen estadístico del edificio. | WARNING | Respuesta real, sin keyword `estadisticas`. |
| I5 | `Cuentas del edificio B` | Debe devolver estado/resumen del edificio B. | WARNING | Respuesta real, sin keyword `cuentas`. |

### J. Documentos por edificio

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| J1 | `Documentos de la Torre A` | Debe listar documentos del edificio o indicar ausencia. | OK | Cobertura real. |
| J2 | `Archivos de la Torre B` | Debe listar documentos/archivos del edificio. | WARNING | Respuesta real, sin keyword `archivos`. |
| J3 | `Actas del edificio A` | Debe listar documentos/actas del edificio. | WARNING | Respuesta real, sin keyword `actas`. |

### K. Pagos por edificio

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| K1 | `Pagos de la Torre A` | Debe listar pagos del edificio o indicar ausencia. | OK | Cobertura real. |
| K2 | `Transferencias de la Torre B` | Debe listar pagos/transferencias del edificio. | WARNING | Respuesta real, sin keyword `transferencias`. |
| K3 | `Recibos del edificio A` | Debe listar pagos/recibos del edificio. | WARNING | Respuesta real, sin keyword `recibos`. |
| K4 | `Cobranzas de la Torre A` | Debe listar pagos/cobranzas del edificio. | WARNING | Respuesta real, sin keyword `cobranzas`. |

### L. Frontera, persona y seguridad

| ID | Pregunta | Respuesta correcta esperada | Estado legacy | Nota |
|---|---|---|---|---|
| L1 | `Deuda del departamento 0101` | Debe sugerir unidades similares como `A-0101` cuando falta torre. | OK | Manejo correcto de ambigüedad. |
| L2 | `Deuda de la Torre Z` | Debe indicar que no encontró la torre. | OK | Manejo correcto de inexistente. |
| L3 | `Tickets del departamento A-9999` | Debe indicar que no encontró la unidad. | OK | Manejo correcto de inexistente. |
| L4 | `Deuda del estacionamiento AP-1203` | Debe responder deuda vinculada al estacionamiento/unidad asociada. | OK | Cobertura real de estacionamiento. |
| L5 | `Hola, como estas?` | Debería manejar saludo sin caer en fallback genérico si se quisiera una UX conversacional mejor. | FAIL | Hoy cae al fallback del mock. |
| L6 | `Donde vive el residente Residente 1` | Debe ubicar a `Residente 1` en `A-0101`. | OK | Búsqueda por persona solo en legacy. |
| L7 | `Cual es el estacionamiento del residente Residente 1` | Debe ubicar el estacionamiento `AP-0101` de `Residente 1`. | OK | Asociación persona-estacionamiento solo en legacy. |

## Oficial `/assistant/chat/v2`

En esta ruta la validación correcta no depende de keywords sueltas: exige `201`, `meta.intent`, `tenantScoped`, `debug.zodValidationPassed`, `debug.rbacChecked` y forma estructurada de `data`.

| ID | Pregunta | Intent esperado | Respuesta correcta esperada | Estado V2 |
|---|---|---|---|---|
| V2-1 | `Quien vive en el departamento A-0101` | `unit_residents` | Debe devolver arreglo de residentes de la unidad. | OK |
| V2-2 | `Cuanto debe el departamento A-0101` | `unit_debt` | Debe devolver objeto con `totalDebt`. | OK |
| V2-3 | `Documentos del departamento A-0101` | `unit_documents` | Debe devolver arreglo de documentos de unidad. | OK |
| V2-4 | `Tickets del departamento A-0101` | `unit_tickets` | Debe devolver arreglo de tickets de unidad. | OK |
| V2-5 | `Ultimos pagos del departamento A-0101` | `unit_payments` | Debe devolver arreglo de pagos de unidad. | OK |
| V2-6 | `Cuanto debe la Torre A` | `building_debt` | Debe devolver objeto con `totalDebt`. | OK |
| V2-7 | `Quienes son los morosos de la Torre A` | `building_delinquents` | Debe devolver objeto con arreglo `delinquents`. | OK |
| V2-8 | `Documentos de la Torre A` | `building_documents` | Debe devolver arreglo de documentos de edificio. | OK |
| V2-9 | `Tickets de la Torre A` | `building_tickets` | Debe devolver objeto con arreglo `tickets`. | OK |
| V2-10 | `Pagos de la Torre A` | `building_payments` | Debe devolver objeto con arreglo `payments`. | OK |
| V2-11 | `Estadisticas de la Torre A` | `building_stats` | Debe devolver objeto con `totalUnits` y `totalDebt`. | OK |

## Gaps todavía abiertos

| Ruta | Pregunta tipo | Estado actual |
|---|---|---|
| `/assistant/chat/v2` | `Resumen de gastos del edificio` | Stub `expenses_summary` |
| `/assistant/chat/v2` | `Compara ingresos y gastos del edificio` | Stub `cashflow_compare` |
| `/assistant/chat/v2` | `Lista los proveedores del edificio` | Stub `vendors_list` |
| `/assistant/chat/v2` | `Envia un recordatorio a los morosos` | Stub `communications_send_reminder` |
| `/assistant/chat/v2` | `Donde vive el residente Residente 1` | Sin soporte oficial estable por nombre del seed |
| `/assistant/chat/v2` | `Cual es el estacionamiento del residente Residente 1` | Sin intent oficial |

## Referencias

- `apps/api/test/assistant-san-cristobal.e2e-spec.ts`
- `apps/api/test/assistant-san-cristobal-v2.e2e-spec.ts`
- `docs/ASSISTANT_SAN_CRISTOBAL_COVERAGE_MATRIX.md`
- `docs/ASSISTANT_QUESTIONS_COMPLETE_CATALOG.md`
