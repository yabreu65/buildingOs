/**
 * Tests for IdempotencyService
 * Task 2.6: Redis SETNX + DB fallback for webhook deduplication
 */

import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mockRedis: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
    };
    mockPrisma = {
      processedWebhookEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    service = new IdempotencyService(mockRedis, mockPrisma);
  });

  describe('isProcessed', () => {
    it('returns true when Redis key exists (fast path)', async () => {
      mockRedis.get.mockResolvedValue('1');

      const result = await service.isProcessed('evt-1', 'mercadopago');
      expect(result).toBe(true);
    });

    it('checks DB when Redis key missing and finds existing event', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.processedWebhookEvent.findUnique.mockResolvedValue({ id: 'db-1' });

      const result = await service.isProcessed('evt-2', 'stripe');
      expect(result).toBe(true);
    });

    it('returns false when event not found in Redis or DB', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.processedWebhookEvent.findUnique.mockResolvedValue(null);

      const result = await service.isProcessed('evt-3', 'mercadopago');
      expect(result).toBe(false);
    });
  });

  describe('markProcessed', () => {
    it('sets Redis key with TTL and creates DB record', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockPrisma.processedWebhookEvent.create.mockResolvedValue({ id: 'db-1' });

      await service.markProcessed('evt-1', 'mercadopago');

      // Redis key should be set with 72h TTL (259200 seconds)
      expect(mockRedis.set).toHaveBeenCalledWith(
        'webhook:mercadopago:evt-1',
        '1',
        259200,
      );
      expect(mockPrisma.processedWebhookEvent.create).toHaveBeenCalledWith({
        data: { eventId: 'evt-1', provider: 'mercadopago' },
      });
    });
  });
});