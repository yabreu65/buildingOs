# Pilot Runbook

This internal runbook explains how to operate the private pilot day to day: check system health, review logs, triage feedback, handle incidents, manage backups, and decide whether the pilot should continue, pause, or close.

## Summary

Use this runbook as the operating playbook for the private pilot. It keeps staging healthy, keeps production untouched, and gives the team a consistent way to respond to bugs, feedback, and incidents.

## Objective

Provide a short, repeatable operating process for the private pilot so internal owners can support testers without exposing secrets or relying on memory.

## Scope

| Area | Included |
|---|---|
| Environment | Staging private pilot only |
| Health checks | API, web, and files endpoints |
| Feedback | Collection, classification, and follow-up |
| Logs | Read-only review for bugs/incidents |
| Backups | Staging backup and restore coordination |
| Incidents | Triage, escalation, and rollback decisions |

## Internal owners

| Role | Responsibility |
|---|---|
| Pilot owner | Final decision on pause / continue / close |
| Support lead | Receives feedback and tracks follow-up |
| Engineering owner | Investigates bugs and ships fixes |
| Operations owner | Watches staging health and rollback readiness |

## Pilot environment

| Item | Value |
|---|---|
| Pilot tenant | `Pilot Controlado 01 Staging` |
| Tenant ID | `cmrcmb22d00003n08rsvc04fw` |
| Building ID | `cmrcmb28o000b3n08t0lyda2b` |
| Web URL | `https://buildingos-staging.31-220-98-21.sslip.io` |
| Login URL | `https://buildingos-staging.31-220-98-21.sslip.io/login` |
| API health | `https://buildingos-api-staging.31-220-98-21.sslip.io/health` |
| API readiness | `https://buildingos-api-staging.31-220-98-21.sslip.io/ready` |
| API readiness alias | `https://buildingos-api-staging.31-220-98-21.sslip.io/readyz` |
| Files health | `https://buildingos-staging-files.31-220-98-21.sslip.io/minio/health/live` |

## Credential rule

**Real demo credentials must never be stored in Git.**

Credentials are delivered through a private channel only. If a credential is exposed, rotate it immediately and update the private handoff.

## Daily routine

1. Check staging web `/login`.
2. Check staging API `/health`.
3. Check staging API `/ready`.
4. Check staging API `/readyz`.
5. Review new feedback entries.
6. Review recent logs only if there was a bug or incident.
7. Confirm production stayed untouched if any operational action was performed.
8. Record an incident if anything looks off.

## Before a tester session

1. Confirm the staging URLs.
2. Confirm the current private credentials are valid without writing them into Git.
3. Confirm the tester received the [Pilot Access Pack](./PILOT_ACCESS_PACK.md).
4. Confirm the tester knows how to report issues with the [Pilot Feedback Pack](./PILOT_FEEDBACK_PACK.md).
5. Confirm no real customer data will be used.
6. Validate login for Owner/Admin or Resident, as needed.

## After a tester session

1. Collect the feedback report.
2. Classify each item as bug, improvement, question, or UX friction.
3. Assign severity and priority.
4. Decide: fix now, backlog, or no action.
5. Record incidents separately if they occurred.
6. Confirm no real data was uploaded.
7. Rotate credentials if they were ever shared incorrectly.

## Monitoring basics

| Signal | OK | Warning | Incident |
|---|---|---|---|
| Web login | Loads and renders | Slow or flaky | Cannot load or redirects unexpectedly |
| API health | Returns 200 | Intermittent failures | Down or returning errors |
| API readiness | Returns 200 | Degraded dependencies | Not ready for traffic |
| Files health | Returns 200 | Intermittent errors | Upload/download path broken |

## Log review

- Review logs only when there is a bug or incident.
- Never paste logs with secrets into tickets or chat.
- Redact tokens, passwords, and credentials before sharing.
- A missing Sentry DSN can be a warning expected in staging.

Suggested read-only checks:

```bash
docker logs --tail=100 buildingos-staging-api
docker logs --tail=100 buildingos-staging-web
```

## Feedback review flow

1. Receive feedback.
2. Classify it.
3. Reproduce if possible.
4. Assign severity and priority.
5. Decide the action.
6. Create the internal task or issue if needed.
7. Close the loop with the tester.

## Incident handling

1. Stop and record the symptoms.
2. Identify whether the issue is login, API, files, permissions, or data.
3. Check whether production is still healthy.
4. Decide whether the issue is a bug, an operational incident, or a rollout blocker.
5. Escalate to the pilot owner if the issue is not clearly non-blocking.

## Backup and rollback

- A validated staging backup already exists.
- A restore test was already validated successfully.
- Do not restore without an explicit decision.
- Do not restore over production.
- Restore only to staging or a temporary database, as appropriate.
- Document the incident before any rollback.

## When to pause the pilot

- Login is broken for both roles.
- Credentials are exposed.
- Real data was uploaded by mistake.
- Staging API is down.
- A critical finance flow is broken.
- Permissions leak across roles.
- Private files are exposed publicly.

## When to continue the pilot

- Only minor bugs are open.
- The issues are visual or copy-related.
- The feedback is mostly usability friction.
- There are workarounds for the open issues.
- No critical flow is blocked.

## When to close the pilot

- Core flows were validated.
- Feedback is classified and tracked.
- Blocking bugs are fixed or explicitly documented.
- A Go / No-Go decision was made.
- Next fixes are prioritized.
- Demo credentials were reviewed and remain outside Git.

## Decision matrix

| Severity | Priority | Action | Responsible | Suggested timing |
|---|---|---|---|---|
| Blocking | P0 | Fix immediately | Engineering owner | Same day |
| High | P1 | Fix during pilot | Engineering owner | Soon |
| Medium | P2 | Add to short backlog | Support lead | This week |
| Low | P3 | Capture as future improvement | Product owner | Later |

## Security rules

- Do not store credentials in Git.
- Do not send passwords through public channels.
- Do not use real customer data.
- Do not upload real documents.
- Hide sensitive data in screenshots.
- Rotate credentials if exposure is suspected.

## Tester close checklist

- [ ] Login was checked.
- [ ] Owner/Admin or Resident flow was validated.
- [ ] Feedback was collected.
- [ ] Issues were classified.
- [ ] Severity and priority were assigned.
- [ ] Incident status was recorded, if relevant.
- [ ] Tester was informed of next steps.

## References

- [`docs/release/PILOT_ACCESS_PACK.md`](./PILOT_ACCESS_PACK.md)
- [`docs/release/PILOT_FEEDBACK_PACK.md`](./PILOT_FEEDBACK_PACK.md)
- [`docs/release/PILOT_STAGING_STATUS.md`](./PILOT_STAGING_STATUS.md)
- [`docs/release/PILOT_HARDENING_STATUS.md`](./PILOT_HARDENING_STATUS.md)
- [`docs/release/PRIVATE_PILOT_PLAYBOOK.md`](./PRIVATE_PILOT_PLAYBOOK.md)
- [`docs/release/FINAL_PILOT_CHECKLIST.md`](./FINAL_PILOT_CHECKLIST.md)
- [`docs/release/STAGING_STATUS.md`](./STAGING_STATUS.md)

