# BuildingOS Cron Catalog (Control Manual)

Catalogo operativo de cronjobs existentes en `apps/api`.

Objetivo: que el administrador del condominio active y ejecute automatizaciones de forma explicita (opt-in), sin decisiones automaticas por defecto.

## Politica vigente

- Todos los cronjobs de `CronJobsService` estan desactivados por defecto y dependen de flags de entorno.
- Los triggers manuales por API solo funcionan en dev/staging, con autenticacion JWT, rol admin y flag explicito.

## Cronjobs en `CronJobsService`

| Job | Cron | Metodo | Flag env | Default |
| --- | --- | --- | --- | --- |
| Dispatch scheduled communications | `EVERY_5_MINUTES` | `dispatchScheduledCommunications()` | `ENABLE_CRON_SCHEDULED_COMMUNICATIONS` | `false` |
| Detect overdue charges | `0 9 * * *` | `detectAndNotifyOverdueCharges()` | `ENABLE_CRON_OVERDUE_CHARGES` | `false` |
| Auto-create expense periods | `0 8 1 * *` | `autoCreateMonthlyExpensePeriods()` | `ENABLE_CRON_AUTO_EXPENSE_PERIODS` | `false` |
| Send payment reminders | `0 10 * * *` | `sendPaymentReminders()` | `ENABLE_CRON_PAYMENT_REMINDERS` | `false` |
| Escalate urgent tickets | `0 * * * *` | `escalateUrgentTickets()` | `ENABLE_CRON_TICKET_ESCALATION` | `false` |
| Process recurring expenses | `0 6 * * *` | `processRecurringExpenses()` | `ENABLE_CRON_RECURRING_EXPENSES` | `false` |
| Send monthly finance summaries | `0 1 1 * *` | `sendMonthlyFinanceSummaries()` | `ENABLE_CRON_MONTHLY_FINANCE_SUMMARY` | `false` |

Referencia: `apps/api/src/shared/scheduling/cron-jobs.service.ts`.

## Triggers manuales (API)

Base route: `POST /buildings/:buildingId/automation/cron-triggers/*`

Endpoints:

- `scheduled-communications`
- `overdue-charges`
- `expense-periods`
- `payment-reminders`
- `urgent-ticket-escalation`
- `recurring-expenses`
- `monthly-finance-summary`

Guardas y requisitos:

- `JwtAuthGuard` activo.
- Solo `SUPER_ADMIN`, `TENANT_OWNER`, `TENANT_ADMIN`.
- Solo en `development` o `staging`.
- Flag requerido: `ENABLE_MANUAL_CRON_TRIGGERS=true`.

Referencia: `apps/api/src/shared/scheduling/cron-jobs-trigger.controller.ts`.

## Cron adicional fuera de `CronJobsService`

Existe un cron de invitaciones que no usa los flags anteriores:

- Job: `markExpiredInvitations()`
- Cron: `EVERY_5_MINUTES`
- Ubicacion: `apps/api/src/invitations/invitations.service.ts`
- Funcion: marcar invitaciones vencidas como `EXPIRED`.

Nota: este job no expone trigger manual en `cron-triggers` y no esta gobernado por los flags `ENABLE_CRON_*` de `CronJobsService`.

## Ejemplo de configuracion opt-in (.env)

```env
# habilitacion de triggers manuales (solo dev/staging)
ENABLE_MANUAL_CRON_TRIGGERS=true

# cronjobs (todos apagados por default; activar uno por uno)
ENABLE_CRON_SCHEDULED_COMMUNICATIONS=false
ENABLE_CRON_OVERDUE_CHARGES=false
ENABLE_CRON_AUTO_EXPENSE_PERIODS=false
ENABLE_CRON_PAYMENT_REMINDERS=false
ENABLE_CRON_TICKET_ESCALATION=false
ENABLE_CRON_RECURRING_EXPENSES=false
ENABLE_CRON_MONTHLY_FINANCE_SUMMARY=false
```

## Recomendacion operativa

- Mantener todo en `false` por defecto.
- Activar por ventana controlada y owner responsable.
- Ejecutar primero por trigger manual antes de habilitar schedule continuo.
