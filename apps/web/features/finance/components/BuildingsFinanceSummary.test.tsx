/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { BuildingsFinanceSummary } from './BuildingsFinanceSummary';
import { financeApi } from '../services/finance.api';

jest.mock('../services/finance.api', () => ({
  financeApi: {
    getFinancialSummary: jest.fn(),
  },
}));

jest.mock('@/features/tenancy/hooks/useTenantBranding', () => ({
  useTenantCurrency: () => ({
    format: (value: number) => `ARS ${value.toLocaleString('es-AR')}`,
  }),
}));

const mockedGetFinancialSummary = jest.mocked(financeApi.getFinancialSummary);

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const summaryJune = {
  totalChargesByCurrency: [{ currency: 'ARS', amountMinor: 100000 }],
  totalPaidByCurrency: [{ currency: 'ARS', amountMinor: 30000 }],
  totalOutstandingByCurrency: [{ currency: 'ARS', amountMinor: 70000 }],
  delinquentUnitsCount: 1,
  topDelinquentUnits: [] as never[],
};

const summaryJuly = {
  totalChargesByCurrency: [{ currency: 'ARS', amountMinor: 120000 }],
  totalPaidByCurrency: [{ currency: 'ARS', amountMinor: 50000 }],
  totalOutstandingByCurrency: [{ currency: 'ARS', amountMinor: 70000 }],
  delinquentUnitsCount: 1,
  topDelinquentUnits: [] as never[],
};

describe('BuildingsFinanceSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetFinancialSummary.mockResolvedValue({
      totalChargesByCurrency: [{ currency: 'ARS', amountMinor: 100000 }],
      totalPaidByCurrency: [{ currency: 'ARS', amountMinor: 30000 }],
      totalOutstandingByCurrency: [{ currency: 'ARS', amountMinor: 70000 }],
      delinquentUnitsCount: 1,
      topDelinquentUnits: [],
    });
  });

  it('requests the selected period for each building and refreshes when the period changes', async () => {
    const { rerender } = render(
      <BuildingsFinanceSummary
        tenantId="tenant-1"
        period="2026-07"
        buildingIds={['building-a']}
        buildingNames={{ 'building-a': 'Torre Sur' }}
      />,
    );

    await waitFor(() => {
      expect(mockedGetFinancialSummary).toHaveBeenCalledWith('building-a', '2026-07');
    });
    expect(await screen.findByText('Torre Sur')).toBeTruthy();
    expect(await screen.findByText((content) => content.includes('1.000,00'))).toBeTruthy();
    expect(await screen.findByText((content) => content.includes('300,00'))).toBeTruthy();
    expect(await screen.findByText((content) => content.includes('700,00'))).toBeTruthy();
    expect(await screen.findByText((content) => content.includes('30% ARS'))).toBeTruthy();

    mockedGetFinancialSummary.mockResolvedValueOnce({
      totalChargesByCurrency: [{ currency: 'ARS', amountMinor: 120000 }],
      totalPaidByCurrency: [{ currency: 'ARS', amountMinor: 50000 }],
      totalOutstandingByCurrency: [{ currency: 'ARS', amountMinor: 70000 }],
      delinquentUnitsCount: 1,
      topDelinquentUnits: [],
    });

    rerender(
      <BuildingsFinanceSummary
        tenantId="tenant-1"
        period="2026-08"
        buildingIds={['building-a']}
        buildingNames={{ 'building-a': 'Torre Sur' }}
      />,
    );

    await waitFor(() => {
      expect(mockedGetFinancialSummary).toHaveBeenCalledWith('building-a', '2026-08');
    });
  });

  it('keeps the latest period summary when an older request resolves later', async () => {
    const june = createDeferred<typeof summaryJune>();
    const july = createDeferred<typeof summaryJuly>();

    mockedGetFinancialSummary
      .mockImplementationOnce(() => june.promise)
      .mockImplementationOnce(() => july.promise);

    const { rerender } = render(
      <BuildingsFinanceSummary
        tenantId="tenant-1"
        period="2026-06"
        buildingIds={['building-a']}
        buildingNames={{ 'building-a': 'Torre Sur' }}
      />,
    );

    rerender(
      <BuildingsFinanceSummary
        tenantId="tenant-1"
        period="2026-07"
        buildingIds={['building-a']}
        buildingNames={{ 'building-a': 'Torre Sur' }}
      />,
    );

    await act(async () => {
      july.resolve(summaryJuly);
    });

    expect(await screen.findByText((content) => content.includes('1.200,00'))).toBeTruthy();
    expect(screen.queryByText((content) => content.includes('1.000,00'))).toBeNull();

    await act(async () => {
      june.resolve(summaryJune);
    });

    expect(screen.getByText((content) => content.includes('1.200,00'))).toBeTruthy();
    expect(screen.queryByText((content) => content.includes('1.000,00'))).toBeNull();
  });

  it('keeps a stale error from replacing a newer summary', async () => {
    const june = createDeferred<typeof summaryJune>();
    const july = createDeferred<typeof summaryJuly>();

    mockedGetFinancialSummary
      .mockImplementationOnce(() => june.promise)
      .mockImplementationOnce(() => july.promise);

    const { rerender } = render(
      <BuildingsFinanceSummary
        tenantId="tenant-1"
        period="2026-06"
        buildingIds={['building-a']}
        buildingNames={{ 'building-a': 'Torre Sur' }}
      />,
    );

    rerender(
      <BuildingsFinanceSummary
        tenantId="tenant-1"
        period="2026-07"
        buildingIds={['building-a']}
        buildingNames={{ 'building-a': 'Torre Sur' }}
      />,
    );

    await act(async () => {
      july.resolve(summaryJuly);
    });

    expect(await screen.findByText((content) => content.includes('1.200,00'))).toBeTruthy();

    await act(async () => {
      june.reject(new Error('Periodo anterior falló'));
    });

    expect(screen.getByText((content) => content.includes('1.200,00'))).toBeTruthy();
    expect(screen.queryByText(/Error al cargar datos/i)).toBeNull();
  });
});
