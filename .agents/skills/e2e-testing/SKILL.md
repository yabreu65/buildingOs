# E2E Testing Skill

**Trigger**: Writing Playwright E2E tests in BuildingOS

## Purpose
Follow BuildingOS E2E testing conventions and patterns.

## Configuration

### Playwright Config
```typescript
// apps/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

## Test Structure

### Location
```
apps/web/tests/{module}/
├── {module}.spec.ts
└── {module}.flows.spec.ts
```

### Basic Test Pattern
```typescript
import { test, expect } from '@playwright/test';

test.describe('{Module}', () => {
  test.beforeEach(async ({ page }) => {
    // Login or setup
    await page.goto('/login');
    await page.fill('[name="email"]', 'admin@test.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('[type="submit"]');
  });

  test('should list {module}', async ({ page }) => {
    await page.goto('/{module}');
    await expect(page.locator('h1')).toContainText('{Module}');
  });

  test('should create {module}', async ({ page }) => {
    await page.goto('/{module}');
    await page.click('[data-testid="create-btn"]');
    await page.fill('[name="name"]', 'Test {Module}');
    await page.click('[type="submit"]');
    await expect(page.locator('.success-message')).toBeVisible();
  });
});
```

## Fixtures

### Tenant Fixture
```typescript
// tests/fixtures/tenant.ts
export const testTenant = {
  id: 'test-tenant-id',
  name: 'Test Tenant',
  slug: 'test-tenant',
};
```

### Auth Fixtures
```typescript
// tests/fixtures/auth.ts
export async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.fill('[name="email"]', 'admin@buildingos.com');
  await page.fill('[name="password"]', process.env.E2E_ADMIN_PASSWORD!);
  await page.click('[type="submit"]');
}

export async function loginAsResident(page: Page) {
  // ... similar
}
```

## Page Objects

### Example
```typescript
// tests/pages/{module}.page.ts
export class {Module}Page {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/{module}');
  }

  async create(name: string) {
    await this.page.click('[data-testid="create-btn"]');
    await this.page.fill('[name="name"]', name);
    await this.page.click('[type="submit"]');
  }

  async getFirstItem() {
    return this.page.locator('[data-testid="{module}-item"]').first();
  }
}
```

## Running Tests

### Local
```bash
cd apps/web
npx playwright test
```

### With UI
```bash
npx playwright test --ui
```

### Specific Module
```bash
npx playwright test tests/{module}
```

### CI/CD
```bash
E2E_BASE_URL=$DEPLOY_URL npx playwright test
```

## Best Practices

1. **Use data-testid** for stable selectors
2. **Avoid flaky waits** - use expect with conditions
3. **Clean up data** - delete test data in afterEach
4. **One test per file** - keep tests focused
5. **Descriptive names** - test describe blocks
6. **Trace on failure** - analyze failures with Playwright trace

## Validation Checklist

Before completing:
- [ ] Tests use data-testid for selectors
- [ ] Login/logout handled in beforeEach
- [ ] Test data cleaned up in afterEach
- [ ] Assertions use expect with meaningful messages
- [ ] Tests run locally before PR
- [ ] Trace analyzed on failures
