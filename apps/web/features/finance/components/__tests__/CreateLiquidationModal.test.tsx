import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateLiquidationModal } from '../CreateLiquidationModal';

const mutateAsync = jest.fn();

jest.mock('../../hooks/useExpenseLedger', () => ({
  useCreateLiquidationDraft: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

describe('CreateLiquidationModal', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it('opens as a dialog and shows validation feedback', () => {
    render(
      <CreateLiquidationModal
        tenantId="tenant-1"
        buildings={[{ id: 'building-1', name: 'Tower One' }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Nueva Liquidación' }));

    expect(screen.getByRole('dialog', { name: 'Crear Liquidación' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Crear Liquidación' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Todos los campos son requeridos');
  });

  it('submits normalized values and closes on escape', async () => {
    mutateAsync.mockResolvedValue({});
    const onSuccess = jest.fn();

    render(
      <CreateLiquidationModal
        tenantId="tenant-1"
        buildings={[{ id: 'building-1', name: 'Tower One' }]}
        onSuccess={onSuccess}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Nueva Liquidación' });
    fireEvent.click(trigger);

    fireEvent.change(screen.getByLabelText('Edificio'), { target: { value: 'building-1' } });
    fireEvent.change(screen.getByLabelText('Período (YYYY-MM)'), { target: { value: '2026-07' } });
    fireEvent.change(screen.getByLabelText('Moneda Base'), { target: { value: 'USD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear Liquidación' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      buildingId: 'building-1',
      period: '2026-07',
      baseCurrency: 'USD',
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Crear Liquidación' }), { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Crear Liquidación' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
