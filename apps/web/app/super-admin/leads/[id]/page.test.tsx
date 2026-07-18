import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LeadDetailPage from './page';
import { listConversionBillingPlans } from '@/features/super-admin/leads/leads.api';
import { useLeads } from '@/features/super-admin/leads/useLeads';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'lead-1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock('@/features/super-admin/leads/leads.api', () => ({
  listConversionBillingPlans: jest.fn(),
}));

jest.mock('@/features/super-admin/leads/useLeads', () => ({
  useLeads: jest.fn(),
}));

const mockedListConversionBillingPlans = jest.mocked(listConversionBillingPlans);
const mockedUseLeads = jest.mocked(useLeads);

describe('LeadDetailPage', () => {
  it('sends the selected persisted plan id when converting a lead', async () => {
    const convert = jest.fn().mockResolvedValue({
      tenantId: 'tenant-1',
      ownerUserId: 'user-1',
      inviteSent: true,
      invitationEmailStatus: 'SENT',
      plan: 'PRO',
      subscriptionStatus: 'TRIAL',
      trialEndDate: '2026-08-01T00:00:00.000Z',
    });
    const fetchLead = jest.fn().mockResolvedValue({
      id: 'lead-1',
      fullName: 'Owner Example',
      email: 'owner@example.com',
      tenantType: 'ADMINISTRADORA',
      status: 'NEW',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    mockedUseLeads.mockReturnValue({
      fetchLead,
      update: jest.fn(),
      convert,
      resendInvitation: jest.fn(),
    } as unknown as ReturnType<typeof useLeads>);
    mockedListConversionBillingPlans.mockResolvedValue([
      { id: 'plan-pro-id', planId: 'PRO', name: 'Professional', monthlyPrice: 2900 },
    ]);

    render(<LeadDetailPage />);

    await screen.findByRole('heading', { name: 'Owner Example' });
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));
    fireEvent.change(screen.getByLabelText(/nombre del inquilino/i), { target: { value: 'Example Building' } });
    fireEvent.change(screen.getByLabelText('Plan *'), { target: { value: 'plan-pro-id' } });
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => expect(convert).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({ planId: 'plan-pro-id' }),
    ));
    expect(await screen.findByText(/plan PRO/i)).toBeTruthy();
  });
});
