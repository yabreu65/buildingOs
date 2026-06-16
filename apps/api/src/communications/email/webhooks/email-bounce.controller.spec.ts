/**
 * Tests for EmailBounceController
 * Task 3.5: Processes bounce notifications and marks emails
 */

import { EmailBounceController } from './email-bounce.controller';

describe('EmailBounceController', () => {
  let controller: EmailBounceController;
  let mockTrackingService: any;

  beforeEach(() => {
    mockTrackingService = {
      markBounced: jest.fn(),
      getByMessageId: jest.fn(),
    };
    controller = new EmailBounceController(mockTrackingService);
  });

  it('processes a bounce and marks email as bounced', async () => {
    mockTrackingService.getByMessageId.mockResolvedValue({ id: 'del-1', status: 'sent', provider: 'resend' });
    mockTrackingService.markBounced.mockResolvedValue(undefined);

    const result = await controller.handleBounce({
      messageId: 'msg-123',
      recipient: 'user@example.com',
      reason: 'mailbox full',
    });

    expect(result.status).toBe('bounced');
    expect(mockTrackingService.markBounced).toHaveBeenCalledWith('del-1');
  });

  it('returns not_found when bounce has no matching delivery', async () => {
    mockTrackingService.getByMessageId.mockResolvedValue(null);

    const result = await controller.handleBounce({
      messageId: 'unknown-msg',
      recipient: 'unknown@example.com',
    });

    expect(result.status).toBe('not_found');
  });
});