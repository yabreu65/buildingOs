/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { useActiveTenantId } from '@/features/auth/useAuthSession';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import { useCanAdministerTenant } from '@/features/tenancy/hooks/useEffectiveRole';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import BankingPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useActiveTenantId: jest.fn(),
}));

jest.mock('@/features/auth/useAuthorizedPortalContext', () => ({
  useAuthorizedPortalContext: jest.fn(),
}));

jest.mock('@/features/tenancy/hooks/useEffectiveRole', () => ({
  useCanAdministerTenant: jest.fn(),
}));

jest.mock('@/features/tenancy/tenant.hooks', () => ({
  useTenantId: jest.fn(),
}));

jest.mock('@/features/banking/banking.ui', () => ({
  __esModule: true,
  default: ({ tenantId }: { tenantId: string }) => (
    <div data-testid="banking-ui">{tenantId}</div>
  ),
}));

const mockedUseRouter = jest.mocked(useRouter);
const mockedUseActiveTenantId = jest.mocked(useActiveTenantId);
const mockedUseAuthorizedPortalContext = jest.mocked(useAuthorizedPortalContext);
const mockedUseCanAdministerTenant = jest.mocked(useCanAdministerTenant);
const mockedUseTenantId = jest.mocked(useTenantId);

describe('BankingPage', () => {
  const replace = jest.fn();
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
    mockedUseCanAdministerTenant.mockReturnValue(true);
    mockedUseTenantId.mockReturnValue('tenant-1');
  });

  it('keeps a neutral loader while the portal context is unresolved', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue(null);

    render(<BankingPage />);

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId('banking-ui')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects resident portal users to the resident dashboard without mounting the editor', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');
    mockedUseCanAdministerTenant.mockReturnValue(false);

    render(<BankingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/resident/dashboard');
    });

    expect(screen.queryByTestId('banking-ui')).toBeNull();
    expect(screen.queryByText('Nueva Cuenta')).toBeNull();
  });

  it('renders the editor for tenant owners', () => {
    mockedUseCanAdministerTenant.mockReturnValue(true);

    render(<BankingPage />);

    expect(mockedUseCanAdministerTenant).toHaveBeenLastCalledWith('tenant-1');
    expect(screen.getByTestId('banking-ui').textContent).toBe('tenant-1');
  });

  it('renders the editor for tenant admins', () => {
    mockedUseCanAdministerTenant.mockReturnValue(true);

    render(<BankingPage />);

    expect(screen.getByTestId('banking-ui')).not.toBeNull();
  });

  it('shows the access denied state for an unauthorized portal admin', () => {
    mockedUseCanAdministerTenant.mockReturnValue(false);

    render(<BankingPage />);

    expect(screen.getByText('No tenés permiso para editar las cuentas bancarias.')).not.toBeNull();
    expect(screen.queryByTestId('banking-ui')).toBeNull();
  });

  it('redirects mixed-role users when the portal resolves to resident', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');
    mockedUseCanAdministerTenant.mockReturnValue(true);

    render(<BankingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/resident/dashboard');
    });

    expect(screen.queryByTestId('banking-ui')).toBeNull();
  });

  it('renders mixed-role users when the portal resolves to admin', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');
    mockedUseCanAdministerTenant.mockReturnValue(true);

    render(<BankingPage />);

    expect(screen.getByTestId('banking-ui').textContent).toBe('tenant-1');
  });

  it('redirects a stale route tenant to the active tenant settings page', async () => {
    mockedUseActiveTenantId.mockReturnValue('tenant-2');
    mockedUseTenantId.mockReturnValue('tenant-1');
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');

    render(<BankingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-2/settings/banking');
    });

    expect(screen.queryByTestId('banking-ui')).toBeNull();
  });

  it('unmounts the tenant A editor before showing tenant B resident access', async () => {
    const { rerender } = render(<BankingPage />);

    expect(screen.getByTestId('banking-ui').textContent).toBe('tenant-1');

    mockedUseActiveTenantId.mockReturnValue('tenant-2');
    mockedUseTenantId.mockReturnValue('tenant-2');
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');
    mockedUseCanAdministerTenant.mockReturnValue(false);

    rerender(<BankingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-2/resident/dashboard');
    });

    expect(screen.queryByTestId('banking-ui')).toBeNull();
  });

  it('remounts the editor when switching from tenant A to tenant B admin access', () => {
    const { rerender } = render(<BankingPage />);

    expect(screen.getByTestId('banking-ui').textContent).toBe('tenant-1');

    mockedUseActiveTenantId.mockReturnValue('tenant-2');
    mockedUseTenantId.mockReturnValue('tenant-2');
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');
    mockedUseCanAdministerTenant.mockReturnValue(true);

    rerender(<BankingPage />);

    expect(screen.getByTestId('banking-ui').textContent).toBe('tenant-2');
  });

  it('never mounts the editor before the portal and tenant are resolved', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue(null);

    render(<BankingPage />);

    expect(screen.queryByTestId('banking-ui')).toBeNull();
    expect(screen.queryByText('Cuentas bancarias')).toBeNull();
  });
});
