# 👥 Bug Triage Team Guide

**For**: Triagers, Developers, QA Engineers
**Purpose**: How to efficiently handle bugs as a team

---

## 👤 Role: Triager (Senior Dev)

**Responsibility**: Classify bugs, assign priority, route to developers

### Daily Standup Responsibilities
```
Every day (5 minutes):
- Check GitHub Issues: label:needs-triage
- Prioritize new bugs
- Assign P0s to developers immediately
- Check reporter responses (needs-info)
```

### Triage Checklist

#### 1️⃣ Can You Reproduce?

```bash
# Setup local environment
git pull origin main
npm install
npm run dev

# Follow reporter's steps exactly
# Try in different browsers/devices
```

**If reproduced** → Go to step 2

**If not reproduced** →
```markdown
@reporter Thanks for reporting!

I couldn't reproduce this on my end.
Can you provide more details?

- [ ] Operating System (macOS 14.2? Windows 11?)
- [ ] Browser version (Chrome 120.0.6099.x?)
- [ ] RequestId from error message
- [ ] Screenshot/video of issue
- [ ] Exact URL you were on

Try these steps:
1. Clear browser cache (Cmd+Shift+Delete)
2. Try in Incognito/Private mode
3. Try a different browser

I'll help once I have more info!
```

Label: `needs-info`

#### 2️⃣ Classify Priority

Use decision tree from BUG_TRIAGE.md:

```
System DOWN or CRASHING?
├─ YES → P0 ✅
└─ NO
   └─ DATA missing/corrupted?
      ├─ YES → P0 ✅
      └─ NO
         └─ BLOCKER (can't work)?
            ├─ YES → P1 ✅
            └─ NO
               └─ Workaround exists?
                  ├─ YES → P2 ✅
                  └─ NO → P1 ✅
```

#### 3️⃣ Analyze Root Cause

```markdown
## Root Cause Analysis

**Issue**: User can't create units in building

**Investigation**:
```bash
# Check logs
tail -f logs/buildingos.log | grep "CreateUnit"

# Check database
SELECT * FROM memberships WHERE userId = 'user_123'
```

**Findings**:
- API endpoint returns 403 Forbidden
- User has OPERATOR role (correct)
- But OPERATOR role missing `units.create` permission

**Root Cause**:
Permission matrix incomplete. OPERATOR role
was added but not granted necessary permissions
for unit creation.

**Affected Code**:
- apps/api/src/rbac/permissions.ts (line 45-50)

**Fix Complexity**: Low (5 minutes to update permission)

**Estimated Story Points**: 2
```

#### 4️⃣ Assign to Developer

Choose by component expertise:

```
Component          → Developer
─────────────────────────────────
Backend/Auth    → @dev1 (API specialist)
Frontend/UI     → @dev2 (React specialist)
Database        → @dev1 (DB schema expert)
Performance     → @dev3 (Optimization)
DevOps          → @dev4 (Infra)
```

**Assignment Comment**:
```markdown
@dev1 This is a permission issue in RBAC.

**Root Cause**: OPERATOR role needs `units.create` permission

**Files to Check**:
- apps/api/src/rbac/permissions.ts
- apps/api/src/tests/rbac.test.ts (add test case)

**Related PR**: #456 (where OPERATOR role was added)

**Steps to Fix**:
1. Add units.create to OPERATOR permissions
2. Write test: "OPERATOR can create units in assigned building"
3. Verify: "RESIDENT cannot create units" (should still fail)
4. PR → Code review → QA verification

**SLA**: 4 hours (P1 bug)

Assigned to you. Let me know if blocked!
```

Label: `in-progress`

---

## 👨‍💻 Role: Developer (Fixing)

**Responsibility**: Implement fix, write tests, request review

### Fix Workflow

#### 1️⃣ Create Branch

```bash
# Branch naming
git checkout -b fix/issue-XXXX-description
# or
git checkout -b fix/permission-operator-units

# Example: "fix/issue-456-operator-permissions"
```

#### 2️⃣ Reproduce Locally

```bash
# Follow exact steps from bug report
# Verify you see the problem

# Check related tests
npm test -- --testNamePattern="OPERATOR"

# Check TypeScript
npm run typecheck
```

#### 3️⃣ Write Test First (TDD)

```typescript
// apps/api/src/tests/rbac.test.ts

describe('OPERATOR permissions', () => {
  it('should allow OPERATOR to create units in assigned building', async () => {
    // Arrange
    const operator = await createUser({ role: 'OPERATOR', building: bld1 });

    // Act
    const result = await authorizeService.authorize({
      userId: operator.id,
      tenantId,
      permission: 'units.create',
      buildingId: bld1.id,
    });

    // Assert
    expect(result).toBe(true); // Should pass after fix
  });

  it('should NOT allow OPERATOR to create units in other buildings', async () => {
    // Similar test for cross-building access (should fail)
  });

  it('should NOT allow RESIDENT to create units', async () => {
    // Regression test: verify RESIDENT still blocked
  });
});
```

Run test (should FAIL before fix):
```bash
npm test -- fix/issue-456
# Expected: ❌ (test fails, as intended)
```

