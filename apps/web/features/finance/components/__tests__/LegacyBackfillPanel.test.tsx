import { fireEvent, render, screen } from '@testing-library/react';
import { LegacyBackfillPanel } from '../LegacyBackfillPanel';
import type {
  Fund,
  LegacyBackfillPreviewItem,
} from '../../contracts';

const applyMutateAsync = jest.fn();

jest.mock('../../hooks/useLegacyIncomeBackfill', () => ({
  useLegacyIncomeBackfillPreview: jest.fn(),
  useApplyLegacyIncomeBackfill: jest.fn(() => ({
    mutateAsync: applyMutateAsync,
    isPending: false,
    error: null,
  })),
}));

jest.mock('../../hooks/useFunds', () => ({
  useFunds: jest.fn(),
}));

const { useLegacyIncomeBackfillPreview } = jest.requireMock(
  '../../hooks/useLegacyIncomeBackfill',
);
const { useFunds } = jest.requireMock('../../hooks/useFunds');

function previewItem(
  overrides: Partial<LegacyBackfillPreviewItem>,
): LegacyBackfillPreviewItem {
  return {
    incomeId: 'income-1',
    period: '2026-04',
    categoryId: 'cat-1',
    scopeType: 'BUILDING',
    buildingId: 'building-1',
    status: 'RECORDED',
    destination: 'APPLY_TO_EXPENSES',
    amountMinor: 10000,
    currencyCode: 'ARS',
    applicationsCount: 0,
    classification: 'AUTO_MAPPABLE_OFFSET',
    ...overrides,
  };
}

const reserveFund: Fund = {
  id: 'fund-reserve',
  tenantId: 'tenant-1',
  buildingId: null,
  scopeType: 'TENANT',
  type: 'RESERVE',
  name: 'Fondo Reserva',
  description: null,
  status: 'ACTIVE',
  balancesByCurrency: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};

const specialFund: Fund = {
  ...reserveFund,
  id: 'fund-special',
  type: 'SPECIAL',
  name: 'Fondo Especial',
};

function setup(items: LegacyBackfillPreviewItem[], funds: Fund[] = []) {
  useLegacyIncomeBackfillPreview.mockReturnValue({
    data: items,
    isPending: false,
    isError: false,
  });
  useFunds.mockReturnValue({ data: funds });
  return render(<LegacyBackfillPanel tenantId="tenant-1" />);
}

describe('LegacyBackfillPanel', () => {
  beforeEach(() => {
    applyMutateAsync.mockReset();
  });

  it('renders classification labels for each preview item', () => {
    setup([
      previewItem({ incomeId: 'i1', classification: 'AUTO_MAPPABLE_OFFSET' }),
      previewItem({ incomeId: 'i2', classification: 'REQUIRES_RESERVE_FUND', destination: 'RESERVE_FUND' }),
      previewItem({ incomeId: 'i3', classification: 'REQUIRES_SPECIAL_FUND', destination: 'SPECIAL_FUND' }),
      previewItem({ incomeId: 'i4', classification: 'ALREADY_HAS_PLAN' }),
      previewItem({ incomeId: 'i5', classification: 'LIQUIDATION_CONFLICT' }),
    ]);

    expect(screen.getByText('Puede migrarse a Aplicar a gastos')).toBeTruthy();
    expect(screen.getByText('Seleccione un Fondo de Reserva')).toBeTruthy();
    expect(screen.getByText('Seleccione un Fondo Especial')).toBeTruthy();
    expect(screen.getByText('Ya usa el modelo moderno; no se modificará')).toBeTruthy();
    expect(
      screen.getByText(
        'Existe una liquidación histórica que impide migrarlo automáticamente',
      ),
    ).toBeTruthy();
  });

  it('renders no migration checkbox for non-actionable classifications', () => {
    setup([
      previewItem({ incomeId: 'i4', classification: 'ALREADY_HAS_PLAN' }),
      previewItem({ incomeId: 'i5', classification: 'LIQUIDATION_CONFLICT' }),
      previewItem({ incomeId: 'i6', classification: 'NOT_RECORDED' }),
    ]);

    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('requires an explicit RESERVE fund before applying a REQUIRES_RESERVE_FUND income', () => {
    setup(
      [
        previewItem({
          incomeId: 'i2',
          classification: 'REQUIRES_RESERVE_FUND',
          destination: 'RESERVE_FUND',
        }),
      ],
      [reserveFund, specialFund],
    );

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const select = screen.getByLabelText('Fondo de Reserva');
    expect(select).toBeTruthy();

    // Only RESERVE funds are offered (never SPECIAL, never fallback by name).
    const options = Array.from(
      select.querySelectorAll('option'),
    ).map((option) => option.getAttribute('value'));
    expect(options).toContain('fund-reserve');
    expect(options).not.toContain('fund-special');

    // Apply is disabled until a fund is selected.
    expect(screen.getByRole('button', { name: /Aplicar migración/ }).getAttribute('disabled')).not.toBeNull();

    fireEvent.change(select, { target: { value: 'fund-reserve' } });
    expect(screen.getByRole('button', { name: /Aplicar migración/ }).getAttribute('disabled')).toBeNull();
  });

  it('shows an actionable empty state when no compatible RESERVE fund exists', () => {
    setup(
      [
        previewItem({
          incomeId: 'i2',
          classification: 'REQUIRES_RESERVE_FUND',
          destination: 'RESERVE_FUND',
        }),
      ],
      [specialFund],
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(
      screen.getByText(
        'No hay un Fondo de Reserva activo. Cree uno antes de migrar este ingreso.',
      ),
    ).toBeTruthy();
  });

  it('summarizes a mixed batch result without collapsing into success/failure', async () => {
    applyMutateAsync.mockResolvedValue([
      { incomeId: 'i1', status: 'MIGRATED' },
      { incomeId: 'i2', status: 'MIGRATED' },
      { incomeId: 'i3', status: 'ALREADY_MIGRATED' },
      { incomeId: 'i4', status: 'LIQUIDATION_CONFLICT' },
    ]);

    setup([
      previewItem({ incomeId: 'i1', classification: 'AUTO_MAPPABLE_OFFSET' }),
      previewItem({ incomeId: 'i2', classification: 'AUTO_MAPPABLE_OFFSET' }),
      previewItem({ incomeId: 'i3', classification: 'AUTO_MAPPABLE_OFFSET' }),
      previewItem({ incomeId: 'i4', classification: 'AUTO_MAPPABLE_OFFSET' }),
    ]);

    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((checkbox) => fireEvent.click(checkbox));

    fireEvent.click(screen.getByRole('button', { name: /Aplicar migración/ }));

    expect(await screen.findByText('4 ingresos procesados')).toBeTruthy();
    expect(screen.getByText(/2 Migrados/)).toBeTruthy();
    expect(screen.getByText(/1 Ya estaban migrados/)).toBeTruthy();
    expect(screen.getByText(/1 Bloqueados por liquidación histórica/)).toBeTruthy();
  });
});
