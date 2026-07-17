import { render, screen } from '@testing-library/react';
import OverviewPage from './page';
import { listTenants } from '@/features/super-admin/tenants.api';

jest.mock('@/features/super-admin/tenants.api', () => ({ listTenants: jest.fn() }));
const mockedListTenants = jest.mocked(listTenants);

describe('OverviewPage', () => {
  it('calculates metrics from API data', async () => {
    mockedListTenants.mockResolvedValue({ total: 3, data: [
      { id: '1', name: 'A', type: 'ADMINISTRADORA', isDemo: false, createdAt: '', updatedAt: '', subscription: { planId: 'FREE', status: 'ACTIVE' } },
      { id: '2', name: 'B', type: 'ADMINISTRADORA', isDemo: false, createdAt: '', updatedAt: '', subscription: { planId: 'FREE', status: 'TRIAL' } },
      { id: '3', name: 'C', type: 'ADMINISTRADORA', isDemo: false, createdAt: '', updatedAt: '', subscription: { planId: 'FREE', status: 'ACTIVE' } },
    ] });
    render(<OverviewPage />);
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Dato no disponible')).toBeTruthy();
  });

  it('does not invent metrics on API failure', async () => {
    mockedListTenants.mockRejectedValue(new Error('Sin conexión'));
    render(<OverviewPage />);
    expect(await screen.findAllByText('Dato no disponible')).toHaveLength(2);
  });
});
