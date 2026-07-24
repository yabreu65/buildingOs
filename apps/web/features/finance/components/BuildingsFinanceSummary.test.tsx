/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
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
});
