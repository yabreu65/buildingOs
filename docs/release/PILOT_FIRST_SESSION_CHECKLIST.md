# Pilot First Session Checklist

This checklist is for the **first real tester session** in the private pilot.
It helps the team confirm the environment is ready before the tester joins, observe the session without interrupting it, and close the loop after the session with clear next steps.

## Quick path

1. Confirm staging, credentials, support channel, and session window.
2. Let the tester complete the assigned Owner/Admin or Resident flow.
3. Capture feedback, incidents, and follow-up actions immediately after the session.

## Session context

| Topic | Decision |
|---|---|
| Environment | Staging private pilot |
| Decision state | GO WITH OBSERVATIONS |
| Session goal | Validate the first live tester experience |
| Credential policy | Credentials stay outside Git |

## Environment

| Item | Value |
|---|---|
| Web staging | `https://buildingos-staging.31-220-98-21.sslip.io` |
| Login | `https://buildingos-staging.31-220-98-21.sslip.io/login` |
| API health | `https://buildingos-api-staging.31-220-98-21.sslip.io/health` |
| API readiness | `https://buildingos-api-staging.31-220-98-21.sslip.io/ready` |
| API readiness alias | `https://buildingos-api-staging.31-220-98-21.sslip.io/readyz` |

## Participants

- Pilot owner
- Support lead
- Tester / beta customer
- Engineering owner, if needed

## Credential rule

**Real pilot credentials must never be stored in Git.**

Credentials are delivered through a private channel only.
If a credential is exposed, it must be rotated and the private handoff updated.

## Before the session

- [ ] Staging `/login` returns 200
- [ ] API `/health` returns 200
- [ ] API `/ready` returns 200
- [ ] API `/readyz` returns 200
- [ ] Private credentials are valid
- [ ] Tester received the Pilot Handoff
- [ ] Tester received the Pilot Access Pack
- [ ] Tester understands the pilot uses fictitious data only
- [ ] Support channel is defined
- [ ] Session time window is defined
- [ ] Tester role is defined: Owner/Admin or Resident

## During the session

- [ ] Confirm the first login succeeds
- [ ] Confirm the initial dashboard or portal renders
- [ ] Observe whether the tester understands the flow without help
- [ ] Record questions as they appear
- [ ] Record bugs as they appear
- [ ] Record UX friction as they appear
- [ ] Do not expose passwords on shared screens
- [ ] Do not allow real data to be entered
- [ ] Pause immediately if a blocking risk appears

## Owner/Admin flow to watch

- [ ] Login
- [ ] Dashboard
- [ ] Pilot building
- [ ] Units / residents
- [ ] Finances
- [ ] Expenses
- [ ] Liquidation
- [ ] Charges
- [ ] Payments
- [ ] Documents
- [ ] Tickets / complaints
- [ ] Communications

## Resident flow to watch

- [ ] Login
- [ ] Resident portal
- [ ] Debt / charges
- [ ] Payments
- [ ] Visible documents
- [ ] Communications
- [ ] Tickets / complaints, if applicable

## Signals to watch

- Login feels confusing or broken
- API fails or is slow
- Role access feels wrong
- Private documents show up incorrectly
- Finance screens look wrong or fail
- The tester tries to use real data
- A credential is exposed on screen or in chat
- Production is accidentally impacted

## Pause criteria

- Tester cannot log in
- A role sees information it should not see
- A blocker appears in finance, documents, or permissions
- Credentials leak
- Real data is uploaded by mistake
- Production is impacted accidentally

## Continue criteria

- Only minor bugs are found
- Issues are mostly visual or copy-related
- The tester is confused but can keep going
- UX friction is present but not blocking
- A workaround exists

## After the session

- [ ] Confirm logout / close session if applicable
- [ ] Collect feedback
- [ ] Classify bugs, improvements, doubts, and UX friction
- [ ] Assign severity and priority
- [ ] Review whether real data was entered by mistake
- [ ] Review whether credentials were exposed
- [ ] Register incidents
- [ ] Define the next fixes
- [ ] Decide whether the pilot continues

## Notes format

### Quick notes
- Role:
- URL:
- What happened:
- What the tester expected:
- What the tester got:

### Quick incident
- Time:
- Role:
- URL:
- Impact:
- Severity:
- Action taken:

### Quick feedback
- Type:
- Screen:
- Summary:
- Priority:

## Next steps after the session

1. Review the notes immediately.
2. Classify feedback with the Pilot Feedback Pack.
3. Open internal issues for blockers and important improvements.
4. Update the pilot owner on the outcome.
5. Decide whether the next session should continue, pause, or wait for fixes.

## Related documents

- `docs/release/PILOT_HANDOFF.md`
- `docs/release/PILOT_ACCESS_PACK.md`
- `docs/release/PILOT_FEEDBACK_PACK.md`
- `docs/release/PILOT_RUNBOOK.md`
- `docs/release/PILOT_LAUNCH_DECISION.md`
- `docs/release/PILOT_GO_NO_GO_CHECKLIST.md`
- `docs/release/PILOT_HARDENING_STATUS.md`

## Important warning

This document must not contain real credentials. Pilot credentials are delivered through a private channel and must be rotated if they are exposed.
