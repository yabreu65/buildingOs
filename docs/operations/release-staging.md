# BuildingOS release-staging runbook

Release-staging is a temporary, isolated environment for validating production waves before they are allowed to reach production. It is **not** production, it does **not** replace the normal staging environment, it does **not** deploy `main`, and it only accepts release branches that match `release/prod-wave-*`.

## Quick path

1. Verify the branch follows the release-wave pattern and the SHA belongs to that branch.
2. Open GitHub Actions and run the `Deploy release-staging` workflow from `main`.
3. Confirm the Environment, deploy summary, smoke checks, and evidence.
4. If needed, rerun the exact same SHA to prove idempotency.
5. Roll back with the rollback script only; do not restore data automatically.

## Architecture

| Topic | Value |
|---|---|
| Remote root | `/opt/pawtech/apps/buildingos-release-staging` |
| Remote checkout | `/opt/pawtech/apps/buildingos-release-staging/buildingos-app` |
| Compose project | `buildingos-release-staging` |
| Compose file | `infra/docker/docker-compose.release-staging.yml` |
| Runtime env file | `/opt/pawtech/env/buildingos-release-staging.env` |
| Backups | `/opt/pawtech/apps/buildingos-release-staging/backups` |
| Backup metadata | `/opt/pawtech/apps/buildingos-release-staging/backups/metadata` |
| Evidence | `/opt/pawtech/apps/buildingos-release-staging/deployments` |
| Logs | `/opt/pawtech/apps/buildingos-release-staging/logs` |
| Internal network | `buildingos_release_staging_net` |
| Shared proxy network | `pawtech_public` |
| PostgreSQL DB | `buildingos_release_staging_db` |
| PostgreSQL user | `buildingos_release_staging` |
| MinIO bucket | `buildingos-release-staging` |

### Services

| Service | Container | Purpose | Local port |
|---|---|---|---|
| PostgreSQL | `buildingos-release-staging-postgres` | Database for release-staging | `127.0.0.1:5435:5432` |
| Redis | `buildingos-release-staging-redis` | Cache / queue support | `127.0.0.1:6382:6379` |
| MinIO | `buildingos-release-staging-minio` | S3-compatible storage | `127.0.0.1:9120:9000` |
| MinIO console | `buildingos-release-staging-minio` | Console on the same container | `127.0.0.1:9121:9001` |
| Bucket creator | `buildingos-release-staging-mc` | Creates the release bucket | no host port |
| Mailpit | `buildingos-release-staging-mailpit` | Local email sink | `127.0.0.1:8027:8025` |
| API | `buildingos-release-staging-api` | Backend service | `127.0.0.1:4020:3000` |
| Web | `buildingos-release-staging-web` | Frontend service | `127.0.0.1:4021:3000` |

### Public URLs

| Purpose | URL | Traefik router |
|---|---|---|
| Web | `https://buildingos-release-staging.31-220-98-21.sslip.io` | `buildingos-release-staging` |
| API | `https://buildingos-api-release-staging.31-220-98-21.sslip.io` | `buildingos-api-release-staging` |
| Files | `https://buildingos-release-staging-files.31-220-98-21.sslip.io` | `buildingos-release-staging-files` |

## Wave 0 files

| File | Responsibility |
|---|---|
| `infra/docker/docker-compose.release-staging.yml` | Isolated Compose stack with release-staging-only names, ports, network, and routers. |
| `infra/docker/.env.release-staging.example` | Placeholder env contract for the release-staging VPS. |
| `scripts/deploy-release-staging.sh` | Remote deploy orchestration, detached checkout, Compose validation, smoke, and evidence. |
| `scripts/smoke-release-staging.sh` | Local and public smoke verification for the release-staging deployment. |
| `scripts/rollback-release-staging.sh` | Roll back to an earlier approved SHA without automatic database restore. |
| `.github/workflows/deploy-release-staging.yml` | Manual GitHub Actions workflow that validates `main`, branch, SHA, SSH, and evidence. |
| `docs/operations/release-staging.md` | This runbook. |

## GitHub Environment

The exact Environment name is:

- `release-staging`

### Secrets

| Secret | Purpose |
|---|---|
| `RELEASE_STAGING_SSH_HOST` | SSH host for the release-staging VPS. |
| `RELEASE_STAGING_SSH_USER` | SSH user for the release-staging VPS. |
| `RELEASE_STAGING_SSH_PRIVATE_KEY` | Private key used for SSH authentication. |
| `RELEASE_STAGING_SSH_KNOWN_HOSTS` | Approved known-hosts entry for strict host checking. |

### Variables

