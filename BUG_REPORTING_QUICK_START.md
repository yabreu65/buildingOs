# 🚀 Bug Reporting Quick Start

**TL;DR**: Found a bug? Use this quick reference to report it properly.

---

## ⚡ 30-Second Overview

```
1. Go to: GitHub Issues → New Issue → 🐛 Bug Report
2. Fill template with:
   - Clear reproduction steps
   - RequestId (from error/DevTools)
   - TenantId (from URL)
   - Your role (ADMIN, OPERATOR, RESIDENT)
3. Submit with labels: bug, [component], [priority]
4. Team triages within SLA
```

---

## 📋 What We Need (In Order of Importance)

### ✅ MUST HAVE
```
1. Reproduction Steps
   - Exact sequence: "Click X, then Y, then Z"
   - NOT: "doesn't work"

2. RequestId
   - From error page: "Error #req_abc123..."
   - Or DevTools: Network tab → API response → requestId field

3. TenantId
   - From URL: /[tenantId]/buildings
   - Or Settings: Copy from top

4. User Role
   - TENANT_OWNER | TENANT_ADMIN | OPERATOR | RESIDENT
```

### 🔄 SHOULD HAVE
```
5. Expected vs Actual
   - "Should see buildings" vs "Blank page"

6. Environment
   - Browser (Chrome, Firefox, Safari)
   - Device (Desktop, Mobile, Tablet)

7. Frequency
   - Always | Intermittent | One-time
```

### 📸 NICE TO HAVE
```
8. Screenshot/Video
   - Shows what you see

9. Browser Console Errors
   - DevTools → Console → Copy red errors

10. Relevant Logs
    - API errors, stack traces
```

---

## 🏷️ Quick Label Guide

### Pick ONE Priority
```
🔴 P0-critical  → Can't work at all (crashes, data loss, security)
🟠 P1-high      → Feature broken (workaround exists)
🟡 P2-medium    → Works but buggy (cosmetic, rare case)
```

### Pick ONE Component
```
🔵 backend      → API, database, logic issues
🟣 frontend     → React, buttons, forms, layout
🔴 auth         → Login, permissions, roles
🔷 database     → Schema, migrations, data
🟢 performance  → Speed, slow loading
🌸 ui           → Colors, fonts, styling
🟤 mobile       → Phone/tablet display
📚 documentation → Guides, docs, comments
```

### Add These Automatically
```
✅ bug                (Always for bug reports)
✅ needs-triage       (Always, first time)
```

---

## 📝 Template (Copy & Paste)

```markdown
## 🐛 [One-line title of the bug]

### Reproduction Steps
1. Login as [ROLE]
2. Go to [PAGE/URL]
3. Click [BUTTON]
4. See: [ACTUAL RESULT]

### Expected
[What should happen]

### Environment
- Browser: Chrome 120
- OS: macOS
- App Version: v1.2.1

### Tenant / User Info
- RequestId: req_abc123xyz789
- TenantId: tenant_123xyz
- Role: OPERATOR

### Additional Context
[Any other useful info]
```

---

## 🎯 Examples (Copy One & Fill In)

### Example 1: "Page crashes"

```markdown
## 🐛 Building dashboard crashes on load

### Reproduction Steps
1. Login as TENANT_ADMIN
2. Go to /buildings
3. Click on any building name
4. See: Browser error "Uncaught TypeError"

### Expected
See building detail page

### Environment
- Browser: Chrome 120
- OS: macOS
- App: v1.2.1

### Tenant / User Info
- RequestId: req_20260218_abc123
- TenantId: tenant_xyz789
- Role: TENANT_ADMIN

### Additional Context
Happens in Firefox too. Works with OPERATOR role.

### Logs
```
TypeError: Cannot read property 'id' of undefined
  at BuildingDetail.tsx:45
```
```

---

### Example 2: "Wrong data"

```markdown
## 🐛 Building filter returns incorrect results

### Reproduction Steps
1. Login as OPERATOR
2. Go to /buildings
3. Set filter: "Units: 5-10"
4. See: Empty results
5. But building "Tower A" has 6 units

### Expected
Show buildings with 5-10 units

### Environment
- Browser: Safari
- OS: iOS
- App: v1.2.1

### Tenant / User Info
- RequestId: req_20260218_filter123
- TenantId: tenant_filter_test
- Role: OPERATOR

### Additional Context
Filter works for "1-5 units" correctly.
Only broken for "5-10" range.
Workaround: Remove filter, count manually.
```

