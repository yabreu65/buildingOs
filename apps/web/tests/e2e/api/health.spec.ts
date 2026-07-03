import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

test.describe('API Health Smoke Tests', () => {
  test('API should respond to health check', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/health`);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('timestamp');
  });

  test('API auth endpoint should exist', async ({ request }) => {
    // We don't login, just verify the endpoint exists (returns 400 for missing body, not 404)
    const response = await request.post(`${API_BASE_URL}/auth/login`, {
      data: {},
    });
    // Should be 400 (bad request) not 404 (not found)
    expect(response.status()).toBe(400);
  });

  test('API should reject unauthenticated requests to protected endpoints', async ({ request }) => {
    // The buildings endpoint is under /tenants/:tenantId/buildings and requires auth
    const response = await request.get(`${API_BASE_URL}/tenants/fake-tenant-id/buildings`);
    expect(response.status()).toBe(401);
  });
});
