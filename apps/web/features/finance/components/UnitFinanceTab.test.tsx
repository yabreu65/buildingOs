/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { UnitFinanceTab } from './UnitFinanceTab';
import { useUnitLedger } from '../hooks/useUnitLedger';
import { formatCurrency } from '@/shared/lib/format/money';
import { formatCurrencyBuckets } from '@/shared/lib/format/currency-buckets';
import { ChargeStatus, ChargeType, type Charge } from '../services/finance.api';

jest.mock('../hooks/useUnitLedger', () => ({
  useUnitLedger: jest.fn(),
}));

const mockedUseUnitLedger = jest.mocked(useUnitLedger);

function makeCharge(overrides: Partial<Charge> = {}): Charge {
  return {
    id: 'charge-1',
    unitId: 'unit-1',
    concept: 'Common expenses',
    period: '2026-07',
    type: ChargeType.COMMON_EXPENSE,
    amount: 10000,
    allocated: 0,
    currency: 'USD',
    dueDate: '2026-07-10',
    status: ChargeStatus.PENDING,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderTab(charges: readonly Charge[]) {
  mockedUseUnitLedger.mockReturnValue({
    data: {
      unitId: 'unit-1',
      charges: [...charges],
      payments: [],
      totals: {
        balanceByCurrency: [],
        totalPaidByCurrency: [],
        totalChargesByCurrency: [],
        totalAllocatedByCurrency: [],
      },
    },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  } as ReturnType<typeof useUnitLedger>);

  render(<UnitFinanceTab tenantId="tenant-1" unitId="unit-1" unitLabel="A-1" />);
}

describe('UnitFinanceTab pending period aggregates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders one stored-currency bucket for a single-currency period', () => {
    renderTab([
      makeCharge({ id: 'usd-1', amount: 10000 }),
      makeCharge({ id: 'usd-2', amount: 2500 }),
    ]);

    expect(screen.getByRole('button', { name: /2026-07/i }).textContent).toContain(
      formatCurrencyBuckets([{ currency: 'USD', amountMinor: 12500 }]),
    );
  });

  it('renders separate USD and COP buckets rather than a combined or relabeled period total', () => {
    renderTab([
      makeCharge({ id: 'usd-1', concept: 'USD charge', amount: 10000, currency: 'USD' }),
      makeCharge({ id: 'cop-1', concept: 'COP charge', amount: 20000, currency: 'COP' }),
    ]);

    const periodButton = screen.getByRole('button', { name: /2026-07/i });
    expect(periodButton.textContent).toContain(formatCurrencyBuckets([
      { currency: 'USD', amountMinor: 10000 },
      { currency: 'COP', amountMinor: 20000 },
    ]));
    expect(periodButton.textContent).not.toContain(formatCurrency(30000, 'USD'));

    fireEvent.click(periodButton);
    expect(screen.getByText('USD charge')).toBeTruthy();
    expect(screen.getByText('COP charge')).toBeTruthy();
    expect(document.body.textContent).toContain(formatCurrency(10000, 'USD'));
    expect(document.body.textContent).toContain(formatCurrency(20000, 'COP'));
  });

  it('renders separate USD and UYU buckets without changing either stored currency', () => {
    renderTab([
      makeCharge({ id: 'usd-1', amount: 10000, currency: 'USD' }),
      makeCharge({ id: 'uyu-1', amount: 30000, currency: 'UYU' }),
    ]);

    expect(screen.getByRole('button', { name: /2026-07/i }).textContent).toContain(
      formatCurrencyBuckets([
        { currency: 'USD', amountMinor: 10000 },
        { currency: 'UYU', amountMinor: 30000 },
      ]),
    );
  });

  it('does not fall back or relabel the period aggregate while preserving individual charge-row formatting', () => {
    renderTab([
      makeCharge({ id: 'legacy-empty-currency', concept: 'Legacy charge', amount: 1234, currency: '' }),
    ]);

    const periodButton = screen.getByRole('button', { name: /2026-07/i });
    expect(periodButton.textContent).toContain(formatCurrencyBuckets([{ currency: '', amountMinor: 1234 }]));
    expect(periodButton.textContent).not.toContain(formatCurrency(1234, 'USD'));

    fireEvent.click(periodButton);
    expect(screen.getByText('Legacy charge')).toBeTruthy();
    expect(document.body.textContent).toContain(formatCurrency(1234, 'USD'));
  });
});
