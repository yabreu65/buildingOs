# Private Pilot Handoff

This document is the final handoff package for an external tester or beta customer joining the BuildingOS private pilot.
It gives them the right links, the right scope, the right reporting format, and the right safety rules without exposing credentials in Git.

## Quick path

1. Share the staging URL and the private credentials through a private channel.
2. Ask the tester to complete the owner/admin or resident flow assigned to them.
3. Collect feedback using the templates in this document and the Pilot Feedback Pack.

## Summary

| Topic | Decision |
|---|---|
| Launch state | GO WITH OBSERVATIONS |
| Pilot environment | Staging private pilot |
| Tester audience | External tester or beta customer |
| Credential policy | Credentials are kept out of Git |

## Environment

| Item | Value |
|---|---|
| Web staging | `https://buildingos-staging.31-220-98-21.sslip.io` |
| Login | `https://buildingos-staging.31-220-98-21.sslip.io/login` |
| API health | `https://buildingos-api-staging.31-220-98-21.sslip.io/health` |
| Decision reference | `docs/release/PILOT_LAUNCH_DECISION.md` |

## Roles available

- Owner/Admin
- Resident

## Credentials

The real credentials are delivered through a private channel and must never be stored in this repository.

| Role | Placeholder |
|---|---|
| Owner/Admin email | `<OWNER_EMAIL>` |
| Owner/Admin password | `<OWNER_PASSWORD_STORED_OUTSIDE_GIT>` |
| Resident email | `<RESIDENT_EMAIL>` |
| Resident password | `<RESIDENT_PASSWORD_STORED_OUTSIDE_GIT>` |

## Suggested message to send to the tester

Hello,

Please use the private BuildingOS pilot at:
`https://buildingos-staging.31-220-98-21.sslip.io`

You have been assigned the **[Owner/Admin | Resident]** role.
Please test the flows included in the pilot, report anything confusing or broken, and avoid using real customer data.

Do not share credentials, do not try production, and do not upload real documents or real tenant data.
Send feedback through the Pilot Feedback Pack format or the private support channel provided separately.

## What to test — Owner/Admin

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
- Tickets / complaints
- Communications

## What to test — Resident

- Login
- Resident portal
- Debt / charges
- Payments
- Visible documents
- Communications
- Tickets / complaints, if applicable

## What not to do

- Do not use real data.
- Do not upload real documents.
- Do not share credentials.
- Do not test production.
- Do not delete pilot data.
- Do not change credentials without telling the team.
- Do not try to access modules outside the pilot scope.
- Do not share screenshots that expose sensitive data.

## How to report feedback

Use the Pilot Feedback Pack format:

### Bug
- Role
- URL
- Steps
- Expected
- Actual
- Severity
- Screenshot if helpful

### Improvement
- Screen
- Problem
- Suggested improvement
- Priority

### Question
- Screen
- Question
- What you tried to do

## Privacy rules

- No passwords in Git.
- No tokens in Git.
- No secrets in Git.
- No real customer data in the pilot.
- Sensitive details in screenshots must be hidden.
- Pilot credentials must be rotated if they are ever exposed.

## Internal support contact

Use the internal support channel defined by the pilot owner.
Do not place personal phone numbers, emails, or direct secrets in this document.

## Suggested testing window

Use a short, defined window agreed with the pilot owner so feedback can be reviewed quickly and issues can be triaged while the context is fresh.

## Success criteria

- Tester can log in with the assigned role.
- Tester can complete the assigned flows without blockers.
- Feedback is captured in a consistent format.
- No real data is used.
- No secrets are exposed.

## Checklist before sending

- [ ] Staging `/login` responds
- [ ] API `/health` responds
- [ ] Private credentials are valid
- [ ] Tester received instructions
- [ ] Tester knows not to use real data
- [ ] Support channel is defined

## Checklist after sending

- [ ] Confirm access
- [ ] Confirm first login
- [ ] Collect initial feedback
- [ ] Review whether any incident occurred
- [ ] Register bugs and improvements
- [ ] Pause the pilot if a blocking risk appears

## Related documents

- `docs/release/PILOT_ACCESS_PACK.md`
- `docs/release/PILOT_FEEDBACK_PACK.md`
- `docs/release/PILOT_RUNBOOK.md`
- `docs/release/PILOT_LAUNCH_DECISION.md`
- `docs/release/PILOT_GO_NO_GO_CHECKLIST.md`
- `docs/release/PILOT_HARDENING_STATUS.md`
- `docs/release/PILOT_STAGING_STATUS.md`

## Important warning

This document must not contain real credentials. Pilot credentials are delivered through a private channel and must be rotated if they are exposed.
