/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { FinanceReportComponent } from './FinanceReport';

jest.mock('@/features/finance/services/finance.api', () => ({
  financeApi: { getFinanceExportUrl: jest.fn() },
}));

jest.mock('@/features/finance/components', () => ({
  FinanceChartsPanel: () => null,
}));

const multiCurrencyReport = {
  totalChargesByCurrency: [
    { currency: 'USD', amountMinor: 600000 },
    { currency: 'ARS', amountMinor: 30000 },
  ],
  totalPaidByCurrency: [
    { currency: 'USD', amountMinor: 400000 },
    { currency: 'ARS', amountMinor: 10000 },
  ],
  totalOutstandingByCurrency: [
    { currency: 'USD', amountMinor: 200000 },
    { currency: 'ARS', amountMinor: 20000 },
  ],
  collectionRateByCurrency: [
    { currency: 'USD', rate: 67 },
    { currency: 'ARS', rate: 33 },
  ],
  delinquentUnitsCount: 1,
  delinquentUnits: [
    {
      unitId: 'unit-1',
      outstandingByCurrency: [
        { currency: 'USD', amountMinor: 150000 },
        { currency: 'VES', amountMinor: 5000 },
      ],
    },
  ],
};

describe('FinanceReportComponent', () => {
  it('renders KPI buckets per currency without mixing amounts', () => {
    render(
      <FinanceReportComponent
        data={multiCurrencyReport}
        loading={false}
        error={null}
      />,
    );

    const body = screen.getByText('Total Facturado').parentElement!.textContent!;
    expect(body).toContain('6.000');
    expect(body).toContain('300');
    // No mixed nominal total is ever rendered (600000+30000=630000).
    expect(body).not.toContain('6.300');
  });

  it('renders collection rates per currency, never blended', () => {
    render(
      <FinanceReportComponent
        data={multiCurrencyReport}
        loading={false}
        error={null}
      />,
    );

    const body = screen.getByText('Tasa de Cobranza').parentElement!.textContent!;
    expect(body).toContain('67% USD');
    expect(body).toContain('33% ARS');
  });

  it('renders delinquent unit outstanding per currency', () => {
    render(
      <FinanceReportComponent
        data={multiCurrencyReport}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText('unit-1')).toBeTruthy();
    const cell = screen
      .getByText((content) => content.includes('1.500'))
      .parentElement!.textContent!;
    expect(cell).toContain('50');
  });

  it('renders empty state for empty buckets', () => {
    render(
      <FinanceReportComponent
        data={{
          totalChargesByCurrency: [],
          totalPaidByCurrency: [],
          totalOutstandingByCurrency: [],
          collectionRateByCurrency: [],
          delinquentUnitsCount: 0,
          delinquentUnits: [],
        }}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText('Sin deudores')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
});
