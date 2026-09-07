import { ImportJobStatus } from '@prisma/client';
import {
  classifyFileReference,
  classifyImportNormalizedReference,
  classifyImportOriginalReference,
} from './db-to-storage.classifier';

describe('DB-to-storage reference classification', () => {
  describe('File', () => {
    it('classifies a valid provider version as exact', () => {
      expect(classifyFileReference('buildingos', 'tenant-a/file.pdf', 'version-1'))
        .toEqual({ identityClass: 'EXACT_VERSIONED', storageCheck: 'EXACT' });
    });

    it('classifies a missing provider version as legacy or unknown', () => {
      expect(classifyFileReference('buildingos', 'tenant-a/file.pdf', null))
        .toEqual({ identityClass: 'LEGACY_OR_UNKNOWN', storageCheck: 'CURRENT' });
      expect(classifyFileReference('buildingos', 'tenant-a/file.pdf', '  '))
        .toEqual({ identityClass: 'LEGACY_OR_UNKNOWN', storageCheck: 'CURRENT' });
    });

    it('rejects unusable bucket or key references without storage access', () => {
      expect(classifyFileReference(' ', 'tenant-a/file.pdf', 'version-1'))
        .toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
      expect(classifyFileReference('buildingos', '\n', null))
        .toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
    });
  });

  describe('ImportJob.original', () => {
    it('uses exact identity for preview version 4 and later', () => {
      expect(classifyImportOriginalReference(4, 'imports/original.xlsx', 'version-1'))
        .toEqual({ identityClass: 'EXACT_VERSIONED', storageCheck: 'EXACT' });
    });

    it('makes missing version identity a contract violation at preview version 4', () => {
      expect(classifyImportOriginalReference(4, 'imports/original.xlsx', null))
        .toEqual({ identityClass: 'CONTRACT_VIOLATION', storageCheck: 'NONE' });
      expect(classifyImportOriginalReference(4, 'imports/original.xlsx', '  '))
        .toEqual({ identityClass: 'CONTRACT_VIOLATION', storageCheck: 'NONE' });
    });

    it('permits key-only current lookup only for legacy preview versions', () => {
      expect(classifyImportOriginalReference(3, 'imports/original.xlsx', null))
        .toEqual({ identityClass: 'LEGACY_KEY_ONLY', storageCheck: 'CURRENT' });
      expect(classifyImportOriginalReference(3, 'imports/original.xlsx', 'version-1'))
        .toEqual({ identityClass: 'EXACT_VERSIONED', storageCheck: 'EXACT' });
    });
  });

  describe('ImportJob.normalized', () => {
    it('classifies null/null as a legitimate absence', () => {
      expect(classifyImportNormalizedReference(4, ImportJobStatus.BLOCKED, null, null))
        .toEqual({ identityClass: 'NOT_APPLICABLE', storageCheck: 'NONE' });
    });

    it.each([ImportJobStatus.READY, ImportJobStatus.CONFIRMING, ImportJobStatus.CONFIRMED])(
      'requires normalized identity for %s at preview version 4',
      (status) => {
        expect(classifyImportNormalizedReference(4, status, null, null))
          .toEqual({ identityClass: 'CONTRACT_VIOLATION', storageCheck: 'NONE' });
      },
    );

    it('allows failed imports to have no normalized identity', () => {
      expect(classifyImportNormalizedReference(4, ImportJobStatus.FAILED, null, null))
        .toEqual({ identityClass: 'NOT_APPLICABLE', storageCheck: 'NONE' });
    });

    it.each([ImportJobStatus.BLOCKED, ImportJobStatus.FAILED])(
      'allows %s imports to have no normalized identity at preview version 3',
      (status) => {
        expect(classifyImportNormalizedReference(3, status, null, null))
          .toEqual({ identityClass: 'NOT_APPLICABLE', storageCheck: 'NONE' });
      },
    );

    it.each([ImportJobStatus.READY, ImportJobStatus.CONFIRMING, ImportJobStatus.CONFIRMED])(
      'requires normalized identity for %s at preview version 3',
      (status) => {
        expect(classifyImportNormalizedReference(3, status, null, null))
          .toEqual({ identityClass: 'CONTRACT_VIOLATION', storageCheck: 'NONE' });
      },
    );

    it('requires exact identity when a normalized key is present at preview version 4', () => {
      expect(classifyImportNormalizedReference(4, ImportJobStatus.READY, 'imports/normalized.json', 'version-1'))
        .toEqual({ identityClass: 'EXACT_VERSIONED', storageCheck: 'EXACT' });
      expect(classifyImportNormalizedReference(4, ImportJobStatus.READY, 'imports/normalized.json', null))
        .toEqual({ identityClass: 'CONTRACT_VIOLATION', storageCheck: 'NONE' });
    });

    it('uses legacy current lookup for a key-only normalized reference before preview version 4', () => {
      expect(classifyImportNormalizedReference(3, ImportJobStatus.READY, 'imports/normalized.json', null))
        .toEqual({ identityClass: 'LEGACY_KEY_ONLY', storageCheck: 'CURRENT' });
    });

    it('rejects structurally contradictory normalized references', () => {
      expect(classifyImportNormalizedReference(4, ImportJobStatus.READY, null, 'version-1'))
        .toEqual({ identityClass: 'CONTRACT_VIOLATION', storageCheck: 'NONE' });
      expect(classifyImportNormalizedReference(4, ImportJobStatus.READY, ' ', null))
        .toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
      expect(classifyImportNormalizedReference(4, ImportJobStatus.READY, null, ''))
        .toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
    });

    it('rejects malformed exact and legacy version ids without storage access', () => {
      expect(classifyImportNormalizedReference(4, ImportJobStatus.READY, 'imports/normalized.json', 'bad\u0001version'))
        .toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
      expect(classifyImportNormalizedReference(3, ImportJobStatus.READY, 'imports/normalized.json', 'bad\u0001version'))
        .toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
      expect(classifyFileReference('buildingos', 'tenant-a/file.pdf', 'bad\u0001version'))
        .toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
    });
  });
});
