import { apiClient } from '@/shared/lib/http/client';
import { resendLeadInvitation } from './leads.api';

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
});
