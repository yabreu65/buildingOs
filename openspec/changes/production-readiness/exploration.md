# Production Readiness Audit — BuildingOS

## Verdict: CONDITIONAL

**Summary**: BuildingOS has a solid multi-tenant architecture with proper auth guards, Prisma migrations, CI/CD, and passing tests. However, several critical gaps prevent an immediate production launch: no payment provider integration, no production email configured, console.logs in production services, missing Next.js loading/error pages, and hardcoded local fallbacks in the AI assistant stack.

---

## Dimension Scores

| Dimension | Status | Critical Issues |
|-----------|--------|-----------------|
| Security | 🟡 | Console.logs in prod services; generic `throw new Error` instead of typed exceptions; hardcoded localhost fallbacks; Swagger only in dev |
| Data Integrity | 🟢 | Comprehensive Prisma schema with indexes, soft deletes, audit logs; 65+ migrations; no raw SQL bypassing tenantId |
| Reliability | 🟡 | Health checks present; Redis fallback to in-memory for rate limiting (won't scale horizontally); no email provider configured by default |
| Observability | 🟡 | Sentry error tracking; structured logging; no metrics/dashboards (Prometheus/Datadog missing); no APM |
| Performance | 🟢 | Prisma indexes present; no N+1 detected in sampled queries; BigInt used for financial amounts |
| Infrastructure | 🟡 | Docker Compose with health checks; Dockerfile multi-stage; CI/CD passes; postgres:15 vs postgres:16 mismatch in CI vs local |
| Code Quality | 🟡 | Tests pass (569/569); ESLint/Prettier configured; many `TODO` comments in assistant (non-critical); generic Error throws |
| Frontend | 🟡 | Error boundaries present; missing `loading.tsx` and `not-found.tsx` (Next.js convention); no manifest validation |
| API | 🟢 | Swagger in dev; comprehensive DTOs; Zod config validation; rate limiting; CORS + Helmet; Sentry exception filter |
| Payments | 🔴 | No Stripe/MercadoPago/PayPal integration; payment verification is 100% manual admin approval; no webhook handlers |

---

## Critical Blockers (must fix before production)

1. **No Payment Provider Integration** — The entire `finanzas` module handles charges, payments, and allocations, but there is zero integration with an actual payment gateway (Stripe, MercadoPago, PayU, etc.). All payments are manually submitted by residents and manually approved/rejected by admins. For a SaaS billing platform, this is a hard blocker.
2. **No Production Email Configured** — `MAIL_PROVIDER="none"` is the default. Invitations, password resets, payment notifications, and lead notifications will silently fail. Must configure Resend/SMTP/SES and validate deliverability.
3. **Console.log in Production Services** — `invitations.service.ts`, `communications.service.ts`, `demo-seed.service.ts`, and `demo-seed.controller.ts` contain `console.log` statements that could leak PII (emails, tokens) into production logs. Replace with structured logger or remove.
4. **Generic `throw new Error` instead of Typed Exceptions** — Found in `onboarding.service.ts`, `email.service.ts`, `super-admin.service.ts`, `finanzas-units.controller.ts`, `expenses.service.ts`, `context.controller.ts`, `analytics.service.ts`, `classifier.service.ts`, `ollama.provider.ts`, `planner/query-planner.service.ts`, `recurring-expense.service.ts`, `intent-extractor.service.ts`, and `query-executor.service.ts`. These become unhandled 500s instead of proper 4xx responses.
5. **Hardcoded Localhost Fallbacks** — `AI_OLLAMA_URL` defaults to `http://localhost:11434` in `assistant.service.ts`, `intent-extractor.service.ts`, `classifier.service.ts`, `ollama.provider.ts`, and `llm-health.service.ts`. In production, the AI assistant will break unless an external LLM provider (Opencode/OpenAI) is explicitly configured.

---

## Recommendations (should fix before or soon after launch)

1. **Add `loading.tsx` and `not-found.tsx` to Next.js app routes** — Currently `0` files found. Next.js 16 uses these for automatic loading and 404 UI.
2. **Enable Swagger in production (or host separately)** — Currently disabled when `NODE_ENV !== 'development'`. Production consumers need API docs.
3. **Redis is required for horizontal scaling** — Rate limiting falls back to in-memory `Map` when Redis is unavailable. In production with multiple pods, this allows rate limit bypass.
4. **Add metrics/monitoring beyond Sentry** — Prometheus or Datadog metrics for request latency, DB connection pool, queue depth, and business KPIs.
5. **Add request ID correlation across services** — The Sentry filter extracts `request.id` but it's not clear if Express request IDs are generated consistently.
6. **Validate docker-compose.full.yml in production** — The `JWT_SECRET` fallback is `your-secret-key-change-in-production`. Ensure this is overridden by env vars and never used.
7. **Standardize on postgres:16** — E2E workflow uses `postgres:15-alpine` while docker-compose uses `postgres:16-alpine`. Align versions.
8. **Add backup/restore strategy** — No evidence of automated DB backups or disaster recovery docs.
9. **Add input validation to `public-leads.controller.ts`** — The `POST /leads/public` endpoint is public and only has rate limiting. Verify it has DTO validation (`@Body()` without DTO is not recommended).
10. **Add CORS origin validation for production** — The config allows `http://localhost:3000` when `NODE_ENV === 'development'`, but verify no dev origins leak into staging/prod.
11. **Add `robots.txt` and security headers audit** — The CSP in helmet is good, but verify no inline scripts/styles are blocked by `styleSrc: ["'self'", "'unsafe-inline'"]` in production.
12. **Add database connection pooling** — No explicit `connection_limit` or pgBouncer configuration detected. At scale, this will exhaust connections.

---

## Evidence

### Security
- `apps/api/src/main.ts` — CORS, Helmet, rate limiting, cache-control headers configured
- `apps/api/src/security/rate-limit.middleware.ts` — Redis-backed with in-memory fallback
- `apps/api/src/tenancy/tenant-access.guard.ts` — Validates membership by `userId_tenantId` composite key
- `apps/api/src/tenancy/building-access.guard.ts` — Validates building belongs to user's tenant + scoped role checks
- `apps/api/src/auth/jwt.strategy.ts` — Uses `ExtractJwt.fromAuthHeaderAsBearerToken()`, bcrypt password hashing
- `apps/api/src/config/config.ts` — Zod validation with env-specific rules (production requires JWT_SECRET >= 64 chars, HTTPS URLs)

### Data Integrity
- `apps/api/prisma/schema.prisma` — 2158 lines, 40+ models, comprehensive indexes, soft deletes (`deletedAt` on Building, Communication, Notification), audit logs (`AuditLog` model with 60+ action types)
- `apps/api/prisma/migrations/` — 65+ migration folders, well-ordered with no gaps
- `apps/api/src/observability/sentry-exception.filter.ts` — Captures 5xx errors with requestId, tenantId, userId

### Infrastructure
- `infra/docker/docker-compose.yml` — Postgres 16, Redis 7, MinIO with health checks
- `infra/docker/docker-compose.full.yml` — Full stack with API + web containers, health checks, restart policies
- `apps/api/Dockerfile` — Multi-stage build, `npm ci --only=production`, health check with curl
- `apps/web/Dockerfile` — Multi-stage build, health check with curl
- `.github/workflows/ci.yml` — Build, lint, test, e2e gates on PRs to main
- `.github/workflows/e2e-tests.yml` — Playwright E2E tests with seeded data, artifact upload

### API
- `apps/api/src/main.ts` — Global ValidationPipe with `whitelist: true`, `transform: true`
- 60+ controllers with `@UseGuards(JwtAuthGuard, TenantAccessGuard)` or `@UseGuards(JwtAuthGuard, SuperAdminGuard)`
- `apps/api/src/observability/health.service.ts` — `/health` (liveness) and `/ready` (readiness) check DB, storage, email

### Frontend
- `apps/web/shared/components/error-boundary/ErrorBoundary.tsx` — Class-based error boundary with `level="page"` and `level="feature"`
- `apps/web/app/layout.tsx` — QueryProvider, AuthBootstrap, ToastProvider
- `apps/web/app/(tenant)/[tenantId]/...` — Tenant-scoped routing
- `apps/web/app/super-admin/...` — Super admin routes

### Payments
- `apps/api/src/finanzas/finanzas.controller.ts` — Manual payment submission/approval/rejection
- `apps/api/src/finanzas/finanzas.service.ts` — Charge generation, payment allocation, receipt generation
- **No Stripe/MercadoPago/PayPal webhook handlers found** — grep for `stripe|mercadopago|payu|paypal|payment.*provider|billing.*provider|webhook` returned zero matches

### AI Assistant
- `apps/api/src/assistant/executor/query-executor.service.ts` — RBAC bypass with `ALLOW_RBAC_BYPASS` (disabled by default, requires local DB)
- `apps/api/src/assistant/intent-engine/intent-extractor.service.ts` — 3-tier extraction: deterministic → Ollama → Opencode
- `apps/api/src/assistant/ollama.provider.ts` — Hardcoded `http://localhost:11434` fallback

---

## Approaches

### Approach A: Fix Blockers, Then Launch
**Description**: Address the 5 critical blockers, then launch to production.
- **Pros**: Fastest path to production; core architecture is solid
- **Cons**: Still missing some operational maturity (metrics, backups, docs)
- **Effort**: Medium

### Approach B: Full Operational Readiness
**Description**: Fix blockers + add metrics, backups, production runbook, and load testing.
- **Pros**: Production-grade operational maturity
- **Cons**: Adds 2-4 weeks
- **Effort**: High

### Recommendation
**Approach A** — The architecture is sound and the tests pass. Fix the 5 critical blockers, configure production env vars, and launch. Operational maturity can be added incrementally post-launch.

---

## Risks
- **Payment gap**: If payments are expected to be automated, the current manual flow will break user expectations.
- **Email gap**: Password resets and invitations will fail silently without a configured email provider.
- **AI assistant**: If AI features are marketed, the local Ollama fallback will break in production.
- **Rate limiting**: In-memory fallback means horizontal scaling weakens abuse protection.

---

## Ready for Proposal
**Yes** — A `sdd-propose` should be created to track the 5 critical blockers as an implementation change. The change is well-scoped and the codebase is in a healthy state.
