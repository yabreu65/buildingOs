# Assistant Operativo BuildingOS — Modelo conversacional Fase 2

Fecha: 2026-05-01
Estado: blueprint de producto para implementación
Scope: BuildingOS assistant/chat para ADMINISTRACIÓN y RESIDENTE
Repos relacionados:
- `/Users/yoryiabreu/proyectos/buildingos`
- `/Users/yoryiabreu/proyectos/yoryi-ai-core`

## Evidencia base consultada

| Path | Evidencia usada |
| --- | --- |
| `/Users/yoryiabreu/proyectos/buildingos/docs/architecture/current-state.md` | BuildingOS es SaaS multi-tenant; roles activos; assistant operativo con yoryi engine primario y tools internos read-only. |
| `/Users/yoryiabreu/proyectos/buildingos/docs/architecture/constraints.md` | Todo acceso de datos debe estar scoped por `tenantId`; validación de permisos obligatoria; cambios de schema sólo con migraciones Prisma. |
| `/Users/yoryiabreu/proyectos/buildingos/docs/architecture/ai-architecture-review.md` | Precedencia oficial, familias, defaults, bridge/UI no inventan clarificaciones, contrato estable/debug. |
| `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/tools.types.ts` | Tools actuales: deuda, pagos, tickets, procesos, claims, cross-query; contrato read-only versionado. |
| `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/tools.service.ts` | Permisos actuales por rol y tool; `RESIDENT` sin acceso directo a tools internas agregadas. |
| `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/hitl.service.ts` | HITL existe con whitelist de fallbacks y `managedServiceEnabled`. |
| `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/yoryi-bridge.mapper.ts` | Metadata estable: `resolvedLevel`, `resolvedIntentCode`, `familyChosen`, `fallbackPath`, `gatewayOutcome`, `missingEntities`, `defaultsApplied`. |
| `/Users/yoryiabreu/proyectos/yoryi-core-architecture/constitution/architecture-principles.md` | Tenant safety first, contracts over coupling, evolutionary architecture, AI with boundaries. |
| `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/ai/agents/tool-contracts.md` | Tools con schema, errores esperados, autorización y tests de contrato. |

---

## 1. Resumen ejecutivo

Fase 2 convierte el assistant de BuildingOS en una **capa operativa conversacional**, no en un chatbot de respuestas sueltas. El producto se modela por:

- capacidad,
- permiso,
- riesgo,
- scope,
- defaults,
- clarificación,
- bloqueo,
- derivación humana,
- roadmap de implementación.

Decisión de producto:

- **MVP**: read-only de alto valor con RBAC fuerte, self-scope residente, métricas agregadas sólo para administración y HITL explícito.
- **V1**: ampliar cobertura operativa con mejores clarificaciones/defaults y primeras acciones asistidas no destructivas.
- **V2**: acciones avanzadas, automatización y orquestación con confirmación fuerte, trazabilidad y control humano según riesgo.

Este documento queda como blueprint para abrir issues de implementación, definir intents/families, tools/gateways, RBAC, defaults, QA y releases.

---

## 2. Principios del Assistant Operativo de BuildingOS

1. **Capacidad + permiso + riesgo antes que frase**
   Un intent representa una capacidad de negocio, no una variante textual aislada.

2. **Tenant safety first**
   Toda ejecución debe estar scoped por `tenantId` y rol efectivo. Sin scope verificable, no se ejecuta tool.

3. **MVP read-only fuerte**
   Primero se habilitan consultas operativas de alto valor. Acciones mutativas o financieras quedan fuera del MVP.

4. **RESIDENTE en self-scope estricto**
   Residente sólo puede consultar/operar sobre sus unidades, pagos, reclamos, comprobantes y comunicaciones propias.

5. **ADMINISTRACIÓN con scope operativo gobernado**
   TENANT_OWNER / TENANT_ADMIN / OPERATOR pueden consultar métricas agregadas según permisos y scope del tenant/building.

