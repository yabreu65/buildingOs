# Pilot Go / No-Go Checklist

This checklist is the final decision gate for opening the BuildingOS private pilot to external testers or beta customers.
It summarizes the minimum evidence required to say **Go**, the conditions that force **No-Go**, and the remaining observations that may be accepted without blocking the pilot.

## Overview

The pilot is considered ready only when staging, documentation, backup/restore, and the core owner/admin and resident flows are all working together without exposing secrets or production data.

## Purpose

- Make the release decision explicit.
- Prevent subjective approvals based on "it seems fine."
- Keep the pilot limited to controlled, fictitious data.
- Ensure the team knows exactly what evidence is required before inviting testers.

## Scope of the decision

This checklist covers:

- public staging access
- owner/admin and resident access
- core operational flows
- pilot data quality
- security and secret handling
- backup and rollback readiness
- release documentation completeness
- tester communication readiness

It does not replace bug triage, operational runbooks, or pilot feedback handling. It only decides whether the pilot can open.

## Reference

| Field | Value |
|---|---|
| Version | 1.0 |
| Reference date | 2026-07-09 |
| Reference commit | `96d4fef` |
| Pilot baseline | Staging + Pilot Access Pack + Feedback Pack + Runbook + Hardening Status |

## Decision owners

| Role | Responsibility |
|---|---|
| Product owner | Accepts product scope and pilot readiness |
| Engineering owner | Confirms technical readiness and safety |
| Operations owner | Confirms rollback, backup, and access procedures |
| Support owner | Confirms tester guidance and feedback intake |

## Go criteria

All of the following must be true:

- staging public URLs respond correctly
- owner/admin login works
- resident login works
- core pilot flows are visible and usable
- the pilot uses fictitious or controlled data only
- no secrets are stored in Git
- staging backup exists
- restore test was validated in a temporary database
- Pilot Access Pack is ready
- Pilot Feedback Pack is ready
- Pilot Runbook is ready
- Pilot Hardening Status is ready
- staging and production remain separated
- production is intact and healthy

## No-Go criteria

Any of the following is a blocker:

- owner/admin login fails
- resident login fails
- staging API is down
- credentials are exposed or still active in Git
- real customer data appears in staging
- role isolation fails
- private resident documents are visible incorrectly
- core finance flows fail in a critical way
- backup is missing or restore test was not validated
- production is affected
- testers do not have a clear access guide

## Go with observations criteria

The pilot may still open if the only remaining issues are non-blocking:

- minor visual issues
- copy improvements
- low-severity UX friction
- expected staging warnings documented in the runbook
- Sentry without a DSN in staging, if explicitly accepted
- non-core features outside pilot scope

## Technical checklist

- [ ] Web staging `/login` returns 200
- [ ] API staging `/health` returns 200
- [ ] API staging `/ready` returns 200
- [ ] API staging `/readyz` returns 200
- [ ] Files staging health endpoint returns 200
- [ ] Staging CORS is correct
- [ ] Staging Traefik routers are correct
- [ ] Production web returns 200
- [ ] Production API `/health` returns 200

## Functional checklist — Owner/Admin

- [ ] Login
- [ ] Dashboard
- [ ] Pilot building
- [ ] Units
- [ ] Residents
- [ ] Finances
- [ ] Expenses
- [ ] Liquidation
- [ ] Charges
- [ ] Payments
- [ ] Documents
- [ ] Tickets
- [ ] Communications

## Functional checklist — Resident

- [ ] Login
- [ ] Portal
- [ ] Debt / charges
- [ ] Payments
- [ ] Visible documents
- [ ] Communications
- [ ] Tickets / complaints, if applicable

## Security checklist

- [ ] No passwords in Git
- [ ] No tokens in Git
- [ ] No secrets in Git
- [ ] Real credentials are stored outside the repository
- [ ] Old exposed credentials have been verified inactive
- [ ] Browser smoke showed no critical errors
- [ ] No real customer data is present
- [ ] Captures and screenshots are sanitized

## Demo data checklist

- [ ] Tenant data is fictitious or controlled
- [ ] Building data is fictitious or controlled
- [ ] Resident data is fictitious or controlled
- [ ] Finance data is fictitious or controlled
- [ ] Documents are safe for demo use
- [ ] Tickets are demo-safe
- [ ] Communications are demo-safe
- [ ] No live customer records are used

## Backup / rollback checklist

- [ ] Staging backup was created
- [ ] `pg_restore -l` validated the backup
- [ ] Restore test passed in a temporary database
- [ ] Temporary database was deleted
- [ ] Rollback requires an explicit decision

## Documentation checklist

- [ ] Pilot Access Pack is ready
- [ ] Pilot Feedback Pack is ready
- [ ] Pilot Runbook is ready
- [ ] Pilot Hardening Status is ready
- [ ] Pilot Staging Status is ready
- [ ] Credentials are not included in docs

## Tester communication checklist

- [ ] Tester receives the staging URL
- [ ] Tester receives credentials by private channel
- [ ] Tester receives the Access Pack
- [ ] Tester receives the Feedback Pack
- [ ] Tester knows what not to touch
- [ ] Tester knows how to report bugs

## Matrix of evidence

| Condition | Status | Evidence | Decision | Responsible |
|---|---|---|---|---|
| Staging access |  |  |  |  |
| Owner/Admin login |  |  |  |  |
| Resident login |  |  |  |  |
| Core flows |  |  |  |  |
| Demo data |  |  |  |  |
| Security |  |  |  |  |
| Backup / restore |  |  |  |  |
| Documentation |  |  |  |  |
| Tester communication |  |  |  |  |

## Final decision

Choose one:

- **GO**
- **GO WITH OBSERVATIONS**
- **NO-GO**

| Field | Value |
|---|---|
| Decision date | 2026-07-09 |
| Decision owner |  |
| Notes |  |

## Sign-off

- Product owner: ____________________
- Engineering owner: ____________________
- Operations owner: ____________________
- Support owner: ____________________

## Important warning

This document must not contain real credentials. Pilot credentials are delivered through a private channel and must be rotated if they are ever exposed.

## Related documents

- `docs/release/PILOT_ACCESS_PACK.md`
- `docs/release/PILOT_FEEDBACK_PACK.md`
- `docs/release/PILOT_RUNBOOK.md`
- `docs/release/PILOT_HARDENING_STATUS.md`
- `docs/release/PILOT_STAGING_STATUS.md`
- `docs/release/PRIVATE_PILOT_PLAYBOOK.md`
- `docs/release/FINAL_PILOT_CHECKLIST.md`
- `docs/release/STAGING_STATUS.md`
