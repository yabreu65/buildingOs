# Automation QA Dashboard

This feature centralizes manual testing for the 15 automation scenarios defined in `AUTOMATION_PLAN.md`.

## Route

- `/{tenantId}/buildings/{buildingId}/automation-qa`

## What it includes

- 15 test cards with objective, action links, evidence links, and local status tracking.
- Optional manual cron triggers for dev/staging environments.
- Per-building persisted progress in local storage.

## Trigger endpoints (dev/staging only)

Base: `POST /buildings/:buildingId/automation/cron-triggers/:triggerKey`

Supported trigger keys:

- `scheduled-communications`
- `overdue-charges`
- `expense-periods`
- `payment-reminders`
- `urgent-ticket-escalation`
- `recurring-expenses`
- `monthly-finance-summary`

## Permissions

- Requires authenticated user with one of:
  - `TENANT_ADMIN`
  - `TENANT_OWNER`
  - `OPERATOR`

## Notes

- Trigger endpoints are blocked in production by design.
- `RecurringExpense` edit mode supports amount and concept updates according to backend DTO constraints.
