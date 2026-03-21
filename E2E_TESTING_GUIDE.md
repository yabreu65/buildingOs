# BuildingOS E2E Testing Guide

Complete guide for implementing and running end-to-end tests with Playwright.

## Overview

This project includes a comprehensive E2E test suite with **57+ test cases** covering 15 critical user flows:

1. **Authentication** (6 tests) - Login, signup, session management
2. **Building Management** (4 tests) - CRUD operations
3. **Unit Management** (5 tests) - Unit creation, assignment, status updates
4. **Finance** (5 tests) - Charges, payments, financial dashboard
5. **Tickets & Communications** (5 tests) - Ticket lifecycle, messaging, documents
6. **Resident Access** (5 tests) - Role-based access control
7. **Super Admin** (4 tests) - Tenant management, plan changes
8. **Team Management** (5 tests) - Invitations, roles, member management
9. **Onboarding** (7 tests) - Checklist, progress tracking
10. **Multi-Tenant Isolation** (6 tests) - Data segregation verification

## Quick Start

### Installation

```bash
# Install Playwright (already included)
npm install -w apps/web --save-dev @playwright/test

# Install browsers
npx playwright install
```

### Run Tests

```bash
# Run all tests
npm run test:e2e -w apps/web

# Interactive UI mode (recommended for debugging)
npm run test:e2e:ui -w apps/web

# Debug mode with Playwright Inspector
npm run test:e2e:debug -w apps/web

# View HTML report
npm run test:e2e:report -w apps/web
```

## Project Structure

```
apps/web/
├── playwright.config.ts          # Main Playwright configuration
├── tests/e2e/
│   ├── README.md                 # Detailed test documentation
│   ├── fixtures.ts               # Custom test fixtures
│   ├── helpers/
│   │   ├── auth.ts              # Authentication helpers
│   │   ├── navigation.ts        # Navigation helpers
│   │   └── test-utils.ts        # Utility functions
│   ├── auth/
│   │   └── login.spec.ts        # Login/logout/session tests
│   ├── buildings/
│   │   ├── create-building.spec.ts
│   │   └── manage-units.spec.ts
│   ├── resident/
│   │   └── view-assignment.spec.ts
│   ├── finance/
│   │   └── charges-and-payments.spec.ts
│   ├── operations/
│   │   └── tickets-and-communications.spec.ts
│   ├── advanced/
│   │   ├── team-and-invitations.spec.ts
│   │   ├── onboarding-and-plans.spec.ts
│   │   └── multi-tenant-isolation.spec.ts
│   └── super-admin/
│       └── tenant-management.spec.ts
└── package.json
```

## Test Users

Pre-configured test users for different roles:

| Role | Email | Password | Purpose |
|------|-------|----------|---------|
| Super Admin | `super@admin.test` | `SuperAdmin@123` | Manage all tenants |
| Tenant Admin A | `admin@tenanta.test` | `TenantAdmin@123` | Manage Tenant A |
| Tenant Admin B | `admin@tenantb.test` | `TenantAdmin@123` | Manage Tenant B |
| Operator | `operator@tenanta.test` | `Operator@123` | Operations (vendors) |
| Resident A | `resident@tenanta.test` | `Resident@123` | View own data |
| Resident B | `resident@tenantb.test` | `Resident@123` | Test isolation |

## Configuration

### playwright.config.ts

Key configuration:

```typescript
// Base URL for tests
baseURL: 'http://localhost:3000'

// Timeout settings
timeout: 30000           // 30 seconds per test
globalTimeout: 30 * 60 * 1000  // 30 minutes total

// Retry policy
retries: 0              // Locally
retries: 2              // In CI

// Browsers
projects: ['chromium', 'firefox', 'webkit']

// Reporting
reporter: ['html', 'list']
```

### Environment Variables

Set via command line:

```bash
# Set custom base URL
BASE_URL=http://staging.example.com npm run test:e2e

# Run in headed mode (see browser)
npx playwright test --headed

# Run single project
npx playwright test --project=chromium
```

## Helper Functions

### Authentication (auth.ts)

```typescript
// Login
await login(page, TEST_USERS.tenantAdminA);

// Signup
await signup(page, {
  email: 'new@test.com',
  password: 'Pass@123',
  fullName: 'John Doe',
  tenantName: 'My Company'
});

// Logout
await logout(page);

// Check if logged in
const loggedIn = await isLoggedIn(page);
```

### Navigation (navigation.ts)

```typescript
// Navigate to route
await navigateTo(page, '/buildings');

// Click sidebar link
await clickNavLink(page, 'Buildings');

// Click button by text
await clickButton(page, 'Create');

// Fill form field
await fillField(page, 'name', 'Test Building');

// Check for messages
const hasError = await hasError(page, 'Email already exists');
const hasSuccess = await hasSuccess(page, 'Building created');
```

### Test Utilities (test-utils.ts)

```typescript
// Generate unique test data
const data = generateTestData();
// Returns: { timestamp, random, uniqueId, email, name, ... }

// Wait for API response
const response = await waitForAPIResponse(page, '/api/buildings', 'POST');

// Check if element contains text
await expectElementContainsText(page, 'h1', 'Dashboard');

// Verify element state
await expectVisible(page, '[data-testid="create-button"]');
await expectDisabled(page, '[data-testid="submit"]');

// LocalStorage operations
await setLocalStorage(page, 'key', 'value');
const value = await getLocalStorage(page, 'key');
await clearLocalStorage(page);

// Retry with backoff
await retry(() => clickButton(page, 'Save'), 3, 1000);
```

