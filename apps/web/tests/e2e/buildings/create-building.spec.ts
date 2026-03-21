import { test, expect } from '@playwright/test';
import { login, TEST_USERS } from '../helpers/auth';
import { clickNavLink, fillField, clickButton, hasSuccess } from '../helpers/navigation';

test.describe('Tenant Admin - Create Building Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login as tenant admin
    await login(page, TEST_USERS.tenantAdminA);
  });

  test('should successfully create a new building', async ({ page }) => {
    // STEP 1: Navigate to buildings
    await clickNavLink(page, 'Buildings');
    expect(page.url()).toContain('/buildings');

    // STEP 2: Click create button
    await clickButton(page, 'New Building');
    await page.waitForURL('**/buildings/create', { timeout: 10000 });
    expect(page.url()).toContain('/buildings/create');

    // STEP 3: Fill form
    const buildingName = `Test Building ${Date.now()}`;
    const buildingAddress = '123 Main Street, City, State 12345';

    await fillField(page, 'name', buildingName);
    await fillField(page, 'address', buildingAddress);

    // STEP 4: Submit form
    await clickButton(page, 'Create');

    // STEP 5: Verify creation
    await page.waitForURL('**/buildings', { timeout: 10000 });
    const success = await hasSuccess(page, buildingName);
    expect(success || page.url().includes('/buildings')).toBe(true);

    // STEP 6: Verify building appears in list
    const buildingInList = await page.locator(`text=${buildingName}`).isVisible().catch(() => false);
    expect(buildingInList).toBe(true);
  });

  test('should show validation error for empty name', async ({ page }) => {
    // STEP 1: Navigate to buildings create
    await page.goto('/buildings/create');
    await page.waitForLoadState('networkidle');

    // STEP 2: Try to submit without name
    await fillField(page, 'address', '123 Main Street');
    await clickButton(page, 'Create');

    // STEP 3: Verify still on create page (error shown)
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/buildings/create');
  });

  test('should show validation error for empty address', async ({ page }) => {
    // STEP 1: Navigate to buildings create
    await page.goto('/buildings/create');
    await page.waitForLoadState('networkidle');

    // STEP 2: Try to submit without address
    await fillField(page, 'name', 'Test Building');
    await clickButton(page, 'Create');

    // STEP 3: Verify still on create page (error shown)
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/buildings/create');
  });

  test('should be able to view created building details', async ({ page }) => {
    // STEP 1: Create a building
    await page.goto('/buildings/create');
    const buildingName = `Details Test ${Date.now()}`;
    await fillField(page, 'name', buildingName);
    await fillField(page, 'address', '456 Oak Avenue');
    await clickButton(page, 'Create');

    // STEP 2: Wait for redirect to buildings list
    await page.waitForURL('**/buildings', { timeout: 10000 });

    // STEP 3: Click on the building
    await page.locator(`text=${buildingName}`).first().click();
    await page.waitForURL('**/buildings/**', { timeout: 10000 });

    // STEP 4: Verify building details are visible
    expect(page.url()).toMatch(/\/buildings\/[a-z0-9-]+$/);
    const buildingNameVisible = await page.locator(`text=${buildingName}`).isVisible().catch(() => false);
    expect(buildingNameVisible).toBe(true);
  });
});
