import { apiClient } from '@/shared/lib/http/client';
import { getResidentCommunications } from './resident-context.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);

describe('resident-context.api', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it('sends the active tenant and resident portal context for inbox requests', async () => {
    mockedApiClient.mockResolvedValue([]);

    await getResidentCommunications('tenant-1', 5);

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/me/communications?limit=5',
      method: 'GET',
      headers: {
        'X-Tenant-Id': 'tenant-1',
        'X-Portal-Context': 'resident',
      },
    });
  });
});