| Variable | Purpose |
|---|---|
| `RELEASE_STAGING_SSH_PORT` | SSH port, default `22` if not overridden. |
| `RELEASE_STAGING_REMOTE_DIR` | Must be `/opt/pawtech/apps/buildingos-release-staging/buildingos-app`. |
| `RELEASE_STAGING_COMPOSE_FILE` | Must be `infra/docker/docker-compose.release-staging.yml`. |
| `RELEASE_STAGING_COMPOSE_PROJECT` | Must be `buildingos-release-staging`. |
| `RELEASE_STAGING_ENV_FILE` | Must be `/opt/pawtech/env/buildingos-release-staging.env`. |
| `RELEASE_STAGING_API_HEALTH_URL` | Public or local health evidence URL for the API. |
| `RELEASE_STAGING_API_READY_URL` | Public or local readiness evidence URL for the API. |
| `RELEASE_STAGING_API_READYZ_URL` | Readiness alias URL for orchestrator compatibility. |
| `RELEASE_STAGING_WEB_LOCAL_URL` | Local web URL used by the workflow. |
| `RELEASE_STAGING_API_PUBLIC_HEALTH_URL` | Public API health URL used by the workflow. |
| `RELEASE_STAGING_WEB_PUBLIC_LOGIN_URL` | Public web login URL used by the workflow. |

No secret values are stored in this repository.

## Preparing the VPS

The following checklist is future work. Mark every item as **pending** until the VPS is provisioned and verified.

- [ ] Capacity is available for a separate release-staging stack.
- [ ] The release-staging host ports are free: `4020`, `4021`, `5435`, `6382`, `9120`, `9121`, `8027`.
- [ ] The remote root exists: `/opt/pawtech/apps/buildingos-release-staging`.
- [ ] The remote checkout exists: `/opt/pawtech/apps/buildingos-release-staging/buildingos-app`.
- [ ] The runtime env file exists at `/opt/pawtech/env/buildingos-release-staging.env`.
- [ ] The release-staging PostgreSQL database is provisioned separately from staging and production.
- [ ] The release-staging Redis instance or namespace is isolated.
- [ ] The release-staging MinIO instance is isolated and the bucket `buildingos-release-staging` exists.
- [ ] Mailpit is available for release-staging and does not expose SMTP on the host.
- [ ] The release-staging Compose project uses `buildingos-release-staging`.
- [ ] The release-staging network uses `buildingos_release_staging_net`.
- [ ] Traefik routes only the three intended public services.
- [ ] Backups and metadata directories exist under `/opt/pawtech/apps/buildingos-release-staging`.
- [ ] Evidence directories exist under `/opt/pawtech/apps/buildingos-release-staging/deployments`.
- [ ] Log directories exist under `/opt/pawtech/apps/buildingos-release-staging/logs`.

## Creating a release branch

Create release branches from the approved production SHA, not from `main`.

Branch name pattern:

- `release/prod-wave-<n>-<nombre>`

Rules:

- The branch must begin with `release/prod-wave-`.
- It must not be `main`, `staging`, `develop`, `feature/*`, `fix/*`, or `chore/*`.
- The branch SHA and the release branch name must be validated together.
- The SHA deployed by the workflow must belong to the selected release branch.

## Running the workflow

1. Open **GitHub Actions** in the repository.
2. Select **Deploy release-staging**.
3. Run it from the definition on `main`.
4. Provide the required inputs:
   - `branch`
   - `sha`
5. Confirm the selected Environment is `release-staging`.
6. Review the workflow summary after it completes.

Important:

- `github.ref` must be `refs/heads/main`.
- `inputs.branch` identifies the release branch to deploy.
- The workflow must reject `main` as an input branch.

## Prechecks before deploy

Before deploying, confirm all of the following:

- [ ] The branch matches `release/prod-wave-*`.
- [ ] The SHA is exactly 40 lowercase hexadecimal characters.
- [ ] The SHA belongs to the selected release branch.
- [ ] The GitHub Environment `release-staging` is configured.
- [ ] The VPS is provisioned and reachable.
- [ ] The runtime env file exists and is readable on the host.
- [ ] The remote working tree is clean.
- [ ] A rollback SHA is recorded.
- [ ] A backup is available when the wave requires one.
- [ ] Production remains intact.
- [ ] The normal staging environment remains intact.

## Deploy

The deploy script is responsible for the following:

1. Validate the branch and SHA.
2. Validate the release-staging remote directory and fixed file paths.
3. Confirm the remote repository is present.
4. Fetch the exact branch and verify the SHA belongs to it.
5. Switch the remote checkout to detached HEAD at the requested SHA.
6. Verify the working tree is clean.
7. Render the release-staging Compose configuration.
8. Start the release-staging services.
9. Run the smoke checks.
10. Record sanitized evidence.

