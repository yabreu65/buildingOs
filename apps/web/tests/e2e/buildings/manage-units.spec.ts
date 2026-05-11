import { test, expect } from '@playwright/test';
import { login, TEST_USERS } from '../helpers/auth';

test.describe.serial('Tenant Admin - Manage Units Flow', () => {
  let tenantId: string;

  test.beforeEach(async ({ page }) => {
    tenantId = await login(page, TEST_USERS.tenantAdminA);
  });

  test('should create a new unit in an existing building', async ({ page }) => {
    // STEP 1: Navigate to buildings list
    await page.goto(`/${tenantId}/buildings`);
    await page.waitForLoadState('networkidle');

    // STEP 2: Click on the seeded building "Torre A Test"
    await page.locator('text=Torre A Test').first().click();
    await page.waitForURL(`**/${tenantId}/buildings/**`, { timeout: 10000 });

    // Extract buildingId from URL
    const buildingUrl = new URL(page.url());
    const buildingId = buildingUrl.pathname.split('/')[3];
    if (!buildingId) {
      throw new Error('Failed to extract buildingId from URL');
    }

    // STEP 3: Navigate directly to building units page
    await page.goto(`/${tenantId}/buildings/${buildingId}/units`);
    await page.waitForLoadState('networkidle');

    // STEP 4: Click create unit button
    await page.locator('[data-testid="unit-create-btn"]').click();
    await page.waitForSelector('[data-testid="unit-create-form"]', { state: 'visible' });

    // STEP 5: Fill unit form
    const unitCode = `E2E-${Date.now()}`;
    await page.fill('[data-testid="unit-code-input"]', unitCode);
    await page.fill('[data-testid="unit-label-input"]', `Unidad Test ${unitCode}`);

    // STEP 6: Submit
    await page.locator('[data-testid="unit-submit-btn"]').click();

    // STEP 7: Verify unit appears in list (search by label text)
    await page.waitForSelector(`[data-testid="units-table-body"]`, { state: 'visible' });
    const unitLabel = `Unidad Test ${unitCode}`;
    const unitRow = page.locator(`tbody tr:has-text("${unitLabel}")`);
    await unitRow.waitFor({ state: 'visible', timeout: 10000 });
    expect(await unitRow.isVisible()).toBe(true);
  });

  test('should show validation error for empty unit code', async ({ page }) => {
    // STEP 1: Navigate to buildings and select Torre A Test
    await page.goto(`/${tenantId}/buildings`);
    await page.waitForLoadState('networkidle');
    await page.locator('text=Torre A Test').first().click();
    await page.waitForURL(`**/${tenantId}/buildings/**`, { timeout: 10000 });

    // Extract buildingId and navigate directly to units
    const buildingUrl = new URL(page.url());
    const buildingId = buildingUrl.pathname.split('/')[3];
    if (!buildingId) {
      throw new Error('Failed to extract buildingId from URL');
    }
    await page.goto(`/${tenantId}/buildings/${buildingId}/units`);
    await page.waitForLoadState('networkidle');

    // STEP 3: Open create form
    await page.locator('[data-testid="unit-create-btn"]').click();
    await page.waitForSelector('[data-testid="unit-create-form"]', { state: 'visible' });

    // STEP 4: Try to submit without filling code (required field)
    await page.locator('[data-testid="unit-submit-btn"]').click();

    // STEP 5: Verify still shows form (HTML5 required prevents submit)
    await page.waitForTimeout(1000);
    const formVisible = await page.locator('[data-testid="unit-create-form"]').isVisible().catch(() => false);
    expect(formVisible).toBe(true);
  });
});
