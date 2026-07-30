import { apiClient } from '@/shared/lib/http/client';
import {
  getResidentCommunications,
  markResidentAsRead,
} from './communications.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);

describe('communications.api resident helpers', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it('sends the active tenant and resident portal context when loading resident communications', async () => {
    mockedApiClient.mockResolvedValue({ items: [], nextCursor: undefined });

    await getResidentCommunications('tenant-1', 'building-1', 'unit-1', 20);

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/resident/communications?buildingId=building-1&unitId=unit-1&limit=20',
      method: 'GET',
      headers: {
        'X-Tenant-Id': 'tenant-1',
        'X-Portal-Context': 'resident',
      },
    });
  });

  it('sends the active tenant and resident portal context when marking resident communications as read', async () => {
    mockedApiClient.mockResolvedValue({ readAt: null });

    await markResidentAsRead('tenant-1', 'comm-1');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/resident/communications/comm-1/read',
      method: 'POST',
      headers: {
        'X-Tenant-Id': 'tenant-1',
        'X-Portal-Context': 'resident',
      },
    });
  });
});
