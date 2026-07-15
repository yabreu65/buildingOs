import { onboardingImportApi } from './onboarding-import.api';

describe('onboardingImportApi', () => {
  it('returns preview data from the server', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: 'job-1',
        rows: [],
        warnings: [],
      }),
    } as unknown as Response);

    await expect(onboardingImportApi.previewImport(new File(['a'], 'import.csv', { type: 'text/csv' }))).resolves.toMatchObject({
      jobId: 'job-1',
    });
  });
});
