# Dashboard Admin - Especificación Técnica

## 1. Definiciones de Semántica de Estados

### Estados de Pago/Charge
| Estado | Definición |
|--------|------------|
| `PENDING` | Charge creado, aún no pagado. |
| `PARTIAL` | Charge con pago parcial asignado. |
| `PAID` | Charge completamente pagado (asignaciones == monto total). |
| `OVERDUE` | Charge PENDING/PARTIAL con `dueDate < now()`. |
| `PENDING_VALIDATION` | Payment enviado, pendiente de aprobación por admin. |

### Estados de Ticket
| Estado | Definición |
|--------|------------|
| `OPEN` | Ticket creado, sin asignar. |
| `IN_PROGRESS` | Ticket asignado y en curso. |
| `OVERDUE` | Ticket con `dueDate` vencido o fuera de SLA. |
| `RESOLVED` | Ticket cerrado/completado. |

### Unidade sin responsable
- `primary_resident = null` O
- Assignment activo con `is_primary = true` no existe para la unidad.

---

## 2. Definición de Períodos

| Código | Definición | Corte |
|--------|------------|-------|
| `CURRENT_MONTH` | Mes actual calendarizado |TZ del tenant |
| `PREVIOUS_MONTH` | Mes anterior completo |TZ del tenant |
| `LAST_30_DAYS` | Últimos 30 días desde hoy |TZ del tenant |

### Formato de período en query
```typescript
period: 'CURRENT_MONTH' | 'PREVIOUS_MONTH' | 'LAST_30_DAYS'
```

---

## 3. Zona Horaria

- **TZ oficial:** `America/Argentina/Buenos_Aires` (AR)
- Fallback si el tenant no tiene TZ configurado: UTC

---

## 4. Moneda y Decimales

- Todos los montos en **centavos** (integer)
- Ejemplo: ARS 500.00 → `50000` (no 500.00)
- `collectionRate` con 3 decimales (0.783)
- Formato display: separador miles `.`, decimal `,`

---

## 5. Contrato de API

### Endpoint
```
GET /api/v1/dashboard/admin/summary
```

### Query Params
| Param | Tipo | Requerido | Default | Descripción |
|-------|------|-----------|---------|-------------|
| `buildingId` | string (UUID) | No | `null` | Filtrar por edificio específico |
| `period` | string | No | `CURRENT_MONTH` | Período de análisis |

### Headers Requeridos
```
Authorization: Bearer <jwt>
X-Tenant-Id: <tenant_id> (del JWT)
```

### Response Schema
```json
{
  "kpis": {
    "outstandingAmount": 1250000,
    "collectedAmount": 980000,
    "collectionRate": 0.783,
    "delinquentUnits": 18
  },
  "queues": {
    "tickets": {
      "open": 12,
      "inProgress": 5,
      "overdue": 3,
      "top": [
        {
          "id": "uuid",
          "title": "Título del ticket",
          "status": "OPEN",
          "buildingId": "uuid",
          "buildingName": "Torre A",
          "createdAt": "2026-03-24T10:00:00Z"
        }
      ]
    },
    "paymentsToValidate": {
      "count": 4,
      "top": [
        {
          "id": "uuid",
          "unitLabel": "Apt 101",
          "buildingName": "Torre A",
          "amount": 50000,
          "submittedAt": "2026-03-23T15:30:00Z"
        }
      ]
    },
    "unitsWithoutResponsible": {
      "count": 9,
      "top": [
        {
          "unitId": "uuid",
          "unitLabel": "Apt 205",
          "buildingId": "uuid",
          "buildingName": "Torre B"
        }
      ]
    }
  },
  "buildingAlerts": [
    {
      "buildingId": "uuid",
      "buildingName": "Torre A",
      "outstandingAmount": 500000,
      "overdueTickets": 2,
      "unitsWithoutResponsible": 3,
      "riskScore": "HIGH"
    }
  ],
  "quickActions": [
    "CREATE_CHARGE",
    "RECORD_PAYMENT",
    "INVITE_RESIDENT",
    "CREATE_TICKET",
    "SEND_ANNOUNCEMENT"
  ],
  "metadata": {
    "period": "CURRENT_MONTH",
    "buildingId": null,
    "generatedAt": "2026-03-24T12:00:00Z"
  }
}
```

