# Proposal: Production Readiness — Payment, Email, and AI Providers

## Intent

BuildingOS cannot launch without automated payments, email delivery, and reliable AI. Today payments require manual admin approval, emails silently fail, and AI falls back to a non-existent local Ollama. Integrate external providers for each gap, keeping existing manual flows.

## Scope

### In Scope
- **Payment Gateway**: Add MercadoPago or Stripe with webhook handlers. Preserve manual approval as fallback.
- **Production Email**: Replace `MAIL_PROVIDER="none"`. Enable invitations, password resets, payment notifications.
- **AI Provider Config**: Remove hardcoded `localhost:11434` fallbacks. Add provider selection (OpenAI/Opencode/Ollama) via env vars.

### Out of Scope
- Operational maturity (metrics, backups, runbooks) — post-launch work.
- Custom checkout UI.

## Capabilities

### New
- `payment-gateway`: Webhook handling, charge confirmation, provider abstraction.
- `email-delivery`: Provider-agnostic sending with delivery tracking.
- `ai-provider-config`: Runtime LLM selection and health checks.

### Modified
- None. Existing flows remain degraded.

## Approach

| Blocker | Implementation | Key Files |
|---------|---------------|-----------|
| Payments | `PaymentProvider` interface + adapter. Webhook handler. Update `finanzas.service.ts` to mark charges `PAID`. | `finanzas/payment-gateway/`, `webhooks/` |
| Email | `EmailProvider` interface + adapters. Route `email.service.ts` through configured provider. | `communications/email/`, `config.ts` |
| AI | Replace `AI_OLLAMA_URL` default with `null`. Add `AI_PROVIDER` enum. Update assistant and health services. | `assistant/`, `config.ts` |

## Affected Areas

| Area | Impact |
|------|--------|
| `apps/api/src/finanzas/` | New gateway module and webhooks |
| `apps/api/src/communications/` | Email routing and provider selection |
| `apps/api/src/assistant/` | LLM provider selection and health checks |
| `apps/api/src/config/` | New env vars for payment, email, AI |
| `prisma/schema.prisma` | Add `paymentProviderId` and `paymentStatus` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Webhook verification fails | Med | Use official SDKs, idempotency keys, log payloads |
| Email deliverability issues | Med | Warm up IPs, bounce handling, SPF/DKIM/DMARC |
| AI provider rate limits | Med | Circuit breaker with graceful fallback |
| Credential leaks | Low | Docker secrets/vault; never commit keys |

## Rollback Plan

1. **Payments**: Disable webhooks via `ENABLE_PAYMENT_WEBHOOKS=false`. Revert to manual approval.
2. **Email**: Set `MAIL_PROVIDER="none"` to restore no-op.
3. **AI**: Set `AI_PROVIDER="none"` to disable assistant gracefully.

## Dependencies

- MercadoPago/Stripe account and API keys.
- Resend/SMTP/SES credentials and verified domain.
- OpenAI/Opencode API keys (if external LLM).

## Success Criteria

- [ ] Payment webhook confirms a test charge within 5 seconds.
- [ ] Invitation email sent and received within 60 seconds.
- [ ] AI assistant responds correctly using external provider.
- [ ] Each feature can be disabled independently via env vars without crashing.
- [ ] All 569 existing tests pass; new webhook and email tests added.
