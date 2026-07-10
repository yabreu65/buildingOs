# Pilot Results Review

This document captures the results of a real pilot session after a tester or beta customer has used BuildingOS.
It organizes feedback, bugs, improvements, doubts, UX friction, and the next prioritized fixes so the team can decide what to do next.

## Quick path

1. Record the session details and overall outcome.
2. Classify every item into bugs, improvements, doubts, or UX friction.
3. Decide whether to continue, pause, repeat, or fix before the next session.

## Summary

| Topic | Decision |
|---|---|
| Purpose | Review the outcome of one real pilot session |
| Scope | Feedback, bugs, improvements, decisions, and follow-up |
| Environment | Staging private pilot |
| Credential policy | No credentials, tokens, or secrets in Git |

## When to use this document

Use this document immediately after a real tester session has ended and the team needs to decide what to fix next.

## Participants

- Tester / beta customer
- Pilot owner
- Support lead
- Engineering owner, if needed

## Session data

| Field | Value |
|---|---|
| Date |  |
| Tester | `<TESTER_ALIAS_OR_ROLE>` |
| Role tested | Owner/Admin or Resident |
| Approximate duration |  |
| Browser / device |  |
| Environment | Staging |
| URL used |  |
| Internal owner |  |

> Do not store personal data that is not necessary for the review.

## General outcome

| Field | Value |
|---|---|
| Overall result |  |
| Session health |  |
| Blockers found |  |
| Continue / pause decision |  |

## Session metrics

| Metric | Value |
|---|---|
| Login successful | yes / no |
| Flows completed |  |
| Flows blocked |  |
| Bugs found |  |
| Improvements found |  |
| Questions found |  |
| UX friction points |  |
| Critical incidents | yes / no |
| Real data uploaded by mistake | yes / no |
| Credentials exposed | yes / no |

## Feedback received

Summarize the main takeaways from the tester here before drilling into individual items.

## Bugs

| ID | Role | Module | URL / Screen | Description | Steps to reproduce | Expected | Actual | Severity | Priority | Status | Owner | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B-001 |  |  |  |  |  |  |  |  |  |  |  |  |

## Improvements

| ID | Role | Module | Need | Proposal | Benefit | Priority | Decision | Status |
|---|---|---|---|---|---|---|---|---|
| I-001 |  |  |  |  |  |  |  |  |

## Questions

| ID | Role | Screen | Question | Answer / Decision | Requires change |
|---|---|---|---|---|---|
| Q-001 |  |  |  |  | yes / no |

## UX friction

| ID | Screen | Action attempted | Friction point | Impact | Proposal | Priority |
|---|---|---|---|---|---|---|
| UX-001 |  |  |  |  |  |  |

## Incidents

| Incident | Severity | Impact | Mitigation | Requires pilot pause | Decision |
|---|---|---|---|---|---|
|  |  |  |  | yes / no |  |

## Risk review

- Blocking risk found: yes / no
- New security risk: yes / no
- New finance risk: yes / no
- New data exposure risk: yes / no

## Decision after the session

Choose one:

- Continue pilot
- Continue with observations
- Pause pilot
- Close pilot
- Repeat session
- Prepare fixes

| Field | Value |
|---|---|
| Decision |  |
| Reason |  |
| Responsible |  |
| Date |  |

## Criteria to continue

- No blocking bugs
- Login works
- Fictitious data remains intact
- No credential exposure
- No cross-role permission leaks
- Feedback can be classified and acted on

## Criteria to pause

- Blocking bug
- Credential leak
- Real data uploaded
- Cross-role permission leak
- Critical finance error
- Staging instability
- Production affected

## Next fixes

| Priority | Items |
|---|---|
| P0 before next session |  |
| P1 during pilot |  |
| P2 short backlog |  |
| P3 future |  |

## Privacy rules

- Do not record passwords.
- Do not record tokens.
- Do not paste logs with secrets.
- Do not keep unnecessary personal data.
- Anonymize the tester if needed.
- Hide sensitive data in screenshots.

## Important warning

This document must not contain real credentials, tokens, secrets, or unnecessary personal data. Any sensitive evidence must be sanitized before being saved.

## Related documents

- `docs/release/PILOT_FEEDBACK_PACK.md`
- `docs/release/PILOT_FIRST_SESSION_CHECKLIST.md`
- `docs/release/PILOT_RUNBOOK.md`
- `docs/release/PILOT_HANDOFF.md`
- `docs/release/PILOT_LAUNCH_DECISION.md`
- `docs/release/PILOT_GO_NO_GO_CHECKLIST.md`
- `docs/release/PILOT_HARDENING_STATUS.md`

