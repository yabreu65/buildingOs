# Staging Plan

This document defines the technical and operational plan for introducing a **separate staging environment** for BuildingOS before any production change. It clarifies why staging exists, how it must be isolated, and what needs to be true before 11B/11C can start.

## Quick path

1. Confirm staging is a separate environment from production.
2. Define the repository, paths, environment variables, and service names for staging.
3. Agree on the deployment flow, validation checks, and go/no-go gate.
4. Only then start implementation tasks for staging.

## A. Objective of staging

| Topic | Decision |
|-------|----------|
| Purpose | Staging is the controlled pre-production environment used to validate release behavior before production. |
| Problem solved | It reduces risk by giving the team a production-like environment to verify deploys, migrations, smoke checks, and operational readiness. |
| Local vs demo vs staging vs production | Local is for developer work; demo marketing is for guided sales demos; staging is for pre-production validation; production is the customer-facing live system. |

## B. Expected architecture

| Item | Staging value |
|------|----------------|
| VPS path | `/opt/pawtech/apps/buildingos-staging` |
| Repo path | `/opt/pawtech/apps/buildingos-staging/buildingos-app` |
| Env file | `/opt/pawtech/env/buildingos-staging.env` |
| Secrets directory | `/opt/pawtech/secrets/buildingos-staging/` |
| Database | `buildingos_staging_db` |
| Web container | `buildingos-staging-web` |
| API container | `buildingos-staging-api` |
| MinIO container | `buildingos-staging-minio` if object storage is required |
| Web URL | `https://buildingos-staging.31-220-98-21.sslip.io` |
| API URL | `https://buildingos-api-staging.31-220-98-21.sslip.io` |

## C. Mandatory separation

- Do not share `buildingos_db` with production.
- Do not share `/opt/pawtech/env/buildingos.env`.
- Do not reuse the production JWT secret.
- Do not use real payment credentials.
- Do not send real email or WhatsApp traffic from staging.
- Do not touch production containers from staging operations.

## D. Recommended Git flow

| Branch | Role |
|--------|------|
| `main` | Production-ready line. |
| `develop` / `staging` | Recommended branch for staging integration and validation. |
| `feature/*` | Short-lived work branches. |

**Interim note:** if the team needs to start staging before a long-lived branch exists, `main` can be used for the first staging baseline only if the release process is explicit and the branch policy is documented immediately after.

## E. Required variables

| Variable | Staging expectation |
|----------|---------------------|
| `APP_ENV` | `staging` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Points to the staging database only. |
| `WEB_ORIGIN` | Staging web origin. |
| `APP_BASE_URL` | Staging app base URL. |
| `JWT_SECRET` | Unique staging secret, never reused from production. |
| Redis | Separate instance or isolated prefix/keyspace. |
| AI settings | `AI_PROVIDER`, `AI_OLLAMA_URL`, `AI_OLLAMA_MODEL`, `AI_CLASSIFIER_MODEL` must avoid the production fallback issue seen previously. |
| Mail / payment | Sandbox or `none` mode for staging. |

## F. Planned VPS execution flow

1. Create the staging directories.
2. Clone the repo into the staging path.
3. Create the staging env file.
4. Store staging secrets separately.
5. Create the staging database.
6. Apply staging migrations.
7. Build and start staging web/API containers.
8. Validate health endpoints.
9. Validate the browser flow.

## G. Validation checklist

- [ ] API `/health` responds on staging.
- [ ] Web staging URL loads successfully.
- [ ] `/super-admin` opens correctly or redirects as designed.
- [ ] Login works with staging credentials.
- [ ] Tenants screen loads.
- [ ] Users screen loads.
- [ ] Finance screens load.
- [ ] Assistant, if enabled, stays read-only or sandboxed.
- [ ] Logs do not expose secrets.
- [ ] Production containers remain untouched.

## H. Risks

- Container name collisions with production.
- Database collision or accidental reuse.
- Missing AI variables causing runtime failures.
- Secrets or tokens appearing in logs.
- Traefik hostname/port conflicts.
- Large Docker cache or image drift.

## I. Go / No-Go for 11B/11C

### Go
Proceed only if:

- staging paths and secrets are isolated;
- the database is separate from production;
- the team agrees on the staging branch strategy;
- the minimum health and browser checks pass;
- no production resource is shared accidentally.

### No-Go
Stop if:

- production and staging share a database, env file, or secret;
- required AI or mail variables are undefined;
- the route/host plan is unclear;
- the validation checklist cannot be executed safely;
- any production container or secret would be affected.

## Final decision table

| Area | State | Evidence | Responsible | Notes |
|------|-------|----------|-------------|-------|
| Architecture | Pending | Paths, containers, URLs | DevOps | Fill before implementation |
| Separation | Pending | Env/secrets/database plan | DevOps / security | Fill before implementation |
| Git flow | Pending | Branch policy | Engineering lead | Fill before implementation |
| Variables | Pending | Staging env template | DevOps / API | Fill before implementation |
| Execution | Pending | VPS runbook | DevOps | Fill before implementation |
| Validation | Pending | Health + browser checks | QA / product | Fill before implementation |
| Risks | Pending | Known risks list | Product / ops | Fill before implementation |
| Go / No-Go | Pending | Final approval | Product owner | Required before 11B/11C |

## References

- [`docs/release/PRIVATE_PILOT_PLAYBOOK.md`](./PRIVATE_PILOT_PLAYBOOK.md)
- [`docs/release/FINAL_PILOT_CHECKLIST.md`](./FINAL_PILOT_CHECKLIST.md)
- [`docs/release/PILOT_READY.md`](./PILOT_READY.md)
- [`docs/release/PILOT_CHECKLIST.md`](./PILOT_CHECKLIST.md)
- [`docs/release/PILOT_ACTIVATION.md`](./PILOT_ACTIVATION.md)
- [`docs/DEMO_GUIDE.md`](../DEMO_GUIDE.md)
