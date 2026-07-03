# BuildingOS Production Release Checklist

Use this checklist before every production deployment.

## Pre-release gates

- [ ] `npm run lint:ci`
- [ ] `npm run build:ci`
- [ ] `npm run test:ci`
- [ ] `npm run test:e2e:ci`
- [ ] `cd apps/api && npx prisma validate`
- [ ] `docker compose -f infra/docker/docker-compose.full.yml config`

## Pre-deploy checklist

- [ ] `docs/release/PUBLIC_EDGE_CONTRACT.md` reviewed before deploy
- [ ] `docker compose -f infra/docker/docker-compose.full.yml config` reviewed before deploy
- [ ] Public ports reviewed and match the intended exposure
- [ ] Public web/API hostnames match the release contract
- [ ] No volume changes planned for this release
- [ ] No shared postgres or redis container changes planned without approval
- [ ] Database backup taken and verified
- [ ] Rollback owner and rollback command documented
- [ ] Deployment target and maintenance window confirmed

## Post-deploy checklist

- [ ] `docker compose ps` or equivalent runtime status checked
- [ ] Deployment logs reviewed for errors or unexpected restarts
- [ ] Health checks pass for the API, web app, and supporting services
- [ ] Public port exposure matches the intended reverse-proxy setup
- [ ] Public web/API hostnames match the release contract
- [ ] No unexpected volume changes or container replacements occurred
- [ ] Rollback path remains available and tested conceptually

## Runtime contract

- [ ] Production env uses `JWT_EXPIRES_IN`
- [ ] Production env uses `MAIL_FROM`
- [ ] Production env uses `SMTP_PASS` when SMTP is enabled
- [ ] Production env uses `S3_*` variables, not legacy `MINIO_*`
- [ ] `WEB_ORIGIN` and `APP_BASE_URL` point to the public HTTPS domain
- [ ] `FEATURE_PORTAL_RESIDENT` and `FEATURE_PAYMENTS_MVP` are explicitly defined

## Database and deploy

- [ ] Database backup taken
- [ ] `npm run migrate:deploy -w apps/api` executed successfully against staging-like database
- [ ] Seed/backfill steps reviewed for the target environment
- [ ] Rollback owner and rollback command documented
- [ ] No production migration was run without a backup-confirmed plan
- [ ] No destructive SQL was run against production

## Readiness and observability

- [ ] `/health` returns 200
- [ ] `/readyz` returns 200 when the API is healthy or degraded, 503 only when the database is down
- [ ] `/metrics` returns scrapeable Prometheus text without secrets
- [ ] Email provider health is green or intentionally `not_configured`
- [ ] Request ID propagation verified end to end (`X-Request-Id`)
- [ ] Error tracking DSN configured for the target environment
- [ ] Deployment version/release annotation captured in release notes
- [ ] Alerting checklist reviewed: readiness failures, 5xx rate, latency, dependency degradation

## Go / No-Go

- [ ] No failing backend suites
- [ ] No config drift between Docker/CI/runtime
- [ ] No unresolved production blocker in release notes
