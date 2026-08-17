import { apiClient } from '@/shared/lib/http/client';
import { createFundTransaction, listFunds, reverseFundTransaction } from './funds.api';
import { getIncomeApplicationPlan } from './income-applications.api';
import { previewLegacyIncomeBackfill } from './legacy-backfill.api';

jest.mock('@/shared/lib/http/client', () => ({ apiClient: jest.fn() }));

const mockedApiClient = jest.mocked(apiClient);

describe('FIN-07A finance contract APIs', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it('uses backend fund filters and preserves balances by currency', async () => {
    mockedApiClient.mockResolvedValueOnce([
      {
        id: 'fund-1', tenantId: 'tenant-1', buildingId: null, scopeType: 'TENANT',
        type: 'RESERVE', name: 'Reserve', description: null, status: 'ACTIVE',
        balancesByCurrency: [{ currency: 'COP', amountMinor: 1000 }, { currency: 'ARS', amountMinor: 2000 }],
      },
    ]);

    const funds = await listFunds('tenant-1', { buildingId: 'building-1', status: 'ACTIVE' });

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/finance/funds?buildingId=building-1&status=ACTIVE', method: 'GET',
    });
    expect(funds[0]?.balancesByCurrency).toEqual([
      { currency: 'COP', amountMinor: 1000 }, { currency: 'ARS', amountMinor: 2000 },
    ]);
  });

  it('sends the optional reversal reason and rejects malformed fund transactions', async () => {
    mockedApiClient.mockResolvedValueOnce({
      id: 'transaction-2', tenantId: 'tenant-1', fundId: 'fund-1', direction: 'DEBIT',
      amountMinor: 100, currencyCode: 'USD',
    });

    await reverseFundTransaction('tenant-1', 'fund-1', 'transaction-1', { reason: 'Duplicate entry' });
    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/finance/funds/fund-1/transactions/transaction-1/reverse',
      method: 'POST', body: { reason: 'Duplicate entry' },
    });

    mockedApiClient.mockResolvedValueOnce({
      id: 'transaction-3', tenantId: 'tenant-1', fundId: 'fund-1', direction: 'CREDIT',
      amountMinor: 1.5, currencyCode: 'USD',
    });
    await expect(createFundTransaction('tenant-1', 'fund-1', {
      direction: 'CREDIT', amountMinor: 100, currencyCode: 'USD', occurredAt: '2026-08-16',
    })).rejects.toThrow('Invalid fund transaction response');
  });

  it('exposes application provenance and rejects conflicting provenance', async () => {
    const application = {
      id: 'application-1', tenantId: 'tenant-1', incomeId: 'income-1',
      destinationType: 'OFFSET_EXPENSES', fundId: null, amountMinor: 1200,
      currencyCode: 'VES', fundTransactionId: null, policyVersionId: null,
      legacyDestination: 'APPLY_TO_EXPENSES',
    };
    mockedApiClient.mockResolvedValueOnce({
      incomeId: 'income-1', currencyCode: 'VES', totalAmountMinor: 1200, applications: [application],
    });

    await expect(getIncomeApplicationPlan('tenant-1', 'income-1')).resolves.toMatchObject({
      applications: [expect.objectContaining({ legacyDestination: 'APPLY_TO_EXPENSES' })],
    });

    mockedApiClient.mockResolvedValueOnce({
      incomeId: 'income-1', currencyCode: 'VES', totalAmountMinor: 1200,
      applications: [{ ...application, policyVersionId: 'policy-1' }],
    });
    await expect(getIncomeApplicationPlan('tenant-1', 'income-1')).rejects.toThrow(
      'Invalid income application plan response',
    );
  });

  it('rejects malformed legacy preview monetary amounts', async () => {
    mockedApiClient.mockResolvedValueOnce([{
      incomeId: 'income-1', period: '2026-08', categoryId: 'category-1', scopeType: 'BUILDING',
      buildingId: 'building-1', status: 'RECORDED', destination: 'APPLY_TO_EXPENSES',
      amountMinor: 12.5, currencyCode: 'COP', applicationsCount: 0, classification: 'AUTO_MAPPABLE_OFFSET',
    }]);

    await expect(previewLegacyIncomeBackfill('tenant-1')).rejects.toThrow(
      'Invalid legacy backfill preview response',
    );
  });
});
