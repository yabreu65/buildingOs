# Pilot Access Pack

This guide is the short, safe starting point for external testers, beta customers, or internal reviewers who need to try the private pilot in staging.

## Summary

Use the staging pilot to validate the core owner/admin and resident workflows with controlled demo data only. Do not use real customer data, and do not store credentials in Git.

## Objective

Confirm that BuildingOS is usable in a private pilot with a small, controlled tenant setup before any broader rollout.

## Pilot scope

| Area | Included |
|---|---|
| Tenant | Pilot tenant only |
| Building | Pilot building only |
| Units | Pilot units only |
| Residents | Controlled pilot residents only |
| Finances | Read-only validation and controlled pilot data |
| Documents | Pilot-approved documents only |
| Tickets | Pilot tickets / requests only |
| Communications | Pilot announcements only |

## Environment

| Item | Value |
|---|---|
| Environment | Staging / private pilot |
| Pilot tenant name | `Pilot Controlado 01 Staging` |
| Tenant ID | `cmrcmb22d00003n08rsvc04fw` |
| Building ID | `cmrcmb28o000b3n08t0lyda2b` |
| Web URL | `https://buildingos-staging.31-220-98-21.sslip.io` |
| Login URL | `https://buildingos-staging.31-220-98-21.sslip.io/login` |
| API health | `https://buildingos-api-staging.31-220-98-21.sslip.io/health` |
| Files health | `https://buildingos-staging-files.31-220-98-21.sslip.io/minio/health/live` |

## Roles available

| Role | What to test |
|---|---|
| Owner/Admin | Full tenant/admin experience |
| Resident | Resident portal experience |

## Data loaded

| Item | Notes |
|---|---|
| Tenant | 1 controlled pilot tenant |
| Building | 1 controlled pilot building |
| Units | 10 units |
| Residents | Controlled pilot residents tied to units |
| Finance | Expenses, liquidation, charges, payments |
| Documents | Pilot-visible documents |
| Tickets | Pilot tickets / requests |
| Communications | Pilot announcements |

## Owner/Admin test flows

- Login
- Dashboard
- Pilot building
- Units
- Residents
- Finances
- Expenses
- Liquidation
- Charges
- Payments
- Documents
- Tickets / requests
- Communications

## Resident test flows

- Login
- Resident portal
- Debt / charges
- Payments
- Visible documents
- Communications
- Tickets / requests, if enabled

## What not to touch

- Do not use real customer data.
- Do not change credentials without notifying the internal owner.
- Do not delete pilot data.
- Do not upload real documents.
- Do not share access publicly.
- Do not test production.
- Do not try to bypass permissions outside the pilot scope.

## Credentials

**No real passwords or tokens are stored in Git.**

Demo credentials are delivered through a private channel only.

| Role | Email | Password |
|---|---|---|
| Owner/Admin | `<OWNER_EMAIL>` | `<OWNER_PASSWORD_STORED_OUTSIDE_GIT>` |
| Resident | `<RESIDENT_EMAIL>` | `<RESIDENT_PASSWORD_STORED_OUTSIDE_GIT>` |

## How to report bugs

Use this format:

- Role used:
- URL:
- Steps to reproduce:
- Expected result:
- Actual result:
- Screenshot / capture:
- Severity: low / medium / high / blocking

## Tester checklist

### Owner/Admin

- [ ] Login works
- [ ] Dashboard loads
- [ ] Building is visible
- [ ] Units are visible
- [ ] Residents are visible
- [ ] Finances are visible
- [ ] Expenses are visible
- [ ] Liquidation is visible
- [ ] Charges are visible
- [ ] Payments are visible
- [ ] Documents are visible
- [ ] Tickets / requests are visible
- [ ] Communications are visible

### Resident

- [ ] Login works
- [ ] Portal loads
- [ ] Debt / charges are visible
- [ ] Payments are visible
- [ ] Visible documents are accessible
- [ ] Communications are visible
- [ ] Tickets / requests are visible, if enabled

## Success criteria

- Core flows are understandable without engineering help.
- The tester can complete the agreed walkthrough.
- Errors are understandable and actionable.
- The pilot stays isolated from production data.
- At least one useful improvement or bug is captured.

## Security warnings

- Keep credentials private.
- Never copy passwords, tokens, or secrets into Git.
- Use only the staging pilot URLs above.
- If any credential is exposed again, rotate it immediately.

## Credential policy

Real demo credentials must be stored outside this repository and shared only through a private channel.

## Internal contact

Pilot owner / internal support contact is shared privately with the pilot team.

## References

- [`docs/release/PILOT_STAGING_STATUS.md`](./PILOT_STAGING_STATUS.md)
- [`docs/release/PILOT_HARDENING_STATUS.md`](./PILOT_HARDENING_STATUS.md)
- [`docs/release/PRIVATE_PILOT_PLAYBOOK.md`](./PRIVATE_PILOT_PLAYBOOK.md)
- [`docs/release/FINAL_PILOT_CHECKLIST.md`](./FINAL_PILOT_CHECKLIST.md)

