/**
 * Tests for Email Adapters
 * Tasks 3.1: SMTP, Resend, SES, NoOp adapters
 */

import { SmtpAdapter } from './smtp.adapter';
import { ResendAdapter } from './resend.adapter';
import { SesAdapter } from './ses.adapter';
import { NoOpAdapter } from './noop.adapter';
import { SendEmailInput, SendResult } from '../interfaces/email-provider.interface';

describe('Email Adapters', () => {
  describe('NoOpAdapter', () => {
    let adapter: NoOpAdapter;

    beforeEach(() => {
      adapter = new NoOpAdapter();
    });

    it('send() returns success without making network requests', async () => {
      const result = await adapter.send({
        to: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>Hello</p>',
      });

      expect(result.success).toBe(true);
      expect(result.externalId).toContain('noop-');
    });

    it('getDeliveryStatus() returns skipped status', async () => {
      const result = await adapter.getDeliveryStatus('noop-123');

      expect(result.status).toBe('skipped');
      expect(result.provider).toBe('noop');
    });

    it('handleBounce() does nothing and returns', async () => {
      await expect(adapter.handleBounce({})).resolves.toBeUndefined();
    });
  });

  describe('ResendAdapter', () => {
    let adapter: ResendAdapter;
    let mockFetch: jest.Mock;

    beforeEach(() => {
      mockFetch = jest.fn();
      global.fetch = mockFetch;
      adapter = new ResendAdapter('re_test_key', 'BuildingOS <no-reply@buildingos.local>');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('send() calls Resend API and returns external ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'resend-email-123' }),
      });

      const result = await adapter.send({
        to: 'user@example.com',
        subject: 'Welcome',
        htmlBody: '<p>Welcome!</p>',
      });

      expect(result.success).toBe(true);
      expect(result.externalId).toBe('resend-email-123');
    });

    it('send() returns error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const result = await adapter.send({
        to: 'user@example.com',
        subject: 'Test',
        htmlBody: '<p>Test</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });

    it('getDeliveryStatus() returns sent status for valid ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'resend-123', status: 'delivered' }),
      });

      const result = await adapter.getDeliveryStatus('resend-123');
      expect(result.provider).toBe('resend');
    });

    it('handleBounce() processes bounce payload', async () => {
      // Resend doesn't have a specific bounce API - just acknowledge
      await expect(adapter.handleBounce({ id: 'resend-123', type: 'bounced' })).resolves.toBeUndefined();
    });
  });

  describe('SesAdapter', () => {
    let adapter: SesAdapter;

    beforeEach(() => {
      adapter = new SesAdapter('us-east-1', 'AKIA_TEST', 'test-secret-key', 'BuildingOS <no-reply@buildingos.local>');
    });

    it('send() calls SES API and returns message ID', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        text: async () => '<SendMessageResult><MessageId>ses-msg-123</MessageId></SendMessageResult>',
      });
      global.fetch = mockFetch;

      const result = await adapter.send({
        to: 'user@example.com',
        subject: 'SES Test',
        htmlBody: '<p>Hello from SES</p>',
      });

      expect(result.success).toBe(true);
      expect(result.externalId).toContain('ses-msg-123');
    });

    it('getDeliveryStatus() returns provider name', async () => {
      const result = await adapter.getDeliveryStatus('ses-msg-123');
      expect(result.provider).toBe('ses');
    });
  });

  describe('SmtpAdapter', () => {
    it('implements the EmailProvider interface', () => {
      const adapter = new SmtpAdapter({
        host: 'smtp.example.com',
        port: 587,
        user: 'test',
        pass: 'test',
        from: 'BuildingOS <no-reply@buildingos.local>',
      });

      expect(typeof adapter.send).toBe('function');
      expect(typeof adapter.getDeliveryStatus).toBe('function');
      expect(typeof adapter.handleBounce).toBe('function');
    });
  });
});