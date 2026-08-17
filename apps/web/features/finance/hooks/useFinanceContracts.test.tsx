import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFundTransaction } from '../services/funds.api';
import { applyLegacyIncomeBackfill } from '../services/legacy-backfill.api';
import { applyIncomePolicy, createIncomeApplicationPlan } from '../services/income-applications.api';
import { useCreateFundTransaction } from './useFunds';
import { useApplyLegacyIncomeBackfill } from './useLegacyIncomeBackfill';
import { useApplyIncomePolicy, useCreateIncomeApplicationPlan } from './useIncomeApplications';
import { financeKeys } from './finance-query-keys';

jest.mock('../services/funds.api', () => ({ createFundTransaction: jest.fn() }));
jest.mock('../services/legacy-backfill.api', () => ({ applyLegacyIncomeBackfill: jest.fn() }));
jest.mock('../services/income-applications.api', () => ({
  applyIncomePolicy: jest.fn(),
  createIncomeApplicationPlan: jest.fn(),
  getIncomeApplicationPlan: jest.fn(),
}));

const mockedCreateFundTransaction = jest.mocked(createFundTransaction);
const mockedApplyLegacyIncomeBackfill = jest.mocked(applyLegacyIncomeBackfill);
const mockedApplyIncomePolicy = jest.mocked(applyIncomePolicy);
const mockedCreateIncomeApplicationPlan = jest.mocked(createIncomeApplicationPlan);

const fundPlan = {
  incomeId: 'income-1', currencyCode: 'COP', totalAmountMinor: 500,
  applications: [{ destinationType: 'FUND' }],
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('FIN-07A finance hooks', () => {
  beforeEach(() => {
    mockedCreateFundTransaction.mockReset();
    mockedApplyLegacyIncomeBackfill.mockReset();
    mockedApplyIncomePolicy.mockReset();
    mockedCreateIncomeApplicationPlan.mockReset();
  });

  it('refreshes the fund and every transaction page after a transaction', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockedCreateFundTransaction.mockResolvedValue({} as never);
    const { result } = renderHook(() => useCreateFundTransaction('tenant-1', 'fund-1'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        direction: 'CREDIT', amountMinor: 500, currencyCode: 'COP', occurredAt: '2026-08-16',
      });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-1', 'funds', 'fund-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['finance', 'tenant-1', 'funds', 'fund-1', 'transactions', {}],
    });
  });

  it('invalidates related tenant-scoped finance data after legacy backfill', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockedApplyLegacyIncomeBackfill.mockResolvedValue([]);
    const { result } = renderHook(() => useApplyLegacyIncomeBackfill('tenant-1'), {
      wrapper: createWrapper(queryClient),
    });

    act(() => result.current.mutate([{ incomeId: 'income-1' }]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-1', 'incomes'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-1', 'funds'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-1', 'liquidations'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-1', 'legacy-backfill'] });
  });

  it('invalidates tenant funds for a manual plan that creates a FUND credit', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    const incomeKey = financeKeys.incomes('tenant-a', { period: '2026-08' });
    const liquidationKey = financeKeys.liquidations('tenant-a', { period: '2026-08' });
    queryClient.setQueryData(incomeKey, []);
    queryClient.setQueryData(liquidationKey, []);
    mockedCreateIncomeApplicationPlan.mockResolvedValue(fundPlan as never);
    const { result } = renderHook(() => useCreateIncomeApplicationPlan('tenant-a', 'income-1'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ applications: [{ destinationType: 'FUND', fundId: 'fund-1', amountMinor: 500 }] });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-a', 'funds'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-a', 'legacy-backfill'] });
    expect(queryClient.getQueryState(incomeKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(liquidationKey)?.isInvalidated).toBe(true);
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-b', 'funds'] });
  });

  it('does not invalidate funds for an OFFSET-only manual plan', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockedCreateIncomeApplicationPlan.mockResolvedValue({ ...fundPlan, applications: [{ destinationType: 'OFFSET_EXPENSES' }] } as never);
    const { result } = renderHook(() => useCreateIncomeApplicationPlan('tenant-a', 'income-1'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ applications: [{ destinationType: 'OFFSET_EXPENSES', amountMinor: 500 }] });
    });

    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-a', 'funds'] });
  });

  it('invalidates tenant funds when a policy returns a FUND application', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockedApplyIncomePolicy.mockResolvedValue(fundPlan as never);
    const { result } = renderHook(() => useApplyIncomePolicy('tenant-a', 'income-1'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-a', 'funds'] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['finance', 'tenant-b', 'funds'] });
  });
});
