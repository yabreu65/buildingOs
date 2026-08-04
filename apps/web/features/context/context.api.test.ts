import { apiClient } from '@/shared/lib/http/client';
import { getContext, getContextOptions, setContext } from './context.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);

describe('context.api', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it('sends the resident portal context when loading resident context data', async () => {
    mockedApiClient.mockResolvedValue({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });

    await getContext('tenant-1', 'resident');
    await getContextOptions('tenant-1', 'resident');

    expect(mockedApiClient).toHaveBeenNthCalledWith(1, {
      path: '/me/context',
      method: 'GET',
      headers: {
        'X-Tenant-Id': 'tenant-1',
        'X-Portal-Context': 'resident',
      },
    });

    expect(mockedApiClient).toHaveBeenNthCalledWith(2, {
      path: '/me/context/options',
      method: 'GET',
      headers: {
        'X-Tenant-Id': 'tenant-1',
        'X-Portal-Context': 'resident',
      },
    });
  });

  it('sends the admin portal context when setting admin context data', async () => {
    mockedApiClient.mockResolvedValue({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });

    await setContext('tenant-1', 'building-1', 'unit-1', 'admin');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/me/context',
      method: 'POST',
      headers: {
        'X-Tenant-Id': 'tenant-1',
        'X-Portal-Context': 'admin',
      },
      body: {
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      },
    });
  });
});
