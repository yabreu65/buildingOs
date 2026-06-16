/**
 * E2E Email Integration Test
 * Task 5.2: send→EmailDelivery queued record created
 */

import { NoOpAdapter } from '../adapters/noop.adapter';
import { EmailRetryInterceptor } from '../email-retry.interceptor';
import { SendEmailInput } from '../interfaces/email-provider.interface';

describe('E2E Email Flow', () => {
  it('NoOp adapter succeeds without sending and returns an ID', async () => {
    const adapter = new NoOpAdapter();
    const input: SendEmailInput = {
      to: 'user@example.com',
      subject: 'E2E Test Email',
      htmlBody: '<p>Hello E2E</p>',
      tenantId: 'tenant-e2e',
    };

    const result = await adapter.send(input);

    expect(result.success).toBe(true);
    expect(result.externalId).toContain('noop-');
  });

  it('NoOp adapter returns skipped status for delivery tracking', async () => {
    const adapter = new NoOpAdapter();
    const status = await adapter.getDeliveryStatus('noop-123');

    expect(status.status).toBe('skipped');
    expect(status.provider).toBe('noop');
  });

  it('Retry interceptor succeeds on first try with NoOp', async () => {
    const adapter = new NoOpAdapter();
    const interceptor = new EmailRetryInterceptor();

    const result = await interceptor.sendWithRetry(adapter, {
      to: 'user@example.com',
      subject: 'Retry Test',
      htmlBody: '<p>Test</p>',
    });

    expect(result.success).toBe(true);
  });
});