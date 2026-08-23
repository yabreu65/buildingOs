# Controlled production promotion

BuildingOS production promotion is manual, exact-SHA, backup-first, and application-only. Database migrations are forward-only; neither deploy nor rollback restores PostgreSQL automatically.

## Quick path

1. Complete PROD-00 and obtain an explicit approved target SHA.
2. Confirm the GitHub `production` environment approval and expected current checkout SHA.
3. Dispatch `Deploy production exact SHA` with the same SHA in `sha` and `approved_sha`.
4. Verify the external deployment record, health, authenticated Resident/Finance smoke, and logs.

The workflow must never be dispatched to compensate for a failed preflight.

## Production control contract

| Control | Requirement |
|---------|-------------|
| Trigger | `workflow_dispatch` only |
| Approval | GitHub Environment `production` with required reviewers |
| Target | Exact 40-character SHA reachable from `origin/main` |
| Race guard | `expected_current_sha` must equal the remote checkout |
| Checkout | Clean, detached, exact target SHA |
| Backup | New verified custom dump before checkout/build/migration |
| Images | SHA tag plus `org.opencontainers.image.revision` |
| Migration | Dedicated `prisma migrate deploy` runner |
| Runtime change | Recreate only `buildingos-api` and `buildingos-web` |
| Infrastructure | Never recreate PostgreSQL, Redis, MinIO, Traefik, networks, or volumes |
| Seeds | Prohibited |
| Evidence | External 0600 deployment record with SHA, digests, backup and migration count |

## GitHub environment

Configure these secrets in the `production` environment:

- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`

Configure these non-sensitive variables:

- `PRODUCTION_SSH_PORT`
- `PRODUCTION_API_HEALTH_URL`
- `PRODUCTION_API_READYZ_URL`
- `PRODUCTION_WEB_LOGIN_URL`

Require at least one reviewer. Do not store production credentials as repository variables.

## Versioned Compose

`infra/docker/docker-compose.production.yml` reproduces the active topology:

- existing container names, networks, volume name, Traefik routers and restart policies;
- API and Web on `pawtech_public` plus `pawtech_internal`;
- existing MinIO route and volume, with its current images pinned by digest;
- dedicated migration profile;
- storage initializer isolated behind the `storage-init` profile;
- no PostgreSQL or Redis service recreation.

Real values remain in `/opt/pawtech/env/`. The versioned Compose contains no credential defaults.

## Audited Prisma baseline

Two successful production migration records are historical exceptions:

| Migration | Classification | Evidence |
|-----------|----------------|----------|
| `20260510000001_enforce_tenant_scope_non_breaking` | `HISTORY_ONLY_DRIFT` | Recorded checksum equals the original applied Git version. The later file change only added replay-safe `UnitAssociation` DDL; the table, columns, PK and unique index already exist. All tenant nullability, FKs and indexes match. |
| `20260616000001_add_tenant_next_building_alias_index` | `HISTORY_ONLY_DRIFT` | The migration was manually registered after the DDL existed. `Tenant.nextBuildingAliasIndex` matches exactly. `Building.alias` pre-existed through `db push`; therefore `ADD COLUMN IF NOT EXISTS ... DEFAULT ''` is a no-op on this database, leaving the no-default column required by the final Prisma schema. |

`prisma migrate resolve --applied` is not applicable to either record because both are already successful; Prisma returns P3008. Do not update `_prisma_migrations` manually. The approved reconciliation is read-only:

```bash
POSTGRES_CONTAINER=pawtech-postgres \
DATABASE_NAME=buildingos_db \
./scripts/verify-production-migration-baseline.sh
```

Any mismatch outside these exact records or DDL invariants is a release blocker.

## Backup and restore

The official backup produces PostgreSQL custom dumps and checksums. Validate custom dumps with `pg_restore`, not the legacy gzip/plain-SQL restore script.

Temporary restore example:

```bash
POSTGRES_CONTAINER=<isolated-postgres-container> \
./scripts/restore-postgres-custom.sh \
  /secure/path/buildingos_db_<timestamp>.dump \
  buildingos_restore_test_<change> \
  --checksum /secure/path/buildingos_db_<timestamp>.dump.sha256
```

The target database must not already exist. A failed temporary restore removes only the database created by that invocation. Production restore remains disabled unless both `--allow-production` and the exact confirmation `APPROVE DATABASE RESTORE` are supplied after a separate human approval.

Never invoke restore tooling from deploy or application rollback.

## Application rollback

`scripts/rollback-production.sh` uses captured image digests and never changes the database. It requires a protected compatibility receipt created only after an isolated rehearsal against the migrated schema.

Receipt format:

```text
status=SAFE
target_sha=<deployed-40-character-sha>
previous_sha=<previous-40-character-sha>
previous_api_digest=sha256:<64-hex>
previous_web_digest=sha256:<64-hex>
migration_count=<verified-count>
```

Store receipts under `/opt/pawtech/apps/buildingos/compatibility/` with mode `0600`; never commit environment-specific receipts. If compatibility is `CONDITIONAL`, `UNKNOWN`, or `UNSAFE`, do not create a SAFE receipt and do not run rollback.

Rollback does not check out old source or rebuild old images. It tags the captured digests locally, recreates only API/Web, verifies the unchanged migration count, then runs health smoke.

## Post-deploy smoke

Run read-only smoke with formally authorized accounts:

- login and session restoration;
- Resident dashboard, Mi Unidad, multi-unit context, payments, debt, receipts, documents, communications, tickets, profile and notifications;
- cross-unit and cross-tenant denial;
- mixed-role portal switching;
- Finance settings, functional currency, exchange rates, expenses, incomes, applications, policies, funds, liquidations, balances, delinquency, payments, receipts and reports;
- multicurrency buckets without cross-currency aggregation.

Do not create financial movements or synthetic production data.

## Failure policy

- Before migrations: stop; the runtime remains unchanged.
- After migrations: never reverse migrations or restore automatically.
- Application rollback is allowed only with a matching SAFE compatibility receipt.
- Otherwise stop, preserve evidence, and forward-fix.
- Database restore requires separate approval: `APPROVE DATABASE RESTORE`.
