# Design: Production Readiness — Payment, Email, and AI Providers

## Technical Approach

Integrate three independent provider-abstraction modules into the existing NestJS architecture. Each follows the same pattern: a provider `interface` + adapter implementations, a DynamicModule that registers the active provider at startup, and graceful degradation when no provider is configured. Existing manual flows remain untouched.

## Architecture Decisions

### Decision: DynamicModule with `register()` for provider selection

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `forRoot()` static | Simple but hard to test — always one provider | Rejected |
| `register(config)` DynamicModule | Selects provider at startup; easily mocked in tests | **Chosen** |
| Config-driven factory | Implicit, harder to trace which provider is active | Rejected |

**Rationale**: NestJS DynamicModule with `register()` enables swapping adapters via env vars at bootstrap while keeping providers injectable and mockable. Follows existing patterns in the codebase (ConfigModule).

### Decision: Interface-based adapters, not abstract classes

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Abstract class | Forces shared logic but couples adapters | Rejected |
| `interface` (NestJS `@Injectable()`) | Loose coupling, easy mocking, follows existing `AiProvider` pattern | **Chosen** |

**Rationale**: The codebase already defines `AiProvider` as an interface in `ai.types.ts`. Using interfaces enables clean mocks in Jest tests and avoids inheritance coupling.

### Decision: Redis-first idempotency with DB fallback

| Option | Tradeoff | Decision |
|--------|----------|----------|
| DB-only | Durable but slower under webhook bursts | Rejected |
| Redis + DB | Fast lookup with TTL, DB for permanent record | **Chosen** |

**Rationale**: Redis is already required in production (config validation enforces it). Webhook idempotency keys get Redis SETNX with 72h TTL, and processed event IDs are also stored in a `ProcessedWebhookEvent` Prisma model for audit.

## Module Structure

```
apps/api/src/
├── finanzas/payment-gateway/
│   ├── interfaces/payment-provider.interface.ts
│   ├── adapters/mercadopago.adapter.ts
│   ├── adapters/stripe.adapter.ts
│   ├── payment-gateway.module.ts           (DynamicModule)
│   ├── payment-gateway.service.ts
│   └── webhooks/payment-webhook.controller.ts
├── communications/email/
│   ├── interfaces/email-provider.interface.ts
│   ├── adapters/resend.adapter.ts
│   ├── adapters/smtp.adapter.ts
│   ├── adapters/ses.adapter.ts
│   ├── adapters/noop.adapter.ts
│   ├── email-delivery.module.ts            (DynamicModule)
│   ├── email-retry.interceptor.ts
│   └── webhooks/email-bounce.controller.ts
├── assistant/providers/
│   ├── ai-provider.interface.ts            (extends existing AiProvider)
│   ├── adapters/openai.adapter.ts
│   ├── adapters/opencode.adapter.ts
│   ├── adapters/ollama.adapter.ts
│   ├── ai-provider.module.ts               (DynamicModule)
│   ├── circuit-breaker.ts                  (state machine)
│   └── ai-health.controller.ts
```

## Interface Definitions

```typescript
// Payment
interface PaymentProvider {
  createPreference(charge: CreatePreferenceInput): Promise<PaymentPreference>;
  handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent>;
  getChargeStatus(externalId: string): Promise<PaymentStatus>;
}

// Email
interface EmailProvider {
  send(options: SendEmailInput): Promise<SendResult>;
  getDeliveryStatus(externalId: string): Promise<DeliveryStatus>;
  handleBounce(payload: unknown): Promise<void>;
}

// AI (extends existing AiProvider.chat)
interface AiProviderConfig {
  chat(message: string, context: AiProviderContext, options?: { model?: string; maxTokens?: number }): Promise<ChatResponse>;
  healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unavailable' }>;
}
```

## Data Model Changes (Prisma)

