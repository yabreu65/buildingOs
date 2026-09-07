import { ImportJobStatus } from '@prisma/client';
import { DbToStorageScanner } from './db-to-storage.scanner';
import {
  FileReferenceRecord,
  ImportJobReferenceRecord,
  ReadOnlyReconciliationDatabase,
  StorageStatClient,
} from './db-to-storage.types';

function createDatabase(
  files: readonly FileReferenceRecord[],
  importJobs: readonly ImportJobReferenceRecord[],
): ReadOnlyReconciliationDatabase & { readonly fileCalls: jest.Mock; readonly importCalls: jest.Mock } {
  const fileCalls = jest.fn();
  const importCalls = jest.fn();
  const page = <T extends { id: string }>(rows: readonly T[], afterId: string | undefined, take: number): readonly T[] => {
    const orderedRows = [...rows].sort((left, right) => left.id.localeCompare(right.id));
    const start = afterId ? orderedRows.findIndex((row) => row.id > afterId) : 0;
    return orderedRows.slice(start < 0 ? orderedRows.length : start, (start < 0 ? orderedRows.length : start) + take);
  };

  fileCalls.mockImplementation(({ afterId, take }: { afterId?: string; take: number }) => (
    Promise.resolve(page(files, afterId, take))
  ));
  importCalls.mockImplementation(({ afterId, take }: { afterId?: string; take: number }) => (
    Promise.resolve(page(importJobs, afterId, take))
  ));

  return {
    findFileBatch: fileCalls,
    findImportJobBatch: importCalls,
    fileCalls,
    importCalls,
  };
}

function createStorage(): StorageStatClient & { readonly statCalls: jest.Mock } {
  const statCalls = jest.fn();
  return {
    getDefaultBucket: () => 'buildingos',
    statObject: statCalls,
    isNotFoundError: (error: unknown) => (
      typeof error === 'object'
      && error !== null
      && (error as { code?: string; statusCode?: number }).code === 'NoSuchVersion'
        || typeof error === 'object'
        && error !== null
        && (error as { code?: string; statusCode?: number }).code === 'NoSuchKey'
        || typeof error === 'object'
        && error !== null
        && (error as { code?: string; statusCode?: number }).statusCode === 404
    ),
    statCalls,
  };
}

function file(id: string, overrides: Partial<FileReferenceRecord> = {}): FileReferenceRecord {
  return {
    id,
    tenantId: 'tenant-1',
    bucket: 'buildingos',
    objectKey: `tenant-1/${id}.pdf`,
    objectVersionId: 'version-1',
    ...overrides,
  };
}

function importJob(id: string, overrides: Partial<ImportJobReferenceRecord> = {}): ImportJobReferenceRecord {
  return {
    id,
    tenantId: 'tenant-1',
    status: ImportJobStatus.READY,
    previewVersion: 4,
    originalObjectKey: `imports/${id}/original.xlsx`,
    originalObjectVersionId: 'version-1',
    normalizedObjectKey: null,
    normalizedObjectVersionId: null,
    ...overrides,
  };
}

