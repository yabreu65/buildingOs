/**
 * @jest-environment jsdom
 */

import { apiClient } from '@/shared/lib/http/client';
import { getResidentProfile, updateResidentProfile } from './resident-profile.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);

describe('resident-profile.api', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it('calls GET /me/profile with X-Tenant-Id', async () => {
    mockedApiClient.mockResolvedValue({
      id: 'member-1',
      tenantId: 'tenant-1',
      name: 'Resident One',
      email: 'resident@test.com',
      phone: null,
      role: 'RESIDENT',
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    } as never);

    await getResidentProfile('tenant-1');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/me/profile',
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-1' },
    });
  });

  it('calls PATCH /me/profile with only the provided body and X-Tenant-Id', async () => {
    mockedApiClient.mockResolvedValue({
      id: 'member-1',
      tenantId: 'tenant-1',
      name: 'Resident Prime',
      email: 'resident@test.com',
      phone: '+584141111111',
      role: 'RESIDENT',
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    } as never);

    const input = { name: 'Resident Prime', phone: '+584141111111' };

    await updateResidentProfile('tenant-1', input);

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/me/profile',
      method: 'PATCH',
      body: input,
      headers: { 'X-Tenant-Id': 'tenant-1' },
    });
  });
});
