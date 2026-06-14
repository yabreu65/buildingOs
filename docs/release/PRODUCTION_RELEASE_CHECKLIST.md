# BuildingOS Production Release Checklist

Use this checklist before every production deployment.

## Pre-release gates

- [ ] `npm run lint:ci`
- [ ] `npm run build:ci`
- [ ] `npm run test:ci`
- [ ] `npm run test:e2e:ci`
- [ ] `cd apps/api && npx prisma validate`
- [ ] `docker compose -f infra/docker/docker-compose.full.yml config`

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

## Readiness and observability

- [ ] `/health` returns 200
- [ ] `/readyz` returns 200 with database and storage up
- [ ] Email provider health is green or intentionally `not_configured`
- [ ] Error tracking DSN configured for the target environment
- [ ] Deployment version/release annotation captured in release notes

## Go / No-Go

- [ ] No failing backend suites
- [ ] No config drift between Docker/CI/runtime
- [ ] No unresolved production blocker in release notes