describe('DbToStorageScanner', () => {
  it('checks exact and legacy references with distinct missing observations', async () => {
    const database = createDatabase([
      file('file-exact'),
      file('file-exact-missing', { objectVersionId: 'missing-version' }),
      file('file-legacy', { objectVersionId: null }),
      file('file-legacy-missing', { objectVersionId: null }),
      file('file-invalid', { bucket: ' ', objectKey: 'invalid' }),
    ], []);
    const storage = createStorage();
    storage.statCalls.mockImplementation((_bucket: string, objectKey: string, versionId?: string) => {
      if (objectKey.includes('exact-missing')) throw { code: 'NoSuchVersion' };
      if (objectKey.includes('legacy-missing')) throw { code: 'NoSuchKey' };
      expect(objectKey).not.toContain('invalid');
      expect(versionId === undefined || versionId === 'version-1').toBe(true);
      return Promise.resolve({});
    });

    const receipt = await new DbToStorageScanner(database, storage, { batchSize: 2 }).scan();

    expect(receipt.recordsScanned).toBe(5);
    expect(receipt.classificationCounts).toMatchObject({
      EXACT_VERSIONED: 2,
      LEGACY_OR_UNKNOWN: 2,
      INVALID_REFERENCE: 1,
    });
    expect(receipt.storageObservationCounts).toMatchObject({
      EXACT_PRESENT: 1,
      EXACT_MISSING: 1,
      CURRENT_PRESENT: 1,
      CURRENT_MISSING: 1,
      NOT_CHECKED: 1,
    });
    expect(receipt.scanStatus).toBe('COMPLETE_WITH_FINDINGS');
  });

  it('does not fall back to a current-key stat for preview version 4 original references', async () => {
    const database = createDatabase([], [
      importJob('job-contract', { originalObjectVersionId: null }),
    ]);
    const storage = createStorage();

    const receipt = await new DbToStorageScanner(database, storage).scan();

    expect(storage.statCalls).not.toHaveBeenCalled();
    expect(receipt.classificationCounts.CONTRACT_VIOLATION).toBe(2);
    expect(receipt.classificationCounts.NOT_APPLICABLE).toBe(0);
    expect(receipt.storageObservationCounts.NOT_CHECKED).toBe(2);
  });

  it('uses current-key lookup only for legacy import references and exact stat for versioned legacy rows', async () => {
    const database = createDatabase([], [
      importJob('job-legacy', {
        previewVersion: 3,
        originalObjectVersionId: null,
        normalizedObjectKey: 'imports/job-legacy/normalized.json',
        normalizedObjectVersionId: null,
      }),
      importJob('job-exact', { previewVersion: 3 }),
    ]);
    const storage = createStorage();
    storage.statCalls.mockResolvedValue({});

    const receipt = await new DbToStorageScanner(database, storage).scan();

    expect(storage.statCalls).toHaveBeenNthCalledWith(1, 'buildingos', 'imports/job-exact/original.xlsx', 'version-1');
    expect(storage.statCalls).toHaveBeenNthCalledWith(2, 'buildingos', 'imports/job-legacy/original.xlsx');
    expect(storage.statCalls).toHaveBeenNthCalledWith(3, 'buildingos', 'imports/job-legacy/normalized.json');
    expect(receipt.sourceCounts['ImportJob.original'].classificationCounts.LEGACY_KEY_ONLY).toBe(1);
    expect(receipt.sourceCounts['ImportJob.original'].classificationCounts.EXACT_VERSIONED).toBe(1);
  });

  it('does not stat malformed VersionIds for exact or legacy references', async () => {
    const database = createDatabase([
      file('file-invalid-version', { objectVersionId: 'bad\u0001version' }),
    ], [
      importJob('job-invalid-version', {
        originalObjectVersionId: 'bad\u0001version',
        normalizedObjectKey: 'imports/job-invalid-version/normalized.json',
        normalizedObjectVersionId: 'bad\u0001version',
      }),
      importJob('job-invalid-version-legacy', {
        previewVersion: 3,
        originalObjectVersionId: 'bad\u0001version',
      }),
    ]);
    const storage = createStorage();

    const receipt = await new DbToStorageScanner(database, storage).scan();

    expect(storage.statCalls).not.toHaveBeenCalled();
    expect(receipt.invalidReferenceCount).toBe(4);
    expect(receipt.storageObservationCounts.NOT_CHECKED).toBe(5);
  });

  it.each([
    [{ code: 'NoSuchVersion' }, 'EXACT_MISSING', 0],
    [{ code: 'NoSuchKey' }, 'EXACT_MISSING', 0],
    [{ code: 'ETIMEDOUT' }, 'OPERATIONAL_ERROR', 1],
    [{ statusCode: 403 }, 'OPERATIONAL_ERROR', 1],
    [{ statusCode: 500 }, 'OPERATIONAL_ERROR', 1],
  ])('keeps provider result %j in the correct observation bucket', async (error, observation, operationalCount) => {
    const database = createDatabase([file('file-error')], []);
    const storage = createStorage();
    storage.statCalls.mockRejectedValue(error);
    storage.isNotFoundError = (candidate: unknown) => (
      typeof candidate === 'object'
      && candidate !== null
      && ((candidate as { code?: string }).code === 'NoSuchVersion' || (candidate as { code?: string }).code === 'NoSuchKey')
    );

    const receipt = await new DbToStorageScanner(database, storage).scan();

    expect(receipt.storageObservationCounts[observation as keyof typeof receipt.storageObservationCounts]).toBe(1);
    expect(receipt.operationalErrorCount).toBe(operationalCount);
    expect(receipt.scanStatus).toBe(operationalCount ? 'INCOMPLETE_OPERATIONAL_ERROR' : 'COMPLETE_WITH_FINDINGS');
  });

  it('paginates deterministically, bounds findings, and has no write-capable collaborators', async () => {
    const database = createDatabase(
      [file('file-a', { objectVersionId: null }), file('file-b', { objectVersionId: null }), file('file-c', { objectVersionId: null })],
      [],
    );
    const storage = createStorage();
    storage.statCalls.mockResolvedValue({});

    const receipt = await new DbToStorageScanner(database, storage, { batchSize: 1, maxFindings: 2 }).scan();

    expect(database.fileCalls).toHaveBeenNthCalledWith(1, { afterId: undefined, take: 1 });
    expect(database.fileCalls).toHaveBeenNthCalledWith(2, { afterId: 'file-a', take: 1 });
    expect(database.fileCalls).toHaveBeenNthCalledWith(3, { afterId: 'file-b', take: 1 });
    expect(database.fileCalls).toHaveBeenNthCalledWith(4, { afterId: 'file-c', take: 1 });
    expect(receipt.recordsScanned).toBe(3);
    expect(receipt.detailedFindings).toHaveLength(2);
    expect(receipt.consistencyModel).toBe('MOVING_WINDOW');
    expect(storage.statCalls).toHaveBeenCalledTimes(3);
  });
});
