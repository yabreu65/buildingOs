# Staging Status

BuildingOS staging is now provisioned, booted, and validated on the VPS as a separate environment from production. It uses its own database, env file, secrets directory, loopback-only ports, and container names.

## Quick path

1. Use the staging env file under `/opt/pawtech/env/buildingos-staging.env`.
2. Manage staging from `/opt/pawtech/apps/buildingos-staging/buildingos-app`.
3. Validate `/health`, `/ready`, `/readyz`, and the web entrypoint before any release work.
4. Shut staging down with the staging compose file only; never use a global compose down.

## Current staging layout

| Area | Value |
|---|---|
| VPS root | `/opt/pawtech/apps/buildingos-staging` |
| Repo | `/opt/pawtech/apps/buildingos-staging/buildingos-app` |
| Env file | `/opt/pawtech/env/buildingos-staging.env` |
| Secrets dir | `/opt/pawtech/secrets/buildingos-staging/` |
| Database | `buildingos_staging_db` |
| Web container | `buildingos-staging-web` |
| API container | `buildingos-staging-api` |
| Postgres container | `buildingos-staging-postgres` |
| Redis container | `buildingos-staging-redis` |
| MinIO container | `buildingos-staging-minio` |
| MinIO bootstrap | `buildingos-staging-mc` |
| Web port | `127.0.0.1:4011` |
| API port | `127.0.0.1:4010` |
| Postgres port | `127.0.0.1:5434` |
| Redis port | `127.0.0.1:6381` |
| MinIO API port | `127.0.0.1:9110` |
| MinIO console port | `127.0.0.1:9111` |
| Web URL | `https://buildingos-staging.31-220-98-21.sslip.io` |
| API URL | `https://buildingos-api-staging.31-220-98-21.sslip.io` |

## What is confirmed

- Staging uses `buildingos_staging_db`.
- Production uses `buildingos_db`.
- Staging and production do **not** share env files.
- Staging and production do **not** share secrets.
- Staging containers use distinct names and loopback-bound ports.
- Staging compose renders successfully with the staging env file.
- Staging migrations were applied successfully to the staging database.
- Staging API is healthy and serves `/health`, `/ready`, and `/readyz`.
- Staging web is healthy and responds on the staging loopback port.
- Production stayed healthy during the entire staging setup.

## Checks already completed

| Check | Result |
|---|---|
| Staging infra up | OK |
| Staging migrations applied | OK |
| API `/health` | OK |
| API `/ready` | OK |
| API `/readyz` | OK |
| Web staging root | OK |
| Web staging login | OK |
| Production web health | OK |
| Production API health | OK |
| Logs reviewed for critical errors | OK |
| Secrets printed in logs | None observed |

## Useful validation commands

Run from the staging repo:

```bash
cd /opt/pawtech/apps/buildingos-staging/buildingos-app

docker compose --env-file /opt/pawtech/env/buildingos-staging.env -f infra/docker/docker-compose.staging.yml ps
curl -fsS http://127.0.0.1:4010/health
curl -fsS http://127.0.0.1:4010/ready
curl -fsS http://127.0.0.1:4010/readyz
curl -fsSI http://127.0.0.1:4011/
```

To inspect logs without mutating anything:

```bash
docker logs --tail=100 buildingos-staging-api
docker logs --tail=100 buildingos-staging-web
```

## How to update staging safely

1. Enter the staging repo: `/opt/pawtech/apps/buildingos-staging/buildingos-app`.
2. Fetch and fast-forward from `origin/main` only.
3. Update the staging env file if a new required variable appears.
4. Re-render the compose file with the staging env.
5. Recreate only the affected staging service(s).
6. Re-run `/health`, `/ready`, `/readyz`, and web checks.

**Important:** do not touch production paths, production env files, production secrets, or production containers.

## How to restart staging safely

If staging must be restarted, restart only the staging services with the staging compose file:

```bash
cd /opt/pawtech/apps/buildingos-staging/buildingos-app
docker compose --env-file /opt/pawtech/env/buildingos-staging.env -f infra/docker/docker-compose.staging.yml up -d postgres redis minio createbuckets buildingos-api buildingos-web
```

Only use the staging compose file. Never run a global `down` or a prune command for this environment as a casual cleanup step.

## How to shut staging down safely

Stop only the staging services:

```bash
cd /opt/pawtech/apps/buildingos-staging/buildingos-app
docker compose --env-file /opt/pawtech/env/buildingos-staging.env -f infra/docker/docker-compose.staging.yml stop buildingos-web buildingos-api createbuckets minio redis postgres
```

Do **not** use a global `docker compose down` on production or staging without a specific reason and explicit approval.

## Risks and open observations

- `/super-admin` browser-side redirect/block was originally noted as unconfirmed when Chromium was missing, but it was later validated successfully in a real browser smoke check.
- `Sentry DSN` is intentionally not configured in staging; warnings are expected.
- Las credenciales demo reales deben almacenarse fuera del repositorio y rotarse si fueron expuestas previamente.
- AI is disabled by configuration, but the staging env must keep the required fallback values present so bootstrap does not fail.
- Production and staging must remain isolated at the database, env, and secrets level.

## Go / No-Go for future staging work

### Go
Proceed if:

- staging compose renders cleanly;
- staging containers are healthy;
- `/health`, `/ready`, and `/readyz` are green;
- web staging responds on the loopback port;
- production remains healthy;
- no production secrets or env files changed.

### No-Go
Stop if:

- staging and production share a DB, env file, or secret;
- any production container would be touched;
- staging health/readiness breaks;
- a required staging env variable is missing;
- the browser-side `/super-admin` behavior must be confirmed before release and the browser tool is unavailable.

## Final state

| Area | State | Evidence | Owner | Notes |
|---|---|---|---|---|
| Staging infra | Ready | Compose up, healthy containers | DevOps | Separate from production |
| Staging app | Ready | API/web healthy | DevOps / Engineering | Loopback ports only |
| Database | Ready | `buildingos_staging_db` migrated | DevOps | Not shared with prod |
| Env / secrets | Ready | Separate staging files | DevOps | No prod reuse |
| Validation | Ready | Browser-side `/super-admin` smoke was later validated successfully | QA / DevOps | Historical Chromium note resolved |
| Production | Intact | Prod health and HTTP checks OK | DevOps | No production mutation |
