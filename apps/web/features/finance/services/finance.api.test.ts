/**
 * @jest-environment jsdom
 */

import * as httpClient from '@/shared/lib/http/client';
import { PaymentMethod, submitPayment } from './finance.api';

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

describe('finance.api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends the resident portal context when submitting a resident payment', async () => {
    mockedApiClient.mockResolvedValue({ id: 'payment-1' } as never);

    await submitPayment(
      'building-1',
      {
        unitId: 'unit-1',
        chargeId: 'charge-1',
        amount: 10000,
        method: PaymentMethod.TRANSFER,
        proofFileId: 'file-1',
      },
      'resident',
    );

    expect(mockedApiClient).toHaveBeenCalledWith(expect.objectContaining({
      path: '/buildings/building-1/payments',
      method: 'POST',
      headers: { 'X-Portal-Context': 'resident' },
    }));
  });

  it('does not add the portal header when no portal context is provided', async () => {
    mockedApiClient.mockResolvedValue({ id: 'payment-2' } as never);

    await submitPayment('building-1', {
      amount: 10000,
      method: PaymentMethod.TRANSFER,
      proofFileId: 'file-1',
    });

    expect(mockedApiClient).toHaveBeenCalledWith(expect.objectContaining({
      path: '/buildings/building-1/payments',
      method: 'POST',
    }));
    expect(mockedApiClient.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      headers: undefined,
    }));
  });
});
