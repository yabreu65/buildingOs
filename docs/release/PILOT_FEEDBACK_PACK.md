# Pilot Feedback Pack

Use this pack to collect real feedback from testers, beta customers, or internal reviewers during the private pilot.

## Summary

The goal is to capture clear, actionable feedback without exposing credentials, production data, or sensitive customer information.

## When to use it

- During pilot walkthroughs
- After a blocked workflow
- After a confusing screen or error
- After a tester finds an improvement opportunity

## Who should use it

- Owner/Admin testers
- Resident testers
- Internal product or support reviewers
- Pilot sponsor / internal owner

## How to send feedback

Use the templates below and share the report through the private pilot channel.

## Severity scale

| Severity | Meaning |
|---|---|
| Blocking | Prevents the pilot from being used |
| High | Breaks a main workflow |
| Medium | Makes the flow hard to use, but a workaround exists |
| Low | Small visual issue, copy issue, or minor improvement |

## Priority scale

| Priority | Meaning |
|---|---|
| P0 | Fix before the pilot continues |
| P1 | Fix during the pilot |
| P2 | Short-term backlog |
| P3 | Future idea |

## How feedback is classified

| Type | When to use |
|---|---|
| Bug | Something is broken or behaves incorrectly |
| Improvement | The flow works, but could be better |
| Question | The tester needs clarification |
| UX friction | The tester gets stuck, confused, or slowed down |

## Bug report template

- Role used: Owner/Admin or Resident
- URL:
- Module:
- Steps to reproduce:
- Expected result:
- Actual result:
- Frequency: always / sometimes / once
- Severity: low / medium / high / blocking
- Screenshot or video:
- Browser / device:
- Approximate date and time:

## Improvement report template

- Module:
- Problem or need:
- Suggested improvement:
- Expected benefit:
- Suggested priority:
- Role that needs it:
- Pilot impact:

## Question template

- Role used:
- Screen or module:
- Question:
- What the tester tried to do:
- What they expected to find:

## UX friction template

- Screen:
- Action attempted:
- Where the tester got stuck:
- Which text / button / flow was confusing:
- Suggested fix, if any:

## Privacy and security rules

- Do not send passwords.
- Do not send tokens.
- Do not send real customer data.
- Do not upload real documents.
- Hide sensitive data in screenshots.
- Use only fictional pilot data.
- Do not share access publicly.

## Do not send

- Real credentials
- Full tokens or secrets
- Production data
- Personal identifiers that are not part of the approved pilot
- Screenshots with visible sensitive information

## Internal review process

1. Receive the report.
2. Classify it as bug, improvement, question, or UX friction.
3. Reproduce when possible.
4. Assign severity and priority.
5. Decide: bug, improvement, no action, or backlog.
6. Create the internal issue or task if needed.
7. Assign an owner.
8. Close the loop with the tester.

## Feedback close checklist

- [ ] Reproduced or marked as not reproducible
- [ ] Severity assigned
- [ ] Priority assigned
- [ ] Decision made
- [ ] Issue or task created, if applicable
- [ ] Tester informed, if applicable

## Example summary format

| Field | Value |
|---|---|
| Role | Owner/Admin |
| Screen | Finance dashboard |
| Type | Bug |
| Severity | High |
| Priority | P1 |
| Decision | Create internal issue |

## Internal contact

Pilot owner / support contact is shared privately with the pilot team and must not be stored in Git.

## References

- [`docs/release/PILOT_ACCESS_PACK.md`](./PILOT_ACCESS_PACK.md)
- [`docs/release/PILOT_STAGING_STATUS.md`](./PILOT_STAGING_STATUS.md)
- [`docs/release/PILOT_HARDENING_STATUS.md`](./PILOT_HARDENING_STATUS.md)
- [`docs/release/PRIVATE_PILOT_PLAYBOOK.md`](./PRIVATE_PILOT_PLAYBOOK.md)

