# 🏷️ GitHub Labels Configuration

**Purpose**: Standardized label system for bug triage, issue classification, and workflow management

**Version**: 1.0
**Last Updated**: Feb 18, 2026

---

## 📋 How to Import Labels

### Option 1: Manual Creation (Recommended for first-time setup)

Go to: **GitHub Repo → Settings → Labels**

Click **New label** and create each label below.

### Option 2: Bulk Import via GitHub CLI

```bash
# Install gh CLI if not already installed
brew install gh

# Login to your repo
gh auth login

# Run script (see Script section below)
./scripts/setup-labels.sh
```

### Option 3: Via GitHub API

```bash
# For each label, run:
curl -X POST \
  -H "Authorization: token YOUR_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/OWNER/REPO/labels \
  -d '{"name":"label-name","color":"HEXCOLOR","description":"description"}'
```

---

## 🏷️ Label Categories

### 1. Priority Labels (Required for every bug)

| Name | Color | Description | Usage |
|------|-------|-------------|-------|
| `P0-critical` | `#d32f2f` (Red) | Fix immediately (data loss, crashes, security) | 🔴 System breaking |
| `P1-high` | `#f57c00` (Orange) | Fix this sprint (major feature broken) | 🟠 Feature broken |
| `P2-medium` | `#fbc02d` (Yellow) | Fix next sprint (workaround exists) | 🟡 Minor issue |

### 2. Component Labels (Helps route to correct team)

| Name | Color | Description | Usage |
|------|-------|-------------|-------|
| `backend` | `#1976d2` (Blue) | API, database, server-side logic | NestJS, Prisma, services |
| `frontend` | `#7b1fa2` (Purple) | React, Next.js, UI/UX | Web app, components |
| `auth` | `#c2185b` (Pink) | Authentication, authorization, JWT | Login, permissions, RBAC |
| `database` | `#0097a7` (Cyan) | Schema, migrations, data integrity | Prisma, SQL, migrations |
| `performance` | `#388e3c` (Green) | Speed, optimization, efficiency | Slow queries, rendering |
| `ui` | `#d81b60` (Deep Pink) | User interface, styling, layout | CSS, components, design |
| `mobile` | `#6a1b9a` (Deep Purple) | Mobile responsiveness, mobile app | Responsive design, mobile testing |
| `documentation` | `#455a64` (Blue Grey) | Docs, guides, comments | README, guides, docs |

### 3. Status Labels (Workflow tracking)

| Name | Color | Description | Usage |
|------|-------|-------------|-------|
| `needs-triage` | `#e0e0e0` (Grey) | Awaiting priority & assignment | New issue |
| `needs-info` | `#bdbdbd` (Medium Grey) | Awaiting reporter clarification | Can't reproduce, need details |
| `in-progress` | `#42a5f5` (Light Blue) | Developer is working on it | Dev assigned, actively fixing |
| `in-review` | `#ab47bc` (Light Purple) | PR awaiting code review | PR created, waiting review |
| `verified` | `#26a69a` (Teal) | QA confirmed fix works | Ready to merge |
| `released` | `#7cb342` (Light Green) | Fixed & deployed to production | Closed, deployed |

### 4. Issue Type Labels (What kind of issue)

| Name | Color | Description | Usage |
|------|-------|-------------|-------|
| `bug` | `#e53935` (Dark Red) | Something is broken | Actual bug, not feature request |
| `regression` | `#d81b60` (Dark Pink) | Used to work, now broken | Caused by recent change |
| `feature-request` | `#5e35b1` (Indigo) | Requested feature (mislabeled) | Not a bug, feature request |
| `chore` | `#616161` (Dark Grey) | Internal improvement, cleanup | Refactoring, tech debt |

### 5. Impact Labels (Severity & scope)

| Name | Color | Description | Usage |
|------|-------|-------------|-------|
| `multi-tenant` | `#c62828` (Dark Red) | Affects multiple tenants/users | Cross-tenant issue |
| `security` | `#bf360c` (Crimson) | Security vulnerability | Auth bypass, data leak |
| `data-loss` | `#e53935` (Red) | Risk of data loss/corruption | Data integrity issue |
| `blocker` | `#d32f2f` (Red) | Blocks other work/features | Blocks development, releases |
| `regression-critical` | `#c62828` (Dark Red) | Critical regression (worked before) | URGENT regression |

---

## 🎯 Label Usage Examples

### Example 1: P0 Security Bug

```
Labels Applied:
- P0-critical          (Priority)
- security             (Type)
- auth                 (Component)
- multi-tenant         (Impact)
- needs-triage         (Status)
```

**Why these labels?**
- P0: System breaking (multi-tenant isolation broken)
- security: Security vulnerability
- auth: Where the bug is
- multi-tenant: Affects all tenants
- needs-triage: Awaiting priority confirmation

---

### Example 2: P1 Feature Broken

```
Labels Applied:
- P1-high              (Priority)
- bug                  (Type)
- backend              (Component)
- in-progress          (Status)
```

**Why these labels?**
- P1: Major feature broken
- bug: It's a bug, not feature request
- backend: Issue is in API/database
- in-progress: Dev is fixing