6. **Defaults por familia, no por pregunta**
   - `TOTAL`, `OVERDUE`, `AGING`, `TOP_N`, `BREAKDOWN` = snapshot actual.
   - `TREND` = período/rango explícito o default documentado.

7. **Clarificación sólo por missingEntities reales**
   El bridge/UI no inventan clarificaciones. Si falta `buildingId`, `unitId`, `period`, `dimension` u otro dato mínimo, lo pide el engine/capability.

8. **HITL diseñado desde el catálogo**
   HITL no es fallback genérico: cada capacidad define cuándo escala.

9. **No duplicar lógica por tipo de tenant**
   La capacidad es común; lo variable vive en configuración/policy/permissions, no en forks de lógica por tenant.

10. **Seguridad, trazabilidad y valor > volumen de features**
    Una capacidad insegura o no testeable no entra al roadmap operativo.

---

## 3. Matriz de capacidades — ADMINISTRACIÓN

Roles incluidos:
- `TENANT_OWNER`
- `TENANT_ADMIN`
- `OPERATOR`

Scopes permitidos:
- tenant,
- building,
- multi-building según RBAC,
- unidad específica cuando la capacidad lo requiere.

| Dominio | Nombre de la capacidad | Objetivo de negocio | Tipo | Riesgo | Datos mínimos requeridos | Admite defaults | Defaults posibles | Requiere confirmación | Requiere HITL | RBAC especial | Scope permitido | Ejemplos | Resultado esperado | Cuándo debe bloquearse | Cuándo debe pedir aclaración | Cuándo debe escalar a humano | Roadmap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| deuda / pagos | Estado global de deuda | Dar foto financiera actual para gestión | consulta | medio | `tenantId`, `role`, `buildingId?` | sí | snapshot actual | no | no | ADMIN/OPERATOR | tenant/building | “deuda total”, “deuda del edificio A” | total de deuda + metadata `TOTAL`/`OVERDUE` | rol sin permiso, tenant inválido, scope cross-tenant | múltiples edificios y no hay building scope claro | drift/falla persistente de fuente financiera | MVP |
| deuda / pagos | Top morosidad | Priorizar gestión de cobranza | consulta | medio | `tenantId`, `role`, `limit?`, `buildingId?` | sí | `limit=10`, snapshot actual | no | condicional | ADMIN/OPERATOR | tenant/building | “top 10 deudores”, “mayores morosos” | ranking TOP_N, nunca breakdown | RESIDENTE, scope inválido | building ambiguo, límite inválido | tool null/error o caso sensible | MVP |
| deuda / pagos | Breakdown de deuda | Entender concentración por dimensión | consulta | medio | `tenantId`, `dimension`, `buildingId?` | sí | snapshot actual | no | condicional | ADMIN/OPERATOR | tenant/building | “deuda por torre”, “deuda por unidad” | breakdown por dimensión | dimensión no permitida o rol inválido | falta dimensión o building necesario | estructura/datos no resolubles | MVP |
| deuda / pagos | Aging de deuda | Controlar vencimientos y buckets | consulta | medio | `tenantId`, `buildingId?` | sí | snapshot actual | no | condicional | ADMIN/OPERATOR | tenant/building | “aging de deuda”, “0-30 31-60 90+” | buckets aging | fuente no disponible, rol inválido | período si pide histórico | inconsistencias financieras críticas | MVP |
| deuda / pagos | Tendencia deuda/cobranza | Ver evolución para decisiones | consulta | medio | `tenantId`, `period/range?`, `buildingId?` | sí | default TREND documentado | no | condicional | ADMIN/OPERATOR | tenant/building | “evolución 6 meses”, “cobranza últimos meses” | serie temporal + variación | rango inválido o scope inválido | rango/período faltante si no inferible | anomalías severas o datos incompletos | MVP |
| reclamos / tickets | Búsqueda de tickets administrativos | Priorizar operación diaria | consulta | bajo | `tenantId`, `status?`, `category?`, `buildingId?` | sí | `status=open` | no | condicional | ADMIN/OPERATOR | tenant/building | “tickets abiertos”, “reclamos críticos” | lista filtrada + acciones sugeridas | permiso insuficiente | demasiados resultados sin filtro | incidente de seguridad/legal | MVP |
| reclamos / tickets | Resumen de reclamos por categoría | Detectar patrones operativos | consulta | medio | `tenantId`, `period?`, `buildingId?` | sí | período actual | no | no | ADMIN/OPERATOR | tenant/building | “reclamos por categoría este mes” | agregados por categoría/estado | falta permiso agregado | período o scope ambiguo | patrón crítico repetido | V1 |
| comunicaciones | Borrador de comunicación | Reducir tiempo de comunicación formal | acción | medio | `tenantId`, `audience`, `topic`, `channel?` | sí | plantilla por tipo | sí | condicional | OWNER/ADMIN | tenant/building/audience | “redactá aviso de corte de agua” | borrador editable, no envío automático | rol OPERATOR si policy no permite; audiencia prohibida | falta audiencia/canal/fecha | contenido legal, conflictivo o reputacional | V1 |
| unidades / residentes | Resolver unidad / perfil operativo | Identificar unidad y contexto operativo | consulta | medio | `tenantId`, `unitRef` o `buildingId+unit` | sí | `resolve_unit_ref` | no | condicional | ADMIN/OPERATOR | tenant/building/unit | “perfil de unidad 3B” | unidad resuelta + perfil operativo permitido | unidad fuera scope | referencia ambigua, edificio faltante | disputa de titularidad/datos sensibles | MVP |
| unidades / residentes | Búsqueda de residente/unidad | Soporte a atención operativa | consulta | medio | `tenantId`, filtro identificador | no | n/a | no | condicional | OWNER/ADMIN/OPERATOR policy | tenant/building | “buscar residente de unidad 2A” | coincidencias permitidas | filtro demasiado sensible o rol no permitido | múltiples matches | conflicto de identidad o privacidad | V1 |
| métricas / operación | SLA de procesos | Detectar cuellos de botella | consulta | medio | `tenantId`, `process`, `period?` | sí | período actual | no | condicional | OWNER/ADMIN | tenant | “SLA de cobranzas esta semana” | KPIs + semáforo | proceso no habilitado | proceso/período ambiguo | breach severo | MVP |
| métricas / operación | Cross-query operacional | Responder preguntas combinadas | consulta | alto | `tenantId`, query, allowed domains | limitado | no default destructivo | no | condicional | OWNER/ADMIN | tenant/building | “morosos con tickets abiertos” | resumen cruzado trazable | combina datos no permitidos | entidades/dominios ambiguos | alto riesgo o datos sensibles | V2 |
| documentos / comprobantes | Consulta documental operativa | Resolver soporte de pagos/casos | consulta | medio | `tenantId`, `unitId?`, `period?`, `docType?` | sí | período actual | no | condicional | OWNER/ADMIN/OPERATOR policy | tenant/building/unit | “comprobante de pago unidad 5A” | refs/links autorizados | documento no autorizado | período/tipo documento ambiguo | disputa documental | V1 |
| derivación humana / HITL | Escalamiento operativo | Transferir caso no resoluble a humano | derivación | alto | `tenantId`, `userId`, `role`, `traceId`, `question`, `fallbackPath` | no | n/a | no | sí | managed service + whitelist | tenant | “escalá esto a administración” | handoff creado + tracking | tenant sin servicio o fallback no permitido | motivo/contexto insuficiente | siempre que cae en whitelist crítica o riesgo alto | MVP |