```prisma
model PaymentProviderConfig {
  id          String   @id @default(cuid())
  tenantId    String
  provider    String   // mercadopago | stripe
  credentials String   // encrypted JSON
  enabled     Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([tenantId, provider])
}

// Add to Charge:
//   paymentProviderId   String?
//   paymentExternalId   String?   (provider's charge/preference ID)

// Add to Payment:
//   paymentEventId      String?   (webhook idempotency key)

model ProcessedWebhookEvent {
  id          String   @id @default(cuid())
  eventId     String   // provider's event ID
  provider    String
  processedAt DateTime @default(now())

  @@unique([eventId, provider])
}

model EmailDelivery {
  id          String   @id @default(cuid())
  tenantId    String
  messageId   String
  to          String
  subject     String
  status      String   // queued | sent | delivered | bounced | failed
  provider    String
  externalId  String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([tenantId, status])
}
```

## Config Changes (env vars + Zod)

| Var | Type | Default | Module |
|-----|------|---------|--------|
| `PAYMENT_PROVIDER` | `mercadopago` \| `stripe` \| `none` | `none` | Payment |
| `MERCADOPAGO_ACCESS_TOKEN` | string | — | Payment |
| `STRIPE_SECRET_KEY` | string | — | Payment |
| `ENABLE_PAYMENT_WEBHOOKS` | boolean | `false` | Payment |
| `MAIL_PROVIDER` | `resend` \| `smtp` \| `ses` \| `none` | `none` | Email |
| `SES_REGION` | string | — | Email |
| `SES_ACCESS_KEY` | string | — | Email |
| `SES_SECRET_KEY` | string | — | Email |
| `AI_PROVIDER` | `openai` \| `opencode` \| `ollama` \| `none` | `none` | AI |
| `AI_OLLAMA_URL` | string (nullable) | `null` | AI |
| `OPENAI_API_KEY` | string | — | AI |

Zod `superRefine` additions: require `AI_OLLAMA_URL` when `AI_PROVIDER=ollama`; require credentials for each provider when selected; production must not have `PAYMENT_PROVIDER=none`.

## Sequence Diagrams

### Payment Webhook Flow

```
MercadoPago ──POST /webhooks/payment──▶ PaymentWebhookController
                                            │
                                   ┌────────▼────────┐
                                   │ Signature Guard  │──invalid──▶ 401
                                   └────────┬────────┘
                                            │ valid
                                   ┌────────▼────────┐
                                   │ IdempotencyCheck│──duplicate──▶ 200
                                   └────────┬────────┘
                                            │ new
                                   ┌────────▼────────┐
                                   │ PaymentGateway  │
                                   │ Service         │
                                   │ .confirmCharge()│
                                   └────────┬────────┘
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                         Charge→PAID   Record Event   Notify Tenant
```

### Email Send Flow

```
Caller ──emailService.send()──▶ EmailProvider.send()
                                    │
                            ┌───────▼────────┐
                            │ RetryInterceptor│──transient──▶ retry (×3, exp backoff)
                            └───────┬────────┘
                                    │ permanent / success
                            ┌───────▼────────┐
                            │ EmailDelivery  │
                            │ .create(status)│
                            └────────────────┘
```

### AI Fallback Flow

```
AssistantService.chat()
        │
        ▼
AiProviderModule.getProvider()
        │
        ├── healthy ──▶ provider.chat() ──▶ response
        │
        └── circuit open ──▶ "AI temporarily unavailable"
                             (circuit-breaker checks health every 30s)
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Adapters | Mock provider SDKs; test interface contract compliance |
| Unit | Services | Mock adapters via provider tokens; test business logic |
| Unit | Guards | Mock request/headers; test signature validation paths |
| Integration | Webhook e2e | Supertest with mock provider payloads; verify status transitions |
| Integration | Email e2e | Supertest; verify EmailDelivery records created |
| E2E | Full flows | Existing 569 tests must pass + ~30 new tests across 3 modules |

## Open Questions

- [ ] Should `PaymentProviderConfig.credentials` use column-level encryption or an external vault? Column-level `crypto.createCipheriv` is simpler; vault requires infra.
- [ ] Which MercadoPago SDK version? `mercadopago` npm package v2 uses ESM — verify NestJS compatibility or use REST API directly.
