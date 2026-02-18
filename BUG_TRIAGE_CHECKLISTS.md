# 📋 Bug Triage Checklists

Print these or keep in your IDE for quick reference.

---

## 🐛 Reporter: Bug Report Checklist

**Before hitting Submit:**

```
Reproduction Steps
  ☐ Clear sequence (1, 2, 3... not "try this")
  ☐ Exact URLs or page names
  ☐ Exact button clicks or form fields
  ☐ Not vague ("doesn't work" → "sees 404")

Expected vs Actual
  ☐ What SHOULD happen
  ☐ What ACTUALLY happened
  ☐ Screenshot showing actual

Environment
  ☐ Browser (Chrome? Firefox? Version?)
  ☐ OS (macOS? Windows? Linux?)
  ☐ Device (Desktop? Mobile? Tablet?)
  ☐ Network (WiFi? Mobile data? VPN?)

Tenant & User Info
  ☐ RequestId (from error or DevTools)
  ☐ TenantId (from URL or Settings)
  ☐ User Role (ADMIN? OPERATOR? RESIDENT?)
  ☐ Building/Unit affected (if applicable)

Issue Quality
  ☐ Title is one-line summary (not full description)
  ☐ Template fully filled out
  ☐ No duplicate issues (searched first)
  ☐ Labels selected: bug, [component], [priority]

✅ READY TO SUBMIT
```

---

## 👨‍💼 Triager: Triage Checklist

**When you pick up a new bug:**

```
Initial Review
  ☐ Title and description make sense
  ☐ All required fields filled (RequestId, TenantId)
  ☐ Priority is reasonable (cross-check decision tree)
  ☐ Component label matches issue

Reproduction
  ☐ Pull latest code (git pull origin main)
  ☐ Follow reporter's exact steps
  ☐ Try multiple browsers/devices
  ☐ Check database/logs for errors
  ☐ Try with different user roles

Classification
  ☐ Assign correct priority (P0/P1/P2)
  ☐ Add component label (backend/frontend/auth)
  ☐ Add status label (needs-triage/in-progress)
  ☐ Add impact labels if applicable (security/multi-tenant/blocker)

Root Cause Analysis
  ☐ Identified root cause
  ☐ Found relevant code files
  ☐ Documented findings in comment
  ☐ Estimated story points
  ☐ Identified which tests to add

Assignment
  ☐ Assigned to appropriate developer
  ☐ Added helpful context comment
  ☐ Provided file/function names to check
  ☐ Linked related issues/PRs
  ☐ Set clear SLA expectation

Issue Status
  ☐ Issue has P0/P1/P2 label
  ☐ Issue has component label
  ☐ Issue has status label
  ☐ Issue is assigned to developer
  ☐ Assignee was notified

✅ READY FOR DEVELOPER
```

---

## 👨‍💻 Developer: Fix Checklist

**Before opening PR:**

```
Understanding
  ☐ Read bug report completely
  ☐ Understand expected vs actual
  ☐ Found and reviewed root cause analysis
  ☐ Understand SLA deadline (P0/P1/P2)

Reproduction
  ☐ Pulled latest code
  ☐ Can reproduce locally
  ☐ Verified with exact steps from report
  ☐ Checked logs/console for errors

Code Changes
  ☐ Created fix branch (fix/issue-XXX)
  ☐ Made minimal changes (not refactoring)
  ☐ No console.logs or debug code left
  ☐ No hardcoded values
  ☐ No commented-out code
  ☐ Followed team style guide

Tests
  ☐ Added test that reproduces bug (TDD)
  ☐ Test FAILS before fix (proves test is real)
  ☐ Test PASSES after fix
  ☐ Added regression tests
  ☐ npm test passes (all tests green)
  ☐ Test coverage is adequate

Build & Lint
  ☐ npm run build (0 errors)
  ☐ npm run typecheck (0 errors)
  ☐ npm run lint (0 warnings)
  ☐ No TypeScript `any` types added
  ☐ Imports are correct

Verification
  ☐ Tested locally in browser
  ☐ Tested with different user roles
  ☐ Tested on mobile/different browsers
  ☐ Verified related features still work
  ☐ No console errors (DevTools)

PR Creation
  ☐ Branch pushed to origin
  ☐ PR title: "fix: description"
  ☐ PR references issue: "Closes #123"
  ☐ Description explains fix clearly
  ☐ Added RequestId and TenantId
  ☐ Requested review from code owner
  ☐ CI/CD checks are passing

✅ READY FOR REVIEW
```

