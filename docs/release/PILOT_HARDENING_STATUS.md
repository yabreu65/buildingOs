# Pilot Hardening Status

This document records the final hardening pass completed before opening the private pilot to external users.

## Executive Summary

BuildingOS completed the private-pilot hardening checklist without touching production. Documentation was sanitized, previously exposed demo credentials were verified as inactive, staging rollback was validated with a real restore into a temporary database, and staging/prod remained healthy throughout.

## Overall Status

| Area | Status |
|---|---|
| Docs sanitization | Done |
| Legacy demo credentials | Verified inactive |
| Staging backup | Created and validated |
| Restore test | Passed in a temporary database |
| Staging environment | Healthy |
| Production environment | Healthy |

## 14A / 14B / 14C / 14D Checklist

| Block | Result | Notes |
|---|---|---|
| 14A - Document hardening | Complete | Demo/test passwords, tokens, and secrets were replaced with safe placeholders in release docs. |
| 14B - Credential verification | Complete | Previously exposed demo credentials were tested against staging and did not authenticate. |
| 14C - Staging backup | Complete | Backup was created under the staging backups path and validated with `pg_restore -l`. |
| 14D - Restore test | Complete | Backup restored successfully into a temporary database and was removed afterward. |

## Credentials and Secrets

- No real passwords, tokens, or secrets are stored in Git.
- Real demo credentials must live outside the repository.
- If any credential is exposed again, rotate it immediately.

## Staging State

- Staging remained operational during all hardening checks.
- Staging continued using its isolated database and staging-only environment.
- Browser smoke for the public staging hosts remained valid.

## Production State

- Production was not touched.
- Production stayed healthy during the full hardening process.
- No production database, env file, or secret was modified.

## Backup and Restore Evidence

- Backup path:
  - `/opt/pawtech/backups/postgres/buildingos_staging_db/manual/buildingos_staging_db_before_private_pilot_20260709_041123.dump`
- Restore test database:
  - `buildingos_staging_restore_test_20260709_171146`
- Restore validation:
  - succeeded in the temporary database
  - temporary database was removed after validation

### Restore counts observed

| Entity | Count |
|---|---|
| Tenants | 4 |
| Buildings | 4 |
| Units | 22 |
| Users | 7 |
| Tenant members | 7 |
| Charges | 12 |
| Payments | 3 |
| Expenses | 3 |
| Documents | 5 |
| Tickets | 4 |
| Communications | 2 |

## Blocking Risks

- None currently blocking opening the pilot.

## Non-Blocking Risks

- Keep credentials out of Git and outside shared docs.
- Rotate any credential immediately if it is ever exposed again.
- Re-run backup/restore validation if the staging data model changes.

## Recommendations Before External Access

1. Keep staging credentials private and outside the repository.
2. Preserve the current backup as the rollback point until the pilot is stable.
3. Re-run browser smoke if the public edge or TLS configuration changes.
4. Keep staging and production isolated at the database, env, secret, and container levels.

