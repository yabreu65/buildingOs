# P2-B: Procesos con Filtros Complejos — Spec de Diseño

**Versión:** 2026-05-p2-process-manifest-v1  
**Fecha diseño:** 2026-04-25

---

## 1. Modelo Mínimo de Proceso

### IMPORTANTE: P2-B v1 es READ-ONLY

**Solo consultas.** Las acciones de approve/reject/complete se implementan en P3 o posterior.
Los tools devuelven datos para que el usuario visualize y pueda tomar decisiones,
pero NO ejecutan transiciones de estado ni modifican registros en BD.

---

### 1.1 Entidad: Process Tracking (unified)

Para soportar liquidaciones/aprobaciones/reclamos con SLA:

```prisma
model ProcessInstance {
  id              String    @id @default(cuid())
  tenantId        String
  buildingId      String?   // nullable para procesos tenant-wide
  unitId          String?  // nullable si no es unit-specific

  // Process definition
  processType     ProcessType  // LIQUIDATION | EXPENSE_VALIDATION | CLAIM | APPROVAL
  processId      String       // FK al proceso base (Liquidation.id, Expense.id, Ticket.id)

  // Workflow state
  status         ProcessStatus // PENDING | IN_PROGRESS | APPROVED | REJECTED | COMPLETED | CANCELLED
  assigneeId     String?       // membershipId del asignado
  assigneeRole   String?       // rol asignado

  // SLA tracking
  slaDeadline    DateTime?   //Deadline para cumplir SLA
  slaBreached    Boolean     @default(false)
  escalationLevel Int        @default(0)  // 0=normal, 1=first_escalation, 2=critical

  // Timeline
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  completedAt    DateTime?

  // Indexes
  @@index([tenantId, processType, status])
  @@index([tenantId, slaDeadline])
  @@index([tenantId, buildingId, status])
  @@index([assigneeId, status])
}

enum ProcessType {
  LIQUIDATION       // Proceso de liquidación de gastos
  EXPENSE_VALIDATION // Validación de comprobantes
  CLAIM             // Reclamo/ticket de residente
  APPROVAL          // Aprobación de pago/gasto
}

enum ProcessStatus {
  PENDING       // Esperando acción
  IN_PROGRESS  // En proceso activo
  APPROVED     // Aprobado
  REJECTED     // Rechazado
  COMPLETED    // Completado
  CANCELLED   // Cancelado
}

model ProcessAudit {
  id              String    @id @default(cuid())
  tenantId        String
  processInstanceId String

  action          ProcessAuditAction // CREATED | ASSIGNED | ESCALATED | APPROVED | REJECTED | COMPLETED | SLA_WARN | SLA_BREACHED
  actorMembershipId String?
  fromStatus      ProcessStatus?
  toStatus        ProcessStatus?
  note            String?
  createdAt       DateTime @default(now())

  @@index([tenantId, processInstanceId])
  @@index([tenantId, createdAt])
}

enum ProcessAuditAction {
  CREATED
  ASSIGNED
  ESCALATED
  SLA_WARN
  SLA_BREACHED
  APPROVED
  REJECTED
  COMPLETED
  CANCELLED
}
```

### 1.2 Campos adicionales a Expense (existing)

```prisma
// En Expense agregar:
processInstanceId String?  // FK a ProcessInstance (para trazabilidad)
```

### 1.3 Campos adicionales a Liquidation (existing)

```prisma
// En Liquidation agregar:
processInstanceId String?  // FK a ProcessInstance
slaDeadline       DateTime? // Deadline SLA
```

### 1.4 Reutilización de Ticket (existing claim model)

- Ya existe model `Ticket` → renombrar a `Claim` mentalmente
- Agregar campos SLA a Ticket schema

```prisma
// En Ticket agregar:
slaDeadline      DateTime?
slaBreached       Boolean  @default(false)
processInstanceId String?  // FK a ProcessInstance
```

---

## REGLAS PM (Aplicables al diseño)

1. **No crear intents por filtro:** Usar tools paramétricas con filtros combinables.
2. **P2-B v1 es READ-ONLY:** No ejecutar aprobaciones/rechazos. Solo consultar.
3. **Respuestas siempre con:**
   - `asOf` timestamp (REQUIRED)
   - `limit` + `cursor` (RECOMMENDED) o `offset` (legacy)
   - `total` count (OPTIONAL)

---

## 2. Tools Core P2-B

### 2.1 search_processes(filters)

**Input:**
```typescript
interface SearchProcessesInput {
  // Filtros combinables (KEY: no crear intents por filtro)
  processTypes?: ProcessType[]           // ["LIQUIDATION", "EXPENSE_VALIDATION"]
  statuses?: ProcessStatus[]            // ["PENDING", "IN_PROGRESS"]
  buildingId?: string                   // filtro por edificio
  unitId?: string                      // filtro por unidad
  assigneeRole?: string                // filtro por rol asignado
  overdueSla?: boolean                 // true = slaBreached=true
  createdAfter?: string                // ISO date string (reemplaza ageGtDays)
  createdBefore?: string               // ISO date string
  period?: string                      // YYYY-MM para filtrar por período

  // Paginación (REQUIRED)
  limit?: number                       // default 20, max 100
  cursor?: string                      // cursor para paginación (opcional)

  // Sort
  sortBy?: "createdAt" | "slaDeadline" | "status"
  sortOrder?: "asc" | "desc"

  // Response siempre con asOf (REQUIRED)
  asOf?: string                         // default now, timestamp de la query
}
```

