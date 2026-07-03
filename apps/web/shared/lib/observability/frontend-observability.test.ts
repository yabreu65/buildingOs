import {
  clearLatestApiResponseContext,
  getLatestApiResponseContext,
  recordApiResponseContext,
  reportFrontendError,
} from './frontend-observability';

describe('frontend-observability', () => {
  beforeEach(() => {
    clearLatestApiResponseContext();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records and clears API response context', () => {
    recordApiResponseContext({
      requestId: 'request-123',
      method: 'GET',
      path: '/ready',
      statusCode: 503,
    });

    const context = getLatestApiResponseContext();

    expect(context).not.toBeNull();
    expect(context?.requestId).toBe('request-123');
    expect(context?.path).toBe('/ready');
    expect(context?.timestamp).toEqual(expect.any(String));

    clearLatestApiResponseContext();
    expect(getLatestApiResponseContext()).toBeNull();
  });

  it('reports frontend errors without requiring optional context', () => {
    expect(() =>
      reportFrontendError(new Error('boom'), {
        source: 'api-client',
      }),
    ).not.toThrow();

    expect(console.error).toHaveBeenCalled();
  });
});
