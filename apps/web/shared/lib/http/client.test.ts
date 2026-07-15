import { createHttpClient } from './client';

describe('createHttpClient', () => {
  it('passes through successful json responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as unknown as Response);

    const client = createHttpClient();
    await expect(client.get('/health')).resolves.toEqual({ ok: true });
  });
});
