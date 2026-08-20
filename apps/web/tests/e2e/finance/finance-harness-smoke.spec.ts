import { test, expect } from '@playwright/test';
import {
  loginAsFinanceAdmin,
  resolveFinanceAdminContext,
  assertNormalV3FixtureReadable,
  navigateToFinanceTab,
  expectFinancePageHeading,
  clickFinanceTab,
  expectActiveTab,
  setViewport,
  expectNoHorizontalOverflow,
  attachBrowserObservability,
  financeTabRoute,
  login,
  TEST_USERS,
} from '../helpers';

/**
 * Finance E2E harness smoke test.
 *
 * This test verifies that the Phase 2B1 harness infrastructure works:
 * 1. Login + context resolution
 * 2. Finance page navigation
 * 3. Tab switching
 * 4. Observability collection
 * 5. Responsive viewport changes
 *
 * It does NOT test business logic — that's Phase 2B2+.
 */
test.describe('Finance E2E harness smoke', () => {
  test('resolves admin context and navigates to finance overview', async ({ page }) => {
    const tenantId = await loginAsFinanceAdmin(page);
    const ctx = await resolveFinanceAdminContext(page, tenantId);

    expect(ctx.tenantId).toBe(tenantId);
    expect(ctx.buildingId).toBeTruthy();
    expect(ctx.unitId).toBeTruthy();
    await assertNormalV3FixtureReadable(page, ctx);

    await navigateToFinanceTab(page, tenantId, 'overview');
    await expectFinancePageHeading(page);
  });

  test('switches between finance tabs', async ({ page }) => {
    const tenantId = await loginAsFinanceAdmin(page);
    await navigateToFinanceTab(page, tenantId, 'overview');

    // Click each major tab and verify it loads
    const tabsToTest = ['expenses', 'charges', 'payments', 'funds'] as const;

    for (const tab of tabsToTest) {
      await clickFinanceTab(page, tab);
      await expectActiveTab(page, tab);
    }
  });

  test('collects browser observability without errors', async ({ page }) => {
    const tenantId = await loginAsFinanceAdmin(page);
    const obs = attachBrowserObservability(page);

    try {
      await navigateToFinanceTab(page, tenantId, 'overview');

      // Navigate through tabs to trigger potential errors
      await clickFinanceTab(page, 'charges');
      await clickFinanceTab(page, 'payments');
    } finally {
      obs.detach();
    }

    // No unhandled JS errors should occur during navigation
    expect(obs.pageErrors).toHaveLength(0);
    expect(obs.consoleErrors).toHaveLength(0);
    // No HTTP 5xx errors should occur
    expect(obs.http5xx).toHaveLength(0);
  });

  test('finance page renders on mobile viewport', async ({ page }) => {
    const tenantId = await loginAsFinanceAdmin(page);
    await setViewport(page, 'mobile');
    await navigateToFinanceTab(page, tenantId, 'overview');
    await expectFinancePageHeading(page);
    await expectNoHorizontalOverflow(page);
  });

  test('finance page renders on desktop viewport', async ({ page }) => {
    const tenantId = await loginAsFinanceAdmin(page);
    await setViewport(page, 'desktop');
    await navigateToFinanceTab(page, tenantId, 'overview');
    await expectFinancePageHeading(page);
    await expectNoHorizontalOverflow(page);
  });

  test('finance tab route builder produces correct URLs', async () => {
    const tenantId = 'test-tenant-id';

    expect(financeTabRoute(tenantId, 'overview')).toBe(`/${tenantId}/finanzas`);
    expect(financeTabRoute(tenantId, 'payments')).toBe(`/${tenantId}/finanzas?tab=payments`);
    expect(financeTabRoute(tenantId, 'charges')).toBe(`/${tenantId}/finanzas?tab=charges`);
    expect(financeTabRoute(tenantId, 'funds')).toBe(`/${tenantId}/finanzas?tab=funds`);
    expect(financeTabRoute(tenantId, 'settings')).toBe(`/${tenantId}/finanzas?tab=settings`);
  });

  test('resident can login and access finance context', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.resident);
    expect(tenantId).toBeTruthy();

    // Resident should be redirected to resident dashboard
    await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/dashboard$`));
  });
});
