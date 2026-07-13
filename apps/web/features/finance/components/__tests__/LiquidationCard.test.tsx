import { fireEvent, render, screen } from '@testing-library/react';
import { LiquidationCard } from '../LiquidationCard';
import type { Liquidation } from '../../services/expense-ledger.api';

const reviewMutateAsync = jest.fn();
const cancelMutateAsync = jest.fn();
const toast = jest.fn();

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
}));

function buildLiquidation(status: Liquidation['status']): Liquidation {
  return {
    id: 'liq-1',
    tenantId: 'tenant-1',
    buildingId: 'building-1',
    period: '2026-05',
    status,
    baseCurrency: 'ARS',
    totalAmountMinor: 12500,
    totalsByCurrency: { ARS: 12500 },
    unitCount: 3,
    generatedAt: '2026-05-01T00:00:00.000Z',
    reviewedAt: status === 'REVIEWED' || status === 'PUBLISHED' || status === 'CANCELED'
      ? '2026-05-02T00:00:00.000Z'
      : null,
    publishedAt: status === 'PUBLISHED' ? '2026-05-03T00:00:00.000Z' : null,
    canceledAt: status === 'CANCELED' ? '2026-05-04T00:00:00.000Z' : null,
    createdAt: '2026-05-01T00:00:00.000Z',
  };
}

describe('LiquidationCard', () => {
  beforeEach(() => {
    reviewMutateAsync.mockReset();
    cancelMutateAsync.mockReset();
    toast.mockReset();
  });

  it('shows review and cancel for DRAFT, but not publish', () => {
    render(
      <LiquidationCard
        tenantId="tenant-1"
        liquidation={buildLiquidation('DRAFT')}
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Revisar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(
      screen.queryByText('Liquidación publicada — no hay acciones disponibles'),
    ).toBeNull();
  });

  it('shows publish and cancel for REVIEWED, but not review', () => {
    render(
      <LiquidationCard
        tenantId="tenant-1"
        liquidation={buildLiquidation('REVIEWED')}
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Publicar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revisar' })).toBeNull();
  });

  it('shows terminal text and no mutating actions for PUBLISHED', () => {
    render(
      <LiquidationCard
        tenantId="tenant-1"
        liquidation={buildLiquidation('PUBLISHED')}
        onRefresh={jest.fn()}
      />,
    );

    expect(
      screen.getByText('Liquidación publicada — no hay acciones disponibles'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revisar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('shows terminal text and no mutating actions for CANCELED', () => {
    render(
      <LiquidationCard
        tenantId="tenant-1"
        liquidation={buildLiquidation('CANCELED')}
        onRefresh={jest.fn()}
      />,
    );

    expect(
      screen.getByText('Liquidación cancelada — no hay acciones disponibles'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revisar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('keeps review and cancel actions functional for DRAFT', async () => {
    reviewMutateAsync.mockResolvedValueOnce({});
    cancelMutateAsync.mockResolvedValueOnce({});

    render(
      <LiquidationCard
        tenantId="tenant-1"
        liquidation={buildLiquidation('DRAFT')}
        onRefresh={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(reviewMutateAsync).toHaveBeenCalledWith('liq-1');
    expect(cancelMutateAsync).toHaveBeenCalledWith('liq-1');
  });
});
