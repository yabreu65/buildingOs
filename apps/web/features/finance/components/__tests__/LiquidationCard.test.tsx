import { fireEvent, render, screen } from '@testing-library/react';
import { LiquidationCard } from '../LiquidationCard';
import type {
  Liquidation,
  LiquidationDetail,
  LiquidationExpenseItem,
  LiquidationChargePreview,
} from '../../services/expense-ledger.api';

const reviewMutateAsync = jest.fn();
const cancelMutateAsync = jest.fn();
const toast = jest.fn();
const detailRefetch = jest.fn();

interface LiquidationDetailQueryState {
  data?: LiquidationDetail;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: typeof detailRefetch;
}

const useLiquidationDetailMock = jest.fn();

let detailQueryState: LiquidationDetailQueryState = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: detailRefetch,
};

jest.mock('@/shared/components/ui/Toast', () => ({
  useToast: () => ({
    toast,
  }),
}));

jest.mock('../../hooks/useExpenseLedger', () => ({
  useReviewLiquidation: () => ({
    mutateAsync: reviewMutateAsync,
    isPending: false,
  }),
  useCancelLiquidation: () => ({
    mutateAsync: cancelMutateAsync,
    isPending: false,
  }),
  useLiquidationDetail: (
    tenantId: string,
    liquidationId: string,
    enabled = true,
  ): LiquidationDetailQueryState =>
    useLiquidationDetailMock(tenantId, liquidationId, enabled),
}));

function buildLiquidation(status: Liquidation['status']): Liquidation {
  return {
    id: 'liq-1',
    tenantId: 'tenant-1',
    buildingId: 'building-1',
    period: '2026-05',
    status,
    baseCurrency: 'ARS',
    totalAmountMinor: 150000,
    totalsByCurrency: { ARS: 150000 },
    unitCount: 2,
    generatedAt: '2026-05-01T00:00:00.000Z',
    reviewedAt:
      status === 'REVIEWED' || status === 'PUBLISHED' || status === 'CANCELED'
        ? '2026-05-02T00:00:00.000Z'
        : null,
    publishedAt: status === 'PUBLISHED' ? '2026-05-03T00:00:00.000Z' : null,
    canceledAt: status === 'CANCELED' ? '2026-05-04T00:00:00.000Z' : null,
    createdAt: '2026-05-01T00:00:00.000Z',
  };
}

function buildDetail(
  status: Liquidation['status'],
  overrides: Partial<{
    expenses: LiquidationExpenseItem[];
    chargesPreview: LiquidationChargePreview[];
    totalAmountMinor: number;
  }> = {},
): LiquidationDetail {
  const liquidation = buildLiquidation(status);

  return {
    ...liquidation,
    totalAmountMinor: overrides.totalAmountMinor ?? liquidation.totalAmountMinor,
    expenses:
      overrides.expenses ??
      [
        {
          id: 'expense-1',
          categoryName: 'Luz',
          vendorName: 'Servicios SA',
          amountMinor: 50000,
          currencyCode: 'ARS',
          invoiceDate: '2026-05-10T00:00:00.000Z',
          description: 'Factura 123',
        },
      ],
    chargesPreview:
      overrides.chargesPreview ??
      [
        {
          unitId: 'unit-1',
          unitCode: 'A-01',
          unitLabel: 'Apartamento 1',
          amountMinor: 75000,
        },
        {
          unitId: 'unit-2',
          unitCode: 'A-02',
          unitLabel: 'Apartamento 2',
          amountMinor: 75000,
        },
      ],
  };
}

function renderCard(status: Liquidation['status']) {
  return render(
    <LiquidationCard
      tenantId="tenant-1"
      liquidation={buildLiquidation(status)}
      onRefresh={jest.fn()}
    />,
  );
}

