/**
 * @jest-environment jsdom
 */

import * as httpClient from '@/shared/lib/http/client';
import { addComment, createTicket, getTicketByTenant } from './tickets.api';

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

  it('sends the resident portal context when creating a resident-origin ticket', async () => {
    mockedApiClient.mockResolvedValue({ id: 'ticket-2' } as never);

    await createTicket(
      'building-1',
      {
        title: 'Leak',
        description: 'Water leak',
        category: 'REPAIR',
      },
      'resident',
    );

    expect(mockedApiClient).toHaveBeenCalledWith(expect.objectContaining({
      path: '/buildings/building-1/tickets',
      method: 'POST',
      headers: { 'X-Portal-Context': 'resident' },
    }));
  });

  it('sends the admin portal context when adding an administrative comment', async () => {
    mockedApiClient.mockResolvedValue({ id: 'comment-1' } as never);

    await addComment(
      'building-1',
      'ticket-1',
      { body: 'Estamos revisando' },
      'admin',
    );

    expect(mockedApiClient).toHaveBeenCalledWith(expect.objectContaining({
      path: '/buildings/building-1/tickets/ticket-1/comments',
      method: 'POST',
      headers: { 'X-Portal-Context': 'admin' },
    }));
  });
});
