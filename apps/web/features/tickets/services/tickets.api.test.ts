/**
 * @jest-environment jsdom
 */

import * as httpClient from '@/shared/lib/http/client';
import { getTicketByTenant } from './tickets.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      public statusText: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const mockedApiClient = jest.mocked(httpClient.apiClient);

describe('tickets.api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls the canonical tenant-scoped endpoint', async () => {
    mockedApiClient.mockResolvedValue({ id: 'ticket-1' } as never);

    await expect(getTicketByTenant('tenant-1', 'ticket-1')).resolves.toEqual({ id: 'ticket-1' });
    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/tickets/ticket-1',
      method: 'GET',
    });
  });
});
