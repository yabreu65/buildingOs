import { test as baseTest, Page } from '@playwright/test';
import { TEST_USERS, TestUser } from './helpers/auth';

/**
 * Custom Playwright fixtures for BuildingOS tests
 * Extends base test with custom utilities
 */

interface BuildingOSFixtures {
  testUsers: typeof TEST_USERS;
  adminPage: Page; // Page logged in as admin
  residentPage: Page; // Page logged in as resident
}

export const test = baseTest.extend<BuildingOSFixtures>({
  testUsers: TEST_USERS,

  adminPage: async ({ page }, use) => {
    // This fixture would login as admin automatically
    // Currently not used, but provided for future extension
    await use(page);
  },

  residentPage: async ({ page }, use) => {
    // This fixture would login as resident automatically
    // Currently not used, but provided for future extension
    await use(page);
  },
});

export { expect } from '@playwright/test';
