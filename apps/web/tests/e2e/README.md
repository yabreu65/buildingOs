# BuildingOS E2E Tests with Playwright

Comprehensive end-to-end test suite covering 15 critical user flows across BuildingOS.

## Test Coverage

### Authentication (6 tests)
- ✅ Successful login with valid credentials
- ✅ Error handling for invalid credentials
- ✅ Error handling for non-existent email
- ✅ Redirect to login for unauthenticated access
- ✅ Successful logout
- ✅ Session persistence after page refresh

### Building Management (4 tests)
- ✅ Create new building
- ✅ Validation errors for empty fields
- ✅ View building details
- ✅ Building list displays correctly

### Unit Management (5 tests)
- ✅ Create unit in building
- ✅ Validation errors for empty unit label
- ✅ Prevent duplicate unit labels
- ✅ Assign resident to unit
- ✅ Update unit occupancy status

### Finance Operations (5 tests)
- ✅ Create charge for unit
- ✅ Display pending charges list
- ✅ Validate negative charge amounts
- ✅ Resident view and payment capability
- ✅ Financial summary dashboard

### Tickets & Communications (5 tests)
- ✅ Create ticket with title and description
- ✅ Display ticket list with status
- ✅ Add comments to ticket
- ✅ Send communication/message
- ✅ Upload document

### Resident Access (5 tests)
- ✅ Login as resident and view dashboard
- ✅ Display assigned unit information
- ✅ Prevent access to admin functions
- ✅ Read-only access to own data
- ✅ Access financial information (if applicable)

### Super Admin (4 tests)
- ✅ Access super-admin dashboard
- ✅ View list of tenants
- ✅ Change tenant plan (FREE → STARTER → PRO)
- ✅ Enforce plan limits on tenants

### Team Management (5 tests)
- ✅ Navigate to members settings
- ✅ Invite new team member
- ✅ List active members with roles
- ✅ Update member role
- ✅ Remove team member

### Onboarding (7 tests)
- ✅ Display onboarding checklist
- ✅ Show onboarding progress
- ✅ Mark steps as complete
- ✅ Hide onboarding when 100% complete
- ✅ Dismiss onboarding card
- ✅ Display current plan information
- ✅ Show plan usage metrics

### Multi-Tenant Isolation (6 tests)
- ✅ Prevent Tenant A from seeing Tenant B buildings
- ✅ Isolate units per tenant
- ✅ Prevent access to other tenant data via direct URL
- ✅ Isolate finance data per tenant
- ✅ Isolate tickets per tenant
- ✅ Prevent residents from seeing other tenants' data

**Total: 57+ test cases**

## Installation

```bash
# Install dependencies (already done via npm ci)
npm install -w apps/web --save-dev @playwright/test

# Install Playwright browsers
npx playwright install
```

## Running Tests

### Run all tests
```bash
npm run test:e2e -w apps/web
```

### Run tests in UI mode (interactive)
```bash
npm run test:e2e:ui -w apps/web
```

### Run tests in debug mode
```bash
npm run test:e2e:debug -w apps/web
```

### Run specific test file
```bash
npx playwright test apps/web/tests/e2e/auth/login.spec.ts
```

### Run tests with specific browser
```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

### Run tests in headed mode (see browser)
```bash
npx playwright test --headed
```

### Generate and view HTML report
```bash
npm run test:e2e:report -w apps/web
```

## Test Structure

```
apps/web/tests/e2e/
├── helpers/
│   ├── auth.ts              # Authentication helpers
│   └── navigation.ts        # Navigation and interaction helpers
├── auth/
│   └── login.spec.ts        # Login and auth flows
├── buildings/
│   ├── create-building.spec.ts
│   └── manage-units.spec.ts
├── resident/
│   └── view-assignment.spec.ts
├── finance/
│   └── charges-and-payments.spec.ts
├── operations/
│   └── tickets-and-communications.spec.ts
├── advanced/
│   ├── team-and-invitations.spec.ts
│   ├── onboarding-and-plans.spec.ts
│   └── multi-tenant-isolation.spec.ts
├── super-admin/
│   └── tenant-management.spec.ts
└── README.md
```

## Test Users

Pre-configured test users for different roles:

```typescript
TEST_USERS = {
  superAdmin: {
    email: 'super@admin.test',
    password: 'SuperAdmin@123',
  },
  tenantAdminA: {
    email: 'admin@tenanta.test',
    password: 'TenantAdmin@123',
  },
  tenantAdminB: {
    email: 'admin@tenantb.test',
    password: 'TenantAdmin@123',
  },
  operator: {
    email: 'operator@tenanta.test',
    password: 'Operator@123',
  },
  resident: {
    email: 'resident@tenanta.test',
    password: 'Resident@123',
  },
  residentB: {
    email: 'resident@tenantb.test',
    password: 'Resident@123',
  },
}
```

## Helper Functions

### auth.ts
- `login(page, user)` - Login to BuildingOS
- `signup(page, user)` - Sign up new user
- `logout(page)` - Logout from BuildingOS
- `getCurrentUser(page)` - Get current user info
- `isLoggedIn(page)` - Check if user is logged in

### navigation.ts
- `navigateTo(page, route)` - Navigate to a route
- `clickNavLink(page, linkText)` - Click sidebar navigation link
- `clickButton(page, buttonText)` - Click button by text
- `fillField(page, fieldName, value)` - Fill form field
- `hasError(page, errorText)` - Check for error message
- `hasSuccess(page, successText)` - Check for success message
- `getText(page, selector)` - Get element text content
- `isOnRoute(page, route)` - Check current route
- `waitForElement(page, selector)` - Wait for element visibility

## Configuration

### playwright.config.ts

Key settings:
- **baseURL**: `http://localhost:3000` (set via `BASE_URL` env var)
- **timeout**: 30 seconds per test
- **retries**: 0 locally, 2 in CI
- **workers**: Parallel execution by default
- **reporters**: HTML report + console output
- **screenshot**: On failure only
- **video**: On failure only
- **trace**: On first retry