---

## 4. Matriz de capacidades — RESIDENTE

Rol incluido:
- `RESIDENT`

Scope obligatorio:
- self-scope estricto: sólo unidades, pagos, reclamos, comunicaciones y documentos propios.

| Dominio | Nombre de la capacidad | Objetivo de negocio | Tipo | Riesgo | Datos mínimos requeridos | Admite defaults | Defaults posibles | Requiere confirmación | Requiere HITL | RBAC especial | Scope permitido | Ejemplos | Resultado esperado | Cuándo debe bloquearse | Cuándo debe pedir aclaración | Cuándo debe escalar a humano | Roadmap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| deuda / pagos | Estado de deuda propia | Autogestión financiera | consulta | bajo | `tenantId`, `userId`, `unitId` | sí | snapshot actual | no | condicional | RESIDENT self | self/unit | “cuánto debo”, “mi deuda” | saldo propio + vencimientos | intenta ver deuda ajena o agregada | múltiples unidades propias | disputa de saldo | MVP |
| deuda / pagos | Historial de pagos propio | Transparencia de pagos | consulta | bajo | `tenantId`, `userId`, `unitId`, `period?` | sí | período reciente/actual | no | condicional | RESIDENT self | self/unit | “mis pagos de abril” | lista de pagos propios | pagos de terceros | período ambiguo | pago no acreditado/reclamado | MVP |
| deuda / pagos | Tendencia de deuda propia | Entender evolución personal | consulta | bajo | `tenantId`, `userId`, `unitId`, `range?` | sí | default TREND | no | condicional | RESIDENT self | self/unit | “mi deuda últimos 6 meses” | serie temporal propia | scope inválido | rango faltante/no inferible | inconsistencia reiterada | V1 |
| reclamos / tickets | Estado de reclamos propios | Seguimiento sin llamar a administración | consulta | bajo | `tenantId`, `userId`, `ticketId?` | sí | `status=open` | no | condicional | RESIDENT self | self | “cómo va mi reclamo” | estado + próximo paso | ticket ajeno | ticket ambiguo | urgencia/seguridad | MVP |
| reclamos / tickets | Crear reclamo guiado | Canalizar incidentes | acción | medio | `tenantId`, `userId`, `category`, `description`, `location?` | sí | plantilla por categoría | sí | condicional | RESIDENT self | self/unit/common area según policy | “reportar pérdida de agua” | ticket draft/creado tras confirmación | categoría prohibida | faltan categoría/detalle/ubicación | emergencia, seguridad, daño crítico | V1 |
| comunicaciones | Avisos recibidos | Acceso a comunicaciones oficiales | consulta | bajo | `tenantId`, `userId`, `period?` | sí | recientes | no | no | RESIDENT self | self | “avisos recientes” | lista de avisos propios | comunicaciones internas admin | filtro temporal ambiguo | conflicto sensible | V1 |
| unidades / residentes | Datos básicos de unidad propia | Autoconsulta de contexto | consulta | bajo | `tenantId`, `userId`, `unitId` | sí | unidad activa si única | no | condicional | RESIDENT self | self/unit | “datos de mi unidad” | datos básicos permitidos | unidad ajena | múltiples unidades propias | conflicto de titularidad | V1 |
| métricas / operación | Estado operativo propio | Ver estado de servicios/casos propios | consulta | bajo | `tenantId`, `userId`, context | sí | últimos eventos propios | no | condicional | RESIDENT self | self | “qué tengo pendiente” | resumen de deuda/reclamos/avisos propios | pide métricas globales | contexto insuficiente | bloqueo de cuenta/caso sensible | V2 |
| documentos / comprobantes | Comprobantes propios | Acceso a evidencia personal | consulta | medio | `tenantId`, `userId`, `unitId`, `period?`, `docType?` | sí | período actual | no | condicional | RESIDENT self | self/unit | “mi comprobante de pago” | refs/links permitidos | documento ajeno | período/tipo ambiguo | disputa documental | V1 |
| derivación humana / HITL | Atención humana | Resolver bloqueo o disputa | derivación | medio | `tenantId`, `userId`, `traceId?`, `reason` | no | n/a | no | sí | tenant policy | self | “quiero hablar con administración” | handoff/canal formal | tenant sin canal habilitado | motivo/contexto insuficiente | disputa, urgencia o fallback crítico | MVP |

