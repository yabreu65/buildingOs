import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { recordIncome, voidIncome } from '../services/expense-ledger.api';
import { financeKeys } from './finance-query-keys';
import { useRecordIncome, useVoidIncome } from './useExpenseLedger';

jest.mock('../services/expense-ledger.api', () => ({
  recordIncome: jest.fn(),
  voidIncome: jest.fn(),
}));

const mockedRecordIncome = jest.mocked(recordIncome);
const mockedVoidIncome = jest.mocked(voidIncome);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useExpenseLedger finance cache convergence', () => {
  beforeEach(() => {
    mockedRecordIncome.mockReset();
    mockedVoidIncome.mockReset();
  });

  it('records income against finance keys and invalidates only that tenant legacy preview', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const legacyA = financeKeys.legacyBackfillPreview('tenant-a', {});
    const legacyB = financeKeys.legacyBackfillPreview('tenant-b', {});
    queryClient.setQueryData(legacyA, []);
    queryClient.setQueryData(legacyB, []);
    mockedRecordIncome.mockResolvedValue({} as never);
    const { result } = renderHook(() => useRecordIncome('tenant-a'), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync('income-1');
    });

    expect(queryClient.getQueryState(legacyA)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(legacyB)?.isInvalidated).toBe(false);
  });

  it('invalidates the tenant fund family after voiding an income', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fundA = financeKeys.funds('tenant-a');
    const fundB = financeKeys.funds('tenant-b');
    queryClient.setQueryData(fundA, []);
    queryClient.setQueryData(fundB, []);
    mockedVoidIncome.mockResolvedValue({} as never);
    const { result } = renderHook(() => useVoidIncome('tenant-a'), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync('income-1');
    });

    expect(queryClient.getQueryState(fundA)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(fundB)?.isInvalidated).toBe(false);
  });
});
