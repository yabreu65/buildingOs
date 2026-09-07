import { classifyProviderError, isConclusiveNotFoundError } from './db-to-storage.errors';

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

  it.each([
    { statusCode: 404 },
    { code: 'NoSuchVersion' },
    { code: 'NoSuchKey' },
  ])('accepts conclusive absence %j', (error) => {
    expect(isConclusiveNotFoundError(error)).toBe(true);
  });

  it.each([
    { statusCode: 500, message: 'NoSuchKey' },
    { statusCode: 403, code: 'NoSuchKey' },
    { code: 'ETIMEDOUT', message: 'NoSuchVersion' },
    { code: 'ECONNRESET', message: 'NoSuchKey' },
    { message: 'NoSuchKey' },
  ])('rejects non-conclusive absence signals %j', (error) => {
    expect(isConclusiveNotFoundError(error)).toBe(false);
  });
});