**Output:**
```typescript
interface SearchProcessesOutput {
  answer: string
  answerSource: "live_data"
  responseType: "list"
  metadata: {
    processes: Array<{...}>
    pagination: {
      total: number           // total sin paginar
      limit: number
      nextCursor?: string    //cursor para siguiente página
      hasMore: boolean       //hay más datos?
    }
    filters: SearchProcessesInput   //eco de filtros aplicados
    asOf: string              //timestamp de la query
  }
}
```

### 2.2 get_process_summary(filters)

**Input:** Mismos filtros que search + agrupamiento

```typescript
interface GetProcessSummaryInput {
  groupBy: "processType" | "status" | "assigneeRole" | "buildingId"
  filters?: SearchProcessesInput["filters"]
  asOf?: string  //default now
}
```

**Output:**
```typescript
{
  answer: "Resumen: 3 liquidaciones pendientes, 2 expenses en validación, 1 claim incumplido..."
  answerSource: "live_data"
  responseType: "metric"
  metadata: {
    groups: Array<{ key: string, count: number, pendingSla: number }>
    filters: {...}
    generatedAt: string
  }
}
```

### 2.3 search_claims(filters) (alias de search_processes para Claims)

- Misma interface que search_processes
- Solo filtrado por processType=["CLAIM"]

---

## 3. Router/Manifest P2-B

### 3.1 Filtros keyword extraction

| Filtro | Palabras clave | Extrae |
|--------|---------------|--------|
| pending | "pendiente", "sin aprobar", "por revisar" | status=[PENDING] |
| in_progress | "en proceso", "en curso" | status=[IN_PROGRESS] |
| approved | "aprobado", "aprobada" | status=[APPROVED] |
| rejected | "rechazado", "rechazada" | status=[REJECTED] |
| overdue | "vencido", "incumplido", "sla" | overdueSla=true |
| my_assignments | "mis tareas", "asignados" | assigneeRole=${CURRENT_ROLE} |
| liquidations | "liquidacion", "liquidaciones" | processType=[LIQUIDATION] |
| expenses | "expensas", "comprobantes", "gastos" | processType=[EXPENSE_VALIDATION] |
| claims | "reclamos", "reclamo", "incidencia" | processType=[CLAIM] |
| 30_days | "último mes", "30 días" | createdAfter=${30_DAYS_AGO} |
| this_month | "este mes" | period=${CURRENT_MONTH} |

### 3.2 Clarifications requeridas

- Si multi-building tenant + filtros de building ambiguos → pedir edificio
- Si proceso unit-specific sin unitId → pedir unidad (si aplica)
- Si filtros contradictorios → clarificación

### 3.3 Manifest P2-B (draft)

```json
{
  "contractVersion": "2026-05-buildingos-p2b-manifest-v1",
  "defaults": {
    "limit": 20,
    "maxLimit": 100,
    "maxClarifications": 2,
    "requireBuildingWhenMultiBuilding": true,
    "ageGtDays": null,
    "overdueSla": false
  },
  "routes": [
    {
      "intentCode": "SEARCH_ALL_PROCESSES",
      "toolName": "search_processes",
      "keywords": ["procesos", "workflow", "tareas", "backlog"]
    },
    {
      "intentCode": "SEARCH_MY_TASKS",
      "toolName": "search_processes",
      "keywords": ["mis tareas", "asignados a mi", "pendientes mios"],
      "toolInput": { "assigneeRole": "${CURRENT_ROLE}" }
    },
    {
      "intentCode": "GET_PROCESS_SUMMARY",
      "toolName": "get_process_summary",
      "keywords": ["resumen", "dashboard", "estado general", "métricas"],
      "toolInput": { "groupBy": "processType" }
    },
    {
      "intentCode": "SEARCH_OVERDUE_PROCESSES",
      "toolName": "search_processes",
      "keywords": ["vencidos", "sla incumplido", "incumplidos", "overdue"],
      "toolInput": { "overdueSla": true }
    },
    {
      "intentCode": "SEARCH_LIQUIDATIONS",
      "toolName": "search_processes",
      "keywords": ["liquidaciones", "liquidacion"],
      "toolInput": { "processTypes": ["LIQUIDATION"] }
    },
    {
      "intentCode": "SEARCH_EXPENSE_VALIDATIONS",
      "toolName": "search_processes",
      "keywords": ["validar", "validación", "comprobantes"],
      "toolInput": { "processTypes": ["EXPENSE_VALIDATION"] }
    },
    {
      "intentCode": "SEARCH_CLAIMS",
      "toolName": "search_claims",
      "keywords": ["reclamos", "incidencias", "tickets"],
      "toolInput": { "processTypes": ["CLAIM"] }
    }
  ]
}
```

