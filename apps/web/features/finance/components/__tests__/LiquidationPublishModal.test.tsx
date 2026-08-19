import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiquidationPublishModal } from '../LiquidationPublishModal';

const mockPublish = {
  isPending: false,
  mutateAsync: jest.fn(),
};

jest.mock('../../hooks/useExpenseLedger', () => ({
  usePublishLiquidation: () => ({
    mutateAsync: mockPublish.mutateAsync,
    isPending: mockPublish.isPending,
  }),
}));

jest.mock('@/shared/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const defaultProps = {
  tenantId: 'tenant-1',
  liquidationId: 'liquidation-1',
  period: '2026-05',
  totalAmountMinor: 120000,
  baseCurrency: 'ARS',
  unitCount: 5,
};

const triggerLabel = 'Publicar';
const triggerTestId = 'publish-trigger';

function renderModal(
  overrides: Partial<{
    onClose: () => void;
    onPublished: () => void;
  }> = {},
) {
  render(
    <>
      <button type="button" data-testid={triggerTestId}>
        {triggerLabel}
      </button>
      <LiquidationPublishModal
        {...defaultProps}
        onClose={overrides.onClose ?? jest.fn()}
        onPublished={overrides.onPublished ?? jest.fn()}
      />
    </>,
  );
}

describe('LiquidationPublishModal', () => {
  beforeEach(() => {
    mockPublish.isPending = false;
    mockPublish.mutateAsync.mockReset();
  });

  it('exposes accessible dialog semantics', () => {
    renderModal();

    const dialog = screen.getByRole('dialog', {
      name: 'Publicar liquidación',
    });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('liquidation-publish-title');
  });

  it('moves initial focus to the due date field', () => {
    renderModal();

    expect(document.activeElement).toBe(
      screen.getByLabelText(/Fecha de vencimiento/),
    );
  });

  it('closes on Escape and calls onClose', () => {
    const onClose = jest.fn();
    renderModal({ onClose });

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Publicar liquidación' }), {
      key: 'Escape',
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while publishing', () => {
    const onClose = jest.fn();
    mockPublish.isPending = true;
    renderModal({ onClose });

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Publicar liquidación' }), {
      key: 'Escape',
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps focus contained when Tab reaches the last control', () => {
    renderModal();

    const dialog = screen.getByRole('dialog', { name: 'Publicar liquidación' });
    const lastButton = screen.getByRole('button', { name: /Publicar liquidación/ });
    const closeButton = screen.getByRole('button', {
      name: 'Cerrar diálogo de publicación de liquidación',
    });

    lastButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(document.activeElement).toBe(closeButton);
  });

  it('keeps focus contained on Shift+Tab from the first control', () => {
    renderModal();

    const dialog = screen.getByRole('dialog', { name: 'Publicar liquidación' });
    const closeButton = screen.getByRole('button', {
      name: 'Cerrar diálogo de publicación de liquidación',
    });
    const lastButton = screen.getByRole('button', { name: /Publicar liquidación/ });

    closeButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(lastButton);
  });

  it('keeps focus on the dialog and never escapes to a background control while pending', () => {
    mockPublish.isPending = true;
    renderModal();

    const dialog = screen.getByRole('dialog', { name: 'Publicar liquidación' });
    const trigger = screen.getByTestId(triggerTestId);

    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(trigger);
  });

  it('does not close on Escape while pending and does not bubble to a parent handler', () => {
    const onClose = jest.fn();
    const parentHandler = jest.fn();
    document.body.addEventListener('keydown', parentHandler);
    mockPublish.isPending = true;
    renderModal({ onClose });

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Publicar liquidación' }), {
      key: 'Escape',
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(parentHandler).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', parentHandler);
  });

  it('disables controls and shows loading state while publishing', async () => {
    mockPublish.isPending = true;
    mockPublish.mutateAsync.mockResolvedValue({});
    const onClose = jest.fn();
    renderModal({ onClose });

    fireEvent.change(screen.getByLabelText(/Fecha de vencimiento/), {
      target: { value: '2026-05-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Publicando/ }));

    expect(
      (screen.getByRole('button', { name: /Publicando/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/Fecha de vencimiento/) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Cerrar diálogo de publicación de liquidación',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('invokes onPublished after successful publish', async () => {
    mockPublish.mutateAsync.mockResolvedValue({});
    const onPublished = jest.fn();
    renderModal({ onPublished });

    fireEvent.change(screen.getByLabelText(/Fecha de vencimiento/), {
      target: { value: '2026-05-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Publicar liquidación/ }));

    await waitFor(() => {
      expect(onPublished).toHaveBeenCalledTimes(1);
    });
    expect(mockPublish.mutateAsync).toHaveBeenCalledWith({
      liquidationId: 'liquidation-1',
      dueDate: '2026-05-31',
    });
  });

  it('restores focus to the trigger that opened it after unmount', () => {
    const { unmount: unmountTrigger } = render(
      <button type="button" data-testid={triggerTestId}>
        {triggerLabel}
      </button>,
    );
    const trigger = screen.getByTestId(triggerTestId);

    trigger.focus();

    const { unmount } = render(
      <LiquidationPublishModal
        {...defaultProps}
        onClose={jest.fn()}
        onPublished={jest.fn()}
      />,
    );

    expect(document.activeElement).not.toBe(trigger);

    unmount();

    expect(document.activeElement).toBe(trigger);
    unmountTrigger();
  });
});
