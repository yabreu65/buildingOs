# STG-DATA-01 Golden Dataset

This is a permanent, additive QA dataset for the normal BuildingOS staging
environment. Every owned record uses the `STG-DATA-01:GOLDEN` marker, stable
`stg-golden-*` identifiers, or a staging-only email address.

## Safety Contract

The Golden seed is a manual, explicit one-shot operation. Run it only through
the profile-gated Compose service from the staging checkout, with
`STAGING_GOLDEN_QA_PASSWORD` supplied by the staging secret manager:

```bash
docker compose \
  --env-file /opt/pawtech/env/buildingos-staging.env \
  -f infra/docker/docker-compose.staging.yml \
  --profile seed-staging-golden \
  run --rm --build api-seed-staging-golden
```

This service is not part of deployment, normal staging startup, restart, or
`docker compose up` without the explicit profile. Production execution is
forbidden. The seed does not print or persist the plaintext password.

The seed requires all of the following before constructing `PrismaClient`:

- `APP_ENV=staging`
- `NODE_ENV=staging`
- `STAGING_GOLDEN_SEED=1`
- `STAGING_GOLDEN_CONFIRMATION=STG-DATA-01`
- `DATABASE_URL` host `postgres` and database `buildingos_staging_db`

After connection, PostgreSQL must report database `buildingos_staging_db` and
a private staging-network server address. Production, local-development,
unknown-host, and wrong-database targets are rejected. The seed uses only
tenant/record-owned lookups and upserts; it contains no delete, truncate, raw
SQL, reset, or broad cleanup operation.

Existing staging records are never renamed, deleted, or replaced. A same-name
tenant without the Golden ownership marker causes the seed to fail rather than
being adopted. Re-running repairs missing owned records and rejects incompatible
owned financial records.

## Accounts

All accounts use the password sourced from `STAGING_GOLDEN_QA_PASSWORD`.

| Tenant | Account | Roles | Context |
|---|---|---|---|
| STG QA - Autogestionada | `owner.autogestionada@staging.buildingos.local` | TENANT_OWNER | Owner |
| STG QA - Autogestionada | `admin.autogestionada@staging.buildingos.local` | TENANT_ADMIN | Tenant admin |
| STG QA - Autogestionada | `resident.auto.1@staging.buildingos.local` | RESIDENT | A-101, paid |
| STG QA - Autogestionada | `resident.auto.2@staging.buildingos.local` | RESIDENT | A-102, pending balance |
| STG QA - Administradora Multi | `owner.multi@staging.buildingos.local` | TENANT_OWNER | Tenant owner |
| STG QA - Administradora Multi | `admin.multi@staging.buildingos.local` | TENANT_ADMIN | Tenant admin |
| STG QA - Administradora Multi | `operator.multi@staging.buildingos.local` | OPERATOR | Building operations |
| STG QA - Administradora Multi | `resident.multi.context@staging.buildingos.local` | RESIDENT | B1-101 and B2-201 |
| STG QA - Administradora Multi | `resident.multi.currency@staging.buildingos.local` | RESIDENT | B1/B3 currency cases |
| STG QA - Edge Cases | `owner.edge@staging.buildingos.local` | TENANT_OWNER | Tenant owner |
| STG QA - Edge Cases | `admin.resident.edge@staging.buildingos.local` | TENANT_ADMIN, RESIDENT | C-101, zero balance |
| STG QA - Edge Cases | `resident.multiunit.edge@staging.buildingos.local` | RESIDENT | C-102 and C-104 |
| STG QA - Edge Cases | `resident.delinquent.edge@staging.buildingos.local` | RESIDENT | C-103, delinquent |

## Acceptance Matrix

- Tenants: 3
- Buildings: 5
- Units: 18
- Users: 13
- Active occupant assignments: 13
- Reconciled payments: 7
- Tickets: 4
- Exchange rates: VES to USD `0.025`, COP to USD `0.00025`
- Partial-payment fixtures: none
- Finance allocations: every payment allocates its complete amount; the B2-201 payment settles the oldest charge before the newer charge

Tenant A has one building, occupied and vacant units, one paid resident, one
pending resident balance, and an open ticket. Tenant B has three buildings,
cross-building resident context, isolated building data, FIFO finance data,
and USD/VES/COP conversion snapshots. Tenant C has mixed roles, a multi-unit
resident, a vacant unit, delinquency, a zero-balance resident, and open/in-
progress tickets.
