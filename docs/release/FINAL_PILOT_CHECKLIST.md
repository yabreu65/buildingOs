# Final Pilot Checklist

Use this checklist to confirm BuildingOS is ready for a **private pilot** before starting the staging phase. It closes the pilot gate with a clear yes/no decision, known risks, and a short list of required proofs.

## Quick path

1. Confirm the branch, commit state, and pilot scope.
2. Verify build, diff, smoke, and security basics.
3. Validate the controlled pilot data and minimum workflows.
4. Review open risks and decide whether to start staging.

## A. Preparation

| Check | Expected |
|-------|----------|
| Branch | Correct branch for the pilot release. |
| Working tree | Clean, with no accidental local changes. |
| Required commits | All pilot-related commits are closed and reviewed. |
| Push | Local changes are already pushed if they are part of the approved pilot baseline. |
| Scope | Pilot scope is documented and shared with the team. |

## B. Build and quality

- [ ] TypeScript passes for the touched surface.
- [ ] Lint passes if the repo or slice uses it for this area.
- [ ] `git diff --check` passes.
- [ ] Smoke browser check passed on the pilot paths.
- [ ] No accidental files were introduced.

## C. Security and configuration

- [ ] No `.env` files were added to Git.
- [ ] No secrets were copied into docs.
- [ ] Environment variables remain separated by environment.
- [ ] Roles and permissions were reviewed for the pilot scope.
- [ ] Demo/pilot data does not include real sensitive customer data.

## D. Pilot data

- [ ] Pilot tenant is controlled and documented.
- [ ] Demo buildings are defined and isolated.
- [ ] Demo units are loaded with known values.
- [ ] Demo residents are fictional or approved.
- [ ] Demo finances use controlled amounts only.
- [ ] Demo tickets, documents, and comments can be reset or recreated safely.

## E. Minimum functional flows

Validate these flows with pilot data only:

- [ ] Login and logout.
- [ ] SuperAdmin entry points relevant to the pilot.
- [ ] Tenant management.
- [ ] User management.
- [ ] Building setup.
- [ ] Apartment / unit setup.
- [ ] Resident setup and assignment.
- [ ] Finances: charges, debt, and payments.
- [ ] Common expenses.
- [ ] Tickets / support requests.
- [ ] Announcements / communications.
- [ ] Documents.
- [ ] Dashboard summary.
- [ ] AI assistant for finance, if present, read-only only.

## F. Internal operations

- [ ] Support flow is defined for the pilot window.
- [ ] Error review process is assigned.
- [ ] Pilot feedback capture is ready.
- [ ] Incident reporting is ready.
- [ ] Responsible owner and backup owner are assigned.
- [ ] Exit criteria for the pilot are clear.

## G. Exclusions

Do **not** test these in the private pilot:

- Real payment integrations.
- Mass email / WhatsApp production sends.
- Real customer data.
- Destructive actions.
- Dangerous automation.
- Staging/production deployment.
- Backend refactors or schema changes.

## H. Criteria to move to staging

| Criterion | Expected |
|-----------|----------|
| Checklist completed | Yes |
| Critical bugs | Closed or explicitly accepted |
| Known risks | Documented |
| Pilot data | Defined and controlled |
| Decision | Explicit approval to start staging |

## Go / No-Go for starting staging

### Go
Use **Go** only if all of the following are true:

- Pilot scope is complete and signed off.
- The minimum workflows are usable without engineering help.
- No critical unresolved bugs remain.
- Pilot data is controlled and documented.
- The team has agreed on feedback handling and escalation.

### No-Go
Use **No-Go** if any of the following are true:

- A critical flow is blocked.
- Sensitive or real customer data would be used by mistake.
- The team cannot explain the pilot clearly to a customer.
- Known issues are not documented.
- The pilot would require staging or production changes to proceed.

## Final sign-off table

| Area | State | Evidence | Responsible | Notes |
|------|-------|----------|-------------|-------|
| Preparation | Pending | Branch / status / commits | Release owner | Fill before launch |
| Build & quality | Pending | TSC / diff check / smoke | Engineering | Fill before launch |
| Security & config | Pending | Environment review | Engineering / ops | Fill before launch |
| Pilot data | Pending | Demo tenant inventory | Product / ops | Fill before launch |
| Functional flows | Pending | Pilot walkthrough notes | Product / QA | Fill before launch |
| Internal ops | Pending | Feedback and incident plan | Support lead | Fill before launch |
| Exclusions | Pending | Written pilot boundary | Product owner | Fill before launch |
| Staging gate | Pending | Go / No-Go decision | Product owner | Final decision |

## References

- [`docs/release/PRIVATE_PILOT_PLAYBOOK.md`](./PRIVATE_PILOT_PLAYBOOK.md)
- [`docs/release/PILOT_READY.md`](./PILOT_READY.md)
- [`docs/release/PILOT_CHECKLIST.md`](./PILOT_CHECKLIST.md)
- [`docs/release/PILOT_ACTIVATION.md`](./PILOT_ACTIVATION.md)
- [`docs/DEMO_GUIDE.md`](../DEMO_GUIDE.md)
