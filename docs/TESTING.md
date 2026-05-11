# Testing Guide for BuildingOS

## Overview

BuildingOS has a two-tier testing strategy:

1. **Unit/Integration Tests**: Jest for API, React Testing Library for web components
2. **E2E Tests**: Playwright for critical user flows (the "hard gate")

## E2E Test Architecture

### Deterministic Seed Data

All E2E tests rely on deterministic data from `apps/api/prisma/seed.test.ts`. This ensures tests are reproducible and don't depend on external state.

**Key test users:**

| Role | Email | Password |
|------|-------|----------|
| Super Admin | `test-superadmin@buildingos.local` | `TestPass123!` |
| Tenant Admin A | `test-tenant-admin-a@buildingos.local` | `TestPass123!` |
| Tenant Admin B | `test-tenant-admin-b@buildingos.local` | `TestPass123!` |
| Operator | `test-operator@buildingos.local` | `TestPass123!` |
| Resident A | `test-resident@buildingos.local` | `TestPass123!` |
| Resident B | `test-resident-b@buildingos.local` | `TestPass123!` |

**Seed data includes:**
- 2 tenants (Tenant A: PRO plan, Tenant B: FREE trial)
- 3 buildings (Torre A Test: 5 units, Torre B Test: 3 units, Edificio Test B: 3 units)
- 11 units total
- 1 published liquidation (April 2026) with charges
- 1 submitted payment

### Running E2E Tests Locally

**Prerequisites:**
1. PostgreSQL running locally
2. API dependencies installed
3. Web app dependencies installed

**Steps:**

```bash
# 1. Set up environment
cp .env.example .env
# Edit DATABASE_URL to point to your local Postgres

# 2. Run migrations and seed
cd apps/api
npm run migrate:deploy
npm run seed:test

# 3. Start API (in one terminal)
npm run start:prod  # or dev

# 4. In another terminal, run E2E tests
cd apps/web
npx playwright install chromium  # one-time
npm run test:e2e -- --project=chromium --workers=1
```

**Run a specific test file:**
```bash
npm run test:e2e -w apps/web -- tests/e2e/auth/login.spec.ts --project=chromium --workers=1
```

### Test File Organization

```
apps/web/tests/e2e/
├── api/
│   └── health.spec.ts          # API smoke tests
├── auth/
│   └── login.spec.ts           # Login/logout/session flows
├── buildings/
│   ├── create-building.spec.ts # Building CRUD
│   └── manage-units.spec.ts    # Unit management
└── helpers/
    ├── auth.ts                 # Login/logout helpers
    └── navigation.ts           # Common navigation actions
```

### Selectors Strategy

We use **data-testid** for stable selectors instead of text or CSS classes:

```tsx
// Good - stable across refactors
<button data-testid="building-create-btn">Nuevo edificio</button>

// Bad - breaks when text changes or i18n is added
<button>Nuevo edificio</button>
```

**Key data-testid values:**
- Login: `login-form`, `login-email`, `login-password`, `login-submit`
- Buildings: `building-create-btn`, `building-form`, `building-name-input`, `building-address-input`, `building-submit-btn`, `buildings-list`
- Units: `unit-create-btn`, `unit-create-form`, `unit-code-input`, `unit-label-input`, `unit-submit-btn`, `units-table-body`

### Rate Limiting in Tests

The API has rate limiting that can block rapid login attempts. For local/test environments, localhost requests get a higher limit (100/min). In CI, the API runs on localhost so this bypass works automatically.

### Writing New E2E Tests

**Guidelines:**
1. Use `test.describe.serial` for tests that mutate data
2. Always use `login()` helper which returns `tenantId`
3. Navigate with explicit URLs using extracted IDs
4. Wait for navigation with `waitForURL` or `waitForLoadState`
5. Verify assertions with `waitFor` to avoid race conditions

**Example:**
```typescript
test.describe.serial('Feature Flow', () => {
  let tenantId: string;

  test.beforeEach(async ({ page }) => {
    tenantId = await login(page, TEST_USERS.tenantAdminA);
  });

  test('should do something', async ({ page }) => {
    await page.goto(`/${tenantId}/some-page`);
    await page.locator('[data-testid="action-btn"]').click();
    await page.waitForURL(`**/${tenantId}/some-page`);
    // assertions...
  });
});
```

## CI/CD

The E2E tests run on every PR to `main` or `develop`, and daily at 2 AM UTC.

**What runs in CI:**
1. PostgreSQL service container
2. Build API + run migrations + seed test data
3. Start API server in background
4. Install Playwright Chromium
5. Run E2E tests against `http://localhost:3000`
6. Upload reports and videos on failure

## Debugging Failed Tests

**Local debugging:**
```bash
# Run with UI mode
npm run test:e2e -w apps/web -- --ui

# Run specific test with headed browser
npm run test:e2e -w apps/web -- tests/e2e/auth/login.spec.ts --headed
```

**Artifacts on failure:**
- Screenshots: `apps/web/test-results/.../test-failed-1.png`
- Videos: `apps/web/test-results/.../video.webm`
- Traces: `apps/web/test-results/.../trace.zip` (open with `npx playwright show-trace`)

## Common Issues

| Issue | Solution |
|-------|----------|
| Rate limiter blocks login | Wait a minute or restart API. Localhost has higher limits. |
| `isVisible()` returns false | Use `waitFor({ state: 'visible' })` instead |
| Form submission fails | Check for validation errors in snapshot |
| Unit code shows N/A | The `unitCode` field might be null; use label for assertions |
| Seed data missing | Run `npm run seed:test` in `apps/api` |
