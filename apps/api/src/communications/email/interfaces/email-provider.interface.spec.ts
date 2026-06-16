/**
 * Tests for EmailProvider interface
 * Task 1.4: Verify interface contract is properly exported
 */

import {
  EmailProvider,
  SendEmailInput,
  SendResult,
  DeliveryStatus,
  DeliveryStatusResult,
  EMAIL_PROVIDER_TOKEN,
} from './email-provider.interface';

describe('EmailProvider Interface', () => {
  it('exports the EMAIL_PROVIDER_TOKEN constant', () => {
    expect(EMAIL_PROVIDER_TOKEN).toBe('EMAIL_PROVIDER');
  });

  it('allows implementing the interface with all required methods', () => {
    const mockProvider: EmailProvider = {
      send: jest.fn(),
      getDeliveryStatus: jest.fn(),
      handleBounce: jest.fn(),
    };

    expect(mockProvider.send).toBeDefined();
    expect(mockProvider.getDeliveryStatus).toBeDefined();
    expect(mockProvider.handleBounce).toBeDefined();
  });

  it('SendEmailInput accepts required fields', () => {
    const input: SendEmailInput = {
      to: 'user@example.com',
      subject: 'Test email',
      htmlBody: '<p>Hello</p>',
    };

    expect(input.to).toBe('user@example.com');
    expect(input.htmlBody).toBe('<p>Hello</p>');
  });

  it('SendResult has success and optional fields', () => {
    const successResult: SendResult = { success: true, externalId: 'ext-123' };
    const failResult: SendResult = { success: false, error: 'Failed' };

    expect(successResult.success).toBe(true);
    expect(failResult.success).toBe(false);
  });

  it('DeliveryStatus has expected values', () => {
    const statuses: DeliveryStatus[] = ['queued', 'sent', 'delivered', 'bounced', 'failed', 'skipped'];
    expect(statuses).toHaveLength(6);
    expect(statuses).toContain('queued');
    expect(statuses).toContain('skipped');
  });

  it('DeliveryStatusResult has required fields', () => {
    const result: DeliveryStatusResult = {
      messageId: 'msg-123',
      status: 'delivered',
      provider: 'resend',
      updatedAt: new Date(),
    };

    expect(result.messageId).toBe('msg-123');
    expect(result.provider).toBe('resend');
  });
});