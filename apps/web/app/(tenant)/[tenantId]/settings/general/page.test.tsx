/**
 * @jest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { useActiveTenantId } from '@/features/auth/useAuthSession';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { useTenantBranding, updateTenantBranding } from '@/features/tenancy/hooks/useTenantBranding';
import { useCanAdministerTenant } from '@/features/tenancy/hooks/useEffectiveRole';
import { useQueryClient } from '@tanstack/react-query';
import GeneralSettingsPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useActiveTenantId: jest.fn(),
}));

jest.mock('@/features/auth/useAuthorizedPortalContext', () => ({
  useAuthorizedPortalContext: jest.fn(),
}));

jest.mock('@/features/tenancy/tenant.hooks', () => ({
  useTenantId: jest.fn(),
}));

jest.mock('@/features/tenancy/hooks/useTenantBranding', () => ({
  useTenantBranding: jest.fn(),
  updateTenantBranding: jest.fn(),
}));

jest.mock('@/features/tenancy/hooks/useEffectiveRole', () => ({
  useCanAdministerTenant: jest.fn(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: jest.fn(),
}));

jest.mock('@/shared/components/ui/Card', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/shared/components/ui/Button', () => ({
  __esModule: true,
  default: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

const mockedUseRouter = jest.mocked(useRouter);
const mockedUseActiveTenantId = jest.mocked(useActiveTenantId);
const mockedUseAuthorizedPortalContext = jest.mocked(useAuthorizedPortalContext);
const mockedUseTenantId = jest.mocked(useTenantId);
const mockedUseTenantBranding = jest.mocked(useTenantBranding);
const mockedUpdateTenantBranding = jest.mocked(updateTenantBranding);
const mockedUseCanAdministerTenant = jest.mocked(useCanAdministerTenant);
const mockedUseQueryClient = jest.mocked(useQueryClient);

describe('GeneralSettingsPage', () => {
  const replace = jest.fn();
  const { QueryClient: RealQueryClient } = jest.requireActual<
    typeof import('@tanstack/react-query')
  >('@tanstack/react-query');
  const queryClient = new RealQueryClient();
  const invalidateQueriesSpy = jest.spyOn(queryClient, 'invalidateQueries');
  const routerMock = {
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn().mockResolvedValue(undefined),
    push: jest.fn(),
    refresh: jest.fn(),
    replace,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseRouter.mockReturnValue(routerMock);
    mockedUseActiveTenantId.mockReturnValue('tenant-1');
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');
    mockedUseTenantId.mockReturnValue('tenant-1');
    mockedUseTenantBranding.mockReturnValue({
      branding: {
        tenantId: 'tenant-1',
        tenantName: 'Tenant 1',
        currency: 'ARS',
      },
      isLoading: false,
      error: null,
      currency: 'ARS',
      locale: 'es-AR',
    });
    mockedUseCanAdministerTenant.mockReturnValue(true);
    mockedUseQueryClient.mockReturnValue(queryClient);
    mockedUpdateTenantBranding.mockResolvedValue({
      tenantId: 'tenant-1',
      tenantName: 'Tenant 1',
      currency: 'USD',
      locale: 'es-AR',
    });
  });

  it('keeps the form hidden while the portal context is unresolved', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue(null);

    render(<GeneralSettingsPage />);

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'common.save' })).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects resident portal users to the resident dashboard and never shows the form', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');
    mockedUseCanAdministerTenant.mockReturnValue(false);

    render(<GeneralSettingsPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/resident/dashboard');
    });

    expect(screen.queryByRole('button', { name: 'common.save' })).toBeNull();
    expect(screen.queryByText('settings.general')).toBeNull();
  });

  it('shows the access denied pattern for an admin portal user without branding capability', () => {
    mockedUseCanAdministerTenant.mockReturnValue(false);

    render(<GeneralSettingsPage />);

    expect(screen.getByText('No tenés permiso para editar el branding del tenant.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'common.save' })).toBeNull();
  });

  it('renders the general settings form for an authorized admin and saves changes', async () => {
    render(<GeneralSettingsPage />);

    expect(mockedUseTenantBranding).toHaveBeenLastCalledWith('tenant-1');
    expect(screen.getByText('settings.general')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /settings\.currencyUSD/ }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockedUpdateTenantBranding).toHaveBeenCalledWith('tenant-1', { currency: 'USD' });
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['tenantBranding', 'tenant-1'] });
  });

  it('does not treat a 403 API response as success', async () => {
    mockedUpdateTenantBranding.mockRejectedValueOnce(new Error('403 Forbidden'));

    render(<GeneralSettingsPage />);

    fireEvent.click(screen.getByRole('radio', { name: /settings\.currencyUSD/ }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(screen.getByText('403 Forbidden')).not.toBeNull();
    });

    expect(invalidateQueriesSpy).not.toHaveBeenCalled();
  });

  it('shows an error when the branding query fails', () => {
    mockedUseTenantBranding.mockReturnValue({
      branding: undefined,
      isLoading: false,
      error: new Error('Branding load failed'),
      currency: 'ARS',
      locale: 'es-AR',
    });

    render(<GeneralSettingsPage />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Branding load failed');
  });

  it('reevaluates the portal and branding capability when the tenant changes', () => {
    const { rerender } = render(<GeneralSettingsPage />);

    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeNull();

    mockedUseTenantId.mockReturnValue('tenant-2');
    mockedUseActiveTenantId.mockReturnValue('tenant-2');
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');
    mockedUseCanAdministerTenant.mockReturnValue(false);
    mockedUseTenantBranding.mockReturnValue({
      branding: {
        tenantId: 'tenant-2',
        tenantName: 'Tenant 2',
        currency: 'VES',
      },
      isLoading: false,
      error: null,
      currency: 'VES',
      locale: 'es-VE',
    });

    rerender(<GeneralSettingsPage />);

    expect(mockedUseAuthorizedPortalContext).toHaveBeenLastCalledWith('tenant-2');
    expect(mockedUseCanAdministerTenant).toHaveBeenLastCalledWith('tenant-2');
    expect(mockedUseTenantBranding).toHaveBeenCalledTimes(1);
    expect(mockedUseTenantBranding).toHaveBeenCalledWith('tenant-1');
    expect(screen.getByText('No tenés permiso para editar el branding del tenant.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'common.save' })).toBeNull();
  });

  it('redirects to the active tenant settings page when the route tenant is stale', async () => {
    mockedUseTenantId.mockReturnValue('tenant-1');
    mockedUseActiveTenantId.mockReturnValue('tenant-2');
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');
    mockedUseCanAdministerTenant.mockReturnValue(true);

    render(<GeneralSettingsPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-2/settings/general');
    });
  });
});