describe('LiquidationCard', () => {
  beforeEach(() => {
    reviewMutateAsync.mockReset();
    cancelMutateAsync.mockReset();
    toast.mockReset();
    detailRefetch.mockReset();
    useLiquidationDetailMock.mockReset();
    detailQueryState = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: detailRefetch,
    };

    useLiquidationDetailMock.mockImplementation(
      (_tenantId: string, _liquidationId: string, enabled = true) => {
        if (!enabled) {
          return {
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
            refetch: detailRefetch,
          } satisfies LiquidationDetailQueryState;
        }

        return detailQueryState;
      },
    );
  });

  it('shows review and cancel for DRAFT, but not publish', () => {
    renderCard('DRAFT');

    expect(screen.getByRole('button', { name: 'Revisar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver detalle' })).toBeTruthy();
  });

  it('shows publish and cancel for REVIEWED, but not review', () => {
    renderCard('REVIEWED');

    expect(screen.getByRole('button', { name: 'Publicar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revisar' })).toBeNull();
  });

  it('shows terminal text and no mutating actions for PUBLISHED', () => {
    renderCard('PUBLISHED');

    expect(
      screen.getByText('Liquidación publicada — no hay acciones disponibles'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revisar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('shows terminal text and no mutating actions for CANCELED', () => {
    renderCard('CANCELED');

    expect(
      screen.getByText('Liquidación cancelada — no hay acciones disponibles'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revisar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('enables the detail query only when the user opens the card', () => {
    renderCard('REVIEWED');

    expect(useLiquidationDetailMock).toHaveBeenCalledWith(
      'tenant-1',
      'liq-1',
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(useLiquidationDetailMock).toHaveBeenLastCalledWith(
      'tenant-1',
      'liq-1',
      true,
    );
    expect(screen.getByRole('button', { name: 'Ocultar detalle' })).toBeTruthy();
  });

  it('shows loading state while the detail is being fetched', () => {
    detailQueryState = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: detailRefetch,
    };

    renderCard('REVIEWED');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(screen.getByRole('status').textContent).toContain(
      'Cargando detalle de la liquidación',
    );
  });

  it('renders expenses and charges when the detail loads', () => {
    detailQueryState = {
      data: buildDetail('REVIEWED'),
      isLoading: false,
      isError: false,
      error: null,
      refetch: detailRefetch,
    };

    renderCard('REVIEWED');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(screen.getByText('Gastos incluidos')).toBeTruthy();
    expect(screen.getByText('Luz')).toBeTruthy();
    expect(
      screen.getByText((_, element) => element?.textContent === 'Servicios SA · $ 500,00'),
    ).toBeTruthy();
    expect(screen.getByText('Distribución estimada por unidad')).toBeTruthy();
    expect(
      screen.getAllByText(
        (_, element) => element?.textContent === 'Unidad A-01 — Apartamento 1',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText((_, element) => element?.textContent === '$ 750,00').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Unidades incluidas: 2')).toBeTruthy();
    expect(
      screen.getByText((_, element) => element?.textContent === 'Total distribuido: $ 1.500,00'),
    ).toBeTruthy();
  });

  it('shows the published copy when the liquidation is terminal and published', () => {
    detailQueryState = {
      data: buildDetail('PUBLISHED'),
      isLoading: false,
      isError: false,
      error: null,
      refetch: detailRefetch,
    };

    renderCard('PUBLISHED');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(screen.getByText('Cargos generados por unidad')).toBeTruthy();
    expect(
      screen.getByText(
        'Estos importes son cargos asignados a las unidades. No representan pagos recibidos.',
      ),
    ).toBeTruthy();
  });

  it('shows empty states when there are no expenses or charges', () => {
    detailQueryState = {
      data: buildDetail('REVIEWED', {
        expenses: [],
        chargesPreview: [],
      }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: detailRefetch,
    };

    renderCard('REVIEWED');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(screen.getByText('No hay datos históricos disponibles.')).toBeTruthy();
    expect(screen.getByText('No hay cargos asociados a esta liquidación.')).toBeTruthy();
    expect(screen.getByText('Unidades incluidas: 0')).toBeTruthy();
  });

  it('shows a retry button when loading the detail fails', () => {
    detailQueryState = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: detailRefetch,
    };

    renderCard('REVIEWED');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(
      screen.getByText('No pudimos cargar el detalle de la liquidación.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(detailRefetch).toHaveBeenCalled();
  });

  it('warns when the distribution total does not match the liquidation total', () => {
    detailQueryState = {
      data: buildDetail('REVIEWED', {
        chargesPreview: [
          {
            unitId: 'unit-1',
            unitCode: 'A-01',
            unitLabel: 'Apartamento 1',
            amountMinor: 100000,
          },
        ],
        totalAmountMinor: 150000,
      }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: detailRefetch,
    };

    renderCard('REVIEWED');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(
      screen.getByText(
        'El total distribuido entre las unidades no coincide con el total de la liquidación.',
      ),
    ).toBeTruthy();
  });

  it('keeps review and cancel actions functional for DRAFT', async () => {
    reviewMutateAsync.mockResolvedValueOnce({});
    cancelMutateAsync.mockResolvedValueOnce({});

    renderCard('DRAFT');

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(reviewMutateAsync).toHaveBeenCalledWith('liq-1');
    expect(cancelMutateAsync).toHaveBeenCalledWith('liq-1');
  });
});
