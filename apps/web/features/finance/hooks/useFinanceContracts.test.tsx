import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFundTransaction } from '../services/funds.api';
import { applyLegacyIncomeBackfill } from '../services/legacy-backfill.api';
import { useCreateFundTransaction } from './useFunds';
import { useApplyLegacyIncomeBackfill } from './useLegacyIncomeBackfill';

jest.mock('../services/funds.api', () => ({ createFundTransaction: jest.fn() }));
jest.mock('../services/legacy-backfill.api', () => ({ applyLegacyIncomeBackfill: jest.fn() }));

const mockedCreateFundTransaction = jest.mocked(createFundTransaction);
const mockedApplyLegacyIncomeBackfill = jest.mocked(applyLegacyIncomeBackfill);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('FIN-07A finance hooks', () => {
  beforeEach(() => {
    mockedCreateFundTransaction.mockReset();
    mockedApplyLegacyIncomeBackfill.mockReset();
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
});
