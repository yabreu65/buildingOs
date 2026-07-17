import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreateTenantPage from './page';
import { createTenant } from '@/features/super-admin/tenants.api';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/features/super-admin/tenants.api', () => ({ createTenant: jest.fn() }));
const mockedCreateTenant = jest.mocked(createTenant);

describe('CreateTenantPage', () => {
  it('creates through the API and redirects to the real detail page', async () => {
    mockedCreateTenant.mockResolvedValue({ id: 'tenant-nuevo', name: 'Administración Nueva' } as Awaited<ReturnType<typeof createTenant>>);
    render(<CreateTenantPage />);
    fireEvent.change(screen.getByLabelText('Nombre del Tenant *'), { target: { value: 'Administración Nueva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear Tenant' }));
    await waitFor(() => expect(mockedCreateTenant).toHaveBeenCalledWith({ name: 'Administración Nueva', type: 'ADMINISTRADORA', plan: 'FREE', planId: 'FREE' }));
    expect(push).toHaveBeenCalledWith('/super-admin/tenants/tenant-nuevo');
  });

  it('does not call the API for an invalid form', async () => {
    render(<CreateTenantPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(mockedCreateTenant).not.toHaveBeenCalled();
  });
});
