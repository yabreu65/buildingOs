import { apiClient } from '@/shared/lib/http/client';
import {
  getResidentCommunications,
  getResidentContext,
  getResidentTickets,
  getResidentLedger,
} from './resident-context.api';

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

  it('sends the active tenant and resident portal context for resident context requests', async () => {
    mockedApiClient.mockResolvedValue({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });

    await getResidentContext('tenant-1');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/me/context',
      method: 'GET',
      headers: {
        'X-Tenant-Id': 'tenant-1',
        'X-Portal-Context': 'resident',
      },
    });
  });

  it('sends the active tenant and resident portal context for resident ticket requests', async () => {
    mockedApiClient.mockResolvedValue({
      tickets: [],
    });

    await getResidentTickets('tenant-1', 'building-1', 'unit-1', 50);

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/buildings/building-1/tickets?unitId=unit-1&limit=50',
      method: 'GET',
      headers: {
        'X-Tenant-Id': 'tenant-1',
        'X-Portal-Context': 'resident',
      },
    });
  });

  it('sends the active tenant and resident portal context for resident ledger requests', async () => {
    mockedApiClient.mockResolvedValue({
      charges: [],
      payments: [],
      totals: {
        balance: 0,
        currency: 'ARS',
        charges: 0,
        payments: 0,
        credits: 0,
      },
    });

    await getResidentLedger('tenant-1', 'unit-1');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/units/unit-1/ledger',
      method: 'GET',
      headers: {
        'X-Tenant-Id': 'tenant-1',
        'X-Portal-Context': 'resident',
      },
    });
  });
});
