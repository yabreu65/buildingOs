import { apiClient } from '@/shared/lib/http/client';
import { convertLead, listConversionBillingPlans, resendLeadInvitation } from './leads.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);

describe('lead API', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it('resends a converted lead owner invitation through the protected lead endpoint', async () => {
    mockedApiClient.mockResolvedValue({ invitationEmailStatus: 'SENT' });

    await resendLeadInvitation('lead-1');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/leads/admin/lead-1/resend-invitation',
      method: 'POST',
    });
  });

  it('sends the selected persisted billing plan id when converting a lead', async () => {
    mockedApiClient.mockResolvedValue({} as Awaited<ReturnType<typeof convertLead>>);

    await convertLead('lead-1', {
      tenantName: 'Example Building',
      planId: 'billing-plan-pro-id',
    });

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/leads/admin/lead-1/convert',
      method: 'POST',
      body: {
        tenantName: 'Example Building',
        planId: 'billing-plan-pro-id',
      },
    });
  });

  it('loads persisted billing plans for the conversion selector', async () => {
    mockedApiClient.mockResolvedValue([]);

    await listConversionBillingPlans();

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/leads/admin/billing-plans',
      method: 'GET',
    });
  });
});
