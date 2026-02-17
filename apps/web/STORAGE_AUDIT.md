# Auditoría de Storage (LocalStorage)

**Fecha:** 2026-02-09
**Objetivo:** Estandarizar el uso de localStorage en `apps/web` bajo la convención `bo_<feature>_<tenantId>` y asegurar reactividad con `emitBoStorageChange`.

## 1. Resumen de Hallazgos

Se detectaron las siguientes features interactuando con `localStorage`:

| Feature | Key Pattern | Archivo Storage | Estado | Acciones Requeridas |
| :--- | :--- | :--- | :--- | :--- |
| **Payments** | `bo_payments_<tenantId>` | `features/payments/payments.storage.ts` | ✅ OK | Ninguna. |
| **Properties** | `bo_properties_<tenantId>` | `features/properties/properties.storage.ts` | ✅ OK | Ninguna. |
| **Banking** | `bo_bank_accounts_<tenantId>` | `features/banking/banking.storage.ts` | ✅ OK | Ninguna. |
| **Units** | `bo_units_<tenantId>` | ❌ No existe | ⚠️ Faltante | Crear `units.storage.ts`. |
| **Marketing (Leads)** | `bo_leads` | ❌ No existe | ⚠️ Directo en UI | Crear `marketing.storage.ts` y refactorizar `CtaForm.tsx`. |
| **Auth (Session)** | `bo_session`, `bo_last_tenant`, `bo_token` | `features/auth/session.storage.ts` | ⚠️ Incompleto | Agregar `emitBoStorageChange`. Centralizar accesos dispersos (`Topbar`, `Login`). |
| **Onboarding** | Varios (`bo_*`) | N/A (Consumidor) | ⚠️ No reactivo | Implementar `useBoStorageTick()` para live-updates. |

## 2. Detalles por Feature

### Units
- **Uso actual:** Referenciado en `OnboardingChecklist` como `bo_units_<tenantId>`.
- **Problema:** No existe archivo de storage. No hay lógica centralizada de escritura.
- **Solución:** Crear `apps/web/features/units/units.storage.ts`.

### Marketing (Leads)
- **Uso actual:** `CtaForm.tsx` escribe directamente en `bo_leads`.
- **Problema:** Lógica de negocio en componente UI. Tipado manual.
- **Solución:** Mover a `apps/web/features/marketing/marketing.storage.ts`.

### Auth (Session)
- **Uso actual:** `session.storage.ts` existe, pero hay accesos directos en `Topbar.tsx`, `login/page.tsx`, `tenant.hooks.ts`, `login.actions.ts`.
- **Problema:** Código duplicado, riesgo de inconsistencia. No emite eventos de cambio.
- **Solución:** Centralizar todo en `session.storage.ts` y emitir eventos.

### Onboarding
- **Uso actual:** `OnboardingChecklist.tsx` lee localStorage directamente al renderizar.
- **Problema:** No se actualiza si el usuario completa un paso en otra pestaña o componente sin recargar.
- **Solución:** Usar hook `useBoStorageTick()` para forzar re-render ante cambios.

## 3. Plan de Acción

1.  Crear `units.storage.ts`.
2.  Crear `marketing.storage.ts`.
3.  Actualizar `session.storage.ts` (agregar `emitBoStorageChange`).
4.  Refactorizar consumidores de Auth (`Topbar`, `Login`, Actions, Hooks).
5.  Refactorizar `CtaForm` para usar `marketing.storage.ts`.
6.  Actualizar `OnboardingChecklist` con `useBoStorageTick`.

## 4. Estado Final (Post-normalización)

| Feature | Key Pattern | Archivo Storage | Estado |
| :--- | :--- | :--- | :--- |
| Payments | `bo_payments_<tenantId>` | `features/payments/payments.storage.ts` | ✅ OK |
| Properties | `bo_properties_<tenantId>` | `features/properties/properties.storage.ts` | ✅ OK |
| Banking | `bo_bank_accounts_<tenantId>` | `features/banking/banking.storage.ts` | ✅ OK |
| Units | `bo_units_<tenantId>` | `features/units/units.storage.ts` | ✅ OK |
| Marketing (Leads) | `bo_leads` | `features/marketing/marketing.storage.ts` | ✅ OK |
| Auth (Session) | `bo_session`, `bo_last_tenant`, `bo_token` | `features/auth/session.storage.ts` | ✅ OK |
| Onboarding | consume `bo_*` | `features/onboarding/OnboardingChecklist.tsx` | ✅ OK (reactivo) |

## 5. Verificación

Ejecutar:

```bash
cd apps/web
grep -R "localStorage\." -n . | head -n 120
grep -R "\bany\b" -n . | head -n 80