Wave 0 does **not** run functional migrations.

## Smoke

The smoke script checks the following endpoints:

- API `GET /health`
- API `GET /ready`
- API `GET /readyz`
- Web `GET /login`
- Public API health URL
- Public web login URL

PASS criteria:

- `GET /health` returns HTTP 200 and a JSON body with `status: "ok"`.
- `GET /ready` and `GET /readyz` return HTTP 200 when readiness is healthy or degraded.
- `GET /login` returns the login page and includes the BuildingOS login shell.
- Public health and login checks return HTTP 200.

FAIL criteria:

- Any endpoint returns a non-200 status when the script expects 200.
- The readiness payload is malformed.
- The repository is not in detached HEAD.
- The working tree is dirty.

## Evidence

The workflow and scripts should preserve sanitized evidence only. Record:

- requested branch
- requested SHA
- validated SHA
- remote SHA after deploy
- working tree status
- Compose project
- Compose file
- env file
- health and smoke results
- execution identifier

Evidence is stored under the release-staging evidence directory on the host. Do not store secret values in evidence.

## Redeploy idempotency

To prove idempotency, rerun the same branch and same SHA after a successful deployment.

Expected results:

- the remote HEAD stays on the same SHA;
- the Compose project remains `buildingos-release-staging`;
- the services stay healthy;
- no duplicate resources are created;
- the smoke script still passes.

## Rollback

Use the rollback script only for release-staging and only with a previously approved SHA.

The rollback procedure:

1. Select the earlier approved SHA.
2. Validate the release branch and SHA.
3. Switch the remote checkout to detached HEAD at the rollback SHA.
4. Bring up the fixed Compose project.
5. Run smoke checks again.
6. Record sanitized rollback evidence.

Important:

- The rollback script does **not** restore the database automatically.
- The rollback script does **not** revert migrations automatically.
- If a future wave includes migrations, backup and restore must be handled separately.

## Backup and restore

Release-staging backups are required before higher-risk waves or any wave that changes data.

Model:

- back up the release-staging database only;
- validate the dump checksum;
- keep 7 daily backups and 4 weekly backups;
- restore to a temporary or isolated database before trusting the backup.

Restore remains a separate operation. Do not overwrite production or normal staging during backup validation.

## Cleanup

Cleanup must target release-staging only.

Checklist:

- [ ] Remove the release-staging containers only.
- [ ] Remove the release-staging volumes only.
- [ ] Remove the release-staging network only.
- [ ] Remove the release-staging database only.
- [ ] Remove the release-staging bucket only.
- [ ] Remove the release-staging routers only.
- [ ] Remove the release-staging checkout only.
- [ ] Remove release-staging secrets only if a future admin process explicitly allows it.
- [ ] Retain evidence according to the retention policy.

Do not affect:

- `/opt/pawtech/apps/buildingos`
- `/opt/pawtech/apps/buildingos-staging`
- production containers
- normal staging containers

## Negative checks

The following situations must fail before any deployment effect:

- running the workflow from a ref other than `main`
- using an unauthorized branch
- using an invalid SHA
- using a SHA that does not exist
- using a SHA that does not belong to the selected branch
- using the wrong remote path
- missing or incomplete Environment settings
- failing health checks
- a dirty remote working tree

## Wave 1 gate

Wave 1 may not start until all of the following are true:

- [ ] The Wave 0 PR has been reviewed and approved.
- [ ] The `release-staging` Environment is configured.
- [ ] The VPS is provisioned.
- [ ] The workflow has executed successfully.
- [ ] The same SHA has been redeployed successfully.
- [ ] Isolation has been verified.
- [ ] Smoke checks passed.
- [ ] Rollback was tested.
- [ ] Cleanup was tested or validated.
- [ ] Production stayed intact.
- [ ] Normal staging stayed intact.

## Decision record

| Decision | Why |
|---|---|
| Keep release-staging separate from normal staging | It must validate release waves without replacing the always-on staging environment. |
| Execute the workflow from `main` | This prevents a modified workflow from being run from an untrusted release branch. |
| Validate branch and SHA together | The branch proves provenance; the SHA proves the exact deployment target. |
| Avoid functional migrations in Wave 0 | Wave 0 validates the deployment substrate, not schema changes. |

## References

- `infra/docker/docker-compose.release-staging.yml`
- `infra/docker/.env.release-staging.example`
- `scripts/deploy-release-staging.sh`
- `scripts/smoke-release-staging.sh`
- `scripts/rollback-release-staging.sh`
- `.github/workflows/deploy-release-staging.yml`
