# Private Pilot Playbook

Use this playbook to run a controlled private pilot of BuildingOS with a small number of trusted customers before any staging or production rollout. It defines the allowed scope, the minimum acceptance bar, and the operating rhythm for feedback.

## Quick path

1. Pick one pilot account and one internal owner for the pilot.
2. Use controlled demo data only; do not connect real customer data.
3. Validate the agreed flows with the pilot checklist.
4. Capture feedback, log gaps, and decide whether the pilot is ready to continue.

## Pilot goals

| Topic | Decision |
|-------|----------|
| Objective | Prove the product can support a real building administrator with a small, controlled tenant setup. |
| Outcome | Validate usability, trust, and operational fit before staging or production. |
| Success signal | The pilot team can complete the core admin → finance → resident flows without blocking issues. |

## Allowed scope

| Area | Allowed |
|------|---------|
| Tenants | Create or use one pilot tenant per customer. |
| Buildings | Create a small, representative building set. |
| Units | Load only the units needed for the pilot. |
| Residents | Invite or seed only controlled pilot residents. |
| Finances | Test the intended finance flows using controlled values. |
| Documents | Use sample or pilot-approved documents only. |
| Support | Capture feedback, questions, and issues during the pilot window. |

## Participants

| Role | Responsibility |
|------|-----------------|
| Pilot sponsor | Approves the pilot scope and is accountable for the business outcome. |
| Building administrator | Exercises the main workflows and validates day-to-day usability. |
| Internal operator | Supports setup, monitors issues, and records feedback. |
| Product owner | Decides whether the pilot meets the acceptance bar. |

## Data rules

- Use fictional or tightly controlled pilot data only.
- Do not mix pilot data with production data.
- Do not expose internal credentials, seed commands, or database shortcuts to the pilot team.
- Do not reuse real resident personal data unless there is explicit approval and a defined privacy process.

## Flows to validate

1. Create or activate the pilot tenant.
2. Create the first building.
3. Load units.
4. Invite or assign residents.
5. Prepare the finance baseline.
6. Create or review charges, payments, and balances.
7. Review documents available to the building and residents.
8. Submit and follow up on a support request.
9. Review the dashboard and summary views.
10. Confirm the operator can explain the next step to the customer.

## Acceptance criteria

- The pilot team understands the product without internal jargon.
- Core workflows are usable without engineering help for every click.
- Errors are understandable and actionable.
- Tenant scope remains isolated throughout the pilot.
- Financial and resident-facing screens are clear enough for real use.
- The team can identify at least one concrete improvement from the pilot feedback.

## What not to test yet

- Staging or production deployment.
- Real customer data migration.
- Destructive recovery procedures.
- Billing or commercial automation not yet approved for the pilot.
- Backend refactors, schema changes, or permission model changes.
- Stress testing beyond the agreed pilot size.

## Feedback collection

- Capture feedback immediately after each walkthrough.
- Separate product feedback from bug reports.
- Record severity, affected screen, and the expected outcome.
- Track what blocked the pilot, what confused users, and what felt trustworthy.
- Close the loop with a summary at the end of the session.

## Start checklist

- [ ] Pilot sponsor approved the scope.
- [ ] One internal owner is assigned.
- [ ] Pilot tenant and sample data are ready.
- [ ] The allowed flows are agreed in advance.
- [ ] The team knows what is out of scope.
- [ ] Feedback capture format is ready.

## Close checklist

- [ ] All agreed flows were exercised.
- [ ] Open issues were logged with severity.
- [ ] Product fit risks were summarized.
- [ ] The team agreed on whether the pilot continues, pauses, or stops.
- [ ] Follow-up actions were assigned.
- [ ] No production or staging changes were made during the pilot.

## References

- [`docs/DEMO_GUIDE.md`](../DEMO_GUIDE.md) — controlled demo walkthrough.
- [`docs/release/PILOT_ACTIVATION.md`](./PILOT_ACTIVATION.md) — pilot setup flow.
- [`docs/release/PILOT_CHECKLIST.md`](./PILOT_CHECKLIST.md) — operational recovery and backup checklist.
- [`docs/release/PILOT_READY.md`](./PILOT_READY.md) — readiness criteria for a customer launch.
