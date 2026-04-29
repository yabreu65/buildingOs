# QA Checklist P2-B — Process Tracking (SEARCH_PROCESSES, GET_PROCESS_SUMMARY, SEARCH_CLAIMS)

## Entorno: ____ (local/staging)

## Criterio GO/NO-GO: TODOS los 11 casos críticos deben pasar (Pass)

---

## CASOS CRÍTICOS (P0) — Deben pasar todos

| ID | Caso | Pasos | Resultado esperado | Evidencia | Pass/Fail |
|----|------|-------|---------------------|-------------------|-----------|-----------|
| C01 | **Tenant isolation: usuario accede a proceso de other tenant** | 1. Autenticarse como tenant-A<br>2. Ejecutar `search_processes` sin buildingId<br>3. Verificar que solo retorna procesos del tenant-A | Solo procesos con `tenantId == tenant-A` | | |
| C02 | **Tenant isolation: building de otro tenant** | 1. Autenticarse como tenant-A<br>2. Intentar `search_processes(buildingId=building-del-tenant-B)` | Error 403 o返回空数组 | | |
| C03 | **Role denied: OPERATOR no puede ver todos los procesos** | 1. Autenticarse como OPERATOR<br>2. Ejecutar `search_processes` sin filtros<br>3. Verificar acceso denegado o filtrado | Error 403 o solo datos del scope permitido | | |
| C04 | **Role denied: RESIDENT solo ve sus procesos** | 1. Autenticarse como RESIDENT (userId=X)<br>2. Ejecutar `search_processes`<br>3. Verificar que solo retorna procesos donde assignedToUserId=X | Solo procesos del usuario | | |
| C05 | **Contract mismatch: toolName inválido** | 1. Ejecutar tool con `toolName: "invalid_tool"`<br>2. Verificar respuesta de error | Error o fallback a tool válida | | |
| C06 | **Pagination: cursor válido para segunda página** | 1. Ejecutar `search_processes(limit=5)`<br>2. Obtener `nextCursor`<br>3. Ejecutar con ese cursor<br>4. Verificar que retorna siguiente página | Items diferentes, `hasMore` correcto | | |
| C07 | **Pagination: cursor inválido/expirado** | 1. Usar cursor de query vieja<br>2. Ejecutar search | empty array o error de cursor | | |
| C08 | **Clarification: multi-building sin buildingId** | 1. Tenant con 3+ edificios<br>2. Ejecutar `search_processes` sin buildingId<br>3. Verificar que retorna clarification | `{ answer: "...edificio...", options: [...] }` | | |
| C09 | **Period required: liquidaciones sin período** | 1. Ejecutar `search_processes(processTypes=["LIQUIDATION"])` sin period<br>2. Verificar clarification | `{ answer: "...período...", options: [...] }` | | |
| C10 | **overdueSla filter: procesos vencidos** | 1. Ejecutar `search_processes(overdueSla=true)`<br>2. Verificar que todos los resultados tienen `overdueSla=true` | Solo procesos con SLA vencido | | |
| C11 | **No intents por filtro: invariante del producto** | 1. Intentar usar filtros como intents (ej: "buscar PENDING liquidaciones" NO es intent,debe ser tool con filtros)<br>2. Verificar que NO hay intents para statuses o processTypes<br>3. Verificar que la herramienta siempre recibe filtros como parámetros, nunca como intents | Router no crea intents para estados o tipos; siempre pasan como `toolInput.filters` | | |

---

## CASOS NORMALES (P1)

| ID | Caso | Pasos | Resultado esperado | Evidencia | Pass/Fail |
|----|------|-------|---------------------|-------------------|-----------|-----------|
| N01 | **search_processes: filtros combinados** | 1. Ejecutar con `statuses=["PENDING"], processTypes=["LIQUIDATION"], buildingId=X`<br>2. Verificar filtros aplicados | Solo liquidaciones pendientes del edificio X | | |
| N02 | **search_processes: status=APPROVED** | 1. Ejecutar `search_processes(statuses=["APPROVED"])`<br>2. Verificar todos con status APPROVED | Solo procesos APPROVED | | |
| N03 | **search_processes: status=REJECTED** | 1. Ejecutar `search_processes(statuses=["REJECTED"])`<br>2. Verificar todos con status REJECTED | Solo procesos REJECTED | | |
| N04 | **search_processes: processTypes=CLAIM → search_claims** | 1. Ejecutar `search_processes(processTypes=["CLAIM"])`<br>2. Verificar que usa tool search_claims | Tool correcto invocado | | |
| N05 | **get_process_summary: groupBy=status** | 1. Ejecutar `get_process_summary(groupBy="status")`<br>2. Verificar respuesta con grupos por status | `{ groups: [{ key: "PENDING", count: N }, ...] }` | | |
| N06 | **get_process_summary: groupBy=processType** | 1. Ejecutar `get_process_summary(groupBy="processType")`<br>2. Verificar grupos por tipo | `{ groups: [{ key: "LIQUIDATION", count: N }, ...] }` | | |
| N07 | **createdAfter filter: "hace 7 días"** | 1. Ejecutar `search_processes(createdAfter="2026-04-18")` (ajustar fecha)<br>2. Verificar que `createdAt >= createdAfter` | Solo procesos créés después de la fecha | | |
| N08 | **assigned filter: sin asignar** | 1. Ejecutar `search_processes(assigned=false)`<br>2. Verificar que todos tienen `assignedToUserId=null` | Solo procesos sin asignar | | |
| N09 | **assigned filter: asignados** | 1. Ejecutar `search_processes(assigned=true)`<br>2. Verificar que todos tienen `assignedToUserId != null` | Solo procesos asignados | | |
| N10 | **priority filter: urgencia** | 1. Ejecutar `search_processes(priority=3)`<br>2. Verificar que todos tienen priority >= 3 | Solo procesos de alta prioridad | | |

---

## Schema de Respuesta Esperado

```json
{
  "answer": "...",
  "answerSource": "live_data",
  "toolName": "search_processes",
  "data": {
    "processes": [
      {
        "id": "...",
        "processType": "LIQUIDATION",
        "status": "PENDING",
        "buildingId": "...",
        "assignedToUserId": "...",
        "priority": 1,
        "period": "2026-03",
        "overdueSla": false,
        "createdAt": "2026-04-01T00:00:00.000Z",
        "updatedAt": "2026-04-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 100,
      "limit": 20,
      "nextCursor": "cursor-uuid",
      "hasMore": true
    },
    "asOf": "2026-04-25T12:00:00.000Z"
  }
}
```

---

## Rollout Checklist

- [ ] Tests locales pasan (28/28 router + tools)
- [ ] Tests staging pasan (20/20 QA checklist)
- [ ] Logs verificados en Datadog
- [ ] Métricas en dashboard
- [ ] Documentación actualizada

---

## Acciones Post-Run

| ID | Hallazgo | Acción | owner |
|----|----------|--------|-------|
| | | | |

---

**Fecha QA**: _______ | **Tester**: _______ | **Resultado**: GO / NO-GO