---

## 5. Capacidades no habilitadas / fuera de alcance

### No debe hacer todavía el assistant

- Crear, modificar, cancelar o condonar cargos.
- Aprobar, rechazar o reconciliar pagos con impacto contable directo.
- Ejecutar refinanciaciones, recargos o acuerdos de pago automáticos.
- Enviar comunicaciones masivas automáticamente.
- Cambiar datos maestros de unidades/residentes por chat.
- Tomar decisiones legales, disciplinarias o sancionatorias.
- Ejecutar acciones cross-module sin confirmación y sin trazabilidad explícita.

### No debe hacer nunca RESIDENTE en scope estándar

- Ver deuda agregada del edificio/torre/tenant.
- Ver top deudores o ranking de morosidad.
- Consultar pagos, reclamos, documentos o datos personales de otra unidad/residente.
- Crear comunicaciones administrativas.
- Acceder a métricas operativas o SLA internos.
- Solicitar excepciones de permisos por conversación.

### Debe ir sí o sí por HITL

- Disputas de saldo/pago con evidencia contradictoria.
- Incidentes de seguridad, emergencia o daño crítico.
- Casos legales, sanciones o reclamos sensibles.
- Solicitudes de excepción de permisos.
- Falla de herramienta operacional en capacidad crítica.
- Ambigüedad persistente después de clarificación razonable.

