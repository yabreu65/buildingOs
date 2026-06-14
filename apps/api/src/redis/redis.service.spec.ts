import { RedisService } from './redis.service';
import { ConfigService } from '../config/config.service';

describe('RedisService', () => {
  let service: RedisService;
  const mockConfigService = {
    getValue: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  beforeEach(() => {
    service = new RedisService(mockConfigService);
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

  describe('incrementCounter', () => {
    it('returns null when not connected', async () => {
      await expect(service.incrementCounter('rate:key', 1000)).resolves.toBeNull();
    });
  });
});
