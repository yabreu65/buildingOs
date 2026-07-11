/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import TenantActions from '../TenantActions';
import type { Tenant } from '../../super-admin.types';

jest.mock('../../../impersonation/useImpersonation', () => ({
  useImpersonation: () => ({
    startImpersonation: jest.fn(),
  }),
}));

describe('TenantActions', () => {
  const baseTenant: Tenant = {
    id: 'tenant-1',
    name: 'Tenant Demo',
    type: 'ADMINISTRADORA',
    status: 'ACTIVE',
    plan: 'PRO',
    createdAt: '2026-06-17T00:00:00Z',
  };

  it('shows delete demo action only for demo tenants', () => {
    const onToggleSuspend = jest.fn();

    const { rerender } = render(
      <TenantActions
        tenant={{ ...baseTenant, isDemo: true }}
        onToggleSuspend={onToggleSuspend}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Eliminar datos de prueba de Tenant Demo' })
    ).toBeTruthy();

    rerender(
      <TenantActions
        tenant={{ ...baseTenant, isDemo: false }}
        onToggleSuspend={onToggleSuspend}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Eliminar datos de prueba de Tenant Demo' })
    ).toBeNull();
  });

  it('opens confirmation modal and confirms demo delete', async () => {
    const onToggleSuspend = jest.fn();
    const onDeleteDemo = jest.fn().mockResolvedValue(undefined);

    render(
      <TenantActions
        tenant={{ ...baseTenant, isDemo: true }}
        onToggleSuspend={onToggleSuspend}
        onDeleteDemo={onDeleteDemo}
      />
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Eliminar datos de prueba de Tenant Demo' })
      );
    });

    expect(screen.getByRole('heading', { name: 'Eliminar datos de prueba' })).toBeTruthy();
    expect(screen.getByText(/datos de demo/i)).toBeTruthy();

    const deleteButtons = screen.getAllByRole('button', { name: 'Sí, eliminar datos de prueba' });
    await act(async () => {
      fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    });

    expect(onDeleteDemo).toHaveBeenCalledWith(expect.objectContaining({ id: 'tenant-1' }));
    await act(async () => {
      await Promise.resolve();
    });
  });
});