### Fuera del MVP

- Acciones mutativas de alto riesgo.
- Orquestación multi-paso autónoma.
- Cross-query operacional amplio.
- Comunicaciones con envío automático.
- Documentos/comprobantes si aún no existe gateway seguro y trazable.

---

## 6. Roadmap — MVP / V1 / V2

### MVP — Read-only de alto valor + seguridad fuerte

Objetivo: entregar valor operativo sin introducir riesgo mutativo.

Capacidades:

- ADMIN deuda/pagos:
  - estado global de deuda,
  - top morosidad,
  - breakdown,
  - aging,
  - tendencia.
- ADMIN tickets/procesos:
  - búsqueda tickets,
  - SLA/procesos.
- ADMIN unidades:
  - resolver unidad/perfil operativo read-only.
- RESIDENTE:
  - deuda propia,
  - pagos propios,
  - reclamos propios,
  - derivación humana.
- HITL:
  - whitelist crítica,
  - handoff trazable.

Criterios de salida MVP:

- No hay datos cross-tenant.
- RESIDENTE no accede a agregados.
- TOP_N nunca cae en BREAKDOWN.
- Clarificaciones dependen de `missingEntities`.
- Cada capability tiene QA de match, no_match, bloqueo, clarificación y HITL.

### V1 — Cobertura operativa + acciones asistidas no destructivas

Objetivo: ampliar utilidad sin autonomía riesgosa.

Capacidades:

- Crear reclamo guiado residente con confirmación.
- Borrador de comunicaciones admin sin envío automático.
- Documentos/comprobantes propios y operativos con gateway seguro.
- Comunicaciones recibidas para residente.
- Búsqueda de residente/unidad con controles de privacidad.
- Más QA de defaults y clarificaciones por dominio.

Criterios de salida V1:

- Toda acción requiere confirmación si crea entidad.
- No hay envío automático de comunicaciones.
- Documentos respetan scope y auditoría.

### V2 — Automatización controlada y orquestación avanzada

Objetivo: mayor autonomía con guardrails maduros.

Capacidades:

- Cross-query operacional controlado.
- Resúmenes proactivos por rol.
- Acciones financieras asistidas sólo si existe workflow formal, confirmación fuerte, auditoría y posible aprobación humana.
- Mayor orquestación multi-step, pero policy-driven.