#### 4️⃣ Implement Fix

```typescript
// apps/api/src/rbac/permissions.ts

export const PERMISSIONS: Record<string, Permission[]> = {
  // ... other roles ...
  OPERATOR: [
    'buildings.read',
    'units.read',
    'units.create',          // ← ADD THIS LINE
    'tickets.read',
    'tickets.write',
    'payments.review',
  ],
};
```

Run test (should PASS after fix):
```bash
npm test -- fix/issue-456
# Expected: ✅ (all tests pass)
```

#### 5️⃣ Verify Locally

```bash
# Smoke test: verify fix in action
npm run dev

# Browser: Login as OPERATOR
# Test:    Go to /buildings, create unit ✅
# Test:    Login as RESIDENT, try create ❌ (should fail)
```

#### 6️⃣ Create PR

```bash
git add apps/api/src/rbac/permissions.ts
git add apps/api/src/tests/rbac.test.ts

git commit -m "fix: add units.create permission to OPERATOR role

Fixes #456 - OPERATOR can now create units in assigned buildings

- Added units.create to OPERATOR permission list
- Added test case: OPERATOR unit creation in building scope
- Verified: RESIDENT still blocked (regression test)

RequestId: req_20260218_fix456
TenantId: tenant_test
"
```

**PR Description** (on GitHub):

```markdown
## Bug Fix: OPERATOR cannot create units

**Closes**: #456

### Root Cause
OPERATOR role missing `units.create` permission after role was added
in #450.

### Fix
Added `units.create` to OPERATOR permissions in permissions.ts

### Tests
- ✅ OPERATOR can create units in building (new test)
- ✅ RESIDENT cannot create units (regression test)
- ✅ TENANT_ADMIN can still create units (regression test)

### Verification Steps
1. npm test ✅ (15/15 pass)
2. npm run build ✅ (0 TS errors)
3. Tested locally: OPERATOR creates unit ✅

### Checklist
- [x] Tests pass
- [x] TypeScript compiles
- [x] No new errors
- [x] Reviewed my own code
- [x] Updated docs if needed

### RequestId
req_20260218_fix456

### TenantId
tenant_test
```

Request review from code owner:
```bash
# If you don't have permission to request
git push --set-upstream origin fix/issue-456

# Then open PR on GitHub and request review
```

---

## ✅ Role: Code Reviewer (QA)

**Responsibility**: Review code, suggest improvements, approve

### Review Checklist

```markdown
## Code Review for #456

### Logic
- [x] Fix actually solves the bug (I traced through code)
- [x] No edge cases missed
- [x] Solution is simplest approach

### Tests
- [x] New test added
- [x] Test reproduces bug (would fail without fix)
- [x] Regression tests added (test didn't break other cases)
- [x] Test coverage is good

### Code Quality
- [x] No hardcoded values
- [x] No console.logs left
- [x] Code follows team style
- [x] Comments explain non-obvious logic

### Security
- [x] No SQL injection risk
- [x] No XSS risk (if frontend)
- [x] Permission checks correct
- [x] Multi-tenant isolation maintained

### Performance
- [x] No new N+1 queries
- [x] No expensive operations added
- [x] Database queries optimized

### Build Status
- [x] CI passes (all tests, lint, TypeScript)
- [x] No console warnings/errors
- [x] Builds successfully

## Approval

✅ Looks good! Ready to merge.

Minor comments:
- Consider adding comment explaining why OPERATOR needs units.create (domain knowledge)
```

**If issues found**:
```markdown
## Requested Changes

1. **Missing regression test**
   Line 45: Please add test for "RESIDENT cannot create"
   This prevents future regressions.

2. **Unclear comment**
   Line 23: Explain why this permission was needed
   (It wasn't obvious from git history)

3. **Performance concern**
   The new query on line 18 might be slow with 100k+ units.
   Consider adding index or pagination.

Please address these and we're good to merge!
```

**After review**, developer makes changes and re-requests review.

---

## 🧪 Role: QA Engineer (Verification)

**Responsibility**: Test fix before marking released

### Pre-Verification

Wait for:
- [x] Code review approved
- [x] CI/CD passing
- [x] PR merged to main

### Verification Checklist

```bash
# 1. Get latest code
git pull origin main
npm install

# 2. Find issue
# Go to GitHub → Issues → #456
```

**Environment Setup**:
```bash
# Start dev server
npm run dev

# In another terminal, start API
cd apps/api && npm run dev
```

**Test Case 1: OPERATOR Can Create Unit**
```
Login: OPERATOR user
Go to: /[tenantId]/buildings/[buildingId]/units
Click: [Create Unit] button
Form:  Fill in unit details
Click: [Save]
Expected: Unit created, show in list
Actual:   ✅ Works!

Screenshot: [paste URL]
```

**Test Case 2: RESIDENT Cannot Create Unit**
```
Login: RESIDENT user
Go to: /[tenantId]/buildings/[buildingId]/units
Click: [Create Unit] button
Expected: 403 Forbidden or button disabled
Actual:   ✅ Correctly blocked!

Screenshot: [paste URL]
```

