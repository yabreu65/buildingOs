# Phase 0 Baseline Status

Date: 2026-07-11
Scope: read-only baseline verification for hardening risks.

## Commands Run
- `rtk git status --short || git status --short`
- `rg -n '"(lint|test|dev|start)"' package.json apps/web/package.json apps/api/package.json`
- `rg -n --hidden --glob '!node_modules' --glob '!.git' '/metrics|metrics' apps/api infra apps/web | head -120`
- `rg -n --hidden --glob '!node_modules' --glob '!.git' 'liquidation|Liquidation' apps/api apps/web | head -200`
- `sed -n '1,160p' apps/api/src/observability/metrics.controller.ts`
- `sed -n '1,160p' apps/api/src/observability/observability.module.ts`
- `sed -n '1,220p' apps/api/src/finanzas/payment-gateway/webhooks/payment-webhook.controller.ts`
- `sed -n '1,160p' apps/api/src/finanzas/payment-gateway/webhooks/signature.guard.ts`
- `sed -n '1,220p' apps/api/src/finanzas/payment-gateway/adapters/mercadopago.adapter.ts`
- `sed -n '1,180p' apps/api/src/finanzas/payment-gateway/adapters/stripe.adapter.ts`
- `sed -n '1,180p' apps/api/src/finanzas/payment-gateway/payment-gateway.service.ts`
- `sed -n '1,220p' apps/api/src/finanzas/liquidations.controller.ts`
- `sed -n '1,240p' apps/api/src/finanzas/liquidation-engine.controller.ts`
- `sed -n '1,220p' apps/web/features/payments/payments.storage.ts`
- `sed -n '1,200p' apps/web/features/units/units.mock.ts`
- `sed -n '1,220p' apps/web/features/assistant/services/analytics.api.ts`
- `sed -n '1,180p' 'apps/web/app/(public)/demo/page.tsx'`
- `sed -n '1,200p' 'apps/web/app/(public)/login/page.tsx'`
- `sed -n '1,180p' 'apps/web/app/(tenant)/[tenantId]/reports/page.tsx'`
- `bash -n scripts/backup-db.sh && bash -n scripts/restore-db.sh`
- `npm run lint --workspace apps/web`

## Confirmed Risks
- **Web lint failures are real.** `npm run lint --workspace apps/web` failed with `✖ 250 problems (92 errors, 158 warnings)`. Representative failures include hook-order violations in `apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/reports/page.tsx`, `any` usage in `apps/web/features/assistant/services/analytics.api.ts`, and `setState` inside effects in multiple layout/hooks files.
- **Legacy liquidation endpoint is still present.** `apps/api/src/finanzas/liquidations.controller.ts` exposes `POST/GET /tenants/:tenantId/finance/liquidations/...`, while `apps/api/src/finanzas/liquidation-engine.controller.ts` still exposes the older `POST/PATCH /tenants/:tenantId/liquidations/...` flow.
- **`/metrics` is publicly exposed.** `apps/api/src/observability/metrics.controller.ts` defines `@Controller()` + `@Get('metrics')` with no guard; `apps/api/src/observability/observability.module.ts` registers it globally.
- **Webhook signature handling is inconsistent.** `apps/api/src/finanzas/payment-gateway/webhooks/signature.guard.ts` only checks that `x-signature` exists. MercadoPago then performs HMAC verification in `mercadopago.adapter.ts`, but `stripe.adapter.ts` ignores the signature argument entirely, so the overall webhook signature story is not uniform.
- **No-op / mock frontend paths exist.** Examples: `apps/web/features/payments/payments.storage.ts` persists payments to `localStorage`; `apps/web/features/units/units.mock.ts` seeds fixed mock units; `apps/web/app/(tenant)/[tenantId]/reports/page.tsx` still uses `alert('Export feature coming soon')`.
- **Demo flow is controlled but reciprocal.** `/demo` links to `/login?demo=true`, and the login page links back to `/demo` and `/demo-guiada`. I did not reproduce an automatic redirect loop; it is a user-navigation loop, not a code-driven redirect loop.
- **Backup/restore scripts look ready at the syntax level.** `bash -n` passed for both scripts, and the scripts include safety checks, checksum validation, and restore gating. Runtime readiness is still unverified because it depends on `DATABASE_URL` plus PostgreSQL client tools.

## Not Reproduced / Unverified
- **Production runtime exposure of `/metrics`** was not probed over HTTP; this baseline only confirms the code path exists and is unguarded.
- **Webhook delivery end-to-end** was not exercised against a provider; validation here is code-level only.
- **Backup and restore live execution** was not attempted; only shell syntax and script structure were checked.
- **Demo flow** was not tested interactively in the browser; only static route/code inspection was done.

## False Positives
- The suspected **demo loop** is not an infinite redirect in the code I inspected. It is a reciprocal set of links and help copy.
- The suspected **webhook signature gap** is not total: MercadoPago does validate signatures. The real issue is inconsistent enforcement across providers, especially Stripe.

## Changes Completed Since Baseline
- Disabled the legacy liquidation controller registration in `apps/api/src/finanzas/finanzas.module.ts`.
- Switched the liquidation modal and draft-card UI to the hardened expense-ledger hooks.
- Removed the legacy liquidation hook file: `apps/web/features/finance/hooks/useLiquidation.ts`.
- Removed the legacy liquidation API client section from `apps/web/features/finance/services/liquidation.api.ts` while keeping `unitGroupApi` and `allocationApi`.
- Replaced the web Jest allowlist with convention-based discovery for `*.test.ts`, `*.test.tsx`, `*.spec.ts`, and `*.spec.tsx`, while ignoring `tests/e2e/`.
- Updated stale web tests that assumed older assistant/super-admin copy and action maps.

## Validation Results
- `npm run test -w apps/web -- --runInBand --no-coverage --listTests` now lists `features/finance/services/expense-ledger.api.test.ts`.
- `npm run test -w apps/web -- --runInBand --no-coverage` passes: **19 suites / 196 tests**.
- `npm run test -w apps/api -- --listTests` lists `src/finanzas/finanzas.module.spec.ts`.
- `npm run test -w apps/api -- --runInBand --no-coverage` still has pre-existing non-finance failures in `assistant/assistant.service.spec.ts` unrelated to this block.
- `rtk git diff --check` passes.

## Phase 0 Next Steps
1. Triage and prioritize the lint failures into a small, reviewable fix set.
2. Continue the remaining hardening slices: any residual finance legacy cleanup, then lint triage.
3. Add/confirm auth or network gating for `/metrics` if it should not be public.
4. Normalize webhook verification so every provider path enforces a real signature check.
5. Replace or clearly isolate mock/localStorage frontend flows from production routes.
6. Run a live backup/restore smoke test in a safe environment once database credentials and client tools are available.
