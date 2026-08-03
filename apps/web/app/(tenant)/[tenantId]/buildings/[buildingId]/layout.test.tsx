/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import BuildingAdminLayout from './layout';

const replace = jest.fn();

let mockTenantId = 'tenant-1';
let mockBuildingId = 'building-1';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock('@/features/auth/useAuthorizedPortalContext', () => ({
  useAuthorizedPortalContext: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseRouter = jest.mocked(useRouter);
const mockedUseAuthorizedPortalContext = jest.mocked(useAuthorizedPortalContext);

function renderLayout(children: React.ReactNode = <div data-testid="admin-content">Admin content</div>) {
  return render(<BuildingAdminLayout>{children}</BuildingAdminLayout>);
}

describe('BuildingAdminLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTenantId = 'tenant-1';
    mockBuildingId = 'building-1';
    mockedUseParams.mockReturnValue({ tenantId: mockTenantId, buildingId: mockBuildingId } as never);
    mockedUseRouter.mockReturnValue({ replace } as never);
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');
  });

  it('does not render children while the portal context resolves', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue(null);

    renderLayout();

    expect(screen.queryByTestId('admin-content')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects resident users to the resident dashboard', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');

    renderLayout();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/resident/dashboard');
    });
    expect(screen.queryByTestId('admin-content')).toBeNull();
  });

  it('never shows administrative content to resident users', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');

    renderLayout(<div data-testid="deep-route">Deep admin route</div>);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/resident/dashboard');
    });

    expect(screen.queryByTestId('deep-route')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('renders children for administrative portal access', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');

    renderLayout();

    expect(screen.getByTestId('admin-content').textContent).toBe('Admin content');
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects mixed-role users when the authorized portal resolves to resident', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');

    renderLayout();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/resident/dashboard');
    });
  });

  it('renders mixed-role users when the authorized portal resolves to admin', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');

    renderLayout();

    expect(screen.getByTestId('admin-content')).not.toBeNull();
  });

  it('re-evaluates access when the tenant changes', () => {
    const { rerender } = renderLayout();

    expect(mockedUseAuthorizedPortalContext).toHaveBeenLastCalledWith('tenant-1');

    mockTenantId = 'tenant-2';
    mockBuildingId = 'building-2';
    mockedUseParams.mockReturnValue({ tenantId: mockTenantId, buildingId: mockBuildingId } as never);

    rerender(
      <BuildingAdminLayout>
        <div data-testid="admin-content">Admin content</div>
      </BuildingAdminLayout>,
    );

    expect(mockedUseAuthorizedPortalContext).toHaveBeenLastCalledWith('tenant-2');
  });

  it('keeps deep administrative routes protected by the same layout gate', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue(null);

    renderLayout(<div data-testid="deep-route">Deep administrative route</div>);

    expect(screen.queryByTestId('deep-route')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
