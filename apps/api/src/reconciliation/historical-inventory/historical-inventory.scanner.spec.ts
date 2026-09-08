import { ImportJobStatus } from '@prisma/client';
import {
  ExpenseReferenceRecord,
  FileReferenceRecord,
  ImportJobReferenceRecord,
  ReadOnlyReconciliationDatabase,
} from '../db-to-storage/db-to-storage.types';
import { HistoricalInventoryScanner } from './historical-inventory.scanner';
import {
  HistoricalInventoryStorage,
  HistoricalObjectVersion,
} from './historical-inventory.types';

function page<T extends { id: string }>(rows: readonly T[], afterId: string | undefined, take: number): readonly T[] {
  const ordered = [...rows].sort((left, right) => left.id.localeCompare(right.id));
  const start = afterId ? ordered.findIndex((row) => row.id > afterId) : 0;
  return ordered.slice(start < 0 ? ordered.length : start, (start < 0 ? ordered.length : start) + take);
}

function createDatabase(
  files: readonly FileReferenceRecord[] = [],
  imports: readonly ImportJobReferenceRecord[] = [],
  expenses: readonly ExpenseReferenceRecord[] = [],
): ReadOnlyReconciliationDatabase & { readonly mutation: jest.Mock } {
  const mutation = jest.fn();
  return {
    findFileBatch: jest.fn(({ afterId, take }) => Promise.resolve(page(files, afterId, take))),
    findImportJobBatch: jest.fn(({ afterId, take }) => Promise.resolve(page(imports, afterId, take))),
    findExpenseBatch: jest.fn(({ afterId, take }) => Promise.resolve(page(expenses, afterId, take))),
    findIncomeBatch: jest.fn().mockResolvedValue([]),
    mutation,
  };
}

function createStorage(pages: readonly (readonly HistoricalObjectVersion[])[]): HistoricalInventoryStorage & {
  readonly listCalls: jest.Mock;
  readonly removeObject: jest.Mock;
  readonly putObject: jest.Mock;
} {
  const listCalls = jest.fn().mockImplementation((
    _bucket: string,
    options: { readonly keyMarker?: string; readonly versionIdMarker?: string },
  ) => {
    const index = options.keyMarker ? Number(options.keyMarker.slice('page-'.length)) : 0;
    const items = pages[index] ?? [];
    const nextIndex = index + 1;
    return Promise.resolve({
      items,
      isTruncated: nextIndex < pages.length,
      ...(nextIndex < pages.length
        ? { nextKeyMarker: `page-${nextIndex}`, nextVersionIdMarker: `version-page-${nextIndex}` }
        : {}),
    });
  });

  return {
    getDefaultBucket: () => 'buildingos-local',
    listObjectVersionsPage: listCalls,
    listCalls,
    removeObject: jest.fn(),
    putObject: jest.fn(),
  };
}

function file(id: string, objectKey: string, objectVersionId: string | null): FileReferenceRecord {
  return {
    id,
    tenantId: 'tenant-1',
    bucket: 'buildingos-local',
    objectKey,
    objectVersionId,
  };
}

function version(
  objectKey: string,
  versionId: string,
  isLatest: boolean,
  isDeleteMarker = false,
): HistoricalObjectVersion {
  return { objectKey, versionId, isLatest, isDeleteMarker };
}

