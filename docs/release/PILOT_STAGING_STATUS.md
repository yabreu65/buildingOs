# Pilot Staging Status

BuildingOS staging is now validated as the private pilot environment. The pilot tenant was loaded with controlled data, the public edge contract was fixed, and browser smoke checks passed for both owner/admin and resident flows. Production remained intact throughout.

## Quick path

1. Use the staging repo and env file only:
   - `/opt/pawtech/apps/buildingos-staging/buildingos-app`
   - `/opt/pawtech/env/buildingos-staging.env`
2. Validate the public staging URLs.
3. Confirm the pilot tenant/building IDs and loaded counts.
4. Re-run the browser smoke for owner/admin and resident.
5. Keep credentials and manifests out of Git.

## Executive summary

| Topic | Status |
|---|---|
| Pilot environment | Ready and validated on staging |
| Controlled pilot data | Loaded successfully |
| Public edge/origin contract | Fixed and verified |
| Owner/admin smoke | Passed |
| Resident smoke | Passed |
| Production | Intact |
| Credential handling | Demo credentials kept out of Git |

## Current commit

| Item | Value |
|---|---|
| Commit | `73203e2` |
| Message | `fix(infra): publish staging through traefik` |
| Purpose | Publish staging through Traefik so browser traffic reaches the correct public hosts |

## Public staging URLs

| Purpose | URL |
|---|---|
| Web app | `https://buildingos-staging.31-220-98-21.sslip.io` |
| API health | `https://buildingos-api-staging.31-220-98-21.sslip.io/health` |
| Public files / MinIO | `https://buildingos-staging-files.31-220-98-21.sslip.io` |

## Pilot tenant data

| Item | Value |
|---|---|
| Tenant ID | `cmrcmb22d00003n08rsvc04fw` |
| Building ID | `cmrcmb28o000b3n08t0lyda2b` |
| Pilot name | `Pilot Controlado 01 Staging` |
| Units | `10` |
| Residents | `3` resident members tied to units |

## Loaded counts

### Core entities

| Entity | Count |
|---|---|
| Tenants | `1` |
| Buildings | `1` |
| Units | `10` |
| Tenant members | `4` |
| Unit occupants | `3` |

### Pilot data pack content

| Entity | Count |
|---|---|
| Expenses | `3` |
| Liquidations | `1` |
| Charges | `10` |
| Payments | `2` |
| Documents | `3` |
| Tickets / requests | `3` |
| Communications | `2` |

## Modules validated

| Module | Result |
|---|---|
| Login / logout | Passed for owner/admin and resident |
| Owner/admin dashboard | Passed |
| Resident dashboard | Passed |
| Finances | Passed at read level |
| Documents | Passed at read level |
| Tickets / requests | Passed at read level |
| Communications | Passed at read level |
| Public staging edge | Passed |

## Smoke browser evidence

### Owner / admin

- Login completed successfully on the staging public web host.
- Dashboard loaded for tenant `Pilot Controlado 01 Staging`.
- Console logs were clear during the smoke.
- Visible areas included the tenant dashboard, finances, documents, tickets, and communications entry points.

### Resident

- Login completed successfully on the staging public web host.
- Resident portal loaded for the pilot unit.
- Visible areas included charges/debt, payments/comprobantes, documents, tickets, and communications.
- Console logs were clear during the smoke.

## What went wrong before the fix

The initial staging smoke failed because the staging services were not published through Traefik:

- staging web/API/files were only attached to the private staging bridge network
- no public Traefik routers were configured for the staging hosts
- the browser hit an origin contract mismatch and reported `Failed to fetch`
- public staging hostnames also failed TLS/origin checks

## Fix applied

The staging compose was updated to:

- attach web/API/MinIO to `pawtech_public`
- add explicit Traefik routers for the staging public hosts
- keep staging and production fully separated
- keep loopback-bound host ports for local inspection

## How to repeat the validation

From the staging VPS repo:

```bash
cd /opt/pawtech/apps/buildingos-staging/buildingos-app
docker compose --env-file /opt/pawtech/env/buildingos-staging.env -f infra/docker/docker-compose.staging.yml ps
curl -fsS https://buildingos-staging.31-220-98-21.sslip.io/login
curl -fsS https://buildingos-api-staging.31-220-98-21.sslip.io/health
curl -fsS https://buildingos-staging-files.31-220-98-21.sslip.io/minio/health/live
```

Browser smoke should confirm:

1. Open the staging login page.
2. Log in with the owner/admin demo account.
3. Verify dashboard, finances, documents, tickets, and communications.
4. Log out.
5. Log in with the resident demo account.
6. Verify resident dashboard, debt/payments, documents, tickets, and communications.

## Credential handling

- Demo credentials are **not** stored in Git.
- The manifest does **not** contain full passwords.
- Any refreshed demo credential must stay outside the repository and outside docs.
- Production credentials were not touched.

## Production state

| Check | Result |
|---|---|
| Production web | Healthy |
| Production API | Healthy |
| Production containers | Healthy |
| Production data | Untouched |

## Risks and follow-up

- Keep staging credentials managed privately and rotate them outside the repo if needed.
- Re-run the public-edge smoke if the hostname, TLS cert, or reverse proxy configuration changes.
- Keep staging and production isolated at the database, env, secret, and container-name levels.

## References

- [`docs/release/PRIVATE_PILOT_PLAYBOOK.md`](./PRIVATE_PILOT_PLAYBOOK.md)
- [`docs/release/FINAL_PILOT_CHECKLIST.md`](./FINAL_PILOT_CHECKLIST.md)
- [`docs/release/STAGING_STATUS.md`](./STAGING_STATUS.md)
- [`docs/release/STAGING_PLAN.md`](./STAGING_PLAN.md)
