# Staging deployment runbook

The `Deploy main to staging` workflow is intentionally **manual only** (`workflow_dispatch`). It deploys one exact commit already reachable from `origin/main`; there is no `push` trigger.

## GitHub Environment `staging`

Configure these **secrets** (never commit values): `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_PRIVATE_KEY`, `STAGING_SSH_KNOWN_HOSTS`. Configure `STAGING_SSH_PORT` as a variable (or secret if policy requires).

Configure these non-sensitive **variables**: `STAGING_APP_PATH`, `STAGING_COMPOSE_FILE`, `STAGING_COMPOSE_PROJECT`, `STAGING_ENV_FILE`, `STAGING_API_LOCAL_HEALTH_URL`, `STAGING_API_LOCAL_READY_URL`, `STAGING_API_LOCAL_READYZ_URL`, `STAGING_WEB_LOCAL_URL`, `STAGING_API_PUBLIC_HEALTH_URL`, and `STAGING_WEB_PUBLIC_LOGIN_URL`.

## Migrator architecture

`apps/api/Dockerfile` has a dedicated `migrate` target based on the dependency builder. Dependencies are installed only by the lockfile-backed `npm ci`; the image entrypoint is the local `./node_modules/.bin/prisma` binary (Prisma `5.22.0` from the root devDependencies and lockfile). It receives `DATABASE_URL` from the external staging env file and uses the internal Compose network to reach PostgreSQL. Compose service `api-migrate` uses the `migrate` profile, has no ports or persistent volumes, and is configured with `restart: "no"`. It is never started by a normal Compose up.

The command is `prisma migrate deploy --schema apps/api/prisma/schema.prisma`; it cannot resolve packages from the network at runtime and never runs seeds.

## Deployment order and controls

1. Validate the SHA format and all required path/URL settings.
2. Require a clean remote checkout (tracked, staged, untracked, and ignored files block; ignored files are treated as possible artifacts, secrets, or real environments).
3. Fetch `origin/main`, verify SHA ancestry, then detach at the exact SHA.
4. Validate Compose (normal and `migrate` profile).
5. Build and always run `api-migrate` as an ephemeral container; stop on any non-zero exit.
6. Build and force-recreate only `buildingos-api` and `buildingos-web`.
7. Check local API `/health`, `/ready`, `/readyz`, local web, public API health, and public web login URLs.
8. Write previous/new SHA and migration status to `/opt/pawtech/apps/buildingos-staging/deployments/` outside the repository.

PostgreSQL, Redis, MinIO, networks, and named volumes are excluded from build/recreate commands. No production path is referenced. Concurrency serializes workflow runs and the job timeout is 45 minutes. SSH uses a temporary 0600 key and known-hosts file cleaned by an exit trap, pinned known hosts, and keepalives (30 seconds, six failures). The script is streamed over SSH stdin; it is not copied to a predictable remote path. Success and failure records include UTC time, previous/new SHA, migration status, services, and seed status; failure logging is attempted from an `ERR` trap.

## Dispatch and failure handling

The runner checks out the trusted workflow commit (`github.sha`) only. Separately, provide a 40-character target SHA input (or omit it to use the dispatch ref SHA); the runner and remote script validate that target SHA and require it to be an ancestor of `origin/main`, so an input cannot select arbitrary workflow code. The remote checkout blocks tracked and untracked files; ignored files are permitted when harmless, while real environment/secret artifacts remain excluded by `.dockerignore` and must never be placed in the context. No automatic `git clean` is used. Every run executes the migrator after reviewing the migration set. A migration failure stops before API/web build or recreation; there is no automatic database migration rollback. Seeds are prohibited.

After success, verify the external record and `git rev-parse HEAD` in the remote checkout. For an application rollback, dispatch a previously known-good SHA through the same gates. Database recovery is a separate approved procedure; Prisma does not provide automatic rollback of applied migrations.

Production is out of scope. Enabling a future `push` to `main` trigger requires a separate reviewed change after manual runs, secret/variable verification, and operational approval.
