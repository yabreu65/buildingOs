import { apiClient } from '@/shared/lib/http/client';
import {
  cancelLiquidation,
  createLiquidationDraft,
  publishLiquidation,
  reviewLiquidation,
} from './expense-ledger.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);

describe('expense ledger liquidation API', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    mockedApiClient.mockResolvedValue({});
  });

  it('creates liquidation drafts through the hardened finance API', async () => {
    const payload = {
      buildingId: 'building-1',
      period: '2026-07',
      baseCurrency: 'ARS',
    };

    await createLiquidationDraft('tenant-1', payload);

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/finance/liquidations/draft',
      method: 'POST',
      body: payload,
    });
  });

  it('routes liquidation draft actions through the hardened finance API', async () => {
    await reviewLiquidation('tenant-1', 'liq-1');
    await publishLiquidation('tenant-1', 'liq-1', { dueDate: '2026-08-10' });
    await cancelLiquidation('tenant-1', 'liq-1');

    expect(mockedApiClient).toHaveBeenNthCalledWith(1, {
      path: '/tenants/tenant-1/finance/liquidations/liq-1/review',
      method: 'POST',
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(2, {
      path: '/tenants/tenant-1/finance/liquidations/liq-1/publish',
      method: 'POST',
      body: { dueDate: '2026-08-10' },
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(3, {
      path: '/tenants/tenant-1/finance/liquidations/liq-1/cancel',
      method: 'POST',
    });
  });

  it('surfaces API failures instead of swallowing them', async () => {
    mockedApiClient.mockRejectedValueOnce(new Error('network down'));

    await expect(
      createLiquidationDraft('tenant-1', {
        buildingId: 'building-1',
        period: '2026-07',
        baseCurrency: 'ARS',
      }),
    ).rejects.toThrow('network down');
  });
});
