# Phase 7 Manual Testing Report
**Auditoría + Impersonation + Reportes**

**Fecha**: 2026-02-17
**Versión**: Phase 7 Complete (7A + 7B + Reports MVP)

---

## Setup Inicial

### Prerequisitos
- Base de datos con datos de prueba (ejecutar seed si es necesario)
- 2 Tenants con estructura mínima:
  - **Tenant A**: TENANT_ADMIN + RESIDENT user
  - **Tenant B**: TENANT_ADMIN + RESIDENT user
- Al menos 1 building por tenant
- Data existente: tickets, charges/payments, communications, documents (de fases previas)

### Test Credentials
```
SUPER_ADMIN:
  email: super@buildingos.com
  password: [usar credentials de .env]

Tenant A Admin:
  email: admin-a@tenant-a.com
  password: [usar credentials de DB]

Tenant A Resident:
  email: resident-a@tenant-a.com
  password: [usar credentials de DB]

Tenant B Admin:
  email: admin-b@tenant-b.com
  password: [usar credentials de DB]
```

---

## A) AUDITORÍA - Eventos en Tenant A (TENANT_ADMIN)

### Paso 1: Ticket Create
**URL**: `/{tenantA}/buildings/{buildingId}/tickets`
**Acción**: Click "Crear Ticket" → completar form → guardar

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Formulario valida | Sin errores de validación | __ |
| Ticket creado | Aparece en lista sin reload | __ |
| BD: Ticket id generado | UUID válido | __ |
| **Auditoría**: TICKET_CREATE registrado | action='TICKET_CREATE', entityType='Ticket', entityId={id}, tenantId={A} | __ |

**Evidencia**: Grabar log del endpoint `GET /audit/logs?action=TICKET_CREATE`

```bash
# En terminal (dev mode):
curl -H "Authorization: Bearer {token}" \
  "http://localhost:4000/audit/logs?action=TICKET_CREATE&tenantId={tenantA}" | jq .
```

**Resultado OK**:
```json
{
  "logs": [{
    "action": "TICKET_CREATE",
    "entityType": "Ticket",
    "entityId": "...",
    "metadata": {"title": "...", "priority": "..."},
    "createdAt": "2026-02-17T...",
    "actorMembershipId": "..."
  }]
}
```

---

### Paso 2: Ticket Status Change
**URL**: Same ticket detail
**Acción**: Cambiar status de OPEN → IN_PROGRESS

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Status actualizado | Badge cambia de color | __ |
| **Auditoría**: TICKET_STATUS_CHANGE registrado | action='TICKET_STATUS_CHANGE', metadata includes {oldStatus, newStatus} | __ |

**Evidencia**:
```bash
curl -H "Authorization: Bearer {token}" \
  "http://localhost:4000/audit/logs?action=TICKET_STATUS_CHANGE&tenantId={tenantA}" | jq .
```

---

### Paso 3: Ticket Assign
**URL**: Same ticket
**Acción**: Asignar a OPERATOR user

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Responsable actualizado | UI muestra nombre | __ |
| **Auditoría**: TICKET_ASSIGNED registrado | metadata includes {assignedTo, membershipId} | __ |

---

### Paso 4: Ticket Comment
**URL**: Same ticket
**Acción**: Agregar comentario "Test comment"

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Comentario aparece | En lista sin reload | __ |
| **Auditoría**: TICKET_COMMENT_ADD registrado | action='TICKET_COMMENT_ADD', entityId={commentId}, metadata={body} | __ |

---

### Paso 5: Communication Create & Publish
**URL**: `/{tenantA}/buildings/{buildingId}/communications` (o menú correspondiente)
**Acción**: Crear comunicado → publicar

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Comunicado creado | Estado DRAFT | __ |
| Comunicado publicado | Estado SENT, sentAt timestamp | __ |
| **Auditoría**: COMMUNICATION_CREATE + COMMUNICATION_PUBLISHED registrados | 2 entradas con action codes correctos | __ |

---

### Paso 6: Document Upload
**URL**: `/{tenantA}/buildings/{buildingId}/documents`
**Acción**: Upload un PDF/archivo

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Archivo cargado | Aparece en lista | __ |
| File URL generada | Link funciona (descarga) | __ |
| **Auditoría**: DOCUMENT_CREATE registrado | action='DOCUMENT_CREATE', metadata={fileName, fileSize} | __ |

---

