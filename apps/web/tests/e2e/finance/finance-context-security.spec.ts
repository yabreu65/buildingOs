import { expect, test } from '@playwright/test';
import {
  EXPECTED_FAILURE_STATUSES,
  TEST_USERS,
  expectHTTPFailure,
  login,
} from '../helpers';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';

test('strictly denies Tenant B access to Tenant A buildings', async ({ browser, page }) => {
  const tenantAContext = await browser.newContext();
  const tenantAPage = await tenantAContext.newPage();
  const tenantAId = await login(tenantAPage, TEST_USERS.tenantAdminA);
  await tenantAContext.close();

  const tenantBId = await login(page, TEST_USERS.tenantAdminB);
  expect(tenantBId).not.toBe(tenantAId);

  await expectHTTPFailure(page.request, {
    method: 'GET',
    url: `${API_ORIGIN}/tenants/${tenantAId}/buildings`,
    headers: {
      'X-Tenant-Id': tenantAId,
      'x-portal-context': 'admin',
    },
    expectedStatus: EXPECTED_FAILURE_STATUSES.FORBIDDEN,
  });
});
