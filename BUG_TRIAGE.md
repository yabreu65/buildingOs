# 🐛 Bug Triage System

**Version**: 1.0
**Last Updated**: Feb 18, 2026
**Maintainer**: Development Team

---

## 📋 Overview

Systematic bug reporting, classification, and resolution process ensuring:
- **Clear prioritization** of critical issues
- **Reproducibility** before committing to fix
- **Accountability** through request tracking
- **Verification** before marking resolved
- **Multi-tenant isolation** validated for tenant-specific bugs

---

## 🏷️ Priority Levels

### P0 — CRITICAL (Fix immediately)

**Definition**: System-breaking issues preventing core workflows or data corruption

**Characteristics**:
- ❌ Application crashes or 500 errors affecting all users
- ❌ Data loss or corruption
- ❌ Authentication bypass or privilege escalation
- ❌ Multi-tenant isolation broken (tenant A sees B's data)
- ❌ Payment processing failures affecting production transactions
- ❌ All users blocked from critical feature

**SLA**: 1 hour response | 4 hours fix | Next commit

**Examples**:
```
- "Users logged out when accessing /buildings"
- "Payment API returns 500 for all requests"
- "Tenant A can see Tenant B's buildings"
- "Database migration breaks all queries"
```

---

### P1 — HIGH (Fix this sprint)

**Definition**: Major feature broken or degraded for significant user segment

**Characteristics**:
- ⚠️ Feature completely broken (wrong data, 403/404 errors)
- ⚠️ Workaround exists but requires extra steps
- ⚠️ Performance degradation (>2s response time)
- ⚠️ UI unusable for specific role (e.g., OPERATOR cannot create tickets)
- ⚠️ Affects multiple buildings/units in a tenant
- ⚠️ Data inconsistency (charges don't match payments)

**SLA**: 4 hour response | 1 day fix | This sprint

**Examples**:
```
- "Unit dashboard shows 404 but unit exists"
- "Building filter returns wrong results"
- "Ticket comments disappear after refresh"
- "Branding settings don't persist"
```

---

### P2 — MEDIUM (Fix next sprint)

**Definition**: Feature works but has issues, or affects single user/edge case

**Characteristics**:
- ℹ️ Feature works but with limitations
- ℹ️ UI text typos, formatting issues
- ℹ️ Single role/building affected, not critical path
- ℹ️ Performance acceptable but not optimal
- ℹ️ Rare edge case (e.g., payment with specific currency)
- ℹ️ Feature request mislabeled as bug

**SLA**: 24 hour response | Next sprint fix | Backlog item

**Examples**:
```
- "Modal closes when clicking outside (working as intended)"
- "Building name truncates at 50 chars"
- "Toast notification shows for 3s instead of 2s"
- "RESIDENT can't download document (works for ADMIN)"
```

---

## 🏗️ Bug Triage Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  1️⃣  REPORT                                                  │
│  User files bug with template (priority unassigned)         │
├─────────────────────────────────────────────────────────────┤
│  2️⃣  TRIAGE                                                  │
│  Dev assigns priority, labels, builds repro scenario        │
│  Reproduces locally or requests more info                   │
├─────────────────────────────────────────────────────────────┤
│  3️⃣  FIX                                                     │
│  Assigned to developer based on component                   │
│  Creates branch, develops fix, tests locally                │
├─────────────────────────────────────────────────────────────┤
│  4️⃣  VERIFY                                                  │
│  QA reproduces original issue, confirms fix works           │
│  Tests doesn't break related features                       │
├─────────────────────────────────────────────────────────────┤
│  5️⃣  CLOSE                                                   │
│  Merge to main, deploy, close with release notes            │
└─────────────────────────────────────────────────────────────┘
```

### Step 1: REPORT ➜ In Progress

**Responsibility**: Reporter (user or QA)

**Checklist**:
- [ ] Fill bug report template completely
- [ ] Include requestId and tenantId if available
- [ ] Provide reproduction steps (exact sequence)
- [ ] Include expected vs actual behavior
- [ ] Attach screenshot/video if UI issue
- [ ] Note browser/environment if client-side
- [ ] Format: Create GitHub issue with `bug` label

**Triage Owner Response**:
- Assigns priority (P0/P1/P2)
- Requests clarification if needed
- Adds component label (backend/frontend/database/auth)

---

### Step 2: TRIAGE ➜ In Progress

**Responsibility**: Triager (senior dev)

**Checklist**:
- [ ] Verify priority is correct (re-prioritize if needed)
- [ ] Reproduce bug locally or staging
- [ ] If cannot reproduce:
  - [ ] Comment with reproduction attempt
  - [ ] Ask reporter for more details (logs, screenshots)
  - [ ] Label: `needs-info`
  - [ ] Close if unresolvable / mark as working-as-designed
- [ ] If reproduced:
  - [ ] Add root cause analysis comment
  - [ ] Assign to developer (component owner)
  - [ ] Estimate story points
  - [ ] Add to sprint (P0) or backlog (P1/P2)

**Example Triage Comment**:
```
@dev-team Reproduced on staging.

**Root Cause**: getTenantId() returns undefined in
UserContext when session restores. Causes /buildings
to return 401 (X-Tenant-Id header missing).

**Fix Area**: apps/web/features/auth/useAuth.ts
Need to ensure activeTenantId is set before API calls.

**Tests Needed**:
- Session restore with multiple tenants
- Quick tenant switch (no refresh)
- API retry after 401

Assigned: @dev1 | Points: 5 | Sprint: Current
```

---

### Step 3: FIX ➜ In Progress

**Responsibility**: Assigned Developer

**Checklist**:
- [ ] Create branch: `fix/bug-description` or `fix/issue-123`
- [ ] Write failing test (TDD) if applicable
- [ ] Implement fix
- [ ] Verify fix locally (steps from bug report)
- [ ] Test doesn't break related features (smoke test)
- [ ] Create PR with:
  - [ ] Title: `fix: description`
  - [ ] Closing reference: `Closes #123`
  - [ ] Comment with reproduction steps + verification
- [ ] Request review from component owner

**PR Comment Template**:
```markdown
## Bug Fix: [Issue Title]

**Closes**: #123

### Reproduction Steps
1. Login as OPERATOR
2. Go to /buildings/bld_123
3. Click [Create Unit]
4. See: 403 Forbidden error

### Root Cause
Permission check used `buildings.write` but OPERATOR
only has `buildings.read`.

### Fix
Updated OperatorPermissions to include
`units.create` for building operators.

### Verification
- [x] Locally verified: OPERATOR can create unit
- [x] RESIDENT still cannot create (403)
- [x] TENANT_ADMIN can create (expected)
- [x] Run tests: npm test (15/15 pass)

**RequestId**: req_abc123def456
**TenantId**: tenant_xyz789
```

---

### Step 4: VERIFY ➜ In Progress

**Responsibility**: QA + Code Reviewer

**Code Review**:
- [ ] Logic is correct (reproduces and fixes issue)
- [ ] No new bugs introduced
- [ ] Tests added/updated
- [ ] No hardcoded values, env-dependent
- [ ] Security: no SQL injection, XSS, CSRF
- [ ] Approve PR

**QA Verification** (P0 bugs):
- [ ] Pull latest fix locally or on staging
- [ ] Follow original reproduction steps
- [ ] Confirm: Issue no longer occurs
- [ ] Smoke test: Related features still work
- [ ] Test with different roles/tenants if applicable
- [ ] Comment: "Verified ✅" on issue/PR

**QA Comment**:
```
Verified on staging (commit abc1234)

✅ OPERATOR can now create units
✅ RESIDENT still blocked (403)
✅ TENANT_ADMIN still works
✅ Building dashboard loads (<2s)
✅ No console errors

Ready to merge!
```

---

### Step 5: CLOSE ➜ Resolved

**Responsibility**: Developer (merge) + Release Manager

**Merge**:
- [ ] PR approved by code reviewer
- [ ] CI passes (builds, tests, lint)
- [ ] Merge to main
- [ ] Delete branch

**Release**:
- [ ] Include in next release notes
- [ ] Format: `- fix: description (#issue)`
- [ ] Deploy to production

**Close Issue**:
- [ ] Mark as closed (auto-closes with PR merge)
- [ ] Add label: `verified`
- [ ] Add label: `released`
- [ ] Comment with deployment date

**Closure Comment**:
```
Fixed in v1.2.5 (deployed Feb 18, 2026)

**Changes**:
- apps/api/src/rbac/permissions.ts: Added units.create to OPERATOR
- apps/api/src/tests/rbac.test.ts: Added OPERATOR unit creation test

**Verification**: QA confirmed ✅
**RequestId**: req_abc123def456
**TenantId**: tenant_xyz789
```

---

## 🏷️ Issue Labels

### Priority
- `P0-critical` — Fix immediately
- `P1-high` — Fix this sprint
- `P2-medium` — Fix next sprint

### Component
- `backend` — API/database issue
- `frontend` — Web app issue
- `auth` — Authentication/permissions
- `database` — Schema/migration issue
- `performance` — Speed/optimization
- `ui` — UI/UX issue
- `mobile` — Mobile/responsive issue

### Status
- `needs-triage` — Awaiting priority assignment
- `needs-info` — Awaiting reporter clarification
- `in-progress` — Developer actively working
- `in-review` — PR awaiting code review
- `verified` — QA confirmed fix works
- `released` — Merged and deployed to prod

### Type
- `bug` — Something is broken
- `regression` — Used to work, now broken
- `feature-request` — Requested feature (mislabeled as bug)
- `documentation` — Docs are wrong/missing
- `chore` — Internal improvement

### Impact
- `multi-tenant` — Affects multiple tenants
- `security` — Security vulnerability
- `data-loss` — Risk of data loss
- `blocker` — Blocks other work

---

## 📝 Bug Report Template

**Location**: GitHub Issues → New Issue → Bug Report

```markdown
## 🐛 Bug Report

### 📌 Summary
[One-line description of the bug]

### 🔍 Reproduction Steps
1. [First step]
2. [Second step]
3. [Action that causes bug]

### ✅ Expected Behavior
[What should happen]

### ❌ Actual Behavior
[What actually happens]

### 📸 Screenshots / Logs
[Paste screenshot URL or logs]

### 🌐 Environment
- **Browser**: Chrome 120 | Firefox 121 | Safari | Edge
- **OS**: macOS | Windows | Linux
- **App Version**: v1.2.1
- **Network**: WiFi | Mobile | VPN (if relevant)

### 📊 Tenant / User Info
- **RequestId**: `req_abc123def456` (from error message or DevTools)
- **TenantId**: `tenant_xyz789` (from URL: /[tenantId]/...)
- **User Role**: TENANT_ADMIN | OPERATOR | RESIDENT
- **Affected Building(s)**: [Building name or ID]
- **Affected Unit(s)**: [Unit label if relevant]

### ⚙️ Additional Context
- When did this start? (just now | last sprint | since update?)
- Does workaround exist? (yes/no, describe)
- How often does it occur? (always | intermittent | rare)
- Does it affect others? (just me | multiple users | all users)

### 🔗 Related Issues
[Link to similar issues if any]
```

---

## 💾 Bug Report Examples

### Example 1: P0 — Multi-Tenant Data Leak

```markdown
## 🐛 Tenant A can see Tenant B's buildings

### Summary
User logged into Tenant A can access buildings belonging to Tenant B

### Reproduction Steps
1. Create 2 tenants: Tenant A and Tenant B
2. Create building "Tower A" in Tenant A
3. Create building "Tower B" in Tenant B
4. Login as User in Tenant A
5. Go to URL: /tenant-b-id/buildings
6. See: Both "Tower A" (correct) and "Tower B" (WRONG)

### Expected
Only "Tower A" visible (Tenant A buildings)

### Actual
Both towers visible (data leak!)

### RequestId
req_20260218_001

### TenantId
tenant_a_id, tenant_b_id

### User Role
TENANT_ADMIN in both tenants

### Additional Context
This is a critical security issue. Data isolation broken.
Just discovered, affects production.
```

**Triage Decision**: P0 (immediate fix) ✅

---

### Example 2: P1 — Feature Broken

```markdown
## 🐛 Building filter returns 0 results when it shouldn't

### Summary
Filter by unit count returns empty list even though buildings exist

### Reproduction Steps
1. Login as OPERATOR
2. Go to /buildings
3. Set filter: "Units: 5-10"
4. See: "No buildings found"
5. But we have 3 buildings with 6-7 units each

### Expected
Show 3 buildings matching filter

### Actual
Empty list (0 buildings)

### Screenshots
[Link to screenshot]

### Environment
- Browser: Chrome 120
- OS: macOS
- App: v1.2.1

### RequestId
req_20260218_002

### TenantId
tenant_filter_test

### Additional Context
Workaround: Remove filter, manually count units
Started: This sprint (Feb 17)
Affects: All users trying to filter
```

**Triage Decision**: P1 (broken feature, affects users) ✅

---

### Example 3: P2 — UI Issue

```markdown
## 🐛 Modal title text overflows on mobile

### Summary
RolesModal title is cut off on small screens (<640px)

### Reproduction Steps
1. Login on mobile or use dev tools (viewport: 375px)
2. Go to /settings/members
3. Click "Manage Roles" for any member
4. See: Title "Manage Roles: [Name]" is truncated

### Expected
Title wraps or uses ellipsis

### Actual
Text overflows: "Manage Roles: Maria Antor..."

### Screenshots
[Link to screenshot showing overflow]

### Browser
Safari iOS 17

### RequestId
req_20260218_003

### TenantId
tenant_mobile_test

### Additional Context
Mobile viewport issue, desktop looks fine
Workaround: Rotate to landscape
Minor cosmetic issue
```

**Triage Decision**: P2 (cosmetic, mobile-only) ✅

---

## 🔄 State Transitions

```
REPORT (New) ──→ TRIAGE (In Progress)
                    ↓
              [Cannot Reproduce]
                    ↓
         needs-info ──→ [Get More Info] ──→ Re-triage
                    ↓
              [Reproduced]
                    ↓
                  FIX ──→ [Developer Assigned]
                    ↓
                   PR ──→ [Code Review]
                    ↓
              [Approved] ──→ VERIFY ──→ [QA Tests]
                    ↓
              [Verified] ──→ MERGE ──→ DEPLOY
                    ↓
                 CLOSE (Released) ✅
```

---

## 📊 Metrics & SLAs

### Response Time SLA
| Priority | Response Time | Fix Time | Close Time |
|----------|---------------|----------|------------|
| P0 | 1 hour | 4 hours | Same day |
| P1 | 4 hours | 1 day | This sprint |
| P2 | 24 hours | 1 week | Next sprint |

### Tracking
```
Daily Standup:
- P0 bugs: Report status
- P1 bugs: Blockers?
- P2 bugs: On backlog

Sprint Planning:
- P0: Emergency fixes (top priority)
- P1: Regular backlog items
- P2: Backlog for future sprints

Release Notes:
- List all fixed bugs by priority
- Include requestId for reference
```

---

## 🛡️ Multi-Tenant Considerations

### Always Verify

For any bug affecting data/access:
1. **Isolation**: Can User A see User B's data? (Yes=P0)
2. **Tenant ID**: Confirm bug is scoped to one tenant
3. **Request ID**: Log request for investigation
4. **Audit Trail**: Check AuditLog for unauthorized access

### In Bug Report, Always Include

```
RequestId: req_20260218_xxxxxx
TenantId: tenant_xyz789
Affected Tenant(s): [Just this tenant | Multiple]
Access Pattern: [RESIDENT | OPERATOR | ADMIN]
```

### Root Cause Questions

- Did user have proper X-Tenant-Id header?
- Did API check tenantId in query?
- Was authorization guard bypassed?
- Did scope validation fail?

---

## 📚 Related Documents

- [AUTH_CONTRACT.md](./AUTH_CONTRACT.md) — Authentication & authorization rules
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — System design & patterns
- [TESTING_COMPLETE_FINAL_REPORT.md](./TESTING_COMPLETE_FINAL_REPORT.md) — Test strategies

---

## ✨ Best Practices

### For Reporters
✅ Be specific (steps, not "doesn't work")
✅ Include all context (role, tenant, browser)
✅ Provide screenshots/logs
✅ Note if it's reproducible

❌ Don't: "something is broken"
❌ Don't: forget environment info
❌ Don't: report feature requests as bugs

### For Triagers
✅ Respond within SLA
✅ Reproduce locally before assigning
✅ Add root cause analysis
✅ Estimate story points

❌ Don't: assign without reproducing
❌ Don't: skip security review
❌ Don't: over-prioritize non-critical issues

### For Developers
✅ Write test that reproduces bug
✅ Reference issue in commit message
✅ Comment code explaining fix
✅ Test related features

❌ Don't: Fix without understanding cause
❌ Don't: Ship without tests
❌ Don't: Ignore SLA

### For QA/Reviewers
✅ Test all reproduction steps
✅ Check related features
✅ Verify no regression
✅ Test multiple roles/tenants if applicable

❌ Don't: Assume fix is correct
❌ Don't: Skip edge cases
❌ Don't: Close without testing

---

## 🚀 Getting Started

1. **First Bug?** Use the bug report template above
2. **Triaging First Time?** Follow the 5-step pipeline
3. **Questions?** Check examples (Example 1-3)
4. **Emergency (P0)?** Contact senior dev immediately

---

**Questions?** Open an issue or contact the development team.
**Last updated**: Feb 18, 2026