### Paso 7: Charge Create
**URL**: `/{tenantA}/buildings/{buildingId}/payments` (Finanzas tab)
**Acción**: Click "Crear Cargo" → ingresar monto/fecha vencimiento

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Cargo creado | Status PENDING, monto en centavos | __ |
| **Auditoría**: CHARGE_CREATE registrado | action='CHARGE_CREATE', metadata={amount, dueDate, unitId} | __ |

---

### Paso 8: Payment Submit (RESIDENT)
**Acción**: Cambiar usuario a RESIDENT del mismo tenant → navegar a financiero → pagar cargo

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Pago registrado | Status PENDING_APPROVAL, createdAt timestamp | __ |
| **Auditoría**: PAYMENT_SUBMITTED registrado | action='PAYMENT_SUBMITTED', metadata={paymentId, amount, method} | __ |

---

### Paso 9: Payment Approval & Allocation (TENANT_ADMIN)
**Acción**: Cambiar a TENANT_ADMIN → Review Payments → Aprobar pago

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Pago aprobado | Status APPROVED, approvedAt timestamp | __ |
| Cargo actualizado | Status PARTIAL o PAID según monto | __ |
| **Auditoría**: PAYMENT_APPROVED + ALLOCATION_CREATED registrados | 2 entradas | __ |

**Log esperado**:
```bash
curl "http://localhost:4000/audit/logs?action=PAYMENT_APPROVED&tenantId={tenantA}" | jq .
```

---

### Paso 10: Vendor/Quote/WorkOrder (Ops)
**Acción**: Create Vendor → Create Quote → Create WorkOrder → cambiar status

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Vendor creado | ID asignado | __ |
| Quote creado | Vinculado a vendor | __ |
| WorkOrder creado | Estado IN_PROGRESS | __ |
| Status cambio a COMPLETED | Status actualizado | __ |
| **Auditoría**: VENDOR_CREATE, QUOTE_CREATE, WORKORDER_CREATE, WORKORDER_STATUS_CHANGE registrados | 4 entradas en audit log | __ |

---

### Paso 11: Audit Log Verification (Summary)
**URL**: `GET /audit/logs?tenantId={tenantA}`

**Verificar**:
1. ✓ Existen entradas para cada evento (pasos 1-10)
2. ✓ Cada entrada tiene `action`, `entityType`, `entityId`, `tenantId`, `createdAt`
3. ✓ `metadata` contiene valores útiles (títulos, cambios, etc.)
4. ✓ `actorMembershipId` está presente (para rastrear quién)
5. ✓ Timestamps en orden cronológico

**Comando de verificación**:
```bash
# Obtener todos los logs de Tenant A
curl -H "Authorization: Bearer {token}" \
  "http://localhost:4000/audit/logs?tenantId={tenantA}&limit=100" | jq '.logs | length'

# Debe retornar >= 10 (al menos los eventos de A.1 a A.10)
```

| Caso | OK/FAIL | Notas |
|------|--------|-------|
| Mínimo 10 entradas | __ | |
| Todos tienen `action` válido | __ | Ver AUDIT_EVENTS.md para códigos |
| `entityId` siempre presente | __ | No null/undefined |
| `tenantId` = {tenantA} | __ | Aislamiento de tenant |
| timestamps cronológicos | __ | createdAt aumenta |

---

## B) IMPERSONATION - SUPER_ADMIN Support Mode

### Paso 12: Access Super-Admin Impersonation UI
**URL**: `http://localhost:3000/super-admin` (después de login SUPER_ADMIN)
**Acción**: Navegar al listado de tenants

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Super-Admin Dashboard visible | Tabla de tenants | __ |
| Botón "Entrar como soporte" presente | En cada fila tenant | __ |

---

### Paso 13: Start Impersonation (Tenant A)
**Acción**: Click "Entrar como soporte" → Tenant A

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Token impersonation generado | Almacenado en sessionStorage (no localStorage) | __ |
| Redirect a tenant dashboard | `/{tenantA}/dashboard` | __ |
| Banner visible | "Impersonando Tenant A" + botón "Salir" | __ |
| Contexto correcto | Menú sidebar muestra Tenant A | __ |

**Verificar en DevTools**:
```javascript
// En console del navegador:
console.log(sessionStorage.getItem('impersonation_token'));
// Debe mostrar un JWT válido
```

---

### Paso 14: Navigate During Impersonation
**Acción**: Navegar por Tenant A routes:
- `/{tenantA}/buildings`
- `/{tenantA}/buildings/{buildingId}`
- `/{tenantA}/buildings/{buildingId}/units`

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Buildings lista | Datos de Tenant A | __ |
| Units visible | Unidades del building | __ |
| Scope respetado | NO puede acceder a Tenant B (404) | __ |
| Header muestra "Support Mode" | Banner persistente | __ |

