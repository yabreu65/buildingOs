# Design: Integración Pasarela de Pagos Online (MP/MercadoPago)

## Technical Approach

Extend the existing `FinanzasModule` with an online payment gateway subsystem. The approach leverages NestJS dependency injection to abstract provider details behind a `PaymentGatewayAdapter` interface, keeping MercadoPago specifics in a swappable adapter. The design adds:

1. **Gateway Adapter Layer** — Abstract interface + MercadoPago concrete implementation
2. **Tenant Configuration Service** — CRUD for encrypted gateway credentials per tenant
3. **Checkout Service** — Orchestrates payment intent → checkout URL → payment record creation
4. **Webhook Handler** — Stateless, idempotent endpoint for provider callbacks
5. **Schema Extensions** — Minimal Prisma changes for gateway config and payment enrichment

## Architecture Decisions

### Decision: Adapter Pattern over Direct SDK Calls

**Choice**: Abstract provider interactions behind a `PaymentGatewayAdapter` interface.  
**Alternatives**: Direct MP SDK calls scattered in services.  
**Rationale**: Keeps provider-specific code isolated; enables future addition of Stripe/Modo without touching checkout/webhook logic. Aligns with existing NestJS DI patterns.

### Decision: Encrypted Credential Storage (AES-256-GCM)

**Choice**: Store API keys encrypted in `TenantGatewayConfig` using a server-side `GATEWAY_ENCRYPTION_KEY`.  
**Alternatives**: Environment variables per tenant (not scalable), plaintext in DB (security risk).  
**Rationale**: Multi-tenant SaaS requirement; credentials must survive backups without exposure. AES-256-GCM provides confidentiality + authenticity. NestJS `ConfigService` provides the master key.

### Decision: Webhooks as Public Stateless Endpoints

**Choice**: Expose `POST /webhooks/payments/:provider` without JWT, validating requests via provider signature.  
**Alternatives**: Authenticated webhooks (impossible for external providers), polling (latency, cost).  
**Rationale**: Provider architecture constraint. Signature validation + idempotency keys prevent replay attacks.

### Decision: Idempotency via External Payment ID

**Choice**: Use provider’s external payment ID as idempotency key; store in `Payment.externalPaymentId`.  
**Alternatives**: UUID generation (loses traceability), composite keys (complex).  
**Rationale**: Simple, provider-native, survives retries and replays.

## Data Flow

### Checkout Flow

```
Resident/Browser
    │
    ▼
POST /tenants/:tenantId/buildings/:buildingId/finanzas/checkout
    │ (JWT + TenantAccessGuard + BuildingAccessGuard)
    ▼
CheckoutService
    │
    ├──► TenantGatewayConfigService (get config for tenant)
    │         │
    │         ▼
    │    Decrypt credentials
    │         │
    │         ▼
    ├──► PaymentGatewayAdapter (MercadoPagoAdapter)
    │         │
    │         ▼
    │    POST /v1/payment_intents (or preference)
    │         │
    │         ▼
    │    Return checkoutUrl + externalPaymentId
    │
    ▼
Prisma: Create Payment (status=PENDING, method=ONLINE)
    │
    ▼
Return { checkoutUrl, paymentId }
```

### Webhook Flow

```
MercadoPago
    │
    ▼
POST /webhooks/payments/mercadopago
    │ (No JWT — SignatureGuard)
    ▼
WebhookController
    │
    ▼
WebhookService
    │
    ├──► Verify signature (HMAC/MP-specific)
    │
    ├──► Extract externalPaymentId
    │
    ├──► Lookup Payment by externalPaymentId
    │
    ├──► Idempotency check (skip if already processed)
    │
    ├──► Map provider status → PaymentStatus
    │
    ├──► Update Payment.status (+ timestamps)
    │
    ├──► If APPROVED → trigger allocation (reuse existing logic)
    │
    └──► Audit log entry
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modify | Add `TenantGatewayConfig` model; add `externalPaymentId`, `gatewayResponse` to `Payment`; add `ONLINE` to `PaymentMethod` if missing |
| `src/gateway/gateway.module.ts` | Create | New module registering adapter and services |
| `src/gateway/gateway.service.ts` | Create | Orchestrates checkout creation, delegates to adapter |
| `src/gateway/gateway.adapter.ts` | Create | `PaymentGatewayAdapter` interface |
| `src/gateway/mercadopago.adapter.ts` | Create | MercadoPago SDK integration |
| `src/gateway/gateway.config.service.ts` | Create | Encrypt/decrypt and CRUD tenant configs |
| `src/gateway/gateway.controller.ts` | Create | `POST /checkout` endpoint |
| `src/gateway/webhook.controller.ts` | Create | `POST /webhooks/payments/:provider` endpoint |
| `src/gateway/webhook.service.ts` | Create | Signature validation, idempotency, status mapping |
| `src/gateway/gateway.dto.ts` | Create | DTOs for checkout request/response, config CRUD |
| `src/gateway/gateway.guard.ts` | Create | `WebhookSignatureGuard` for provider HMAC validation |
| `src/finanzas/finanzas.module.ts` | Modify | Import `GatewayModule`; add `GatewayService` to providers/exports if needed |
| `src/finanzas/finanzas.controller.ts` | Modify | Add `POST /checkout` route (or keep in GatewayController) |
| `src/app.module.ts` | Modify | Import `GatewayModule` |
| `test/gateway/gateway.service.spec.ts` | Create | Unit tests for checkout orchestration |
| `test/gateway/mercadopago.adapter.spec.ts` | Create | Unit tests with mocked MP SDK |
| `test/gateway/webhook.service.spec.ts` | Create | Unit tests for signature validation + idempotency |

## Interfaces / Contracts

### PaymentGatewayAdapter

```typescript
export interface PaymentGatewayAdapter {
  readonly provider: string;