**Test Case 3: No Regression (TENANT_ADMIN)**
```
Login: TENANT_ADMIN
Go to: /[tenantId]/buildings/[buildingId]/units
Create: Unit with same steps
Expected: Works (had this before)
Actual:   ✅ Still works!
```

**Test Case 4: Related Features**
```
Dashboard loading: ✅ Works
Building edit:     ✅ Works
Unit detail page:  ✅ Works
Tenant switch:     ✅ Works
```

**Verification Comment on Issue**:
```markdown
## QA Verification ✅

Tested on staging (commit abc1234d, v1.2.5)

### Test Results
- ✅ OPERATOR creates unit (reproduces original issue fix)
- ✅ RESIDENT blocked (regression check)
- ✅ TENANT_ADMIN creates unit (regression check)
- ✅ Dashboard loads fast (<2s)
- ✅ No console errors

### Test Environment
- Browser: Chrome 120
- OS: macOS 14.2
- Device: MBP 16"

### Screenshots
[Link to screenshot 1]
[Link to screenshot 2]

Verified and ready to release! 🚀
```

Label: `verified`

---

## 📤 Role: Release Manager (Closing)

**Responsibility**: Merge PR, update release notes, close issue

### Pre-Release Checklist

```markdown
Before merging to production:
- [x] Code review approved
- [x] QA verification passed
- [x] CI/CD all green
- [x] No merge conflicts
- [x] No broken builds
```

### Merge to Main

```bash
# On GitHub: Click "Merge Pull Request"
# Or via CLI:
git checkout main
git pull
git merge fix/issue-456
git push origin main
```

### Update Release Notes

**File**: CHANGELOG.md or Release Notes

```markdown
## v1.2.5 (Feb 18, 2026)

### Bug Fixes
- fix: OPERATOR can now create units (#456)
  RequestId: req_20260218_fix456
  TenantId: tenant_test
```

### Deploy to Production

```bash
# (Your deployment process)
npm run deploy

# Verify deployment
curl -s https://api.buildingos.app/health
```

### Close Issue

```markdown
Fixed in v1.2.5 (deployed Feb 18, 2026) ✅

**Changes**:
- apps/api/src/rbac/permissions.ts: Added units.create to OPERATOR
- apps/api/src/tests/rbac.test.ts: Added OPERATOR creation test

**Verification**: QA confirmed ✅

**RequestId**: req_20260218_fix456
**TenantId**: tenant_test

Thanks for reporting!
```

Add labels: `released` `verified`

Mark as: ✅ Closed

---

## 🔄 Escalation Procedures

### P0 Bug Not Fixed in 4 Hours

```
1. Notify dev manager immediately (Slack/call)
2. Offer help: "Can I pair with you?"
3. Remove blockers: CI issues, dependency problems
4. Escalate: If truly stuck, assign to backup dev
5. Track: Daily standup reporting
```

### Blocker for Release

```
1. Interrupt current work (if not P0)
2. All hands on deck
3. Skip code review if critical (but document)
4. Deploy to staging first
5. Get sign-off from tech lead before production
```

### Multi-Tenant Isolation Issue

```
1. TREAT AS P0 IMMEDIATELY
2. Notify security team
3. Assess: How many tenants affected?
4. Contain: Disable feature if necessary
5. Audit: Check if data was accessed
6. Post-mortem: Prevent recurrence
```

---

## 📊 Team Metrics

Track for efficiency:

```
Daily:
- P0 bugs: Count, avg time to resolve
- P1 bugs: Count, assigned/in-progress
- P2 bugs: Backlog size

Weekly:
- Bug resolution rate
- Average time per priority
- Regression rate (bugs we broke)

Monthly:
- Top bug sources (components)
- Trends (improving/worsening)
- Team velocity
```

---

## 📚 Related Documents

- [BUG_TRIAGE.md](./BUG_TRIAGE.md) — Full triage process & SLAs
- [BUG_REPORTING_QUICK_START.md](./BUG_REPORTING_QUICK_START.md) — Reporter guide
- [GITHUB_LABELS.md](./GITHUB_LABELS.md) — Label reference

---

## ❓ Common Questions

### Q: I'm not sure if I should prioritize this as P0 or P1
**A**: Use the decision tree in BUG_TRIAGE.md. When in doubt, ask senior dev in Slack.

### Q: What if I can't reproduce the bug?
**A**: Add `needs-info` label, ask reporter for more details. Give them 48 hours to respond, then close if silent.

### Q: Can I work on P2 bugs instead of P1?
**A**: Priority = importance to users. Always do P0 → P1 → P2. Don't skip levels.

### Q: How do I handle a bug I introduced?
**A**:
1. Take responsibility immediately
2. Treat as P1 minimum (even if cosmetic)
3. Write test that catches it
4. Fix it yourself (or help fixer)
5. Document in PR what went wrong

### Q: What if the reporter is wrong (not a bug)?
**A**: Politely explain why it's "working as designed". Offer feature request template if they want to request change.

---

**Questions?** Ask in team Slack or check docs.

**Last Updated**: Feb 18, 2026