Criterios de salida V2:

- Contratos versionados.
- Rollback por capability.
- HITL configurable por tenant/policy.
- QA adversarial para privacidad, RBAC y edge cases.

---

## 7. Backlog ejecutable

| Prioridad | Capacidad | Family sugerida | IntentCode sugerido | Tool/Gateway requerido | Permisos requeridos | Defaults | Clarificación esperada | Casos no_match | Casos de bloqueo | Casos HITL | QA sugerido |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | Estado global deuda admin | `TOTAL` / `OVERDUE` | `GET_BUILDING_DEBT_TOTAL` | `search_payments` o gateway agregado de deuda | OWNER/ADMIN/OPERATOR | snapshot | `buildingId` si multi-building ambiguo | pregunta no financiera | RESIDENTE, cross-tenant | gateway unavailable/tool error | total con/sin building; resident blocked; no_match irrelevante |
| P0 | Top morosidad admin | `TOP_N` | `GET_TOP_DEBTORS` | debt ranking gateway | OWNER/ADMIN/OPERATOR | `limit=10`, snapshot | `buildingId` si ambiguo, `limit` inválido | no ranking intent | RESIDENTE | tool null/error | TOP_N nunca BREAKDOWN; N default; blocked resident |
| P0 | Breakdown deuda admin | `BREAKDOWN` | `GET_DEBT_BREAKDOWN` | `analytics_debt_by_tower` | OWNER/ADMIN/OPERATOR | snapshot | `dimension`, `buildingId` | dimensión fuera catálogo | RESIDENTE | datos estructurales faltantes | tower/unit breakdown; missing dimension |
| P0 | Aging deuda admin | `AGING` | `GET_DEBT_AGING` | `analytics_debt_aging` | OWNER/ADMIN/OPERATOR | snapshot | período si histórico | no aging intent | RESIDENTE | source drift | buckets expected; snapshot default |
| P0 | Trend deuda admin | `TREND` | `GET_BUILDING_DEBT_TREND` | `get_building_debt_trend` | OWNER/ADMIN/OPERATOR | range default TREND | `period/range` si no inferible | snapshot prompt sin trend | scope inválido | serie incompleta | trend vs total distinction |
| P0 | Trend cobranzas admin | `TREND` | `GET_COLLECTIONS_TREND` | `get_collections_trend` | OWNER/ADMIN/OPERATOR | range default TREND | `period/range` | no collections intent | scope inválido | gateway error | collection trend cases |
| P0 | Tickets admin | `TICKET_SEARCH` | `SEARCH_TICKETS_ADMIN` | `search_tickets` | OWNER/ADMIN/OPERATOR | `status=open` | filtro si demasiados resultados | no ticket intent | role invalid | critical ticket | open/closed/category filters |
| P0 | Procesos/SLA admin | `PROCESS_SUMMARY` | `GET_PROCESS_SLA_SUMMARY` | `search_processes`, `get_process_summary` | OWNER/ADMIN | período actual | `process`, `period` | no process intent | OPERATOR si policy restringe | SLA breach | process ambiguity, role block |
| P0 | Perfil unidad admin | `UNIT_LOOKUP` | `GET_UNIT_PROFILE_ADMIN` | `resolve_unit_ref`, `get_unit_profile` | OWNER/ADMIN/OPERATOR | unit resolver | `buildingId`, `unitRef` | no unit intent | unidad fuera scope | titularidad conflictiva | ambiguous unit, profile success |
| P0 | Deuda propia residente | `TOTAL` / `OVERDUE` | `GET_MY_UNIT_DEBT` | `get_unit_balance` via self-scope gateway | RESIDENT self | snapshot | `unitId` si múltiples propias | pide agregado | otra unidad | disputa saldo | own debt, multi-unit clarification, cross-scope block |
| P0 | Pagos propios residente | `PAYMENT_HISTORY` | `GET_MY_PAYMENT_HISTORY` | `get_unit_payments` via self-scope gateway | RESIDENT self | período reciente | `period`, `unitId` | no payment intent | pago ajeno | pago no acreditado | own payments; period default; block other |
| P0 | Reclamos propios residente | `CLAIM_STATUS` | `GET_MY_TICKETS_STATUS` | `search_claims`/`search_tickets` self-scope | RESIDENT self | `status=open` | `ticketId` si ambiguo | no claim intent | ticket ajeno | urgencia | own ticket; ambiguous ticket; emergency HITL |
| P0 | HITL explícito | `HITL_ESCALATION` | `ESCALATE_TO_HUMAN` | `AssistantHitlService` | all roles by tenant policy | none | motivo si falta | pedido no accionable | tenant sin HITL | native | whitelist fallback + manual escalation |
| P1 | Crear reclamo residente | `CLAIM_CREATE` | `CREATE_MY_TICKET_GUIDED` | nuevo ticket-create gateway | RESIDENT self | plantilla categoría | categoría/detalle/ubicación | intención difusa | category/policy block | emergency/security | draft, confirm, create, emergency route |
| P1 | Borrador comunicación admin | `COMM_DRAFT` | `DRAFT_ADMIN_COMMUNICATION` | comm draft gateway | OWNER/ADMIN | template by type | audiencia/canal/fecha | no comm intent | rol no permitido | legal/sensitive | draft only; mandatory confirm |
| P1 | Comprobantes residente | `DOC_LOOKUP` | `GET_MY_PAYMENT_RECEIPTS` | document gateway | RESIDENT self | período actual | docType/period | no doc intent | doc ajeno | disputa documental | own doc pass; cross-scope block |
| P1 | Avisos residente | `COMM_LOOKUP` | `GET_MY_NOTICES` | communications lookup gateway | RESIDENT self | recientes | período/tipo | no notices intent | internos admin | conflicto | notice list, filters |
| P2 | Cross-query admin | `CROSS_QUERY` | `GET_OPERATIONAL_CROSS_QUERY` | `cross_query` | OWNER/ADMIN | none/limited | dominios/filtros | pregunta no soportada | mezcla datos prohibidos | high-risk combo | adversarial privacy + RBAC |
| P2 | Acciones financieras asistidas | `FINANCIAL_ACTION` | `REQUEST_FINANCIAL_ACTION_REVIEW` | workflow/HITL gateway | OWNER/ADMIN only | none | entidad/motivo/monto | fuera catálogo | sin workflow aprobado | always review | confirm hard + human approval |

