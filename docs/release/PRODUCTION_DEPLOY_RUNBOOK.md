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
| Backup | Exact external script identity plus new verified custom dump before checkout/build/migration |
| Images | SHA tag plus `org.opencontainers.image.revision` |
| Migration | Immutable 81→97 manifest verified against files and database before and after the dedicated runner |
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
- private-bucket initializer isolated behind the `storage-init` profile;
- no PostgreSQL or Redis service recreation.

Real values remain in `/opt/pawtech/env/`. The versioned Compose contains no credential defaults.

The legacy ignored file `infra/docker/.env` may remain in the production checkout only while the root `.dockerignore` excludes nested `.env` files. Any other ignored environment file or sensitive artifact blocks deployment.

Before the first controlled promotion, run the `storage-init` profile under separate production approval. It preserves the existing bucket and explicitly removes the legacy anonymous-download policy with `mc anonymous set none`; verify private access before continuing.

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

The workflow sends the versioned deploy script, security validator, and `infra/production/backup-postgres.identity.v1` together as a temporary remote control bundle outside the checkout. The bundle is removed when the remote command exits. Deployment stops unless the external backup script is a non-symlink regular file at the exact path, SHA-256, owner, group, and mode declared by the canonical manifest. Immediately before backup, the validator creates a private copy, verifies its SHA-256, revalidates the source identity, and executes only the pinned copy.

The official backup produces PostgreSQL custom dumps and checksums. Deployment requires a newly created backup directory, verifies the dump checksum, and validates the custom archive with `pg_restore --list` before checkout, build, or migration. Validate custom dumps with `pg_restore`, not the legacy gzip/plain-SQL restore script.

The latest authorized production read-only preflight recorded `BACKUP_READINESS=INCOMPLETE`; deployment remains blocked until backup readiness is separately proven. This observation does not authorize creating or executing a backup in a tooling change.

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

For incident recovery, use the separately gated candidate-restore, swap, and reverse procedure in `docs/operations/production-postgres-custom-recovery.md`. It is never an automatic deploy fallback.

## Exact migration transition

`scripts/manifests/production-migrations-81-to-98.tsv` binds the only approved transition: 81 successful migrations, zero failed migrations, the exact next 17 migration names and SHA-256 values, and a final state of 98 successful migrations with zero failed or rolled-back rows. The verified production pre-deploy state is 97 successful migrations with `20260831000000_add_payment_receipt_issuance_snapshot` pending. `scripts/manifests/production-migration-metadata-exceptions.tsv` contains the only approved historical metadata exception: `20260719000000_add_receipt_sequence` may be finished and active with `applied_steps_count=0` only when its audited checksum matches and the ReceiptSequence DDL baseline passes exactly.

The deploy sequence is fail-closed:

1. The workflow validates the manifest and local migration files before opening SSH.
2. After the exact target checkout, deployment revalidates local files from that target.
3. Immediately before `prisma migrate deploy`, the database must match the verified 97-row production pre-state and contain only the exact target migration pending.
4. Immediately after migration, the database must contain exactly the 98 expected active, finished rows; all 17 new database checksums must match the manifest.

If a previous attempt completed migration and stopped afterward, the strict 97-row pre-check reports the exact count mismatch and deployment may enter its retry path. That path accepts only a fully validated 98-row target state, skips migration application, and still requires post-verification, rollback compatibility, receipt generation, application recreation, and health checks. Partial, failed, extra, or checksum-mismatched states remain rejected.

Any missing, extra, duplicate, failed, rolled-back, partial, reordered, renamed, or checksum-mismatched migration stops deployment. No zero-step row is accepted outside the immutable historical exception manifest. Do not edit migration history or bypass the verifier.

## Application rollback

`scripts/rollback-production.sh` uses captured image digests and never changes the database. The deploy script creates the protected compatibility receipt only after migration, post-verification, and the shared compatibility guard pass, and before API/Web recreation. If generation or immediate validation fails, deployment stops before application recreation.

Receipt format:

```text
receipt_version=rollback-compatibility-receipt.v2
receipt_id=<unique-safe-id>
timestamp_utc=<YYYY-MM-DDTHH:MM:SSZ>
compatibility=SAFE
target_sha=<deployed-40-character-sha>
previous_sha=<previous-40-character-sha>
previous_api_digest=sha256:<64-hex>
previous_web_digest=sha256:<64-hex>
migration_count=98
```

The filename must be `<receipt_id>.receipt`. Store receipts as direct children of `/opt/pawtech/apps/buildingos/compatibility/`, owned by `yoryi:yoryi`, with directory mode exactly `0700` and receipt mode exactly `0600`; the directory path and every component must be canonical and contain no symlinks. Fields must appear exactly once in the order shown, use LF endings, and end with one LF. Never commit environment-specific receipts. If compatibility is `CONDITIONAL`, `UNKNOWN`, or `UNSAFE`, do not create a SAFE receipt and do not run rollback.

Rollback does not check out old source or rebuild old images. It tags the captured digests locally, recreates only API/Web, verifies the unchanged migration count, then runs health smoke.

Immediately before rollback, the script reuses the same read-only compatibility guard used by deploy and requires zero rows using target-only Finance structures: cross-currency snapshots/rates, shared recurring expenses, funds, income applications/policies, valued liquidations and income offsets. If users have created any such data, the previous application is no longer considered compatible and rollback stops without changing runtime or database.

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
- MinIO anonymous-policy change or restoration requires a separate approved window and the exact captured-policy procedure in `docs/operations/production-minio-policy-recovery.md`.
