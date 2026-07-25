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

describe('BuildingsFinanceSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetFinancialSummary.mockResolvedValue({
      totalCharges: 100000,
      totalPaid: 30000,
      totalOutstanding: 70000,
      delinquentUnitsCount: 1,
      topDelinquentUnits: [],
      currency: 'ARS',
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
    expect(await screen.findByText('ARS 100.000')).toBeTruthy();
    expect(await screen.findByText('ARS 30.000')).toBeTruthy();
    expect(await screen.findByText('ARS 70.000')).toBeTruthy();
    expect(await screen.findByText('30%')).toBeTruthy();

    mockedGetFinancialSummary.mockResolvedValueOnce({
      totalCharges: 120000,
      totalPaid: 50000,
      totalOutstanding: 70000,
      delinquentUnitsCount: 1,
      topDelinquentUnits: [],
      currency: 'ARS',
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
    const june = createDeferred<{
      totalCharges: number;
      totalPaid: number;
      totalOutstanding: number;
      delinquentUnitsCount: number;
      topDelinquentUnits: never[];
      currency: string;
    }>();
    const july = createDeferred<{
      totalCharges: number;
      totalPaid: number;
      totalOutstanding: number;
      delinquentUnitsCount: number;
      topDelinquentUnits: never[];
      currency: string;
    }>();

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
      july.resolve({
        totalCharges: 120000,
        totalPaid: 50000,
        totalOutstanding: 70000,
        delinquentUnitsCount: 1,
        topDelinquentUnits: [],
        currency: 'ARS',
      });
    });

    expect(await screen.findByText('ARS 120.000')).toBeTruthy();
    expect(screen.queryByText('ARS 100.000')).toBeNull();

    await act(async () => {
      june.resolve({
        totalCharges: 100000,
        totalPaid: 30000,
        totalOutstanding: 70000,
        delinquentUnitsCount: 1,
        topDelinquentUnits: [],
        currency: 'ARS',
      });
    });

    expect(screen.getByText('ARS 120.000')).toBeTruthy();
    expect(screen.queryByText('ARS 100.000')).toBeNull();
  });

  it('keeps a stale error from replacing a newer summary', async () => {
    const june = createDeferred<{
      totalCharges: number;
      totalPaid: number;
      totalOutstanding: number;
      delinquentUnitsCount: number;
      topDelinquentUnits: never[];
      currency: string;
    }>();
    const july = createDeferred<{
      totalCharges: number;
      totalPaid: number;
      totalOutstanding: number;
      delinquentUnitsCount: number;
      topDelinquentUnits: never[];
      currency: string;
    }>();

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
      july.resolve({
        totalCharges: 120000,
        totalPaid: 50000,
        totalOutstanding: 70000,
        delinquentUnitsCount: 1,
        topDelinquentUnits: [],
        currency: 'ARS',
      });
    });

    expect(await screen.findByText('ARS 120.000')).toBeTruthy();

    await act(async () => {
      june.reject(new Error('Periodo anterior falló'));
    });

    expect(screen.getByText('ARS 120.000')).toBeTruthy();
    expect(screen.queryByText(/Error al cargar datos/i)).toBeNull();
  });
});