---

## 8. Orden recomendado de implementación

### Sprint / PR 1 — MVP núcleo read-only y seguridad

Objetivo: entregar valor operativo inmediato sin side effects.

Incluye:

- ADMIN deuda/pagos:
  - `GET_BUILDING_DEBT_TOTAL`
  - `GET_TOP_DEBTORS`
  - `GET_DEBT_BREAKDOWN`
  - `GET_DEBT_AGING`
  - `GET_BUILDING_DEBT_TREND`
  - `GET_COLLECTIONS_TREND`
- ADMIN tickets/procesos:
  - `SEARCH_TICKETS_ADMIN`
  - `GET_PROCESS_SLA_SUMMARY`
- ADMIN unidad:
  - `GET_UNIT_PROFILE_ADMIN`
- RESIDENTE:
  - `GET_MY_UNIT_DEBT`
  - `GET_MY_PAYMENT_HISTORY`
  - `GET_MY_TICKETS_STATUS`
- HITL:
  - `ESCALATE_TO_HUMAN`

Por qué este orden:

- Reutiliza tools existentes mayormente read-only.
- Maximiza valor de negocio.
- Minimiza riesgo mutativo.
- Permite QA fuerte de RBAC/self-scope desde el arranque.

Criterio de salida:

- Suites QA por rol/capability.
- Bloqueo residente en métricas agregadas.
- Clarificación por missing entities.
- HITL operativo en fallbacks críticos.

