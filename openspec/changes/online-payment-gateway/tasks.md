# Tasks: Online Payment Gateway Integration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1200-1400 (13 new files, 3 modified, 3 test files) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Schema + Adapter Interface + Encryption → PR 2: Checkout Flow + MP Adapter → PR 3: Webhooks + Auto-Allocation → PR 4: Wiring + Tests |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema migration, adapter interface, encryption service | PR 1 | Foundation; no runtime behavior yet |
| 2 | Checkout service, MP adapter, DTOs, controller | PR 2 | Depends on PR 1; resident-facing flow |
| 3 | Webhook handler, signature guard, auto-allocation | PR 3 | Depends on PR 2; async confirmation path |
| 4 | Module wiring, integration tests, feature flag | PR 4 | Depends on PR 3; glues everything together |

## Phase 1: Schema + Foundation (PR 1)

- [ ] 1.1 Add `TenantGatewayConfig` model to `prisma/schema.prisma` with encrypted credential fields, provider enum, soft delete, and `@@unique([tenantId])` constraint
- [ ] 1.2 Add `gatewayPaymentId` (String, @unique), `gatewayProvider`, `gatewayStatus`, `gatewayRawResponse` (Json) fields to `Payment` model in `prisma/schema.prisma`
- [ ] 1.3 Run `npx prisma migrate dev` to generate and apply migration; verify zero-downtime (all new columns nullable)
- [ ] 1.4 Create `apps/api/src/gateway/gateway.adapter.ts` with `PaymentGatewayAdapter` interface (`provider`, `createCheckoutSession`, `verifyWebhookSignature`, `mapProviderStatusToPaymentStatus`)
- [ ] 1.5 Create `apps/api/src/gateway/gateway-crypto.service.ts` with AES-256-GCM `encrypt()` and `decrypt()` methods using `GATEWAY_ENCRYPTION_KEY` from `ConfigService`
- [ ] 1.6 Create `apps/api/src/gateway/gateway.module.ts` registering `GatewayCryptoService` and exporting adapter interface provider
- [ ] 1.7 Write unit test `apps/api/test/gateway/gateway-crypto.service.spec.ts` for encrypt/decrypt round-trip and key validation

## Phase 2: Tenant Config + Checkout Flow (PR 2)

- [ ] 2.1 Create `apps/api/src/gateway/gateway.dto.ts` with `CreateGatewayConfigDto`, `UpdateGatewayConfigDto`, `CheckoutRequestDto`, `CheckoutResponseDto` using `class-validator` decorators
- [ ] 2.2 Create `apps/api/src/gateway/gateway-config.service.ts` with CRUD for `TenantGatewayConfig`: create (encrypt + validate credentials), get (mask secrets), update, soft-delete; RBAC guard for `TENANT_ADMIN`/`TENANT_OWNER`
- [ ] 2.3 Create `apps/api/src/gateway/gateway-config.controller.ts` with `POST/GET/PATCH/DELETE /tenants/:tenantId/gateway-config` endpoints
- [ ] 2.4 Create `apps/api/src/gateway/mercadopago.adapter.ts` implementing `PaymentGatewayAdapter` with MP SDK integration for `createCheckoutSession` (preference API) and `verifyWebhookSignature`
- [ ] 2.5 Create `apps/api/src/gateway/gateway.service.ts` orchestrating checkout: resolve tenant config → decrypt credentials → delegate to adapter → create `Payment` record (SUBMITTED, ONLINE) → return `CheckoutResponseDto`
- [ ] 2.6 Create `apps/api/src/gateway/gateway.controller.ts` with `POST /tenants/:tenantId/buildings/:buildingId/finanzas/checkout` guarded by `JwtAuthGuard` + `TenantAccessGuard` + `BuildingAccessGuard`
- [ ] 2.7 Write unit test `apps/api/test/gateway/gateway-config.service.spec.ts` for CRUD, encryption, credential validation, and RBAC rejection
- [ ] 2.8 Write unit test `apps/api/test/gateway/mercadopago.adapter.spec.ts` with mocked MP SDK for checkout URL generation and signature verification

## Phase 3: Webhooks + Auto-Allocation (PR 3)

- [ ] 3.1 Create `apps/api/src/gateway/gateway.guard.ts` with `WebhookSignatureGuard` that validates provider HMAC/signature headers before route handler execution
- [ ] 3.2 Create `apps/api/src/gateway/webhook.service.ts` with idempotent processing: lookup by `gatewayPaymentId` → skip if APPROVED → map provider status → update Payment → store raw payload → audit log
- [ ] 3.3 Create `apps/api/src/gateway/webhook.controller.ts` with `POST /webhooks/payments/:provider` (no JWT, uses `WebhookSignatureGuard`), returns 200 within 5s, rejects unknown providers with 404
- [ ] 3.4 Add auto-allocation trigger in `webhook.service.ts`: when payment transitions to APPROVED, call existing `MovementAllocationService` to allocate to oldest pending charges (reuse existing logic)
- [ ] 3.5 Add `GATEWAY_CHECKOUT_ENABLED` feature flag check in `gateway.controller.ts`; return 501 if disabled
- [ ] 3.6 Write unit test `apps/api/test/gateway/webhook.service.spec.ts` covering: idempotency (duplicate webhook), signature failure, status mapping (approved/rejected/expired), unknown gatewayPaymentId, DB failure → 500
- [ ] 3.7 Write unit test `apps/api/test/gateway/gateway.service.spec.ts` for checkout orchestration: no config → 400, valid config → payment created + redirect URL returned, amount exceeds balance → 422

## Phase 4: Wiring + Integration (PR 4)

- [ ] 4.1 Modify `apps/api/src/finanzas/finanzas.module.ts` to import `GatewayModule`
- [ ] 4.2 Modify `apps/api/src/app.module.ts` to import `GatewayModule`
- [ ] 4.3 Add `gatewayPaymentId`, `gatewayProvider`, `gatewayStatus` fields to `PaymentDetailDto` interface in `apps/api/src/finanzas/finanzas.dto.ts`
- [ ] 4.4 Add `GET /tenants/:tenantId/buildings/:buildingId/finanzas/payments/:paymentId/status` polling endpoint in `gateway.controller.ts` for residents to check payment status after redirect
- [ ] 4.5 Create `apps/api/test/gateway/gateway.e2e-spec.ts` with full checkout → webhook → allocation flow using MP sandbox credentials (skip if no credentials in CI)
- [ ] 4.6 Run `npm run test -w apps/api` to verify all unit tests pass; run `npm run test:e2e -w apps/api` for e2e coverage
- [ ] 4.7 Run `npx prisma generate` and `npx tsc --noEmit -p apps/api/tsconfig.json` to verify type-checking
