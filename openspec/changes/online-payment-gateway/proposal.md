# Proposal: Online Payment Gateway Integration

## Intent

Enable residents to pay building charges online via credit/debit card by integrating a payment gateway (MercadoPago or Stripe). Today `PaymentMethod` includes `ONLINE` and `CARD` enums but all payments are manual transfer + receipt upload to MinIO, requiring admin manual approval. This change automates payment processing, status updates, and charge allocation via gateway webhooks.

## Scope

### In Scope
- Gateway adapter abstraction (MercadoPago primary, Stripe fallback)
- Tenant-scoped gateway configuration (credentials, provider selection)
- Backend checkout session creation and webhook handling
- Automatic payment approval and allocation on webhook confirmation
- Frontend payment initiation and result handling
- Prisma schema extensions for gateway tracking (`gatewayPaymentId`, `gatewayProvider`, `gatewayRawResponse`)
- Multi-tenant isolation for all gateway operations

### Out of Scope
- SaaS subscription billing gateway (separate `PaymentVerification` flow)
- Recurring auto-pay / scheduled payments
- Split payments across multiple cards
- Cryptocurrency or alternative payment methods
- Chargeback dispute management UI

## Capabilities

### New Capabilities
- `online-payment-gateway`: Checkout session creation, webhook confirmation, automatic allocation
- `tenant-gateway-config`: CRUD for tenant-scoped gateway credentials and provider selection
- `webhook-payment-confirmation`: Idempotent async processing of gateway payment events

### Modified Capabilities
- `payment-flow`: Extends `SubmitPaymentDto` to support `ONLINE`/`CARD` methods; bypasses manual approval for gateway-confirmed payments

## Approach

1. **Adapter Pattern**: `PaymentGatewayAdapter` interface with `MercadoPagoAdapter` and `StripeAdapter` implementations. Tenant configures provider + credentials.
2. **Checkout Flow**: Resident selects ONLINE → API creates gateway checkout session → returns redirect URL → resident completes payment on gateway → redirected back.
3. **Webhook Handler**: Exposed at `/webhooks/payments/:provider` (unauthenticated, provider-signed). Receives `payment.completed` → idempotently updates `Payment.status` to `APPROVED`, sets `paidAt`, triggers auto-allocation to oldest pending charges.
4. **Schema Changes**: Add `gatewayPaymentId`, `gatewayProvider`, `gatewayStatus`, `gatewayRawResponse` JSON to `Payment` model. New `GatewayConfig` model (tenant-scoped, encrypted credentials).
5. **Security**: Webhook endpoints validate provider signatures. Credentials stored encrypted (AES-256). No card data touches our servers (hosted checkout).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/prisma/schema.prisma` | Modified | Payment model extensions + new GatewayConfig model |
| `apps/api/src/finanzas/` | Modified | submitPayment creates checkout sessions; approvePayment handles auto-approval path |
| `apps/api/src/payments-gateway/` | New | Adapter interface, MercadoPago/Stripe adapters, webhook controller |
| `apps/api/src/billing/` | Modified | GatewayConfig service for tenant-scoped credentials |
| `apps/web/features/payments/` | Modified | Online payment flow, redirect handling, status polling |
| `.env` / infrastructure | New | Gateway API keys, webhook secrets |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Webhook delivery failures | Med | Store raw webhook payload, retry with exponential backoff, expose admin replay endpoint |
| Duplicate payment processing | Med | Idempotency via `gatewayPaymentId` UNIQUE constraint + idempotent status transitions |
| Credential leakage | Low | AES-256 encryption at rest, no logging of secrets, environment-only |
| Gateway API changes | Low | Adapter pattern isolates provider-specific logic |
| Resident confusion during redirect | Med | Clear UX with loading states, timeout handling, payment status polling |

## Rollback Plan

1. Disable `ONLINE`/`CARD` options in frontend (feature flag or enum filter).
2. Stop webhook endpoint processing (return 410 Gone).
3. Refund or manually allocate any unprocessed gateway payments.
4. Revert schema changes via Prisma migration rollback.
5. Clear tenant gateway configs (soft delete or disable flag).

## Dependencies

- MercadoPago/Stripe account and API credentials
- `mercadopago` or `stripe` npm package
- Environment variable encryption mechanism (or existing secret management)

## Success Criteria

- [ ] Resident can select "Pagar online" and complete card payment via hosted checkout
- [ ] Webhook confirmation automatically updates `Payment.status` to `APPROVED` and sets `paidAt`
- [ ] Auto-allocation creates `PaymentAllocation` records for oldest pending charges
- [ ] Admin can configure gateway provider and credentials per tenant
- [ ] Webhook handler is idempotent: same `gatewayPaymentId` processed only once
- [ ] All data remains scoped to `tenantId`; no cross-tenant leakage
- [ ] Unit and e2e tests pass for checkout flow, webhook, and allocation logic
