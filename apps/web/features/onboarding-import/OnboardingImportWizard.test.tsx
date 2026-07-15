/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OnboardingImportWizard } from './OnboardingImportWizard';
import {
  confirmOnboardingImport,
  downloadOnboardingImportTemplate,
  getOnboardingImport,
  listOnboardingImportIssues,
  previewOnboardingImport,
} from './onboarding-import.api';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('@/features/tenancy/tenant.hooks', () => ({
  useTenantId: jest.fn(),
}));

jest.mock('@/shared/components/ui', () => {
  const actual = jest.requireActual('@/shared/components/ui');
  return {
    ...actual,
    useToast: () => ({
      toast: jest.fn(),
    }),
  };
});

jest.mock('./onboarding-import.api', () => ({
  ONBOARDING_IMPORT_ALLOWED_MIME_TYPES: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream',
  ],
  downloadOnboardingImportTemplate: jest.fn(),
  previewOnboardingImport: jest.fn(),
  getOnboardingImport: jest.fn(),
  listOnboardingImportIssues: jest.fn(),
  confirmOnboardingImport: jest.fn(),
}));

const mockedUsePathname = jest.requireMock('next/navigation').usePathname as jest.Mock;
const mockedUseRouter = jest.requireMock('next/navigation').useRouter as jest.Mock;
const mockedUseSearchParams = jest.requireMock('next/navigation').useSearchParams as jest.Mock;
const mockedUseTenantId = jest.requireMock('@/features/tenancy/tenant.hooks').useTenantId as jest.Mock;

const mockedDownloadTemplate = jest.mocked(downloadOnboardingImportTemplate);
const mockedPreviewImport = jest.mocked(previewOnboardingImport);
const mockedGetImport = jest.mocked(getOnboardingImport);
const mockedListIssues = jest.mocked(listOnboardingImportIssues);
const mockedConfirmImport = jest.mocked(confirmOnboardingImport);

function createJob(overrides: Partial<Awaited<ReturnType<typeof getOnboardingImport>>> = {}) {
  return {
    importId: 'import-1',
    tenantId: 'tenant-1',
    type: 'INITIAL_ONBOARDING' as const,
    fileName: 'buildingos-onboarding.xlsx',
    fileHash: 'hash-1',
    schemaVersion: 'v1',
    previewVersion: 1,
    status: 'READY' as const,
    expiresAt: '2026-01-31T00:00:00.000Z',
    canConfirm: true,
    summary: {
      buildings: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
      units: { total: 2, new: 2, reusable: 0, conflict: 0, invalid: 0 },
      people: { total: 3, new: 3, reusable: 0, conflict: 0, invalid: 0 },
      relations: { total: 3, new: 3, reusable: 0, conflict: 0, invalid: 0 },
      openingBalances: { total: 0, new: 0, reusable: 0, conflict: 0, invalid: 0 },
      blockingIssues: 0,
      warnings: 1,
    },
    counts: {
      buildings: { total: 1, new: 1, reusable: 0, conflict: 0, invalid: 0 },
      units: { total: 2, new: 2, reusable: 0, conflict: 0, invalid: 0 },
      people: { total: 3, new: 3, reusable: 0, conflict: 0, invalid: 0 },
      relations: { total: 3, new: 3, reusable: 0, conflict: 0, invalid: 0 },
      openingBalances: { total: 0, new: 0, reusable: 0, conflict: 0, invalid: 0 },
      blockingIssues: 0,
      warnings: 1,
    },
    issueCount: 1,
    blockingIssueCount: 0,
    warningCount: 1,
    confirmedAt: null,
    confirmedByMembershipId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createSearchParams(importId?: string) {
  const params = new URLSearchParams();
  if (importId) {
    params.set('importId', importId);
  }
  return params;
}

describe('OnboardingImportWizard', () => {
  const routerReplace = jest.fn();
  const routerPush = jest.fn();
  const routerRefresh = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseTenantId.mockReturnValue('tenant-1');
    mockedUsePathname.mockReturnValue('/tenant-1/settings/onboarding-import');
    mockedUseRouter.mockReturnValue({
      replace: routerReplace,
      push: routerPush,
      refresh: routerRefresh,
    });
    mockedUseSearchParams.mockReturnValue(createSearchParams());
    mockedDownloadTemplate.mockResolvedValue({
      fileName: 'buildingos-importacion-inicial-v1.xlsx',
      blob: new Blob(['template'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    });
    mockedPreviewImport.mockResolvedValue(createJob());
    mockedGetImport.mockResolvedValue(createJob());
    mockedListIssues.mockResolvedValue({
      data: [
        {
          id: 'issue-1',
          sheet: 'Edificios',
          row: 2,
          column: 'codigo',
          code: 'duplicate-code',
          severity: 'BLOCKER',
          message: 'Duplicate building code detected',
          receivedValue: 'A',
          normalizedValue: 'A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    mockedConfirmImport.mockResolvedValue({
      importId: 'import-1',
      status: 'CONFIRMED',
      confirmedAt: '2026-01-01T00:05:00.000Z',
      summary: {
        buildingsCreated: 1,
        buildingsReused: 0,
        unitCategoriesCreated: 0,
        unitCategoriesReused: 0,
        unitsCreated: 2,
        unitsReused: 0,
        peopleCreated: 3,
        peopleReused: 0,
        relationsCreated: 3,
        relationsReused: 0,
        chargesCreated: 0,
        chargesReused: 0,
      },
    });
  });

  it('downloads the template, previews the workbook, and confirms the import', async () => {
    render(<OnboardingImportWizard />);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => {
      expect(mockedDownloadTemplate).toHaveBeenCalledWith('tenant-1');
    });

    const file = new File(['content'], 'buildingos-onboarding.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(screen.getByLabelText('Workbook file'), {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));

    await waitFor(() => {
      expect(mockedPreviewImport).toHaveBeenCalledWith('tenant-1', file);
    });
    expect(await screen.findByText('Ready to confirm')).toBeTruthy();
    expect(screen.getByText('buildingos-onboarding.xlsx')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));

    await waitFor(() => {
      expect(mockedConfirmImport).toHaveBeenCalledWith('tenant-1', 'import-1', {
        expectedPreviewVersion: 1,
      });
    });
    await waitFor(() => {
      expect(mockedGetImport).toHaveBeenCalledWith('tenant-1', 'import-1');
    });
  });

  it('restores an existing import from the URL and loads issues', async () => {
    mockedUseSearchParams.mockReturnValue(createSearchParams('import-1'));
    mockedGetImport.mockResolvedValue(
      createJob({
        status: 'BLOCKED',
        canConfirm: false,
        blockingIssueCount: 1,
        issueCount: 1,
      }),
    );

    render(<OnboardingImportWizard />);

    await waitFor(() => {
      expect(mockedGetImport).toHaveBeenCalledWith('tenant-1', 'import-1');
    });

    expect(await screen.findByText('Has blocking issues')).toBeTruthy();
    expect(await screen.findByText('1 entries')).toBeTruthy();
    expect(mockedListIssues).toHaveBeenCalledWith('tenant-1', 'import-1', {
      severity: '',
      sheet: '',
      code: '',
      page: 1,
      pageSize: 25,
    });
  });
});