---

## 6. Reglas de Cálculo

### KPI: Outstanding Amount
- Suma de todos los charges con status `PENDING` o `PARTIAL` del período.
- **Excluir:** charges con `canceledAt != null`.
- Fórmula: `SUM(charge.amount - SUM(allocations.amount WHERE payment.status = APPROVED))`

### KPI: Collected Amount
- Suma de payments con status `APPROVED` del período.
- Considerar `paidAt` o `validatedAt` para filtrar por período.

### KPI: Collection Rate
- `collectedAmount / totalChargesEmitted`
- Total charges emitidas = suma de todos los charges del período (sin importar status).

### KPI: Delinquent Units
- Cantidad de unidades con `outstandingAmount > 0` (al menos 1 charge impago).

### Queue: Tickets
- Filtrar por `period` (createdAt) o por `dueDate` para overdue.
- Top 5 ordenados por: overdue primero, luego por `createdAt` ascendente.

### Queue: Payments to Validate
- Solo payments con status `PENDING_VALIDATION`.
- Ordenados por `submittedAt` descendente.

### Queue: Units Without Responsible
- Units donde no existe `ResidentAssignment` con `is_primary = true` Y `deletedAt = null`.

---

## 7. Degradación por Módulo Ausente

Si el módulo de expensas/financial no está habilitado para el tenant:

```json
{
  "kpis": {
    "outstandingAmount": null,
    "collectedAmount": null,
    "collectionRate": null,
    "delinquentUnits": null,
    "_warning": "MODULE_NOT_CONFIGURED"
  },
  "queues": { ... },
  "buildingAlerts": [ ... ],
  "quickActions": [],
  "metadata": {
    "moduleStatus": "FINANCIAL_MODULE_DISABLED"
  }
}
```

En frontend: mostrar empty state guiado con CTA a configuración.

---

## 8. Permisos por Rol

| Widget | TENANT_OWNER | TENANT_ADMIN | OPERATOR | RESIDENT |
|--------|--------------|--------------|----------|----------|
| KPIs (finanzas) | ✅ | ✅ | ⚠️ (si permiso) | ❌ |
| Queue: Tickets | ✅ | ✅ | ✅ | ❌ |
| Queue: Pagos a validar | ✅ | ✅ | ❌ | ❌ |
| Queue: Units sin resp | ✅ | ✅ | ⚠️ (si permiso) | ❌ |
| Building Alerts | ✅ | ✅ | ⚠️ (si permiso) | ❌ |
| Quick Actions | ✅ | ✅ | ⚠️ (limitado) | ❌ |

---

## 9. Reglas de UI

### Filtros
- Sincronizar con URL: `?buildingId=uuid&period=CURRENT_MONTH`
- Preservar al navegar

### Estados Vacíos
| Escenario | Texto |
|-----------|-------|
| Sin deuda | "✅ No hay deuda pendiente" |
| Sin tickets vencidos | "✅ No hay tickets vencidos" |
| Sin unidades sin responsable | "✅ Todas las unidades tienen responsable" |
| Módulo financiero no disponible | "Configurá el módulo de cobranzas para ver métricas financieras" + CTA |

### Textos en Español (100%)
- Todos los labels, placeholders, CTAs, mensajes de error, empty states.

---

## 10. Performance y Cache

- **Target p95:** < 500ms
- **Cache:** React Query con staleTime 60s para summary
- **Invalidación:** on mutations (pago aprobado, ticket resuelto, etc.)

---

## 11. Supuestos

1. Existe tabla `Charge` con campos: `amount`, `status`, `dueDate`, `period`, `canceledAt`
2. Existe tabla `Payment` con campos: `amount`, `status`, `paidAt`, `validatedAt`, `submittedAt`
3. Existe tabla `PaymentAllocation` con relación a Charge y Payment
4. Existe tabla `Ticket` con campos: `status`, `dueDate`, `createdAt`
5. Existe tabla `Unit` con `label`, `buildingId`
6. Existe tabla `ResidentAssignment` con `unitId`, `memberId`, `is_primary`, `deletedAt`
7. Tenant tiene campo `timezone` (fallback: UTC)

---

**Documento generado:** 2026-03-24  
**Versión:** 1.0  
**Autor:** Tech Lead (BuildingOS)