describe('HistoricalInventoryScanner', () => {
  it('correlates exact references and classifies current, noncurrent, delete-marker, orphan, legacy, invalid, and cross-tenant inventory', async () => {
    const secretKey = 'tenant-tenant-1/private/exact-present.pdf';
    const secretVersion = 'provider-version-secret-123456';
    const database = createDatabase(
      [
        file('exact-present', secretKey, secretVersion),
        file('exact-missing', 'tenant-tenant-1/private/exact-missing.pdf', 'missing-version-secret'),
        file('noncurrent-present', 'tenant-tenant-1/private/noncurrent.pdf', 'noncurrent-secret'),
        file('legacy', 'tenant-tenant-1/private/legacy.pdf', null),
        file('invalid', '/invalid/key.pdf', 'invalid-version'),
        file('cross-tenant', 'tenant-tenant-2/private/cross.pdf', 'cross-version'),
      ],
      [],
      [{ id: 'expense-key-only', tenantId: 'tenant-1', attachmentFileKey: 'receipts/legacy.pdf' }],
    );
    const storage = createStorage([[
      version(secretKey, secretVersion, true),
      version('tenant-tenant-1/private/noncurrent.pdf', 'noncurrent-secret', false),
      version('tenant-tenant-1/private/noncurrent.pdf', 'new-current-secret', true),
      version('tenant-tenant-1/private/legacy.pdf', 'legacy-current-secret', true),
      version('unowned/current-object.pdf', 'orphan-current-secret', true),
      version('unowned/current-object.pdf', 'orphan-old-secret', false),
      version('unowned/deleted-object.pdf', 'delete-marker-secret', true, true),
      version('unowned/deleted-object.pdf', 'old-delete-marker-secret', false, true),
    ]]);

    const receipt = await new HistoricalInventoryScanner(database, storage, {
      databaseBatchSize: 2,
      storagePageSize: 50,
    }).scan();

    expect(receipt.referenceOutcomeCounts).toMatchObject({
      EXACT_REFERENCED_VERSION_PRESENT: 2,
      EXACT_REFERENCED_VERSION_MISSING: 1,
      LEGACY_KEY_ONLY_REFERENCE: 2,
      INVALID_REFERENCE: 1,
      CROSS_TENANT_REFERENCE: 1,
    });
    expect(receipt.storageOutcomeCounts).toMatchObject({
      CURRENT_OBJECT: 2,
      NONCURRENT_VERSION: 1,
      LATEST_DELETE_MARKER: 1,
      NONCURRENT_DELETE_MARKER: 1,
      CURRENT_ORPHAN_OBJECT: 2,
      ORPHAN_HISTORICAL_VERSION: 1,
    });
    expect(receipt.dispositionCounts).toMatchObject({
      PRESERVE: 5,
      REPAIR_REQUIRED_LATER: 5,
      OPERATIONAL_ERROR: 0,
    });
    expect(receipt.scanStatus).toBe('COMPLETE_WITH_FINDINGS');
    expect(receipt.consistencyModel).toBe('MOVING_WINDOW');

    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(secretKey);
    expect(serialized).not.toContain(secretVersion);
    expect(serialized).not.toContain('missing-version-secret');
    expect(receipt.detailedFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'EXACT_REFERENCED_VERSION_MISSING' }),
      expect.objectContaining({ outcome: 'LEGACY_KEY_ONLY_REFERENCE', disposition: 'REPAIR_REQUIRED_LATER' }),
      expect.objectContaining({ outcome: 'CROSS_TENANT_REFERENCE' }),
      expect.objectContaining({ outcome: 'CURRENT_ORPHAN_OBJECT', disposition: 'PRESERVE' }),
      expect.objectContaining({ outcome: 'ORPHAN_HISTORICAL_VERSION', disposition: 'PRESERVE' }),
      expect.objectContaining({ outcome: 'LATEST_DELETE_MARKER', disposition: 'PRESERVE' }),
      expect.objectContaining({ outcome: 'NONCURRENT_DELETE_MARKER', disposition: 'PRESERVE' }),
    ]));
    expect(database.mutation).not.toHaveBeenCalled();
    expect(storage.removeObject).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('paginates version listing with bounded pages and opaque provider markers', async () => {
    const database = createDatabase();
    const storage = createStorage([
      [version('orphan/a.pdf', 'version-a', true)],
      [version('orphan/b.pdf', 'version-b', false)],
    ]);

    const receipt = await new HistoricalInventoryScanner(database, storage, {
      databaseBatchSize: 1,
      storagePageSize: 1,
      maxFindings: 1,
    }).scan();

    expect(storage.listCalls).toHaveBeenNthCalledWith(1, 'buildingos-local', {
      prefix: '',
      maxKeys: 1,
    });
    expect(storage.listCalls).toHaveBeenNthCalledWith(2, 'buildingos-local', {
      prefix: '',
      maxKeys: 1,
      keyMarker: 'page-1',
      versionIdMarker: 'version-page-1',
    });
    expect(receipt.storageEntriesScanned).toBe(2);
    expect(receipt.detailedFindings).toHaveLength(1);
  });

  it.each([
    [{ code: 'AccessDenied', statusCode: 403 }, 'AUTHORIZATION'],
    [{ code: 'ETIMEDOUT' }, 'TIMEOUT'],
  ] as const)('marks historical listing failure %j as operational and never reports exact missing', async (error, category) => {
    const database = createDatabase([
      file('exact', 'tenant-tenant-1/private/exact.pdf', 'exact-version'),
    ]);
    const storage = createStorage([]);
    storage.listCalls.mockRejectedValue(error);

    const receipt = await new HistoricalInventoryScanner(database, storage).scan();

    expect(receipt.scanStatus).toBe('INCOMPLETE_OPERATIONAL_ERROR');
    expect(receipt.operationalErrorCount).toBe(1);
    expect(receipt.referenceOutcomeCounts.EXACT_REFERENCED_VERSION_MISSING).toBe(0);
    expect(receipt.referenceOutcomeCounts.PROVIDER_OPERATIONAL_ERROR).toBe(1);
    expect(receipt.detailedFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcome: 'PROVIDER_OPERATIONAL_ERROR',
        disposition: 'OPERATIONAL_ERROR',
        providerErrorCategory: category,
      }),
    ]));
  });

  it('does not list storage for a cross-tenant-only non-default bucket reference', async () => {
    const database = createDatabase([{
      id: 'cross',
      tenantId: 'tenant-1',
      bucket: 'other-bucket',
      objectKey: 'tenant-tenant-2/private/cross.pdf',
      objectVersionId: 'cross-version',
    }]);
    const storage = createStorage([[]]);

    await new HistoricalInventoryScanner(database, storage).scan();

    expect(storage.listCalls).toHaveBeenCalledTimes(1);
    expect(storage.listCalls).toHaveBeenCalledWith('buildingos-local', expect.anything());
  });

  it('validates options and rejects non-advancing historical pagination', async () => {
    const database = createDatabase();
    const storage = createStorage([]);

    expect(() => new HistoricalInventoryScanner(database, storage, { storagePageSize: 1001 })).toThrow(
      'storagePageSize must be an integer between 1 and 1000',
    );

    storage.listCalls.mockResolvedValue({
      items: [],
      isTruncated: true,
      nextKeyMarker: 'same',
      nextVersionIdMarker: 'same',
    });
    const receipt = await new HistoricalInventoryScanner(database, storage).scan();

    expect(receipt.scanStatus).toBe('INCOMPLETE_OPERATIONAL_ERROR');
    expect(storage.listCalls).toHaveBeenCalledTimes(2);
  });

  it('handles import exact and legacy references without storage reads other than version inventory', async () => {
    const importRows: readonly ImportJobReferenceRecord[] = [{
      id: 'job',
      tenantId: 'tenant-1',
      status: ImportJobStatus.READY,
      previewVersion: 3,
      originalObjectKey: 'tenant-imports/tenant-1/job/original.xlsx',
      originalObjectVersionId: 'import-version',
      normalizedObjectKey: 'tenant-imports/tenant-1/job/normalized.json',
      normalizedObjectVersionId: null,
    }];
    const database = createDatabase([], importRows);
    const storage = createStorage([[
      version('tenant-imports/tenant-1/job/original.xlsx', 'import-version', true),
      version('tenant-imports/tenant-1/job/normalized.json', 'normalized-current', true),
    ]]);

    const receipt = await new HistoricalInventoryScanner(database, storage).scan();

    expect(receipt.referenceOutcomeCounts.EXACT_REFERENCED_VERSION_PRESENT).toBe(1);
    expect(receipt.referenceOutcomeCounts.LEGACY_KEY_ONLY_REFERENCE).toBe(1);
    expect(receipt.storageOutcomeCounts.CURRENT_OBJECT).toBe(2);
  });
});