---

### Example 3: P2 UI Issue

```
Labels Applied:
- P2-medium            (Priority)
- bug                  (Type)
- frontend             (Component)
- ui                   (Component - secondary)
- mobile               (Impact)
- needs-info           (Status)
```

**Why these labels?**
- P2: Minor cosmetic issue
- bug: UI bug
- frontend: React component
- ui: UI-specific
- mobile: Mobile-only issue
- needs-info: Need more details from reporter

---

## 📊 Label Workflow

### Bug Lifecycle

```
Issue Created
    ↓
[Add Labels] needs-triage, bug, [component], [impact]
    ↓
[Triage Review] Assign P0/P1/P2
    ↓
[Can't Reproduce?] Add needs-info, ask questions
    ↓
[Reproduced] → Assign to developer, add in-progress
    ↓
[PR Created] → Change status to in-review
    ↓
[QA Tests] → Change status to verified (if passes)
    ↓
[Merged] → Change status to released
    ↓
[Close Issue] ✅
```

---

## 🔍 Label Search Tips

### Quick Filters

```
# Find all critical bugs
is:open label:P0-critical

# Backend issues awaiting triage
is:open label:backend label:needs-triage

# Security issues
is:open label:security

# My assigned high-priority bugs
is:open label:P1-high assignee:@me

# Recent regressions
is:open label:regression created:>2026-02-01

# Multi-tenant issues
is:open label:multi-tenant
```

### GitHub Project Board Setup

Create columns matching status labels:
1. **Needs Triage** (label: needs-triage)
2. **In Progress** (label: in-progress)
3. **In Review** (label: in-review)
4. **Verified** (label: verified)
5. **Closed** (is:closed)

---

## 📝 Labeling Rules

### Every Bug MUST have:
- ✅ **One Priority**: P0-critical | P1-high | P2-medium
- ✅ **One Component**: backend | frontend | auth | database | performance | ui | mobile | documentation
- ✅ **One Type**: bug | regression | feature-request | chore
- ✅ **One Status**: needs-triage | needs-info | in-progress | in-review | verified | released

### May also have:
- ⚠️ **Impact labels**: multi-tenant | security | data-loss | blocker | regression-critical
- 🏷️ **Secondary component**: (e.g., both frontend and mobile)

### Examples

**Valid Label Combo** ✅
```
P1-high, backend, bug, in-progress
```

**Invalid** ❌
```
P0-critical, P1-high  (Two priorities!)
```

**Valid with Secondary** ✅
```
P2-medium, frontend, ui, mobile, bug
```

---

## 🔄 Transitions

### Status Label Changes

```
Initial Creation
  ↓ Triage Review
[needs-triage] → [P0/P1/P2 assigned]
  ↓ Developer Assigned
[needs-triage] → [in-progress]
  ↓ PR Created
[in-progress] → [in-review]
  ↓ PR Approved
[in-review] → [in-progress] (back to dev for final touches)
  ↓ Verified
[in-progress] → [verified]
  ↓ Merged
[verified] → [released]
  ↓ Closed
[released] → [CLOSED]
```

---

## 📋 Label Management Checklist

### Initial Setup
- [ ] Create all priority labels
- [ ] Create all component labels
- [ ] Create all status labels
- [ ] Create all type labels
- [ ] Create all impact labels

### Ongoing Maintenance
- [ ] Review label colors are distinct
- [ ] Remove unused labels (quarterly)
- [ ] Archive old/deprecated labels
- [ ] Update descriptions if needed
- [ ] Add any new labels to this document

### Team Alignment
- [ ] Share this document with team
- [ ] Train new team members on labels
- [ ] Enforce labeling in code review
- [ ] Use labels in sprint planning

---

## 🎨 Color Palette Reference

Used throughout labels for consistency:

```
Red/Pink (High Priority, Security, Critical):
- #d32f2f (P0-critical)
- #e53935 (multi-tenant, data-loss)
- #c62828 (security, regression-critical)

Orange/Yellow (Medium Priority):
- #f57c00 (P1-high)
- #fbc02d (P2-medium)

Blue/Purple (Components, Features):
- #1976d2 (backend)
- #7b1fa2 (frontend)
- #c2185b (auth)

Green (Positive, Performance, Verified):
- #388e3c (performance)
- #7cb342 (released)
- #26a69a (verified)

Grey (Neutral, Info, Chores):
- #e0e0e0 (needs-triage)
- #bdbdbd (needs-info)
- #616161 (chore)
```

---

## 🚀 Getting Started

1. **Copy labels above** into GitHub Settings → Labels
2. **Share this doc** with team
3. **Create first issue** using template with labels
4. **Review quarterly** to add/remove labels

---

## 📚 Related Documents

- [BUG_TRIAGE.md](./BUG_TRIAGE.md) — Bug triage process & pipeline
- [.github/ISSUE_TEMPLATE/bug_report.md](./.github/ISSUE_TEMPLATE/bug_report.md) — Bug report template

---

**Questions?** Check [BUG_TRIAGE.md](./BUG_TRIAGE.md) or contact the team.

**Last updated**: Feb 18, 2026
