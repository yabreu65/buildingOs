import { test, expect } from '@playwright/test';
import { login, TEST_USERS } from '../helpers/auth';
import { clickButton, fillField } from '../helpers/navigation';

test.describe.serial('Tenant Admin - Create Building Flow', () => {
  let tenantId: string;

  test.beforeEach(async ({ page }) => {
    // Login as tenant admin and capture tenantId
    tenantId = await login(page, TEST_USERS.tenantAdminA);
  });

  test('should successfully create a new building', async ({ page }) => {
    // STEP 1: Navigate to buildings
    await page.goto(`/${tenantId}/buildings`);
    await page.waitForLoadState('networkidle');

    // STEP 2: Click create button
    await page.locator('[data-testid="building-create-btn"]').click();
    await page.waitForLoadState('networkidle');

    // STEP 3: Fill form
    const buildingName = `Test Building ${Date.now()}`;
    const buildingAddress = '123 Calle Principal, Ciudad, Estado 12345';

    await fillField(page, 'building-name', buildingName);
    await fillField(page, 'building-address', buildingAddress);

    // STEP 4: Submit form and wait for navigation back to list
    await page.locator('[data-testid="building-submit-btn"]').click();
    await page.waitForURL(`**/${tenantId}/buildings`, { timeout: 10000 });

    // STEP 5: Verify creation - building appears in list
    const buildingLocator = page.locator(`text=${buildingName}`);
    await buildingLocator.waitFor({ state: 'visible', timeout: 10000 });
    expect(await buildingLocator.isVisible()).toBe(true);
  });

  test('should show validation error for empty name', async ({ page }) => {
    // STEP 1: Navigate to buildings page
    await page.goto(`/${tenantId}/buildings`);
    await page.waitForLoadState('networkidle');

    // STEP 2: Click create button
    await page.locator('[data-testid="building-create-btn"]').click();

    // STEP 3: Try to submit without name (the required attribute should block it)
    await fillField(page, 'building-address', '123 Calle Principal');
    await page.locator('[data-testid="building-submit-btn"]').click();

    // STEP 4: Verify still shows form (required field prevents submit)
    await page.waitForTimeout(1000);
    const formVisible = await page.locator('[data-testid="building-form"]').isVisible().catch(() => false);
    expect(formVisible).toBe(true);
  });
});
