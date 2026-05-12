import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(() => {
    service = new RedisService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('getClient', () => {
    it('returns null when not connected', () => {
      expect(service.getClient()).toBeNull();
    });
  });

  describe('get', () => {
    it('returns null when not connected', async () => {
      const result = await service.get('any-key');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('does nothing when not connected', async () => {
      // Should not throw
      await expect(service.set('key', 'value')).resolves.toBeUndefined();
      await expect(service.set('key', 'value', 60)).resolves.toBeUndefined();
    });
  });

  describe('del', () => {
    it('does nothing when not connected', async () => {
      // Should not throw
      await expect(service.del('any-key')).resolves.toBeUndefined();
    });
  });
});
