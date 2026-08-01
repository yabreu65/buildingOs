/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import ResidentLayout from './layout';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  usePathname: jest.fn(),
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('@/features/auth/useAuthorizedPortalContext', () => ({
  useAuthorizedPortalContext: jest.fn(),
}));

jest.mock('@/features/resident/components/ResidentContextSwitcher', () => ({
  ResidentContextSwitcher: ({ tenantId }: { tenantId: string }) => (
    <div data-testid="resident-context-switcher">{tenantId}</div>
  ),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUsePathname = jest.mocked(usePathname);
const mockedUseRouter = jest.mocked(useRouter);
const mockedUseSearchParams = jest.mocked(useSearchParams);
const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedUseAuthorizedPortalContext = jest.mocked(useAuthorizedPortalContext);

function renderLayout(children: React.ReactNode = <div data-testid="page">Contenido</div>) {
  return render(<ResidentLayout>{children}</ResidentLayout>);
}

describe('ResidentLayout', () => {
  beforeEach(() => {
    replace.mockReset();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUsePathname.mockReturnValue('/tenant-1/resident/dashboard' as never);
    mockedUseSearchParams.mockReturnValue(new URLSearchParams('') as never);
    mockedUseRouter.mockReturnValue({ replace } as never);
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident User' },
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
      activeTenantId: 'tenant-1',
    } as never);
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');
  });

  it('authorizes against the tenantId from the route and renders the resident portal', () => {
    renderLayout();

    expect(mockedUseAuthorizedPortalContext).toHaveBeenCalledWith('tenant-1');
    expect(screen.getByTestId('resident-context-switcher').textContent).toBe('tenant-1');
    expect(screen.getByTestId('page').textContent).toBe('Contenido');
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps a valid resident route open even when activeTenantId points elsewhere', () => {
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident User' },
      memberships: [
        { tenantId: 'tenant-1', roles: ['RESIDENT'] },
        { tenantId: 'tenant-2', roles: ['TENANT_ADMIN'] },
      ],
      activeTenantId: 'tenant-2',
    } as never);

    renderLayout();

    expect(screen.getByTestId('resident-context-switcher').textContent).toBe('tenant-1');
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects admin-only access away from the resident portal', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');

    renderLayout();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/dashboard');
    });
  });

  it('treats a mixed-role user as resident when the authorized portal context resolves to resident', () => {
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident Admin' },
      memberships: [
        { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
        { tenantId: 'tenant-2', roles: ['TENANT_ADMIN'] },
      ],
      activeTenantId: 'tenant-2',
    } as never);
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');

    renderLayout();

    expect(screen.getByTestId('resident-context-switcher').textContent).toBe('tenant-1');
    expect(replace).not.toHaveBeenCalled();
  });

  it('rejects a route when the authorized portal context is missing for the tenant', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue(null);

    renderLayout();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/dashboard');
    });
  });
});
