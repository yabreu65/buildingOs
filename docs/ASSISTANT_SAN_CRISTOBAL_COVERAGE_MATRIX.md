# Matriz de Cobertura - Asistente San Cristobal

Estado actual de cobertura real usando el seed de Residencia San Cristobal.

| Categoria | Pregunta ejemplo | Ruta | Responde real | Testeada | Gap | Prioridad |
|---|---|---|---|---|---|---|
| Residentes por unidad | `Quien vive en el departamento A-0101` | `/assistant/chat` | Si | Si | No | Alta |
| Residentes por unidad | `Quien vive en el departamento A-0101` | `/assistant/chat/v2` | Si (`unit_residents`) | Si | No | Alta |
| Deuda por unidad | `Cuanto debe el departamento A-0101` | `/assistant/chat` | Si | Si | No | Alta |
| Deuda por unidad | `Cuanto debe el departamento A-0101` | `/assistant/chat/v2` | Si (`unit_debt`) | Si | No | Alta |
| Documentos por unidad | `Documentos del departamento A-0101` | `/assistant/chat` | Si | Si | No | Media |
| Documentos por unidad | `Documentos del departamento A-0101` | `/assistant/chat/v2` | Si (`unit_documents`) | Si | No | Media |
| Tickets por unidad | `Tickets del departamento A-0101` | `/assistant/chat` | Si | Si | No | Media |
| Tickets por unidad | `Tickets del departamento A-0101` | `/assistant/chat/v2` | Si (`unit_tickets`) | Si | No | Media |
| Pagos por unidad | `Ultimos pagos del departamento A-0101` | `/assistant/chat` | Si | Si | No | Alta |
| Pagos por unidad | `Ultimos pagos del departamento A-0101` | `/assistant/chat/v2` | Si (`unit_payments`) | Si | No | Alta |
| Deuda por edificio | `Cuanto debe la Torre A` | `/assistant/chat` | Si | Si | No | Alta |
| Deuda por edificio | `Cuanto debe la Torre A` | `/assistant/chat/v2` | Si (`building_debt`) | Si | No | Alta |
| Morosos por edificio | `Quienes son los morosos de la Torre A` | `/assistant/chat` | Si | Si | No | Alta |
| Morosos por edificio | `Quienes son los morosos de la Torre A` | `/assistant/chat/v2` | Si (`building_delinquents`) | Si | No | Alta |
| Documentos por edificio | `Documentos de la Torre A` | `/assistant/chat` | Si | Si | No | Media |
| Documentos por edificio | `Documentos de la Torre A` | `/assistant/chat/v2` | Si (`building_documents`) | Si | No | Media |
| Tickets por edificio | `Tickets de la Torre A` | `/assistant/chat` | Si | Si | No | Media |
| Tickets por edificio | `Tickets de la Torre A` | `/assistant/chat/v2` | Si (`building_tickets`) | Si | No | Media |
| Pagos por edificio | `Pagos de la Torre A` | `/assistant/chat` | Si | Si | No | Alta |
| Pagos por edificio | `Pagos de la Torre A` | `/assistant/chat/v2` | Si (`building_payments`) | Si | No | Alta |
| Estadisticas por edificio | `Estadisticas de la Torre A` | `/assistant/chat` | Si | Si | No | Media |
| Estadisticas por edificio | `Estadisticas de la Torre A` | `/assistant/chat/v2` | Si (`building_stats`) | Si | No | Media |
| Busqueda por persona | `Donde vive el residente Residente 1` | `/assistant/chat` | Si | Si | Solo existe en legacy | Media |
| Busqueda por persona | `Donde vive el residente Residente 1` | `/assistant/chat/v2` | No estable | No | Falta soporte oficial claro para nombres del seed | Media |
| Asociacion de estacionamiento | `Cual es el estacionamiento del residente Residente 1` | `/assistant/chat` | Si | Si | Solo existe en legacy | Media |
| Asociacion de estacionamiento | `Cual es el estacionamiento del residente Residente 1` | `/assistant/chat/v2` | No | No | Falta intent oficial | Media |
| Resumen de gastos | `Resumen de gastos del edificio` | `/assistant/chat/v2` | No | No | Intent stub `expenses_summary` | Alta |
| Comparacion ingresos vs gastos | `Compara ingresos y gastos del edificio` | `/assistant/chat/v2` | No | No | Intent stub `cashflow_compare` | Alta |
| Lista de proveedores | `Lista los proveedores del edificio` | `/assistant/chat/v2` | No | No | Intent stub `vendors_list` | Media |
| Envio de recordatorios | `Envia un recordatorio a los morosos` | `/assistant/chat/v2` | No | No | Intent stub `communications_send_reminder` | Alta |

## Notas

- El spec legacy cubre 66 preguntas: las 64 originales mas 2 casos agregados de persona y estacionamiento.
- El spec oficial de `/chat/v2` cubre los 11 intents con ejecucion real y valida `meta.intent`, `summary`, `data` y `debug` para evitar falsos positivos por keywords.
- Los intents `expenses_summary`, `cashflow_compare`, `vendors_list` y `communications_send_reminder` siguen documentados como gaps porque todavia son stubs y no tienen una ruta estable de respuesta real.
