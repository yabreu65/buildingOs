# Pilot Launch Decision

This document captures the final launch decision for the BuildingOS private pilot.
It consolidates the evidence already validated across staging, hardening, backup/restore, access, feedback, runbook, and Go/No-Go review so the team can decide whether to open the pilot to testers or beta customers.

## Summary

**Recommended state:** GO WITH OBSERVATIONS

The pilot is technically ready, staging is healthy, owner/admin and resident access work, backup and restore validation passed, documentation is complete, and no blocking security issue is known. Remaining items are observations, not blockers, because the environment is still a private pilot with controlled, fictitious data.

## Purpose

- Make the launch decision explicit.
- Reuse the evidence already collected instead of re-litigating it.
- Keep the decision focused on pilot readiness, not production readiness.

## Scope of the decision

This decision covers:

- staging readiness
- private pilot access readiness
- security and secret handling
- backup and restore confidence
- documentation completeness
- tester communication readiness

It does not certify the system as a public production release.

## Decision

| Field | Value |
|---|---|
| Decision | GO WITH OBSERVATIONS |
| Date | 2026-07-09 |
| Reference commit | `9be9383` |
| Evaluated environment | Staging + private pilot data pack |

## Decision rationale

The current evidence supports opening the private pilot because:

- staging public access works
- API health, readiness, and files checks are in place
- owner/admin login works
- resident login works
- demo data is loaded and controlled
- docs no longer contain real credentials
- backup and restore were validated
- production remains intact

The decision is not pure GO because this is still a private pilot and minor issues may surface during real tester usage.

## Technical evidence

- Web staging public entry is available
- API staging `/health`, `/ready`, and `/readyz` respond correctly
- Files staging health endpoint is available
- Staging Traefik routing is operational
- Staging CORS is aligned with browser usage
- Production web and API remain healthy
- Restore test on a temporary database was validated successfully

## Functional evidence

- Owner/Admin login works
- Resident login works
- Pilot tenant and building are loaded
- Finance screens are available
- Documents are available
- Tickets are available
- Communications are available
- The pilot uses controlled, fictitious data

## Security evidence

- Release docs were sanitized
- Old documented credentials were checked and are inactive
- No real credentials remain in Git
- Real credentials live outside the repository
- No tokens or secrets are stored in the release docs
- No real customer data is present in staging

## Backup and rollback evidence

- Staging backup exists
- `pg_restore -l` validation passed
- Restore test in a temporary database passed
- Temporary database was deleted after validation
- Rollback remains an explicit operator decision

## Documentation available

- `docs/release/PILOT_GO_NO_GO_CHECKLIST.md`
- `docs/release/PILOT_ACCESS_PACK.md`
- `docs/release/PILOT_FEEDBACK_PACK.md`
- `docs/release/PILOT_RUNBOOK.md`
- `docs/release/PILOT_STAGING_STATUS.md`
- `docs/release/PILOT_HARDENING_STATUS.md`
- `docs/release/PRIVATE_PILOT_PLAYBOOK.md`
- `docs/release/FINAL_PILOT_CHECKLIST.md`
- `docs/release/STAGING_STATUS.md`

## Risks accepted

- Minor bugs may appear during the pilot
- Copy or UX improvements may be needed
- Staging warnings may exist if documented and non-blocking
- Sentry may remain without a DSN in staging if that is the documented setup
- The pilot does not represent production volume or real customer behavior

## Risks not accepted

- Credential leakage
- Real customer data in staging
- Broken owner/admin login
- Broken resident login
- API staging outage
- Cross-role permission leakage
- Private document exposure
- Critical finance errors
- Production impact

## Blockers

None known at the time of this decision.

## Conditions to open the pilot

- Share the staging URL
- Deliver credentials through a private channel
- Share the Pilot Access Pack
- Share the Pilot Feedback Pack
- Explain what testers must not touch
- Confirm testers will use only fictitious data
- Define a support window
- Define the escalation channel

## Conditions to pause the pilot

- Credential leakage
- Real data uploaded by mistake
- API staging outage
- Login breaks for either role
- Critical finance error
- Cross-role permission failure
- Private document exposure
- Any accidental impact to production

## Next steps

1. Open the pilot to the approved tester group.
2. Track feedback through the Pilot Feedback Pack.
3. Use the Pilot Runbook for operational support.
4. Reassess launch status if a blocker appears.

## Responsible roles

| Role | Responsibility |
|---|---|
| Product owner | Final product call |
| Engineering owner | Technical readiness and risk assessment |
| Operations owner | Access, backup, rollback, and support readiness |
| Support owner | Tester onboarding and feedback intake |

## Sign-off

- Product owner: ____________________
- Engineering owner: ____________________
- Operations owner: ____________________
- Support owner: ____________________

## Important warning

This document must not contain real credentials. Pilot credentials are delivered through a private channel and must be rotated if they are exposed.

## Related documents

- `docs/release/PILOT_GO_NO_GO_CHECKLIST.md`
- `docs/release/PILOT_ACCESS_PACK.md`
- `docs/release/PILOT_FEEDBACK_PACK.md`
- `docs/release/PILOT_RUNBOOK.md`
- `docs/release/PILOT_HARDENING_STATUS.md`
- `docs/release/PILOT_STAGING_STATUS.md`