---

## 👀 Code Reviewer: Review Checklist

**Before approving PR:**

```
Problem Understanding
  ☐ Read original issue thoroughly
  ☐ Understand root cause analysis
  ☐ Agree with proposed fix
  ☐ Fix is actually solving the problem

Code Quality
  ☐ Code is clear and understandable
  ☐ No obvious bugs or edge cases
  ☐ No dead code or commented lines
  ☐ Follows team coding standards
  ☐ No hardcoded values or magic numbers

Tests
  ☐ New tests added (not just changes)
  ☐ Tests cover happy path AND edge cases
  ☐ Tests have clear names (explain purpose)
  ☐ Regression tests added (didn't break existing)
  ☐ All tests pass locally

Security & Architecture
  ☐ No security vulnerabilities (SQL injection, XSS, CSRF)
  ☐ Multi-tenant isolation maintained
  ☐ Permission/authorization checks correct
  ☐ Database queries efficient (no N+1)
  ☐ API response structures consistent

Performance
  ☐ No slow new code
  ☐ No unnecessary loops or recursion
  ☐ Database indexes used appropriately
  ☐ No memory leaks in frontend
  ☐ No blocking operations

Build Status
  ☐ CI/CD pipeline passes
  ☐ All tests pass (both old and new)
  ☐ No TypeScript errors
  ☐ No lint warnings
  ☐ Build completes successfully

Documentation
  ☐ Code comments explain non-obvious logic
  ☐ Function/method names are clear
  ☐ No obvious gaps in documentation
  ☐ PR description is clear

Final Check
  ☐ This fix will actually solve the bug
  ☐ I'm confident in this code
  ☐ No questions or concerns
  ☐ Ready to approve

✅ APPROVE or REQUEST CHANGES (with clear comments)
```

---

## ✅ QA: Verification Checklist

**Before marking as verified:**

```
Environment Setup
  ☐ Pulled latest main branch
  ☐ npm install (clean dependencies)
  ☐ npm run dev (server starting clean)
  ☐ Logged in successfully
  ☐ No console errors on load

Bug Reproduction
  ☐ Followed original bug report steps EXACTLY
  ☐ Bug happens (before fix applied)
  ☐ Applied fix (checkout merged commit)
  ☐ Bug NO LONGER happens (fix confirmed)
  ☐ Took screenshot/video of verification

Regression Testing
  ☐ Tested related features still work
  ☐ Tested with different user roles
  ☐ Tested on different browsers
  ☐ Tested on mobile
  ☐ No new console errors introduced

Specific Test Cases
  ☐ Test Case 1: [From bug report] ✅
  ☐ Test Case 2: [Regression test] ✅
  ☐ Test Case 3: [Edge case] ✅
  ☐ Test Case 4: [Related feature] ✅

Performance
  ☐ Page loads in acceptable time (<3s)
  ☐ No UI lag or freezing
  ☐ Network requests are reasonable
  ☐ Memory usage is normal
  ☐ No console warnings

Data Integrity (if applicable)
  ☐ Data displays correctly
  ☐ Multi-tenant data isolated
  ☐ Audit logs created (if expected)
  ☐ Permissions enforced
  ☐ No data corruption

Issue Tracking
  ☐ RequestId noted in verification
  ☐ TenantId noted in verification
  ☐ Environment documented
  ☐ Screenshots/videos attached
  ☐ Posted verification comment on issue

✅ MARK AS VERIFIED (Ready to release)
```

---

## 🚀 Release Manager: Deployment Checklist

**Before deploying to production:**

