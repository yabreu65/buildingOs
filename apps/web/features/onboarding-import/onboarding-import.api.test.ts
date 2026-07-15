import { apiClient } from '@/shared/lib/http/client';
import {
  confirmOnboardingImport,
  downloadOnboardingImportTemplate,
  getOnboardingImport,
  listOnboardingImportIssues,
  previewOnboardingImport,
  ONBOARDING_IMPORT_TEMPLATE_FILENAME,
} from './onboarding-import.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);

describe('onboarding import api', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it('downloads the template as a blob using the fixed filename', async () => {
    const blob = new Blob(['template'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    mockedApiClient.mockResolvedValue(blob);

    const result = await downloadOnboardingImportTemplate('tenant-1');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/onboarding-imports/template',
      method: 'GET',
      responseType: 'blob',
    });
    expect(result.fileName).toBe(ONBOARDING_IMPORT_TEMPLATE_FILENAME);
    expect(result.blob).toBe(blob);
  });

  it('uploads the preview workbook as multipart form data', async () => {
    mockedApiClient.mockResolvedValue({
      importId: 'import-1',
      tenantId: 'tenant-1',
      type: 'INITIAL_ONBOARDING',
      fileName: 'workbook.xlsx',
      fileHash: 'hash',
      schemaVersion: 'v1',
      previewVersion: 1,
      status: 'READY',
      expiresAt: '2026-01-01T00:00:00.000Z',
      canConfirm: true,
      summary: {
        buildings: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        units: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        people: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        relations: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        openingBalances: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        blockingIssues: 0,
        warnings: 0,
      },
      counts: {
        buildings: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        units: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        people: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        relations: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        openingBalances: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
        blockingIssues: 0,
        warnings: 0,
      },
      issueCount: 0,
      blockingIssueCount: 0,
      warningCount: 0,
      confirmedAt: null,
      confirmedByMembershipId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const file = new File(['workbook'], 'tenant-onboarding.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await previewOnboardingImport('tenant-1', file);

    expect(mockedApiClient).toHaveBeenCalledTimes(1);
    const config = mockedApiClient.mock.calls[0][0];
    expect(config.path).toBe('/tenants/tenant-1/onboarding-imports/preview');
    expect(config.method).toBe('POST');
    expect(config.body).toBeInstanceOf(FormData);
    expect((config.body as FormData).get('file')).toBe(file);
  });

  it('builds issue queries and confirm requests correctly', async () => {
    mockedApiClient.mockResolvedValue({
      importId: 'import-1',
      status: 'CONFIRMED',
      confirmedAt: '2026-01-01T00:00:00.000Z',
      summary: {
        buildingsCreated: 1,
        buildingsReused: 0,
        unitCategoriesCreated: 0,
        unitCategoriesReused: 0,
        unitsCreated: 1,
        unitsReused: 0,
        peopleCreated: 1,
        peopleReused: 0,
        relationsCreated: 1,
        relationsReused: 0,
        chargesCreated: 0,
        chargesReused: 0,
      },
    });

    await getOnboardingImport('tenant-1', 'import-1');
    await listOnboardingImportIssues('tenant-1', 'import-1', {
      severity: 'BLOCKER',
      sheet: 'Edificios',
      code: 'duplicate-code',
      page: 2,
      pageSize: 50,
    });
    await confirmOnboardingImport('tenant-1', 'import-1', {
      expectedPreviewVersion: 3,
      confirmationToken: 'token-1',
    });

    expect(mockedApiClient).toHaveBeenNthCalledWith(1, {
      path: '/tenants/tenant-1/onboarding-imports/import-1',
      method: 'GET',
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(2, {
      path: '/tenants/tenant-1/onboarding-imports/import-1/issues?severity=BLOCKER&sheet=Edificios&code=duplicate-code&page=2&pageSize=50',
      method: 'GET',
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(3, {
      path: '/tenants/tenant-1/onboarding-imports/import-1/confirm',
      method: 'POST',
      body: {
        expectedPreviewVersion: 3,
        confirmationToken: 'token-1',
      },
    });
  });
});
