import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { apiClient } from '@/shared/lib/http/client';
import { allocationApi, unitGroupApi } from './liquidation.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);
const financeRoot = join(__dirname, '..');

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return listSourceFiles(absolutePath);
    }

    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) {
      return [];
    }

    return [absolutePath];
  });
}

describe('legacy liquidation cleanup', () => {
  beforeEach(() => {
    mockedApiClient.mockResolvedValue({});
  });

  it('does not leave active code importing the legacy liquidation hook or API', () => {
    const legacyHookPath = join(financeRoot, 'hooks/useLiquidation.ts');
    const sourceFiles = listSourceFiles(financeRoot);
    const offenders = sourceFiles.flatMap((filePath) => {
      const contents = readFileSync(filePath, 'utf8');
      const hasLegacyHookImport = /from ['"][^'"]*hooks\/useLiquidation['"]/.test(contents);
      const hasLegacyApiUsage = /\bliquidationApi\b/.test(contents);

      return hasLegacyHookImport || hasLegacyApiUsage
        ? [relative(financeRoot, filePath)]
        : [];
    });

    expect(existsSync(legacyHookPath)).toBe(false);
    expect(offenders).toEqual([]);
  });

  it('keeps unitGroupApi available with unchanged request behavior', async () => {
    await unitGroupApi.list('tenant-1', 'building-1');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/unit-groups?buildingId=building-1',
      headers: { 'tenant-id': 'tenant-1' },
    });
  });

  it('keeps allocationApi available with unchanged request behavior', async () => {
    await allocationApi.getForMovement('tenant-1', 'expense-1', 'income-1');

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/allocations?expenseId=expense-1&incomeId=income-1',
      headers: { 'tenant-id': 'tenant-1' },
    });
  });

  it('normalizes identifiers before sending liquidation API requests', async () => {
    await unitGroupApi.create(' tenant-1 ', {
      buildingId: ' building-1 ',
      name: '  Tower A ',
      description: '  Main block  ',
      unitIds: [' unit-1 ', 'unit-2'],
    });

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/unit-groups',
      method: 'POST',
      body: {
        buildingId: 'building-1',
        name: 'Tower A',
        description: 'Main block',
        unitIds: ['unit-1', 'unit-2'],
      },
      headers: { 'tenant-id': 'tenant-1' },
    });
  });

  it('rejects blank tenant identifiers early', async () => {
    await expect(unitGroupApi.list('   ')).rejects.toThrow('tenantId is required');
  });
});