---

### Example 3: "UI looks wrong"

```markdown
## 🐛 Modal title overflows on mobile

### Reproduction Steps
1. Open app on iPhone (375px width)
2. Go to /settings/members
3. Click "Manage Roles" button
4. See: Title text is cut off

### Expected
Title fits on screen or uses ellipsis

### Screenshots
[Paste screenshot here]

### Environment
- Browser: Safari
- OS: iOS 17
- Device: iPhone 14

### Tenant / User Info
- RequestId: N/A (no error)
- TenantId: tenant_mobile
- Role: TENANT_ADMIN

### Additional Context
Desktop looks fine (Chrome 1920x1080).
Only broken on small screens.
```

---

## 🚨 Priority Decision Tree

```
Is the system DOWN or CRASHING?
├─ YES → P0-critical
└─ NO
   └─ Is DATA missing or corrupted?
      ├─ YES → P0-critical
      └─ NO
         └─ Can you NOT work? (BLOCKER)
            ├─ YES → P1-high
            └─ NO
               └─ Workaround exists?
                  ├─ YES → P2-medium
                  └─ NO → P1-high
```

---

## ❌ Common Mistakes (Avoid These!)

### ❌ Bad: Vague description
```
"Dashboard doesn't work"
"Building page is broken"
"Can't see my data"
```

### ✅ Good: Specific steps
```
"Go to /buildings, see 404 instead of list"
"Click 'Create Unit' button, get 403 Forbidden"
"Building 'Tower A' shows units from 'Tower B'"
```

---

### ❌ Bad: Missing RequestId/TenantId
```
"Payment API returns error"
(No way to debug which tenant/request)
```

### ✅ Good: Include IDs
```
"Payment API returns 500 for req_abc123 in tenant_xyz"
```

---

### ❌ Bad: Feature request as bug
```
"Add dark mode to the app"
"Implement export to PDF"
```

### ✅ Good: Feature request format
```
(Create new issue with "Feature Request" template)
```

---

## 📞 Need Help?

### Quick Questions
1. **What's RequestId?** → Check error message or DevTools Network tab
2. **Where's TenantId?** → In URL: `/[tenantId]/...` or Settings page
3. **What role am I?** → Check Settings → Your profile

### Still stuck?
- Read: [BUG_TRIAGE.md](./BUG_TRIAGE.md) (full process)
- Read: [GITHUB_LABELS.md](./GITHUB_LABELS.md) (label reference)
- Ask: Team Slack or GitHub discussions

---

## 🔄 What Happens Next?

```
1️⃣  You submit bug report
    ↓
2️⃣  Team triages (within SLA)
    • Confirms priority
    • Assigns to developer
    ↓
3️⃣  Developer fixes
    • Creates PR with fix
    • References your issue
    ↓
4️⃣  QA verifies
    • Tests your exact steps
    • Confirms fixed
    ↓
5️⃣  Deployed to production
    • Merged and live
    • Issue closed with release info
```

---

## 📊 SLA (What to Expect)

| Priority | Response | Fix | Deploy |
|----------|----------|-----|--------|
| P0 🔴 | 1 hour | 4 hours | Same day |
| P1 🟠 | 4 hours | 1 day | This sprint |
| P2 🟡 | 24 hours | 1 week | Next sprint |

---

## ✅ Checklist (Before Submitting)

- [ ] I filled the bug report template completely
- [ ] I provided exact reproduction steps (not vague)
- [ ] I included RequestId and TenantId
- [ ] I noted my user role
- [ ] I used the correct label (bug, not feature-request)
- [ ] I picked a priority (P0/P1/P2)
- [ ] I picked a component (backend/frontend/auth/etc)
- [ ] I searched for similar issues (no duplicates)

---

## 🎯 One More Thing

**The more detail you provide → The faster we fix it**

Take 5 minutes to fill the template well. Saves everyone hours of back-and-forth!

---

**Ready to report?** → [Create New Issue](../../issues/new?assignees=&labels=bug&template=bug_report.md)

**Need full details?** → Read [BUG_TRIAGE.md](./BUG_TRIAGE.md)

**Questions?** → Check [GITHUB_LABELS.md](./GITHUB_LABELS.md) or ask the team