**Test Negativo**:
```
Intentar acceder: /{tenantB}/buildings
Resultado esperado: 404 o redirect a /{tenantA}/dashboard
```

---

### Paso 15: Exit Impersonation
**Acción**: Click "Salir" en banner de impersonation

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Token eliminado | sessionStorage limpio | __ |
| Redirect a /super-admin | Control plane | __ |
| Banner desaparece | Ya no visible | __ |

**Verificar**:
```javascript
console.log(sessionStorage.getItem('impersonation_token'));
// null o undefined
```

---

### Paso 16: Audit Impersonation Events
**URL**: `GET /audit/logs?action=IMPERSONATION_START`

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| IMPERSONATION_START registrado | tenantId={superAdmin}, metadata={targetTenantId: tenantA} | __ |
| IMPERSONATION_END registrado | mismo metadata | __ |

**Comando**:
```bash
curl -H "Authorization: Bearer {superAdminToken}" \
  "http://localhost:4000/audit/logs?action=IMPERSONATION_START" | jq .
```

**Resultado OK**:
```json
{
  "logs": [{
    "action": "IMPERSONATION_START",
    "metadata": {
      "targetTenantId": "{tenantA}",
      "targetTenantName": "Tenant A"
    },
    "createdAt": "..."
  }]
}
```

---

## C) REPORTES - Tenant & Building Level

### Paso 17: Tenant-Level Reports
**URL**: `/{tenantA}/reports`
**Acción**: Abrir página de reportes

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Page carga | Sin errores en console | __ |
| 4 tabs visibles | Tickets, Finanzas, Comunicados, Actividad | __ |
| Building selector | Dropdown con "Todos" + lista edificios | __ |

---

### Paso 18: Tickets Report
**Acción**: Click tab "Tickets" (si no es default)

**Verificar**:
- 2 KPI cards: "Respuesta Promedio (horas)", "Resolución Promedio (horas)"
- Tabla "Por Estado": OPEN, IN_PROGRESS, RESOLVED, CLOSED (con conteos)
- Tabla "Por Prioridad": LOW, MEDIUM, HIGH, URGENT
- Tabla "Categorías Principales": top 5 categorías

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| KPI Respuesta | Número >= 0 | __ |
| KPI Resolución | Número >= 0 | __ |
| Estado OPEN | Coincide con DB (tickets sin cerrar) | __ |
| Categorías top | Ordenadas por count descend | __ |

**Verificar en Network**:
- Endpoint: `GET /tenants/{tenantA}/reports/tickets`
- Status: 200
- Response: `{byStatus, byPriority, topCategories, avgTimeToFirstResponseHours, avgTimeToResolveHours}`

---

### Paso 19: Finance Report
**Acción**: Click tab "Finanzas"

**Verificar**:
- 4 KPI cards: "Total Facturado", "Total Cobrado", "Pendiente", "Tasa de Cobranza (%)"
- Tabla "Unidades Morosas" (si existen): unitId, Monto Pendiente

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Total Facturado | SUM(charges) / 100 | __ |
| Total Cobrado | SUM(APPROVED payments) / 100 | __ |
| Pendiente | Facturado - Cobrado | __ |
| Tasa Cobranza | (Cobrado / Facturado) * 100 | __ |
| Unidades Morosas | Solo PENDING/PARTIAL + dueDate < now | __ |
| Monto display | Formateo ARS correcto | __ |

**Comando de verificación**:
```bash
curl "http://localhost:4000/tenants/{tenantA}/reports/finance" | jq .
```

---

### Paso 20: Communications Report
**Acción**: Click tab "Comunicados"

**Verificar**:
- 3 KPI cards: "Total Destinatarios", "Lecturas", "Tasa de Lectura (%)"
- Tabla "Por Canal": EMAIL, SMS, PUSH, etc. (sent, read, readRate)

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Total Destinatarios | COUNT(receipts) | __ |
| Lecturas | COUNT(receipts WHERE readAt IS NOT NULL) | __ |
| Tasa Lectura | (Lecturas / Destinatarios) * 100 | __ |
| Por Canal EMAIL | sent, read, readRate % | __ |

---

### Paso 21: Activity Report
**Acción**: Click tab "Actividad"

**Verificar**:
- 4 KPI cards (números grandes):
  - Tickets Creados
  - Pagos Enviados
  - Documentos Cargados
  - Comunicaciones Enviadas

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Tickets Creados | COUNT(tickets) | __ |
| Pagos Enviados | COUNT(payments) | __ |
| Documentos Cargados | COUNT(documents) | __ |
| Comunicaciones Enviadas | COUNT(communications WHERE status='SENT') | __ |

