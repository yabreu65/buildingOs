import { classifyProviderError } from './db-to-storage.errors';

describe('DB-to-storage provider error classification', () => {
  it.each([
    [{ statusCode: 401 }, 'AUTHORIZATION'],
    [{ statusCode: 403 }, 'AUTHORIZATION'],
    [{ code: 'ETIMEDOUT' }, 'TIMEOUT'],
    [{ message: 'request timed out' }, 'TIMEOUT'],
    [{ code: 'ECONNREFUSED' }, 'NETWORK'],
    [{ code: 'ENOTFOUND' }, 'NETWORK'],
    [{ statusCode: 500 }, 'SERVER_ERROR'],
  ])('classifies %j as %s', (error, category) => {
    expect(classifyProviderError(error)).toBe(category);
  });

  it('keeps unexpected provider failures operational without treating them as missing', () => {
    expect(classifyProviderError(new Error('unexpected provider failure'))).toBe('PROVIDER_ERROR');
  });
});
