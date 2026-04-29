# Assistant Router QA Throttled Report

- Generated at: 2026-04-29T14:53:22.134Z
- BuildingOS base: http://localhost:4000
- yoryi base: http://localhost:4001
- Request delay: 900ms
- Batch size: 8
- Batch pause: 5000ms
- Retry delays: 2000, 5000, 10000ms
- Total checks: 92
- Pass: 92
- Fail: 0
- Skip: 0

- Missing cases: none
- NEEDS_CONTRACT: 0
- MAL agregadas: 0
- MAL menu_generico: 0
- NO_EVALUABLE: 0

| # | Input | Layer | Route | Output | Source | Type | HTTP | Attempts | Status | Cause |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | cuanto debe la unidad A-1203 de la torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 1 | cuanto debe la unidad A-1203 de la torre A | yoryi | P1 (GET_UNIT_DEBT) | La unidad Torre A - Piso 12 - Depto 03 (Torre A) no tiene deuda pendiente. | live_data | exact | 200 | 1 | PASS | OK |
| 2 | cuanto debe la unidad A-1203 del edificio A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 2 | cuanto debe la unidad A-1203 del edificio A | yoryi | P1 (GET_UNIT_DEBT) | La unidad Torre A - Piso 12 - Depto 03 (Torre A) no tiene deuda pendiente. | live_data | exact | 200 | 1 | PASS | OK |
| 3 | cuanto debe la unidad A-1203 del bloque A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 3 | cuanto debe la unidad A-1203 del bloque A | yoryi | P1 (GET_UNIT_DEBT) | La unidad Torre A - Piso 12 - Depto 03 (Torre A) no tiene deuda pendiente. | live_data | exact | 200 | 1 | PASS | OK |
| 4 | deuda unidad A-1203 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 4 | deuda unidad A-1203 torre A | yoryi | P1 (GET_UNIT_DEBT) | La unidad Torre A - Piso 12 - Depto 03 (Torre A) no tiene deuda pendiente. | live_data | exact | 200 | 1 | PASS | OK |
| 5 | saldo pendiente unidad A-1203 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 5 | saldo pendiente unidad A-1203 torre A | yoryi | P1 (GET_UNIT_DEBT) | La unidad Torre A - Piso 12 - Depto 03 (Torre A) no tiene deuda pendiente. | live_data | exact | 200 | 1 | PASS | OK |
| 6 | adeuda la unidad A-1203 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 6 | adeuda la unidad A-1203 torre A | yoryi | P1 (GET_UNIT_DEBT) | La unidad Torre A - Piso 12 - Depto 03 (Torre A) no tiene deuda pendiente. | live_data | exact | 200 | 1 | PASS | OK |
| 7 | esta al dia la unidad A-1203 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 7 | esta al dia la unidad A-1203 torre A | yoryi | P1 (GET_UNIT_DEBT) | La unidad Torre A - Piso 12 - Depto 03 (Torre A) no tiene deuda pendiente. | live_data | exact | 200 | 1 | PASS | OK |
| 8 | expensas adeudadas unidad A-1203 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 8 | expensas adeudadas unidad A-1203 torre A | yoryi | P1 (GET_UNIT_DEBT) | La unidad Torre A - Piso 12 - Depto 03 (Torre A) no tiene deuda pendiente. | live_data | exact | 200 | 1 | PASS | OK |
| 9 | cuanto debe la unidad 1203 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 9 | cuanto debe la unidad 1203 torre A | yoryi | P1 (GET_UNIT_DEBT) | No encontré unidad para esa referencia. | live_data | summary | 200 | 1 | PASS | OK |
| 10 | cuanto debe la unidad 12-03 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 10 | cuanto debe la unidad 12-03 torre A | yoryi | P1 (GET_UNIT_DEBT) | No encontré unidad para esa referencia. | live_data | summary | 200 | 1 | PASS | OK |
| 11 | cuanto debe la unidad 12-3 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 11 | cuanto debe la unidad 12-3 torre A | yoryi | P1 (GET_UNIT_DEBT) | No encontré unidad para esa referencia. | live_data | summary | 200 | 1 | PASS | OK |
| 12 | saldo UF 1203 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 12 | saldo UF 1203 torre A | yoryi | P1 (GET_UNIT_DEBT) | No encontré unidad para esa referencia. | live_data | summary | 200 | 1 | PASS | OK |
| 13 | cuanto debe depto 03 piso 12 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 13 | cuanto debe depto 03 piso 12 torre A | yoryi | P1 (GET_UNIT_DEBT) | No encontré unidad para esa referencia. | live_data | summary | 200 | 1 | PASS | OK |
| 14 | como viene la morosidad este mes? | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Resumen de deuda agregada (scope: tenant): total pendiente ARS 1.518.362,07 en 2 torre(s)/edificio(s). | live_data | summary | 201 | 1 | PASS | OK |
| 14 | como viene la morosidad este mes? | yoryi | P0 (GET_OVERDUE_UNITS) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 15 | resumen de deuda del edificio | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Resumen de deuda agregada (scope: tenant): total pendiente ARS 1.518.362,07 en 2 torre(s)/edificio(s). | live_data | summary | 201 | 1 | PASS | OK |
| 15 | resumen de deuda del edificio | yoryi | P0 (GET_DEBT_BY_TOWER) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 16 | top morosos | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Top deuda por torre/edificio: 1. Torre B: ARS 1.298.203,86 2. Torre A: ARS 220.158,21 | live_data | list | 201 | 1 | PASS | OK |
| 16 | top morosos | yoryi | P0 (GET_DEBT_BY_TOWER) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 17 | que torres deben mas? | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Top deuda por torre/edificio: 1. Torre B: ARS 1.298.203,86 2. Torre A: ARS 220.158,21 | live_data | list | 201 | 1 | PASS | OK |
| 17 | que torres deben mas? | yoryi | P0 (GET_DEBT_BY_TOWER) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 18 | comparame deuda de este mes vs mes pasado | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Para responder con precision necesito ambos datos exactos: unidad y torre. Ejemplo: "Cuanto debe la unidad 123 de Torre A". | live_data | clarification | 201 | 1 | PASS | OK |
| 18 | comparame deuda de este mes vs mes pasado | yoryi | P0 (GET_OVERDUE_UNITS) | Necesito una aclaracion para responder en modo operativo. Elegi una opcion: 1) Ver unidades con deuda vencida 2) Ver pagos rechazados hoy | live_data | clarification | 200 | 1 | PASS | OK |
| 19 | quien es el residente principal de la unidad A-1203 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | En Torre A, la unidad Torre A - Piso 12 - Depto 03 tiene como propietario/a principal a Owner 91. | live_data | exact | 201 | 1 | PASS | OK |
| 19 | quien es el residente principal de la unidad A-1203 torre A | yoryi | P1 (GET_UNIT_PRIMARY_RESIDENT) | No encontré una coincidencia única para la unidad indicada. Verificá unidad y torre exactas. | live_data | clarification | 200 | 1 | PASS | OK |
| 20 | telefono del residente de la unidad A-1203 torre A | BuildingOS | YORYI_BRIDGE | No encontré una coincidencia única para la unidad indicada. Verificá unidad y torre exactas. | live_data | clarification | 201 | 1 | PASS | OK |
| 20 | telefono del residente de la unidad A-1203 torre A | yoryi | P1 (GET_UNIT_PRIMARY_RESIDENT) | No encontré una coincidencia única para la unidad indicada. Verificá unidad y torre exactas. | live_data | clarification | 200 | 1 | PASS | OK |
| 21 | listame unidades con deuda | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Resumen de deuda agregada (scope: tenant): total pendiente ARS 1.518.362,07 en 2 torre(s)/edificio(s). | live_data | summary | 201 | 1 | PASS | OK |
| 21 | listame unidades con deuda | yoryi | P0 (GET_OVERDUE_UNITS) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 22 | unidades con deuda en torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Resumen de deuda agregada (scope: A): total pendiente ARS 220.158,21 en 1 torre(s)/edificio(s). | live_data | summary | 201 | 1 | PASS | OK |
| 22 | unidades con deuda en torre A | yoryi | P0 (GET_OVERDUE_UNITS) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 23 | pagos de la unidad A-1203 | BuildingOS | YORYI_BRIDGE | Para buscar pagos de una unidad necesito el dato faltante: torre/edificio. | live_data | clarification | 201 | 1 | PASS | OK |
| 23 | pagos de la unidad A-1203 | yoryi | P1 (GET_LAST_PAYMENT) | Para buscar pagos de una unidad necesito el dato faltante: torre/edificio. | live_data | clarification | 200 | 1 | PASS | OK |
| 24 | ultimo pago de la unidad A-1203 | BuildingOS | YORYI_BRIDGE | Necesito una aclaracion para responder en modo operativo. Elegi una opcion: 1) Ver ultimo pago de unidad 2) Ver unidades con deuda vencida | live_data | clarification | 201 | 1 | PASS | OK |
| 24 | ultimo pago de la unidad A-1203 | yoryi | P1 (GET_LAST_PAYMENT) | Necesito una aclaracion para responder en modo operativo. Elegi una opcion: 1) Ver ultimo pago de unidad 2) Ver unidades con deuda vencida | live_data | clarification | 200 | 1 | PASS | OK |
| 25 | busca pagos de abril torre A | BuildingOS | YORYI_BRIDGE | Puedo ayudarte con pagos en modo operativo. Indicá alcance mínimo (torre/edificio y período exacto) para ejecutar la consulta. | live_data | clarification | 201 | 1 | PASS | OK |
| 25 | busca pagos de abril torre A | yoryi | P1 (GET_PENDING_PAYMENTS) | Puedo ayudarte con pagos en modo operativo. Indicá alcance mínimo (torre/edificio y período exacto) para ejecutar la consulta. | live_data | clarification | 200 | 1 | PASS | OK |
| 26 | filtra cargos pendientes por torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Top deuda por torre/edificio: 1. Torre A: ARS 220.158,21 | live_data | list | 201 | 1 | PASS | OK |
| 26 | filtra cargos pendientes por torre A | yoryi | P1 (GET_PENDING_PAYMENTS) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 27 | mostrame reclamos abiertos del edificio A | BuildingOS | YORYI_BRIDGE | Tickets activos: MAINTENANCE - Issue 1 (Torre A) | MAINTENANCE - Issue 50 (Torre A) | PARKING - Issue 53 (Torre B) | NOISE - Issue 3 (Torre... | live_data | summary | 201 | 1 | PASS | OK |
| 27 | mostrame reclamos abiertos del edificio A | yoryi | P0 (GET_OPEN_TICKETS) | Tickets activos: MAINTENANCE - Issue 1 (Torre A) | MAINTENANCE - Issue 50 (Torre A) | PARKING - Issue 53 (Torre B) | NOISE - Issue 3 (Torre... | live_data | summary | 200 | 1 | PASS | OK |
| 28 | buscar unidad 1203 | BuildingOS | P0 | El engine primario respondió con error o payload inválido para consultas P0. Para confirmar un dato operativo necesito respuesta live_data.... | fallback | clarification | 201 | 1 | PASS | OK |
| 28 | buscar unidad 1203 | yoryi | unknown | (Unidades) Basado en el contexto del módulo units, esta es la guía que solicitaste: Units Module Purpose The Units module is responsible fo... | knowledge | summary | 200 | 1 | PASS | OK |
| 29 | deuda aging | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Resumen de deuda agregada (scope: tenant): total pendiente ARS 1.518.362,07 en 2 torre(s)/edificio(s). | live_data | summary | 201 | 1 | PASS | OK |
| 29 | deuda aging | yoryi | P2/P3 (GET_DEBT_AGING) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 30 | deuda por antiguedad | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Resumen de deuda agregada (scope: tenant): total pendiente ARS 1.518.362,07 en 2 torre(s)/edificio(s). | live_data | summary | 201 | 1 | PASS | OK |
| 30 | deuda por antiguedad | yoryi | P2/P3 (GET_DEBT_AGING) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 31 | evolucion de morosidad ultimos 6 meses | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Resumen de deuda agregada (scope: tenant): total pendiente ARS 1.518.362,07 en 2 torre(s)/edificio(s). | live_data | summary | 201 | 1 | PASS | OK |
| 31 | evolucion de morosidad ultimos 6 meses | yoryi | P2/P3 (GET_BUILDING_DEBT_TREND) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 32 | deuda por torre ultimos 3 meses | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | No encontré la torre "ULTIMOS". Indicame otra torre/edificio o querés el resumen general del tenant. | live_data | clarification | 201 | 1 | PASS | OK |
| 32 | deuda por torre ultimos 3 meses | yoryi | P0 (GET_DEBT_BY_TOWER) | Para responder en forma operativa necesito acotar el alcance mínimo: indicá torre/edificio o período (por ejemplo: Torre A, últimos 3 meses... | live_data | clarification | 200 | 1 | PASS | OK |
| 33 | cobranzas del mes | BuildingOS | YORYI_BRIDGE | Basado en el contexto del módulo general, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is the main operati... | knowledge | summary | 201 | 1 | PASS | OK |
| 33 | cobranzas del mes | yoryi | unknown | Basado en el contexto del módulo general, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is the main operati... | knowledge | summary | 200 | 1 | PASS | OK |
| 34 | tendencia de pagos vs cargos | BuildingOS | YORYI_BRIDGE | Basado en el contexto del módulo general, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is the main operati... | knowledge | summary | 201 | 1 | PASS | OK |
| 34 | tendencia de pagos vs cargos | yoryi | unknown | Basado en el contexto del módulo general, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is the main operati... | knowledge | summary | 200 | 1 | PASS | OK |
| 35 | necesito ver pagos | BuildingOS | YORYI_BRIDGE | Puedo ayudarte con pagos en modo operativo. Indicá alcance mínimo (torre/edificio y período exacto) para ejecutar la consulta. | live_data | clarification | 201 | 1 | PASS | OK |
| 35 | necesito ver pagos | yoryi | P1 (GET_PENDING_PAYMENTS) | Puedo ayudarte con pagos en modo operativo. Indicá alcance mínimo (torre/edificio y período exacto) para ejecutar la consulta. | live_data | clarification | 200 | 1 | PASS | OK |
| 36 | abrir dashboard de finanzas | BuildingOS | YORYI_BRIDGE | Basado en el contexto del módulo general, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is the main operati... | knowledge | summary | 201 | 1 | PASS | OK |
| 36 | abrir dashboard de finanzas | yoryi | unknown | Basado en el contexto del módulo general, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is the main operati... | knowledge | summary | 200 | 1 | PASS | OK |
| 37 | quiero ver reportes | BuildingOS | YORYI_BRIDGE | Basado en el contexto del módulo general, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is the main operati... | knowledge | summary | 201 | 1 | PASS | OK |
| 37 | quiero ver reportes | yoryi | unknown | Basado en el contexto del módulo general, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is the main operati... | knowledge | summary | 200 | 1 | PASS | OK |
| 38 | necesito ver reclamos | BuildingOS | YORYI_BRIDGE | Necesito una aclaracion para responder en modo operativo. Elegi una opcion: 1) Ver tickets abiertos o en progreso 2) Ver unidades con deuda... | live_data | clarification | 201 | 1 | PASS | OK |
| 38 | necesito ver reclamos | yoryi | P0 (GET_OPEN_TICKETS) | Necesito una aclaracion para responder en modo operativo. Elegi una opcion: 1) Ver tickets abiertos o en progreso 2) Ver unidades con deuda... | live_data | clarification | 200 | 1 | PASS | OK |
| 39 | buscar documentos del edificio | BuildingOS | YORYI_BRIDGE | (Documentos) Basado en el contexto del módulo documents, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is t... | knowledge | summary | 201 | 1 | PASS | OK |
| 39 | buscar documentos del edificio | yoryi | unknown | (Documentos) Basado en el contexto del módulo documents, esta es la guía que solicitaste: Role — Tenant Admin Purpose The Tenant Admin is t... | knowledge | summary | 200 | 1 | PASS | OK |
| 40 | cuanto debe la unidad 1203 | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Para responder con precision necesito la torre/edificio exacto. Ejemplo: "Cuanto debe la unidad 123 de Torre A". | live_data | clarification | 201 | 1 | PASS | OK |
| 40 | cuanto debe la unidad 1203 | yoryi | P1 (GET_UNIT_DEBT) | Necesito una aclaracion para responder en modo operativo. Elegi una opcion: 1) Consultar saldo de una unidad especifica 2) Ver unidades con... | live_data | clarification | 200 | 1 | PASS | OK |
| 41 | cuanto debe la unidad 1203 torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | La Torre A unidad Torre A - Piso 12 - Depto 03 no tiene deuda pendiente. Saldo actual: ARS 0,00. | live_data | exact | 201 | 1 | PASS | OK |
| 41 | cuanto debe la unidad 1203 torre A | yoryi | P1 (GET_UNIT_DEBT) | No encontré una coincidencia única para la unidad indicada. Verificá unidad y torre exactas. | live_data | clarification | 200 | 1 | PASS | OK |
| 42 | deuda torre A | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Para responder con precision necesito la unidad exacta dentro de la torre/edificio. Ejemplo: "Cuanto debe la unidad 123 de Torre A". | live_data | clarification | 201 | 1 | PASS | OK |
| 42 | deuda torre A | yoryi | P0 (GET_OVERDUE_UNITS) | Necesito una aclaracion para responder en modo operativo. Elegi una opcion: 1) Ver unidades con deuda vencida 2) Ver pagos rechazados hoy | live_data | clarification | 200 | 1 | PASS | OK |
| 43 | unidad A-1203 edificio | BuildingOS | YORYI_BRIDGE | Necesito una aclaracion para responder en modo operativo. Decime si queres saldo, pagos, residente o busqueda de la unidad. | live_data | clarification | 201 | 1 | PASS | OK |
| 43 | unidad A-1203 edificio | yoryi | P0 (UNKNOWN) | Necesito una aclaracion para responder en modo operativo. Decime si queres saldo, pagos, residente o busqueda de la unidad. | live_data | clarification | 200 | 1 | PASS | OK |
| 44 | crea un cargo a la unidad A-1203 | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Estoy en modo solo consulta. No puedo ejecutar cambios (crear cargos, registrar pagos o modificar residentes). | live_data | clarification | 201 | 1 | PASS | OK |
| 44 | crea un cargo a la unidad A-1203 | yoryi | unknown | Actualmente solo puedo consultar información; no puedo crear, editar, eliminar, aprobar, rechazar, publicar, asignar ni marcar datos como p... | fallback | clarification | 200 | 1 | PASS | OK |
| 45 | registra un pago de 10000 | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Estoy en modo solo consulta. No puedo ejecutar cambios (crear cargos, registrar pagos o modificar residentes). | live_data | clarification | 201 | 1 | PASS | OK |
| 45 | registra un pago de 10000 | yoryi | P0 (UNKNOWN) | Estoy en modo solo consulta. No puedo ejecutar cambios (crear cargos, registrar pagos o modificar residentes). | live_data | clarification | 200 | 1 | PASS | OK |
| 46 | cambia el residente de la unidad | BuildingOS | LIVE_DATA_STRICT_OR_LOCAL | Estoy en modo solo consulta. No puedo ejecutar cambios (crear cargos, registrar pagos o modificar residentes). | live_data | clarification | 201 | 1 | PASS | OK |
| 46 | cambia el residente de la unidad | yoryi | P0 (UNKNOWN) | Estoy en modo solo consulta. No puedo ejecutar cambios (crear cargos, registrar pagos o modificar residentes). | live_data | clarification | 200 | 1 | PASS | OK |