  createCheckoutSession(params: {
    amount: number;
    currency: string;
    description: string;
    externalReference: string;
    credentials: DecryptedCredentials;
  }): Promise<{ checkoutUrl: string; externalPaymentId: string }>;

  verifyWebhookSignature(
    payload: unknown,
    signature: string,
    secret: string,
  ): boolean;

  mapProviderStatusToPaymentStatus(providerStatus: string): PaymentStatus;
}
```

### Checkout Response DTO

```typescript
export class CheckoutResponseDto {
  paymentId!: string;
  checkoutUrl!: string;
  externalPaymentId!: string;
  expiresAt?: string;
}
```

### Webhook Payload Type (example)

```typescript
export interface MercadoPagoWebhookPayload {
  data: {
    id: string; // externalPaymentId
    status: string;
    /* ...other MP fields */
  };
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Adapter methods | Mock MP SDK; test URL generation, signature verification, status mapping |
| Unit | GatewayService | Mock adapter + Prisma; test checkout flow, error handling |
| Unit | WebhookService | Mock adapter; test idempotency, signature failure, status transitions |
| Integration | Prisma schema changes | Migration dry-run; verify new fields and constraints |
| E2E | Full checkout + webhook | Use MP sandbox/test credentials; assert payment record transitions PENDING → APPROVED |

## Migration / Rollout

1. **Schema Migration**: Prisma migration adding `TenantGatewayConfig` table and `Payment` columns. Zero-downtime (new columns nullable).
2. **Feature Flag**: `GATEWAY_CHECKOUT_ENABLED` env var. If false, checkout endpoint returns `501 Not Implemented`.
3. **Credential Seeding**: Backfill `TenantGatewayConfig` for pilot tenants via admin script.
4. **Webhook DNS**: Ensure `https://api.buildingos.com/webhooks/payments/mercadopago` is registered in MP dashboard before go-live.

## Open Questions

- [ ] **MercadoPago Product Choice**: Confirm whether to use MP **Payment Intent** (modern, redirect) or **Preference API** (legacy, simpler). Decision needed before adapter implementation.
- [ ] **Encryption Key Rotation**: Define rotation strategy for `GATEWAY_ENCRYPTION_KEY` without invalidating stored credentials.
- [ ] **Idempotency Scope**: Should idempotency also cover checkout creation (prevent duplicate checkout URLs for same charge), or only webhook processing?
- [ ] **Allocation Trigger**: Reuse existing `FinanzasService.approvePayment()` logic or create a new `autoAllocateOnlinePayment()` helper? Current `approvePayment` expects manual approval context.

---

## Implementation Notes

- **Existing Patterns to Follow**:
  - DTOs with `class-validator` decorators (`@IsString`, `@IsEnum`, etc.)
  - Guards: `JwtAuthGuard` → `TenantAccessGuard` → `BuildingAccessGuard` for authenticated routes
  - RBAC checks via `FinanzasValidators` (all authenticated users can submit payments)
  - Prisma transactions for multi-step writes (create config + audit log)
  - `ConflictException` for duplicate detection (pattern from `submitPayment`)

- **Dependencies to Add**:
  - `mercadopago` SDK (official Node.js SDK) or raw `axios` + `crypto` for HMAC
  - `crypto` (Node built-in) for AES-256-GCM encryption

- **Security Checklist**:
  - [ ] Encrypt `apiKey` and `accessToken` before DB write
  - [ ] Never log decrypted credentials
  - [ ] Webhook endpoint rejects unknown providers (404)
  - [ ] Webhook signature timeout/leeway configured (prevent replay windows)
