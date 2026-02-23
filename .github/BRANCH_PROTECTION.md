# Branch Protection Rules - BuildingOS

## 🔒 Objetivo
Bloquear merges a `main` si la CI falla o si hay code reviews pendientes.

## Manual Setup (Via GitHub UI)

1. Go to: **Settings** → **Branches** → **Add rule**
2. Create rule for branch: `main`
3. Enable these options:
   - ✅ **Require a pull request before merging**
     - ✅ Require approvals: **1 reviewer**
     - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ **Require status checks to pass before merging**
     - ✅ Require branches to be up to date before merging
     - ✅ Select status check: **ci** (from GitHub Actions)
   - ✅ **Require branches to be up to date before merging**
   - ✅ **Include administrators** (enforce for admins too)

## Automated Setup (Via GitHub CLI)

```bash
# Install GitHub CLI if not already installed
# https://cli.github.com

# Login to GitHub
gh auth login

# Configure branch protection for main
gh repo rules create \
  --name "main-branch-protection" \
  --targets "branch" \
  --condition branch_name_pattern="main" \
  --require-status-checks-to-pass "ci" \
  --require-pull-request-reviews 1 \
  --require-branches-to-be-up-to-date
```

## What This Enforces

| Check | Status |
|-------|--------|
| **Install dependencies** | ✅ Must pass |
| **Lint** | ✅ Must pass |
| **Typecheck** | ✅ Must pass |
| **Unit & Integration Tests** | ✅ Must pass |
| **E2E Tests** | ✅ Must pass |
| **Build** | ✅ Must pass |
| **Require PR Reviews** | ✅ Min 1 approval needed |
| **Up-to-date branches** | ✅ Must rebase if main updated |

## Result

**Any PR with:**
- ❌ Failing build
- ❌ Failing tests (unit, integration, E2E)
- ❌ Linting errors
- ❌ TypeScript errors
- ❌ No approvals

**Cannot be merged to main.**

## Checking Status

```bash
# View rules
gh repo rules list

# View branch protections
gh api repos/{owner}/{repo}/branches/main/protection
```

## Troubleshooting

If CI is blocking legitimate changes:
1. Check the failing job in GitHub Actions
2. Fix the issue locally
3. Push a new commit
4. CI will re-run automatically
5. Once all checks pass, PR can be merged

## Admin Override (Emergency Only)

Admins can dismiss this rule temporarily:
- GitHub UI: Settings → Branches → main → Scroll to bottom
- Or: `gh pr comment {PR_NUMBER} --body "skip-checks"`

*Use sparingly - this rule exists to maintain code quality.*
