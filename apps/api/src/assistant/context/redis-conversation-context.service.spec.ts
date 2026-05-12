import { RedisConversationContextService } from './redis-conversation-context.service';
import { RedisService } from '../../redis/redis.service';
import { ConversationTurn } from '../intent-engine/intent.types';

// Mock RedisService
const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  getClient: jest.fn(),
};

describe('RedisConversationContextService', () => {
  let service: RedisConversationContextService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RedisConversationContextService(mockRedisService as unknown as RedisService);
  });

  describe('storeTurn', () => {
    it('stores a turn in Redis with correct key', async () => {
      const turn: ConversationTurn = {
        role: 'user',
        message: '¿Cuánto debe A-0101?',
        timestamp: new Date(),
      };

      mockRedisService.get.mockResolvedValue(null);

      await service.storeTurn('tenant-1', 'user-1', 'conv-1', turn);

      expect(mockRedisService.set).toHaveBeenCalledWith(
        'assistant:context:tenant-1:user-1:conv-1',
        expect.any(String),
        expect.any(Number),
      );
    });

    it('stores multiple turns, keeping only last 5', async () => {
      const turns: ConversationTurn[] = [
        { role: 'user', message: 'Turn 1', timestamp: new Date() },
        { role: 'user', message: 'Turn 2', timestamp: new Date() },
        { role: 'user', message: 'Turn 3', timestamp: new Date() },
        { role: 'user', message: 'Turn 4', timestamp: new Date() },
        { role: 'user', message: 'Turn 5', timestamp: new Date() },
        { role: 'user', message: 'Turn 6', timestamp: new Date() },
      ];

      // Simulate Redis persistence - get returns the last stored JSON string
      let storedJson: string | null = null;
      mockRedisService.get.mockImplementation(() => Promise.resolve(storedJson));
      mockRedisService.set.mockImplementation((_key, value: string) => {
        storedJson = value;
        return Promise.resolve();
      });

      for (const turn of turns) {
        await service.storeTurn('tenant-1', 'user-1', 'conv-1', turn);
      }

      expect(storedJson).not.toBeNull();
      const storedSession = JSON.parse(storedJson!);
      expect(storedSession.turns).toHaveLength(5);
      expect(storedSession.turns[0].message).toBe('Turn 2');
      expect(storedSession.turns[4].message).toBe('Turn 6');
    });

    it('stores last resolved entities', async () => {
      const turn: ConversationTurn = {
        role: 'user',
        message: '¿Cuánto debe A-0101?',
        timestamp: new Date(),
        resolvedEntities: {
          building: { id: 'b1', name: 'Torre A', alias: 'A' },
          unit: { id: 'u1', code: '0101', buildingId: 'b1' },
          alternatives: [],
        },
      };

      mockRedisService.get.mockResolvedValue(null);

      await service.storeTurn('tenant-1', 'user-1', 'conv-1', turn);

      const setCall = mockRedisService.set.mock.calls[0];
      const storedSession = JSON.parse(setCall[1]);
      expect(storedSession.lastEntity.buildingId).toBe('b1');
      expect(storedSession.lastEntity.unitId).toBe('u1');
    });

    it('stores metadata with intent and filters', async () => {
      const turn: ConversationTurn = {
        role: 'user',
        message: 'Test',
        timestamp: new Date(),
      };

      mockRedisService.get.mockResolvedValue(null);

      await service.storeTurn('tenant-1', 'user-1', 'conv-1', turn, {
        intent: 'unit_debt',
        filters: { period: '2026-01' },
      });

      const setCall = mockRedisService.set.mock.calls[0];
      const storedSession = JSON.parse(setCall[1]);
      expect(storedSession.lastIntent).toBe('unit_debt');
      expect(storedSession.lastFilters).toEqual({ period: '2026-01' });
    });
  });

  describe('getContext', () => {
    it('returns empty array for unknown session', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.getContext('tenant-1', 'user-1', 'unknown-conv');

      expect(result).toEqual([]);
    });

    it('returns turns for known session', async () => {
      const storedSession = {
        turns: [
          { role: 'user', message: 'Test', timestamp: new Date().toISOString() },
        ],
      };
      mockRedisService.get.mockResolvedValue(JSON.stringify(storedSession));

      const result = await service.getContext('tenant-1', 'user-1', 'conv-1');

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Test');
    });

    it('returns empty array for corrupted data', async () => {
      mockRedisService.get.mockResolvedValue('invalid-json{');

      const result = await service.getContext('tenant-1', 'user-1', 'conv-1');

      expect(result).toEqual([]);
    });
  });

  describe('getLastResolved', () => {
    it('returns empty object for unknown session', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.getLastResolved('tenant-1', 'user-1', 'conv-1');

      expect(result).toEqual({});
    });

    it('returns last resolved entities', async () => {
      const storedSession = {
        turns: [],
        lastEntity: {
          buildingId: 'b1',
          unitId: 'u1',
          personId: 'p1',
        },
      };
      mockRedisService.get.mockResolvedValue(JSON.stringify(storedSession));

      const result = await service.getLastResolved('tenant-1', 'user-1', 'conv-1');

      expect(result).toEqual({
        buildingId: 'b1',
        unitId: 'u1',
        personId: 'p1',
      });
    });
  });

  describe('resolveAnaphora', () => {
    it('returns original message when no context', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.resolveAnaphora('tenant-1', 'user-1', 'conv-1', '¿Cuánto debe?');

      expect(result).toBe('¿Cuánto debe?');
    });

    it('returns original message when no anaphora detected', async () => {
      const storedSession = {
        turns: [],
        lastEntity: { unitId: 'u1' },
      };
      mockRedisService.get.mockResolvedValue(JSON.stringify(storedSession));

      const result = await service.resolveAnaphora('tenant-1', 'user-1', 'conv-1', '¿Cuánto debe A-0101?');

      expect(result).toBe('¿Cuánto debe A-0101?');
    });
  });
});