```
Pre-Deployment
  ☐ Code review approved
  ☐ QA verification passed (labeled: verified)
  ☐ All tests passing in CI/CD
  ☐ No merge conflicts
  ☐ Commit history is clean

Merge & Deploy
  ☐ Merged to main (via GitHub or CLI)
  ☐ Branch deleted
  ☐ Deploy script ran successfully
  ☐ Deployment to production completed
  ☐ Health check: API is responding

Post-Deployment Verification
  ☐ Logged into prod environment
  ☐ Can reproduce bug (verify it's fixed)
  ☐ Related features still work
  ☐ No console errors in prod
  ☐ Database migrations completed (if any)

Documentation & Notification
  ☐ Added to CHANGELOG or release notes
  ☐ Format: "- fix: description (#issue)"
  ☐ Issue closed with deployment info
  ☐ Labels updated: released, verified
  ☐ Team notified (Slack/email)

Monitoring
  ☐ Monitoring for errors in Sentry/logs
  ☐ No spike in error rates
  ☐ Performance metrics normal
  ☐ User complaints (check Support channel)
  ☐ Rollback plan is ready (if needed)

✅ PRODUCTION DEPLOYMENT COMPLETE
```

---

## 🔴 P0 Emergency Bug Checklist

**For critical bugs affecting production:**

```
IMMEDIATE (First 30 minutes)
  ☐ Triager assigned bug to top developer
  ☐ Developer started investigating
  ☐ Tech lead notified (may need emergency decision)
  ☐ Posted in #emergency Slack channel
  ☐ Gathered root cause info

URGENT (30 min - 2 hours)
  ☐ Temporary workaround implemented (if possible)
  ☐ Users communicated (status + ETA)
  ☐ Fix identified and tested locally
  ☐ Code review started (expedited)
  ☐ QA standing by

CRITICAL (2 - 4 hours)
  ☐ PR merged to main (after expedited review)
  ☐ Deployed to staging for final verification
  ☐ QA spot-checked in staging
  ☐ Deployed to production
  ☐ Post-deployment verification

FOLLOW-UP (Same day)
  ☐ Verified fix in production
  ☐ User feedback collected
  ☐ Root cause analysis documented
  ☐ Prevent recurrence plan made
  ☐ Incident report filed (if data loss/security)

✅ P0 RESOLVED AND MONITORING
```

---

## ⚠️ Multi-Tenant Bug Checklist

**When bug might affect data isolation:**

```
Investigation
  ☐ Does Tenant A see Tenant B's data? (If yes = P0!)
  ☐ Are both tenants affected or just one?
  ☐ Was a query missing tenantId filter?
  ☐ Was an API endpoint missing authorization check?
  ☐ Do scoped roles have validation issues?

Testing
  ☐ Create test with 2+ tenants
  ☐ Verify isolation between tenants
  ☐ Test all affected features with multiple tenants
  ☐ Check database queries include tenantId
  ☐ Verify API responses filtered by tenant

Security Review
  ☐ Determine if data was exposed
  ☐ Audit logs: which requests accessed foreign data?
  ☐ Notify security team if data breach likely
  ☐ Plan user notification if needed
  ☐ Consider: do we need account password resets?

Fix Validation
  ☐ Fix filters all queries by tenantId
  ☐ Fix adds authorization checks
  ☐ Fix validates scope/permissions
  ☐ Test: User A cannot see User B's data
  ☐ Test: API returns 403/404 for unauthorized

Post-Fix
  ☐ Audit logs reviewed for unauthorized access
  ☐ Affected users notified (if breach occurred)
  ☐ Post-mortem scheduled
  ☐ Code review more thorough for data access
  ☐ Add automated tests for multi-tenant isolation

✅ MULTI-TENANT ISOLATION VERIFIED
```

---

## 🔗 Quick Links

- 📖 Full Guide: [BUG_TRIAGE.md](./BUG_TRIAGE.md)
- 🚀 Quick Start: [BUG_REPORTING_QUICK_START.md](./BUG_REPORTING_QUICK_START.md)
- 👥 Team Guide: [BUG_TRIAGE_TEAM_GUIDE.md](./BUG_TRIAGE_TEAM_GUIDE.md)
- 🏷️ Labels: [GITHUB_LABELS.md](./GITHUB_LABELS.md)

---

**Print this page** for your desk or team whiteboard!

**Last Updated**: Feb 18, 2026