### Sprint / PR 2 — Cobertura V1 y acciones asistidas controladas

Objetivo: sumar utilidad conversacional sin autonomía riesgosa.

Incluye:

- `CREATE_MY_TICKET_GUIDED`
- `DRAFT_ADMIN_COMMUNICATION`
- `GET_MY_PAYMENT_RECEIPTS`
- `GET_MY_NOTICES`
- mejoras de clarificación/defaults por dominio.

Por qué segundo:

- Requiere confirmaciones y gateways adicionales.
- Depende de RBAC/self-scope probado en Sprint 1.
- Introduce acciones no destructivas con guardrails.

Criterio de salida:

- Confirmación obligatoria en creación/draft.
- Sin envío automático.
- Documentos y comunicaciones respetan self-scope.

### Sprint / PR 3 — V2 controlado y automatización avanzada

Objetivo: habilitar capacidades de mayor complejidad sólo después de observabilidad y QA maduros.

Incluye:

- `GET_OPERATIONAL_CROSS_QUERY`
- `REQUEST_FINANCIAL_ACTION_REVIEW`
- policy por tenant para escalation/approval.
- QA adversarial de privacidad/RBAC.

Por qué tercero:

- Cross-query y acciones financieras concentran más riesgo.
- Necesitan contratos, confirmación fuerte e intervención humana.
- No son necesarios para probar valor MVP.

Criterio de salida:

- No hay acción financiera directa sin workflow.
- Todo caso de alto riesgo deriva o requiere aprobación humana.
- Rollback por capability.

---

## 9. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Residentes acceden a datos agregados | Fuga de privacidad / riesgo legal | Self-scope hard gate + tests negativos obligatorios |
| TOP_N cae en BREAKDOWN | Decisión de cobranza errónea | Families + gates + confusion matrix por capability |
| Clarificaciones genéricas | UX pobre y loops | Clarificar sólo por `missingEntities`; bridge/UI no inventan |
| MVP con acciones de alto riesgo | Incidentes financieros/operativos | MVP read-only; acciones quedan V1/V2 |
| HITL saturado | Operación ineficiente | Whitelist + reglas por capability + managedServiceEnabled |
| Cross-query mezcla datos sensibles | Riesgo de privacidad | V2 únicamente + RBAC/domain allowlist + QA adversarial |
| Drift entre blueprint e implementación | Falsos verdes | Backlog con intent/tool/RBAC/defaults/QA por capability |

---

## 10. Recomendación final de producto

Implementar Fase 2 con este blueprint.

Regla ejecutiva:

- **Sí ahora**: MVP read-only de alto valor, RBAC estricto, self-scope residente, metrics admin, HITL explícito.
- **Sí después**: acciones asistidas no destructivas con confirmación obligatoria.
- **No todavía**: acciones financieras, cambios de datos maestros, envío automático masivo, cross-query amplio.
- **Nunca para RESIDENTE estándar**: métricas agregadas, datos de terceros, acciones administrativas.

Este documento queda listo para:

- definir intents/families,
- definir tools/gateways,
- definir permisos/RBAC,
- diseñar defaults y clarificaciones,
- crear QA suites,
- abrir issues por sprint,
- priorizar releases.

---

## Key Learnings

1. El Assistant Operativo de BuildingOS debe organizarse por capacidad + permiso + riesgo + scope, no por prompts.
2. El MVP sano es read-only de alto valor con self-scope residente y métricas agregadas sólo para administración.
3. HITL tiene que estar modelado por capacidad desde el inicio para no degradar a respuestas inseguras.
4. Las acciones mutativas/financieras requieren V2, confirmación fuerte, workflow formal y posible aprobación humana.
5. El backlog debe llevar desde el inicio family, intentCode, tool, RBAC, defaults, clarificación, no_match, bloqueo, HITL y QA.
