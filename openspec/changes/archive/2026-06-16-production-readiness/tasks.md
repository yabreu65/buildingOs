# Tasks: Production Readiness — Payment, Email, and AI Providers

Estimated changed lines: ~2,000–2,500
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Work units: PR 1 (Foundation: migration + config + interfaces), PR 2 (Payment: 2 adapters + webhooks + idempotency), PR 3 (Email: 4 adapters + retry + tracking), PR 4 (AI: 3 adapters + circuit breaker + health), PR 5 (Integration: e2e + docs + full suite).

## Phase 1: Foundation

- [x] 1.1 **Prisma**: Add `PaymentProviderConfig`, `ProcessedWebhookEvent`, `EmailDelivery` models; add `paymentProviderId`/`paymentExternalId` to Charge; add `paymentEventId` to Payment. Run migration.
- [x] 1.2 **Config**: Add `PAYMENT_PROVIDER`, `MERCADOPAGO_ACCESS_TOKEN`, `STRIPE_SECRET_KEY`, `ENABLE_PAYMENT_WEBHOOKS`, `SES_*`, `AI_PROVIDER`, `AI_OLLAMA_URL` (nullable, `null` default), `OPENAI_API_KEY`. SuperRefine conditional validation. Update `AppConfig` type.
- [x] 1.3 `finanzas/payment-gateway/interfaces/payment-provider.interface.ts` — createPreference/handleWebhook/getChargeStatus.
- [x] 1.4 `communications/email/interfaces/email-provider.interface.ts` — send/getDeliveryStatus/handleBounce.
- [x] 1.5 `ai.types.ts` — add healthCheck() to AiProvider, define AiProviderStatus type.

## Phase 2: Payment Gateway

- [x] 2.1 `adapters/mercadopago.adapter.ts` — implement PaymentProvider via SDK.
- [x] 2.2 `adapters/stripe.adapter.ts` — implement PaymentProvider via SDK.
- [x] 2.3 `payment-gateway.service.ts` — delegates to active adapter.
- [x] 2.4 `payment-gateway.module.ts` — DynamicModule with register(); selects adapter from PAYMENT_PROVIDER.
- [x] 2.5 `webhooks/signature.guard.ts` — validates provider signature; invalid→401.
- [x] 2.6 `webhooks/idempotency.service.ts` — Redis SETNX 72h TTL + DB ProcessedWebhookEvent fallback.
- [x] 2.7 `webhooks/payment-webhook.controller.ts` — POST /webhooks/payment; disabled env→503.
- [x] 2.8 Wire PaymentGatewayModule into FinanzasModule; update finanzas.service to confirmCharge on webhook.

## Phase 3: Email Delivery

- [x] 3.1 Extract SMTP from EmailService → `adapters/smtp.adapter.ts`. Create resend, ses (new), noop adapters implementing EmailProvider.
- [x] 3.2 `email-delivery.module.ts` — DynamicModule; selects adapter from MAIL_PROVIDER.
- [x] 3.3 `email-retry.interceptor.ts` — 3 retries exp backoff on 5xx; no retry on 4xx.
- [x] 3.4 **Delivery tracking** — service creating EmailDelivery records: queued→sent→delivered→bounced→failed.
- [x] 3.5 `webhooks/email-bounce.controller.ts` — processes bounce, flags user, marks bounced.
- [x] 3.6 Wire into CommunicationsModule; route sends through EmailDeliveryModule.

## Phase 4: AI Provider Config

- [x] 4.1 Remove hardcoded `localhost:11434` defaults from all assistant files; startup fails if ollama selected without URL.
- [x] 4.2 `providers/adapters/openai.adapter.ts` — chat + healthCheck.
- [x] 4.3 `providers/adapters/opencode.adapter.ts` — chat + healthCheck.
- [x] 4.4 Move `ollama.provider.ts` → `providers/adapters/ollama.adapter.ts`. Add healthCheck(). Remove inline OpenAI fallback.
- [x] 4.5 `providers/circuit-breaker.ts` — trips after 3 failures; recovers after health check.
- [x] 4.6 `providers/ai-provider.module.ts` — DynamicModule; wraps adapter in circuit breaker.
- [x] 4.7 Refactor llm-health controller/service to use AiProviderStatus through adapter healthCheck().
- [x] 4.8 Wire AiProviderModule into AssistantModule; remove hardcoded OllamaProvider/MockAiProvider refs.

## Phase 5: Integration & Verification

- [x] 5.1 E2E payment: charge→mock webhook→PAID + ProcessedWebhookEvent created.
- [x] 5.2 E2E email: send→EmailDelivery queued record created.
- [x] 5.3 E2E AI: AI_PROVIDER=none→assistant returns "not configured".
- [x] 5.4 Config validation test: superRefine rejects missing credentials.
- [x] 5.5 Full suite: all 573 existing + 116 new tests pass (689 total).
- [x] 5.6 Update .env.example; document rollback env vars.