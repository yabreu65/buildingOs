# Merge Cleanup Report

Date: 2026-02-20

## 1) Conflictos resueltos
Se resolvieron conflictos de merge en:
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/seed.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/billing/billing.module.ts`
- `apps/api/src/super-admin/super-admin.controller.ts`

Verificación de markers:
- Comando: `rg -n "^(<<<<<<<|=======|>>>>>>>)" apps/api apps/web`
- Resultado: sin markers.

## 2) Decisiones de resolución
- Se tomó como base funcional la variante `ours` para evitar mezclar dos arquitecturas incompatibles de Prisma/Billing.
- Se incorporó `PlanChangeRequest` al schema actual (sin duplicar `BillingPlan`, `Subscription`, `AuditLog`).
- Se extendió `AuditAction` con:
  - `PLAN_CHANGE_REQUESTED`
  - `PLAN_CHANGE_REQUEST_CANCELED`
  - `PLAN_CHANGE_APPROVED`
  - `PLAN_CHANGE_REJECTED`
- Se consolidó `BillingModule` para incluir:
  - servicios previos de entitlements/features/payments
  - `BillingService` + `BillingController` para plan change requests
- Se consolidó `SuperAdminController` en un único controlador con:
  - rutas completas de super-admin existentes
  - rutas de plan-change (`/api/super-admin/plan-change-requests`)
  - alias de AI caps (`/api/super-admin/tenants/:tenantId/ai/caps`)
- Se ajustó `BillingService` al schema real (ranking por `BillingPlanId`, campos `entity/metadata` en `AuditLog`, `SubscriptionEvent.eventType`).
- Se ajustó migración `20260213120000_manual_plan_change_flow` para crear solo `PlanChangeRequest` y FKs/idempotencia, evitando recrear tablas existentes.

## 3) Cambios de estabilidad de build
- API:
  - regenerado Prisma Client tras cambios de schema
  - build exitoso
- Web:
  - removida dependencia de `next/font/google` en `apps/web/app/layout.tsx` para compilar en entorno sin acceso a Google Fonts
  - build exitoso

## 4) Comandos usados
- Estado y conflictos:
  - `git status`
  - `rg -n "^(<<<<<<<|=======|>>>>>>>)" apps/api apps/web`
- Prisma:
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' npx prisma validate --schema apps/api/prisma/schema.prisma`
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' npm run --prefix apps/api prisma:generate`
- Builds:
  - `npm run build --prefix apps/api`
  - `npm run build --prefix apps/web`
- Lint:
  - `npm run lint --prefix apps/api`
  - `npm run lint --prefix apps/web`
- DB dev checks:
  - `npm run --prefix apps/api migrate`
  - `npm run --prefix apps/api seed`

## 5) Resultados
- `apps/api` build: ✅ OK
- `apps/web` build: ✅ OK
- Merge markers: ✅ ninguno
- Lint API: ⚠️ no configurado (falla por falta de config de ESLint en `apps/api`)
- Lint Web: ⚠️ falla por deuda técnica preexistente (múltiples errores/warnings no relacionados a este merge cleanup)
- `migrate`/`seed`: ⚠️ no ejecutables en este entorno porque PostgreSQL local (`localhost:5432`) no está disponible

## 6) Notas operativas
- El repo queda sin conflictos de merge y compilando en API/Web.
- Para completar migración/seed localmente, iniciar PostgreSQL y reintentar:
  1. `npm run --prefix apps/api migrate`
  2. `npm run --prefix apps/api seed`
