import { render, screen } from '@testing-library/react';
import { useParams } from 'next/navigation';
import TenantDetailPage from './page';
import { getTenant } from '@/features/super-admin/tenants.api';

jest.mock('next/navigation', () => ({ useParams: jest.fn() }));
jest.mock('@/features/super-admin/tenants.api', () => ({ getTenant: jest.fn() }));
jest.mock('@/features/billing/components/SubscriptionPanel', () => () => <div>Suscripción</div>);
jest.mock('@/features/demo-seed/DemoSeedWizard', () => ({ DemoSeedWizard: () => <div>Demo</div> }));
const mockedGetTenant = jest.mocked(getTenant);
const mockedUseParams = jest.mocked(useParams);

describe('TenantDetailPage', () => {
  beforeEach(() => {
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-001' });
  });

  it('loads only the requested tenant from the API', async () => {
    mockedGetTenant.mockResolvedValue({ id: 'tenant-001', name: 'Administración API', type: 'ADMINISTRADORA', isDemo: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', subscription: { planId: 'PRO', status: 'ACTIVE' } });
    render(<TenantDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Administración API' })).toBeTruthy();
    expect(mockedGetTenant).toHaveBeenCalledWith('tenant-001');
  });

  it('shows the existing not-found state when the API rejects', async () => {
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-404' });
    mockedGetTenant.mockRejectedValue(new Error('Not found'));
    render(<TenantDetailPage />);
    expect(await screen.findByText('Administradora no encontrada')).toBeTruthy();
  });

  it('does not request the API when the route has no tenant ID', async () => {
    mockedUseParams.mockReturnValue({});
    render(<TenantDetailPage />);
    expect(await screen.findByText('Administradora no encontrada')).toBeTruthy();
    expect(screen.getByText(/\(sin ID\)/)).toBeTruthy();
    expect(mockedGetTenant).not.toHaveBeenCalled();
  });
});
