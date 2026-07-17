import { render, screen, waitFor } from '@testing-library/react';
import TenantsPage from './page';
import { listTenants } from '@/features/super-admin/tenants.api';

jest.mock('@/features/super-admin/tenants.api', () => ({ listTenants: jest.fn(), deleteTenant: jest.fn() }));
jest.mock('@/features/super-admin/components/TenantActions', () => () => <span>Acciones</span>);

const mockedListTenants = jest.mocked(listTenants);

describe('TenantsPage', () => {
  it('renders API tenants and ignores stale local storage data', async () => {
    localStorage.setItem('super-admin-tenants', JSON.stringify([{ id: 'old', name: 'Dato local obsoleto' }]));
    mockedListTenants.mockResolvedValue({ total: 2, data: [
      { id: 'tenant-1', name: 'Administración Uno', type: 'ADMINISTRADORA', isDemo: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', subscription: { planId: 'PRO', status: 'ACTIVE' } },
      { id: 'tenant-2', name: 'Administración Dos', type: 'EDIFICIO_AUTOGESTION', isDemo: true, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', subscription: { planId: 'FREE', status: 'TRIAL' } },
    ] });
    render(<TenantsPage />);
    expect(await screen.findByText('Administración Uno')).toBeTruthy();
    expect(screen.getByText('Administración Dos')).toBeTruthy();
    expect(screen.queryByText('Dato local obsoleto')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Ver' })[0].getAttribute('href')).toBe('/super-admin/tenants/tenant-1');
    expect(mockedListTenants).toHaveBeenCalled();
  });

  it('renders empty and API error states', async () => {
    mockedListTenants.mockResolvedValueOnce({ total: 0, data: [] });
    const { unmount } = render(<TenantsPage />);
    expect(await screen.findByText('No hay administradoras cargadas')).toBeTruthy();
    unmount();
    mockedListTenants.mockRejectedValueOnce(new Error('Sin conexión'));
    render(<TenantsPage />);
    expect(await screen.findByText('Sin conexión')).toBeTruthy();
  });
});
