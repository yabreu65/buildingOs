import { ConversationContextService } from './conversation-context.service';

describe('ConversationContextService', () => {
  let service: ConversationContextService;
  const fixedDate = new Date('2026-05-12T10:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers({ advanceTime: true });
    jest.setSystemTime(fixedDate);
    service = new ConversationContextService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('storeTurn', () => {
    it('stores a turn for a session', async () => {
      const turn = {
        role: 'user' as const,
        message: '¿Cuánto debe A-0101?',
        timestamp: new Date(),
      };

      await service.storeTurn('session-1', turn);

      const context = await service.getContext('session-1');
      expect(context).toHaveLength(1);
      expect(context[0]!.message).toBe('¿Cuánto debe A-0101?');
    });

    it('stores multiple turns, keeping only last N', async () => {
      const turns = [
        { role: 'user' as const, message: 'Turn 1', timestamp: new Date() },
        { role: 'user' as const, message: 'Turn 2', timestamp: new Date() },
        { role: 'user' as const, message: 'Turn 3', timestamp: new Date() },
        { role: 'user' as const, message: 'Turn 4', timestamp: new Date() },
        { role: 'user' as const, message: 'Turn 5', timestamp: new Date() },
      ];

      for (const turn of turns) {
        await service.storeTurn('session-1', turn);
      }

      const context = await service.getContext('session-1');
      expect(context).toHaveLength(5);
      expect(context[context.length - 1]!.message).toBe('Turn 5');
    });

    it('respects max turns limit', async () => {
      // Create service with max 3 turns
      const service3 = new ConversationContextService(3);

      const turns = [
        { role: 'user' as const, message: 'Turn 1', timestamp: new Date() },
        { role: 'user' as const, message: 'Turn 2', timestamp: new Date() },
        { role: 'user' as const, message: 'Turn 3', timestamp: new Date() },
        { role: 'user' as const, message: 'Turn 4', timestamp: new Date() },
        { role: 'user' as const, message: 'Turn 5', timestamp: new Date() },
      ];

      for (const turn of turns) {
        await service3.storeTurn('session-1', turn);
      }

      const context = await service3.getContext('session-1');
      expect(context).toHaveLength(3);
      expect(context[0]!.message).toBe('Turn 3');
      expect(context[1]!.message).toBe('Turn 4');
      expect(context[2]!.message).toBe('Turn 5');
    });

    it('stores last resolved entities', async () => {
      const turn = {
        role: 'user' as const,
        message: '¿Cuánto debe A-0101?',
        timestamp: new Date(),
        resolvedEntities: {
          building: { id: 'b1', name: 'Torre A', alias: 'A' },
          unit: { id: 'u1', code: '0101', buildingId: 'b1' },
          alternatives: [],
        },
      };

      await service.storeTurn('session-1', turn);

      const lastResolved = await service.getLastResolved('session-1');
      expect(lastResolved.buildingId).toBe('b1');
      expect(lastResolved.unitId).toBe('u1');
    });
  });

  describe('getContext', () => {
    it('returns empty array for unknown session', async () => {
      const context = await service.getContext('unknown-session');
      expect(context).toEqual([]);
    });

    it('returns turns for known session', async () => {
      await service.storeTurn('session-1', {
        role: 'user',
        message: 'Test message',
        timestamp: new Date(),
      });

      const context = await service.getContext('session-1');
      expect(context).toHaveLength(1);
    });
  });

  describe('TTL expiration', () => {
    it('expires entries after TTL', async () => {
      // Create service with 30 minute TTL
      const ttlService = new ConversationContextService(5, 30 * 60 * 1000);

      await ttlService.storeTurn('session-1', {
        role: 'user',
        message: 'Test',
        timestamp: new Date(),
      });

      // Advance time past TTL (31 minutes)
      jest.advanceTimersByTime(31 * 60 * 1000);

      const context = await ttlService.getContext('session-1');
      expect(context).toEqual([]);
    });

    it('does not expire before TTL', async () => {
      const ttlService = new ConversationContextService(5, 30 * 60 * 1000);

      await ttlService.storeTurn('session-1', {
        role: 'user',
        message: 'Test',
        timestamp: new Date(),
      });

      // Advance time by 29 minutes (before TTL)
      jest.advanceTimersByTime(29 * 60 * 1000);

      const context = await ttlService.getContext('session-1');
      expect(context).toHaveLength(1);
    });
  });

  describe('resolveAnaphora', () => {
    it('returns original message when no context', async () => {
      const result = await service.resolveAnaphora('unknown-session', '¿Cuánto debe?');

      expect(result).toBe('¿Cuánto debe?');
    });

    it('returns original message when no anaphora detected', async () => {
      await service.storeTurn('session-1', {
        role: 'user',
        message: 'Hello',
        timestamp: new Date(),
      });

      const result = await service.resolveAnaphora('session-1', '¿Cuánto debe A-0101?');

      expect(result).toBe('¿Cuánto debe A-0101?');
    });
  });

  describe('cleanExpired', () => {
    it('removes expired entries', async () => {
      const ttlService = new ConversationContextService(5, 30 * 60 * 1000);

      // Store session-1 at T=0
      await ttlService.storeTurn('session-1', {
        role: 'user',
        message: 'Test 1',
        timestamp: new Date(),
      });

      // Advance time by 31 minutes (session-1 will be expired)
      jest.advanceTimersByTime(31 * 60 * 1000);

      // Store session-2 at T+31min (will expire at T+61min)
      await ttlService.storeTurn('session-2', {
        role: 'user',
        message: 'Test 2',
        timestamp: new Date(),
      });

      // Manually trigger cleanup - should only remove session-1
      await ttlService.cleanExpired();

      const context1 = await ttlService.getContext('session-1');
      const context2 = await ttlService.getContext('session-2');

      expect(context1).toEqual([]);
      expect(context2).toHaveLength(1);
    });
  });
});
