# 🐛 Bug Triage System Index

**Complete bug reporting, triage, and resolution process for BuildingOS**

---

## 🚀 Quick Navigation

### "I found a bug!" → Where to start?
👉 **[BUG_REPORTING_QUICK_START.md](./BUG_REPORTING_QUICK_START.md)** (10 min read)
- What to include in bug report
- Template & examples
- How to find RequestId & TenantId

### "I'm triaging a bug" → What's the process?
👉 **[BUG_TRIAGE_TEAM_GUIDE.md](./BUG_TRIAGE_TEAM_GUIDE.md)** (30 min read)
- Role-specific workflows
- Step-by-step procedures for each role
- Escalation & emergency procedures

### "I need a checklist" → What should I verify?
👉 **[BUG_TRIAGE_CHECKLISTS.md](./BUG_TRIAGE_CHECKLISTS.md)** (Printable reference)
- Reporter checklist
- Triager checklist
- Developer checklist
- Code reviewer checklist
- QA checklist
- Release manager checklist

### "I need the full process" → Tell me everything
👉 **[BUG_TRIAGE.md](./BUG_TRIAGE.md)** (Complete reference - 40 min read)
- Priority definitions (P0/P1/P2)
- 5-stage pipeline details
- Multi-tenant considerations
- SLAs & metrics

### "What labels should I use?" → Label configuration
👉 **[GITHUB_LABELS.md](./GITHUB_LABELS.md)** (Label reference)
- All 23 labels with colors
- How to import labels
- Label usage examples

---

## 📚 Document Overview

| Document | Purpose | Read Time | Audience | Format |
|----------|---------|-----------|----------|--------|
| [BUG_REPORTING_QUICK_START.md](./BUG_REPORTING_QUICK_START.md) | How to report bugs | 10 min | Reporters | Quick guide |
| [BUG_TRIAGE.md](./BUG_TRIAGE.md) | Complete triage process | 40 min | Everyone | Reference |
| [BUG_TRIAGE_TEAM_GUIDE.md](./BUG_TRIAGE_TEAM_GUIDE.md) | Team workflows | 30 min | Dev team | Procedures |
| [BUG_TRIAGE_CHECKLISTS.md](./BUG_TRIAGE_CHECKLISTS.md) | Verification checklists | Variable | Dev team | Checklist |
| [GITHUB_LABELS.md](./GITHUB_LABELS.md) | Label system | 15 min | Dev team | Config |
| [.github/ISSUE_TEMPLATE/bug_report.md](./.github/ISSUE_TEMPLATE/bug_report.md) | GitHub template | Auto-filled | Reporters | Template |

---

## 👥 By Role