## CI/CD Integration

GitHub Actions workflow (`.github/workflows/e2e-tests.yml`):
- Runs on push to main/develop
- Runs on pull requests
- Scheduled daily run at 2 AM UTC
- PostgreSQL service container
- Uploads artifacts (reports, videos)
- Comments on PRs with results

## Debugging

### View test artifacts
After a test run, artifacts are available:
- `playwright-report/` - HTML report with all test details
- `test-results/` - Videos and traces from failed tests

### Debug a specific test
```bash
npx playwright test --debug apps/web/tests/e2e/auth/login.spec.ts
```

This opens the Playwright Inspector where you can:
- Step through test execution
- Inspect selectors
- View DOM state
- Check network requests

### View detailed test output
```bash
npm run test:e2e -w apps/web -- --verbose
```

### Generate trace for debugging
Tests are configured to generate traces on first retry (can be modified in config)

## Best Practices

1. **Use data-testid attributes** - More reliable than text selectors
   ```html
   <button data-testid="create-building">Create</button>
   ```

2. **Wait for navigation** - Always wait for page loads
   ```typescript
   await page.waitForURL('**/dashboard');
   ```

3. **Handle async operations** - Use proper waits
   ```typescript
   await page.waitForLoadState('networkidle');
   ```

4. **Isolate test data** - Use unique identifiers
   ```typescript
   const buildingName = `Test Building ${Date.now()}`;
   ```

5. **Clean up after tests** - Use afterEach hooks
   ```typescript
   test.afterEach(async ({ page }) => {
     await page.close();
   });
   ```

## Troubleshooting

### Tests timeout
- Increase timeout in `playwright.config.ts`
- Check if application is running
- Check network connectivity
- Review selectors for stale DOM references

### Cannot find element
- Use `test:e2e:ui` mode to see what's on screen
- Check selector syntax
- Verify element is actually visible
- Use `--verbose` flag for detailed logs

### Tests fail in CI but pass locally
- Check database state in CI
- Verify environment variables
- Check for flaky selectors
- Run with `--headed` to see browser behavior

### Element not clickable
- Check if element is covered by modal/overlay
- Use `page.click({ force: true })` as last resort
- Wait for element visibility first

## Performance

Current test suite performance:
- **Total runtime**: ~3-5 minutes locally (all browsers)
- **Parallel execution**: 4-6 workers by default
- **CI runtime**: ~10-15 minutes (with service setup + build)

To speed up:
- Run specific test files only
- Disable extra browsers in local runs
- Use CI for full suite, local for development

## Contributing

When adding new E2E tests:

1. **Follow naming convention**: `[feature].spec.ts`
2. **Use describe blocks**: Group related tests
3. **Use helpers**: Leverage auth.ts and navigation.ts
4. **Add comments**: Document complex test flows
5. **Test happy path + errors**: Both success and failure cases
6. **Consider multi-tenant**: Test isolation if applicable
7. **Keep tests independent**: No dependencies between tests

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright API Reference](https://playwright.dev/docs/api/class-playwright)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Guide](https://playwright.dev/docs/debug)

## Next Steps

- [ ] Add more edge case tests
- [ ] Implement visual regression testing
- [ ] Add performance testing
- [ ] Extend CI/CD with performance metrics
- [ ] Add accessibility testing
- [ ] Document test metrics and trends