---

## 4. Tests Design

### 4.1 Router Contract Tests

- routing "mis tareas" → `search_processes` con assigneeRole del context
- routing "resumen de liquidaciones" → `get_process_summary` groupBy=processType
- routing "procesos vencidos" → `search_processes` overdueSla=true
- routing sin match → null
- clarification cuando multi-building sin buildingId

### 4.2 Tool Contract Tests

- success: devuelve array procesos con paginación
- tenant spoofing: filtro tenantId forzado, no cruza
- role denied: sin rol válido → 403
- no_data: filtros que no retornan resultados
- overdueSla filter: solo trae slaBreached=true
- ageGtDays filter: solo trae creados hace > N días
- combinable filters: todos juntos

### 4.3 Smoke Tests (enforcing in CI)

```yaml
# .github/workflows/ci.yml add:
- name: Run P2-B smoke tests - buildingos-p2b-router
  run: npm run test --workspace=@yoryi/ai-adapters -- src/buildingos/buildingos-p2b-router.spec.ts
```

---

## 5. Backlog por Fases

### Phase B.1: Model + Tools (MVP)

- [ ] Schema: ProcessInstance + ProcessAudit models + migrations
- [ ] Schema: agregar campos sla/processInstanceId a Expense/Liquidation/Ticket
- [ ] Service: ProcessSearchService con filtros
- [ ] Tool: search_processes, get_process_summary, search_claims
- [ ] Tests: unit tests para services
- [ ] Tests: contract tests tool

### Phase B.2: Router

- [ ] BuildingOSP2BRouter class
- [ ] buildingos.p2b.json manifest
- [ ] keyword extraction logic
- [ ] clarification logic
- [ ] Tests: P2-B router tests (16+)

### Phase B.3: QA + Release

- [ ] Smoke end-to-end (3 queries)
- [ ] CI integration (enforcing)
- [ ] Release notes P2-B.md
- [ ] Update PLAYBOOK_VERSION

---

## 6. Archivos a Tocar por Repo

### BuildingOS (`/Users/yoryiabreu/proyectos/buildingos`)

| Archivo | Acción |
|---------|--------|
| `apps/api/prisma/schema.prisma` | AGREGAR: ProcessInstance, ProcessAudit, campos SLA en Expense/Liquidation/Ticket |
| `apps/api/prisma/migrations/*` | NUEVA migracion |
| `apps/api/src/finanzas/process-search.service.ts` | NUEVO service |
| `apps/api/src/finanzas/process-search.controller.ts` | NUEVO controller |
| `apps/api/src/finanzas/finanzas.module.ts` | REGISTRAR provider+controller |
| `apps/api/src/assistant/tools.service.ts` | AGREGAR P2-B tools |
| `apps/api/src/assistant/tools.types.ts` | AGREGAR P2-B tool names |
| `docs/releases/P2-B.md` | NUEVO release notes |

### yoryi-ai-core (`/Users/yoryiabreu/proyectos/yoryi-ai-core`)

| Archivo | Acción |
|---------|--------|
| `packages/ai-adapters/src/buildingos/buildingos-p2b-router.ts` | NUEVO router |
| `packages/ai-adapters/src/buildingos/buildingos-p2b-router.spec.ts` | NUEVO tests |
| `packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p2b.json` | NUEVO manifest |
| `packages/ai-adapters/src/index.ts` | EXPORT P2-B router |
| `.github/workflows/ci.yml` | AGREGAR smoke P2-B step |

---

## 7. Consideraciones de Diseño

### 7.1 Reutilización vs Nuevos Models

- **Elegido:** Nuevo modelo `ProcessInstance` unificado para evitar N tablas de workflow
- **Rationale:** 1 tabla con `processType` es más mantenible que 4 tablas separadas para liquidations/expenses/claims/approvals
- **Trade-off:** Queries deben filtrar por `processType` explícitamente

### 7.2 SLA en Tiempo o en Días Hábiles?

- **Diseño:** SLA deadline como `DateTime` exacto (más simple)
- **Consideración:** Para SLA en días hábiles, la lógica de cálculo queda en aplicación, no en DB
- **Extensibilidad:** Se puede agregar campo `slaBusinessDays: boolean` si se necesita

### 7.3 Por qué no usar Ticket existente tal cual?

- Ticket ya tiene lifecycle completo (OPEN→IN_PROGRESS→CLOSED)
- **Mejora:** Agregar wrapper `ProcessInstance` permite:
  - Unificar búsqueda cross-process (liquidations + claims + approvals)
  - Métricas agregadas
  - Escalation levels global

### 7.4 Escalation Model

```
Level 0: Normal (sin acción)
Level 1: First Escalation (notificar admins)
Level 2: Critical (notificar owners + tomar acción automática si aplica)
```

iggers:
- Level up: cuando pasa deadline sin completar
- Level up: cuando usuario lo requiere explícitamente
- Level reset: al completar proceso