### 🐛 Reporter / QA Engineer
**You found a bug!**
1. Read: [BUG_REPORTING_QUICK_START.md](./BUG_REPORTING_QUICK_START.md) (10 min)
2. Use checklist: [BUG_TRIAGE_CHECKLISTS.md#reporter](./BUG_TRIAGE_CHECKLISTS.md#-reporter-bug-report-checklist) (5 min)
3. File issue using template
4. Include: RequestId, TenantId, exact steps

### 👨‍💼 Triager / Tech Lead
**You're classifying and assigning bugs**
1. Read: [BUG_TRIAGE.md](./BUG_TRIAGE.md) - Triage section (15 min)
2. Skim: [BUG_TRIAGE_TEAM_GUIDE.md#role-triager](./BUG_TRIAGE_TEAM_GUIDE.md#-role-triager-senior-dev) (20 min)
3. Use checklist: [BUG_TRIAGE_CHECKLISTS.md#triager](./BUG_TRIAGE_CHECKLISTS.md#-triager-triage-checklist) (5 min)
4. Reference: [GITHUB_LABELS.md](./GITHUB_LABELS.md) for labels (5 min)

### 👨‍💻 Developer / Engineer
**You're fixing the bug**
1. Read: [BUG_TRIAGE.md](./BUG_TRIAGE.md) - Fix section (10 min)
2. Skim: [BUG_TRIAGE_TEAM_GUIDE.md#role-developer](./BUG_TRIAGE_TEAM_GUIDE.md#-role-developer-fixing) (20 min)
3. Use checklist: [BUG_TRIAGE_CHECKLISTS.md#developer](./BUG_TRIAGE_CHECKLISTS.md#-developer-fix-checklist) (5 min)
4. Verify SLA from [BUG_TRIAGE.md](./BUG_TRIAGE.md)

### 👀 Code Reviewer
**You're reviewing the fix**
1. Read: [BUG_TRIAGE.md](./BUG_TRIAGE.md) - Verify section (10 min)
2. Skim: [BUG_TRIAGE_TEAM_GUIDE.md#role-code-reviewer](./BUG_TRIAGE_TEAM_GUIDE.md#-role-code-reviewer-qa) (15 min)
3. Use checklist: [BUG_TRIAGE_CHECKLISTS.md#reviewer](./BUG_TRIAGE_CHECKLISTS.md#-code-reviewer-review-checklist) (10 min)

### ✅ QA / Verification
**You're testing the fix**
1. Read: [BUG_TRIAGE.md](./BUG_TRIAGE.md) - Verify section (10 min)
2. Skim: [BUG_TRIAGE_TEAM_GUIDE.md#role-qa](./BUG_TRIAGE_TEAM_GUIDE.md#-role-qa-engineer-verification) (15 min)
3. Use checklist: [BUG_TRIAGE_CHECKLISTS.md#qa](./BUG_TRIAGE_CHECKLISTS.md#-qa-verification-checklist) (10 min)

### 🚀 Release Manager
**You're deploying the fix**
1. Read: [BUG_TRIAGE.md](./BUG_TRIAGE.md) - Close section (5 min)
2. Skim: [BUG_TRIAGE_TEAM_GUIDE.md#role-release](./BUG_TRIAGE_TEAM_GUIDE.md#-role-release-manager-closing) (10 min)
3. Use checklist: [BUG_TRIAGE_CHECKLISTS.md#release](./BUG_TRIAGE_CHECKLISTS.md#-release-manager-deployment-checklist) (10 min)

---

## 🏗️ 5-Stage Pipeline

```
1️⃣ REPORT
   └─ User files bug with template
   └─ Read: BUG_REPORTING_QUICK_START.md
   └─ Checklist: Reporter checklist

2️⃣ TRIAGE
   └─ Triager assigns priority, labels, root cause
   └─ Read: BUG_TRIAGE.md (Triage section)
   └─ Checklist: Triager checklist

3️⃣ FIX
   └─ Developer implements fix with tests
   └─ Read: BUG_TRIAGE_TEAM_GUIDE.md (Developer section)
   └─ Checklist: Developer checklist

4️⃣ VERIFY
   └─ Code reviewer + QA verify fix
   └─ Read: BUG_TRIAGE_TEAM_GUIDE.md (QA section)
   └─ Checklists: Code Reviewer + QA checklists

5️⃣ CLOSE
   └─ Release manager deploys, closes issue
   └─ Read: BUG_TRIAGE_TEAM_GUIDE.md (Release Manager section)
   └─ Checklist: Release Manager checklist
```

---

## 🏷️ Priority System

### P0 — CRITICAL ❌
- System crashes / 500 errors
- Data loss or corruption
- Security vulnerability (auth bypass, data leak)
- Multi-tenant isolation broken
- All users blocked
- **SLA**: 1 hour response | 4 hours fix | Deploy immediately

### P1 — HIGH ⚠️
- Major feature broken (wrong data, 403/404)
- Affects significant user segment
- Performance degraded (>2s response time)
- Workaround exists but painful
- **SLA**: 4 hour response | 1 day fix | This sprint

### P2 — MEDIUM ℹ️
- Feature works but buggy
- Affects single user/edge case
- UI cosmetic issues
- **SLA**: 24 hour response | Next sprint | Backlog

**Full definitions**: [BUG_TRIAGE.md#priority-levels](./BUG_TRIAGE.md#-priority-levels)

---

## 🔑 Required Fields

Every bug report MUST include:

```
✅ RequestId      (from error message or API response)
✅ TenantId       (from URL /[tenantId]/ or Settings)
✅ Reproduction   (exact steps: 1, 2, 3, not vague)
✅ Expected vs    (what should happen vs what happened)
   Actual
✅ Role           (ADMIN, OPERATOR, RESIDENT)
✅ Environment    (Browser, OS, Device)
```

**Template**: [.github/ISSUE_TEMPLATE/bug_report.md](./.github/ISSUE_TEMPLATE/bug_report.md)

---

## 🏷️ Labels (23 total)

### Priority Labels (Pick ONE)
- `P0-critical` — Fix immediately
- `P1-high` — Fix this sprint
- `P2-medium` — Fix next sprint

### Component Labels (Pick ONE)
- `backend`, `frontend`, `auth`, `database`, `performance`, `ui`, `mobile`, `documentation`

### Status Labels (Workflow)
- `needs-triage` → `in-progress` → `in-review` → `verified` → `released`

### Type Labels (Pick ONE)
- `bug`, `regression`, `feature-request`, `chore`

### Impact Labels (Optional)
- `multi-tenant`, `security`, `data-loss`, `blocker`, `regression-critical`

**Full reference**: [GITHUB_LABELS.md](./GITHUB_LABELS.md)

---

## ⚙️ Setup Instructions

### For First-Time Setup

1. **Create labels automatically**:
   ```bash
   export GITHUB_TOKEN=your_token
   export GITHUB_REPO=owner/repo
   ./scripts/setup-labels.sh
   ```

   Or see [GITHUB_LABELS.md#how-to-import](./GITHUB_LABELS.md#-how-to-import-labels) for manual setup

2. **Share documents with team**:
   ```bash
   # Share these files:
   - BUG_REPORTING_QUICK_START.md
   - BUG_TRIAGE_CHECKLISTS.md (print this)
   - BUG_TRIAGE_TEAM_GUIDE.md
   ```

3. **Set team expectations**:
   - Link to quick start in README
   - Mention in onboarding
   - Post in team Slack

---

## 📊 SLAs & Metrics

### Response Time
| Priority | Target | Escalate if |
|----------|--------|-------------|
| P0 | 1 hour | Not assigned after 30 min |
| P1 | 4 hours | Not assigned after 2 hours |
| P2 | 24 hours | Not assigned after 12 hours |

### Fix Time
| Priority | Target | Escalate if |
|----------|--------|-------------|
| P0 | 4 hours | Not merged after 4 hours |
| P1 | 1 day | Not merged after 1 day |
| P2 | 1 week | Not merged after 1 week |

### Close Time
| Priority | Target |
|----------|--------|
| P0 | Same day (deployed) |
| P1 | This sprint |
| P2 | Next sprint |

---

## 🆘 Emergency Procedures

### P0 Bug Not Fixed in 4 Hours?
1. Notify dev manager immediately (Slack/call)
2. Offer help: "Can I pair with you?"
3. Remove blockers
4. Escalate to backup developer

### Multi-Tenant Isolation Issue?
1. TREAT AS P0 IMMEDIATELY
2. Notify security team
3. Assess impact (how many tenants?)
4. Disable feature if necessary
5. Post-mortem required

**Full escalation guide**: [BUG_TRIAGE_TEAM_GUIDE.md#escalation](./BUG_TRIAGE_TEAM_GUIDE.md#-escalation-procedures)

---

## 📖 Common Questions

### Q: What's RequestId?
**A**: Unique identifier for API request. Find in:
- Error message: "Error #req_abc123..."
- DevTools Network tab → API response → `requestId` field

### Q: Where's TenantId?
**A**: Your organization ID. Find in:
- URL: `/[tenantId]/buildings...`
- Settings page

### Q: Can I work on P2 bugs instead of P1?
**A**: No. Always do P0 → P1 → P2. Don't skip levels.

**More Q&A**: [BUG_TRIAGE_TEAM_GUIDE.md#common-questions](./BUG_TRIAGE_TEAM_GUIDE.md#-common-questions)

---

## 🔗 Related Documents

- [PHASE_11_SCOPED_ROLES_COMPLETE.md](./PHASE_11_SCOPED_ROLES_COMPLETE.md) — Multi-tenant implementation
- [AUTH_CONTRACT.md](./AUTH_CONTRACT.md) — Auth & permission rules
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — System design

---

## 📋 Checklist for New Team Members

- [ ] Read: [BUG_REPORTING_QUICK_START.md](./BUG_REPORTING_QUICK_START.md) (10 min)
- [ ] Read: [BUG_TRIAGE.md](./BUG_TRIAGE.md) (40 min)
- [ ] Read: Your role-specific section in [BUG_TRIAGE_TEAM_GUIDE.md](./BUG_TRIAGE_TEAM_GUIDE.md) (20 min)
- [ ] Print: [BUG_TRIAGE_CHECKLISTS.md](./BUG_TRIAGE_CHECKLISTS.md)
- [ ] Bookmark: [GITHUB_LABELS.md](./GITHUB_LABELS.md)
- [ ] Ask: "What's the current bug backlog?"
- [ ] Ask: "Can I shadow a triage session?"

---

## 🚀 Getting Started Right Now

**Reporting a bug?**
→ Go to [BUG_REPORTING_QUICK_START.md](./BUG_REPORTING_QUICK_START.md)

**Triaging a bug?**
→ Use [BUG_TRIAGE_CHECKLISTS.md#triager](./BUG_TRIAGE_CHECKLISTS.md#-triager-triage-checklist)

**Fixing a bug?**
→ Use [BUG_TRIAGE_CHECKLISTS.md#developer](./BUG_TRIAGE_CHECKLISTS.md#-developer-fix-checklist)

**Need full process?**
→ Read [BUG_TRIAGE.md](./BUG_TRIAGE.md)

---

## 📞 Help

- **Question about process?** → Read [BUG_TRIAGE.md](./BUG_TRIAGE.md)
- **What should I include?** → Read [BUG_REPORTING_QUICK_START.md](./BUG_REPORTING_QUICK_START.md)
- **Need a checklist?** → Use [BUG_TRIAGE_CHECKLISTS.md](./BUG_TRIAGE_CHECKLISTS.md)
- **What labels to use?** → See [GITHUB_LABELS.md](./GITHUB_LABELS.md)
- **Team-specific how-tos?** → Read [BUG_TRIAGE_TEAM_GUIDE.md](./BUG_TRIAGE_TEAM_GUIDE.md)

---

**Created**: Feb 18, 2026
**Status**: Production Ready ✅
**Version**: 1.0