---

### Paso 22: Building-Level Reports
**URL**: `/{tenantA}/buildings/{buildingId}/reports`
**Acción**: Navegar desde tab "Reportes" en building

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Page carga | Sin errores | __ |
| buildingId locked | No hay dropdown de edificios | __ |
| Solo filtro fechas | date range (from/to) | __ |
| Reportes cargados | Misma estructura 4 tabs | __ |

**Comparación con tenant-level**:
- Números deben ser iguales o menores (subset)
- Si hay 2 buildings en tenant, números de A.1-building deben ser < reportes tenant-level

---

### Paso 23: Filter by Building (Tenant-Level)
**URL**: `/{tenantA}/reports`
**Acción**: En dropdown buildings, seleccionar un building específico → "Aplicar filtros"

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Reportes recargan | GET /reports/... con ?buildingId=... | __ |
| Números actualizan | Más bajos que antes (solo ese building) | __ |
| URL o query params | buildingId presente | __ |

---

### Paso 24: Filter by Date Range
**URL**: `/{tenantA}/reports`
**Acción**: Ingresar date range (últimos 7 días) → "Aplicar"

| Campo | Resultado Esperado | OK/FAIL |
|-------|-------------------|--------|
| Reportes recargan | GET /reports/... con ?from=... &to=... | __ |
| Números disminuyen | Solo eventos en rango | __ |

---

## D) NEGATIVAS & SEGURIDAD

### Paso 25: Non-Admin Cannot Impersonate
**Acción**: Login con RESIDENT user → intentar acceder `/super-admin`

| Resultado Esperado | OK/FAIL |
|-------------------|--------|
| 403 Forbidden o redirect `/login` | __ |
| No carga interface impersonation | __ |

---

### Paso 26: Token Expiry
**Acción**: Generar impersonation token → esperar X minutos (o simular expiry en code)

| Resultado Esperado | OK/FAIL |
|-------------------|--------|
| Redirección a login automática | __ |
| Mensaje "Sesión expirada" | __ |
| sessionStorage limpio | __ |

**Alternativa (sin esperar)**:
Modificar token en sessionStorage a uno inválido → refrescar página
```javascript
sessionStorage.setItem('impersonation_token', 'invalid.token.here');
```
Resultado: debe logout o 401

---

### Paso 27: Cross-Tenant Audit Access
**Acción**: Tenant B TENANT_ADMIN intenta acceder `/audit/logs?tenantId={tenantA}`

| Resultado Esperado | OK/FAIL |
|-------------------|--------|
| 404 Not Found o 403 Forbidden | __ |
| No retorna data de Tenant A | __ |

**Comando**:
```bash
curl -H "Authorization: Bearer {tenantBToken}" \
  "http://localhost:4000/audit/logs?tenantId={tenantA}"
# Esperado: 404 o 403
```

---

### Paso 28: Cross-Tenant Reports Access
**Acción**: Tenant B intenta acceder `/reports` de Tenant A o suplantar buildingId de A

| Resultado Esperado | OK/FAIL |
|-------------------|--------|
| `GET /tenants/{tenantA}/reports/tickets` con B's token → 404 | __ |
| `GET /tenants/{tenantB}/reports/tickets?buildingId={tenantA_buildingId}` → 404 | __ |

---

### Paso 29: RESIDENT Cannot See Reports
**Acción**: Login RESIDENT → intentar `/reports`

| Resultado Esperado | OK/FAIL |
|-------------------|--------|
| 403 Forbidden | __ |
| Mensaje "No tienes permiso" | __ |

---

## E) ROBUSTEZ UX

### Paso 30: Refresh Tenant Reports
**URL**: `/{tenantA}/reports` (cualquier tab)
**Acción**: Press F5 (refresh)

| Resultado Esperado | OK/FAIL |
|-------------------|--------|
| Página recarga | Sin errores 404 | __ |
| Datos se recargan desde API | Network tab muestra GET /reports/... | __ |
| Contexto mantenido | Mismo tab activo (o default Tickets) | __ |
| No hay localStorage | sessionStorage solo para auth/impersonation | __ |

---

### Paso 31: Refresh Building Reports
**URL**: `/{tenantA}/buildings/{buildingId}/reports`
**Acción**: F5

| Resultado Esperado | OK/FAIL |
|-------|--------|
| Recarga sin errores | __ |
| buildingId mantenido | URL correcta | __ |
| Reportes refrescados | Data actual | __ |