## Running Tests

### Local Development

```bash
# Run all tests once
npm run test:e2e -w apps/web

# Watch mode (rerun on file changes)
npm run test:e2e:ui -w apps/web

# Run specific test file
npx playwright test apps/web/tests/e2e/auth/login.spec.ts

# Run tests matching pattern
npx playwright test -g "login"

# Run tests in a specific directory
npx playwright test apps/web/tests/e2e/buildings/
```

### Debugging

```bash
# Debug mode with Inspector
npm run test:e2e:debug -w apps/web

# Headed mode (see browser)
npx playwright test --headed

# Trace & screenshot on failure
npx playwright test --trace on

# View traces
npx playwright show-trace trace.zip
```

### CI/CD

Tests run automatically on:
- Push to `main` or `develop`
- Pull requests
- Daily schedule (2 AM UTC)

See `.github/workflows/e2e-tests.yml` for configuration.

## Writing New Tests

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { login, TEST_USERS } from '../helpers/auth';
import { clickButton, fillField } from '../helpers/navigation';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Setup - runs before each test
    await login(page, TEST_USERS.tenantAdminA);
  });

  test('should do something', async ({ page }) => {
    // Step 1: Navigate
    await page.goto('/path');

    // Step 2: Interact
    await fillField(page, 'name', 'Test');
    await clickButton(page, 'Submit');

    // Step 3: Verify
    await expect(page).toHaveURL(/\/success/);
  });

  test.afterEach(async ({ page }) => {
    // Cleanup - runs after each test
    await page.close();
  });
});
```

### Best Practices

1. **Use data-testid attributes**
   ```html
   <button data-testid="submit-button">Submit</button>
   ```

2. **Wait for navigation**
   ```typescript
   await page.waitForURL('**/dashboard');
   ```

3. **Use unique test data**
   ```typescript
   const data = generateTestData();
   ```

4. **Handle async operations**
   ```typescript
   await page.waitForLoadState('networkidle');
   ```

5. **Group related tests**
   ```typescript
   test.describe('Building Management', () => {
     // Related tests here
   });
   ```

6. **Test both success and error paths**
   ```typescript
   test('should create successfully', async ({ page }) => { ... });
   test('should show error on invalid input', async ({ page }) => { ... });
   ```

## Test Results

### HTML Report

Generate after tests:

```bash
npm run test:e2e:report -w apps/web
```

Opens detailed report with:
- Test results and timing
- Browser console logs
- Network requests
- Screenshots (on failure)
- Video recordings (on failure)

### Artifacts

After test run:

```
apps/web/
├── playwright-report/    # HTML report
├── test-results/
│   ├── videos/          # Failed test videos
│   ├── traces/          # Debug traces
│   └── screenshots/     # Failure screenshots
```

## Troubleshooting

### Tests timeout

**Solution**: Increase timeout in config or specific test

```typescript
test.setTimeout(60000); // 60 seconds for this test
```

### Cannot find element

**Solution**: Use UI mode to debug

```bash
npm run test:e2e:ui -w apps/web
```

Then:
- See live browser
- Inspect elements
- Check selectors
- Slow down execution

### Tests fail in CI but pass locally

**Likely causes**:
- Different database state
- Missing environment variables
- Async timing issues
- Browser differences

**Solutions**:
- Check CI logs carefully
- Verify test data setup
- Add explicit waits
- Use `--headed` in CI for debugging

### Flaky tests

**Causes**:
- Race conditions
- Timing assumptions
- Network issues
- Element visibility

**Solutions**:
- Use explicit waits instead of sleeps
- Add retry logic for flaky operations
- Use data-testid for element selection
- Check for overlays/modals blocking clicks

## Performance

### Test Suite Timing

- **Local (all browsers)**: 3-5 minutes
- **Local (chromium only)**: 1-2 minutes
- **CI (with setup)**: 10-15 minutes

### Optimization

Run specific tests for faster feedback:

```bash
# Test a feature in development
npx playwright test -g "building" --headed

# Test single file
npx playwright test apps/web/tests/e2e/auth/login.spec.ts

# Run only chromium (fastest)
npx playwright test --project=chromium
```

## CI/CD Integration

### GitHub Actions Workflow

`.github/workflows/e2e-tests.yml`:

- Runs on push/PR to main/develop
- Sets up PostgreSQL service
- Builds API and Web
- Runs migrations and seeds
- Executes all E2E tests
- Uploads reports and videos
- Comments on PRs with results

### Branch Protection

Configure branch protection to require:
- E2E tests pass
- Zero vulnerabilities
- Code review

## Next Steps

1. **Seed test data** - Create demo tenants with sample data
2. **Add visual regression** - Screenshot comparisons
3. **Performance testing** - Load and response time testing
4. **Accessibility testing** - WCAG compliance checks
5. **Mobile testing** - Add mobile device configurations
6. **Test metrics dashboard** - Track test results over time

## Resources

- [Playwright Documentation](https://playwright.dev)
- [API Reference](https://playwright.dev/docs/api/class-playwright)
- [Debugging Guide](https://playwright.dev/docs/debug)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Trace Viewer](https://trace.playwright.dev)

## Support

For issues or questions:
1. Check test logs in HTML report
2. Run in UI mode for visual debugging
3. Check Playwright documentation
4. Enable debug mode: `DEBUG=pw:api npm run test:e2e`
