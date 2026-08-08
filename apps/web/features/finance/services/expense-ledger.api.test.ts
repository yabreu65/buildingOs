import { apiClient } from '@/shared/lib/http/client';
import {
  cancelLiquidation,
  createLiquidationDraft,
  publishLiquidation,
  reviewLiquidation,
  listTenantRecurringExpenses,
  createTenantRecurringExpense,
  updateTenantRecurringExpense,
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

describe('tenant recurring expenses API', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    mockedApiClient.mockResolvedValue({});
  });

  it('lists tenant recurring expenses through the tenant route with includeInactive=true', async () => {
    await listTenantRecurringExpenses('tenant-1', true);

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/recurring-expenses?includeInactive=true',
      method: 'GET',
    });
  });

  it('lists tenant recurring expenses without includeInactive when not requested', async () => {
    await listTenantRecurringExpenses('tenant-1');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/recurring-expenses',
      method: 'GET',
    });
  });

  it('creates tenant recurring expenses through the tenant route with the full payload', async () => {
    const payload = {
      scopeType: 'TENANT_SHARED' as const,
      allocationMode: 'MANUAL' as const,
      categoryId: 'category-1',
      amount: 10000,
      currency: 'ARS',
      concept: 'Limpieza',
      frequency: 'MONTHLY' as const,
      allocations: [
        { buildingId: 'building-1', percentage: 60 },
        { buildingId: 'building-2', percentage: 40 },
      ],
    };

    await createTenantRecurringExpense('tenant-1', payload);

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/recurring-expenses',
      method: 'POST',
      body: payload,
    });
  });

  it('updates tenant recurring expenses through the tenant route with id', async () => {
    await updateTenantRecurringExpense('tenant-1', 're-1', { isActive: false });

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/recurring-expenses/re-1',
      method: 'PATCH',
      body: { isActive: false },
    });
  });

  it('does not use the buildings route for tenant-scoped operations', async () => {
    await listTenantRecurringExpenses('tenant-1', true);
    await createTenantRecurringExpense('tenant-1', {
      scopeType: 'TENANT_SHARED',
      allocationMode: 'EQUAL_SHARE',
      categoryId: 'category-1',
      amount: 10000,
      currency: 'ARS',
      concept: 'Limpieza',
      frequency: 'MONTHLY',
    });

    const calls = mockedApiClient.mock.calls.map((call) => call[0]);
    expect(calls.every((call) => !String(call.path).startsWith('/buildings/'))).toBe(true);
  });
});