---

### Paso 32: Refresh During Impersonation
**URL**: `/{tenantA}/dashboard` (mientras impersonando)
**Acción**: F5

| Resultado Esperado | OK/FAIL |
|-------|--------|
| Mantiene impersonation | Banner "Impersonando" aún visible | __ |
| Dashboard Tenant A carga | Datos de A | __ |
| Contexto = Tenant A | No desconecta | __ |

---

### Paso 33: Tab Switch (Reports)
**URL**: `/{tenantA}/reports`
**Acción**: Ir a tab Tickets → (esperar carga) → tab Finanzas → tab Comunicados → tab Actividad

| Resultado Esperado | OK/FAIL |
|-------|--------|
| Cada tab carga datos | Sin errores | __ |
| Scroll position reset | Top de página | __ |
| Loading state visible | Skeleton o spinner | __ |
| Datos correctos por tab | No mezcla datos | __ |

---

### Paso 34: Error Handling
**Acción**: Simular error de red (DevTools → Network throttling: Offline)

**URL**: `/{tenantA}/reports`
**Acción**: Abrir reports con offline

| Resultado Esperado | OK/FAIL |
|-------|--------|
| Error state visible | "Error cargando reportes" | __ |
| Botón "Reintentar" | Funciona al volver online | __ |
| No crash | UI manejable | __ |

---

## Resumen de Resultados

### Tabla de Cierre

| Sección | Casos | OK | FAIL | Status |
|---------|-------|----|----|--------|
| **A) Auditoría** | 11 | __ | __ | __ |
| **B) Impersonation** | 5 | __ | __ | __ |
| **C) Reportes** | 8 | __ | __ | __ |
| **D) Negativas** | 5 | __ | __ | __ |
| **E) Robustez** | 5 | __ | __ | __ |
| **TOTAL** | **34** | __ | __ | __ |

---

## Checklist de No-Regresión

- [ ] localStorage: vacío en Auditoría/Reports/Impersonation (solo sessionStorage)
- [ ] SUPER_ADMIN role: no accessible a tenant routes
- [ ] RESIDENT role: no accessible a reports
- [ ] Multi-tenant isolation: todos los tests de cross-tenant retornan 404
- [ ] Audit action codes: todos presentes en AUDIT_EVENTS.md
- [ ] API endpoints: responden correctamente con números coherentes
- [ ] UX: sin errores de console, sin TypeScript warnings

---

## Evidence Links

### Archivos de Referencia
- `AUDIT_EVENTS.md` - Action codes exhaustivos (60+ acciones)
- `apps/api/src/reports/reports.service.ts` - Lógica de agregación
- `apps/api/src/audit/audit.service.ts` - Logging de eventos
- `apps/api/src/impersonation/` - Token impersonation

### Comandos de Verificación Rápida

**Audit Log (últimos 10)**:
```bash
curl -H "Authorization: Bearer {token}" \
  "http://localhost:4000/audit/logs?tenantId={tenantId}&limit=10" | jq '.logs[] | {action, entityType, entityId, createdAt}'
```

**Reports Tickets**:
```bash
curl -H "Authorization: Bearer {token}" \
  "http://localhost:4000/tenants/{tenantId}/reports/tickets?buildingId={id}" | jq .
```

**Impersonation Status** (Client DevTools):
```javascript
{
  token: sessionStorage.getItem('impersonation_token'),
  isActive: !!sessionStorage.getItem('impersonation_token')
}
```

---

## Notas para Evaluador

### Criterio de Aceptación
✅ **Todos los casos (1-34) deben marcar OK**

Si hay FAILs:
1. Documentar el caso fallido exactamente
2. Reproducir en local
3. Listar máximo 5 fixes concretos con prioridad
4. Re-testear

### Datos Esperados por Tenant
Asegurar que antes de testing existe:
- Tenant A:
  - ≥1 building
  - ≥2 tickets (diferentes estados)
  - ≥1 charge + payment aprobado
  - ≥1 comunicado enviado
  - ≥1 documento
  - ≥1 vendor con quote/workorder
- Tenant B: mismo (para aislamiento)

### Performance Notes
- Reports → primer load: ~500-1000ms (depend de cantidad de datos)
- Audit log: ~100ms (indexed por tenantId + action)
- Impersonation token: válido por 8 horas o sesión (configurable)

---

## Sign-off

**Testeador**: ___________________
**Fecha**: ___________________
**Status Final**: ✅ PASS / ❌ FAIL
**Notas**:

