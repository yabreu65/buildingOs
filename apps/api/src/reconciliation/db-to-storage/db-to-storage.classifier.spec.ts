import { ImportJobStatus } from '@prisma/client';
import {
  classifyExpenseAttachmentReference,
  classifyFileReference,
  classifyIncomeAttachmentReference,
  classifyImportNormalizedReference,
  classifyImportOriginalReference,
} from './db-to-storage.classifier';

describe('DB-to-storage reference classification', () => {
  describe('File', () => {
    it.each(['tenant-tenant-a/file.pdf', 'tenant/tenant-a/receipt.pdf', 'pilot-data-pack/tenant-a/document.txt'])(
      'classifies a same-tenant key as exact: %s',
      (objectKey) => {
        expect(classifyFileReference('tenant-a', 'buildingos', objectKey, 'version-1')).toEqual({
          identityClass: 'EXACT_VERSIONED',
          storageCheck: 'EXACT',
        });
      },
    );

    it('classifies a missing provider version as legacy or unknown', () => {
      expect(classifyFileReference('tenant-a', 'buildingos', 'tenant-tenant-a/file.pdf', null)).toEqual({
        identityClass: 'LEGACY_OR_UNKNOWN',
        storageCheck: 'CURRENT',
      });
      expect(classifyFileReference('tenant-a', 'buildingos', 'tenant-tenant-a/file.pdf', '  ')).toEqual({
        identityClass: 'LEGACY_OR_UNKNOWN',
        storageCheck: 'CURRENT',
      });
    });

    it('rejects unusable bucket or key references without storage access', () => {
      expect(classifyFileReference('tenant-a', ' ', 'tenant-tenant-a/file.pdf', 'version-1')).toEqual({
        identityClass: 'INVALID_REFERENCE',
        storageCheck: 'NONE',
      });
      expect(classifyFileReference('tenant-a', 'buildingos', '\n', null)).toEqual({
        identityClass: 'INVALID_REFERENCE',
        storageCheck: 'NONE',
      });
    });

    it.each([
      'tenant-tenant-b/file.pdf',
      'tenant/tenant-b/receipt.pdf',
      'pilot-data-pack/tenant-b/document.txt',
      'legacy/file.pdf',
    ])('rejects unsupported or cross-tenant keys without storage access: %s', (objectKey) => {
      expect(classifyFileReference('tenant-a', 'buildingos', objectKey, 'version-1')).toEqual({
        identityClass: 'INVALID_REFERENCE',
        storageCheck: 'NONE',
      });
    });
  });

  describe.each([
    ['Expense', classifyExpenseAttachmentReference],
    ['Income', classifyIncomeAttachmentReference],
  ])('%s attachment', (_source, classifyAttachmentReference) => {
    it('classifies a null attachment as not applicable', () => {
      expect(classifyAttachmentReference(null)).toEqual({
        identityClass: 'NOT_APPLICABLE',
        storageCheck: 'NONE',
      });
    });

    it('rejects blank attachments without storage access', () => {
      expect(classifyAttachmentReference('  ')).toEqual({
        identityClass: 'INVALID_REFERENCE',
        storageCheck: 'NONE',
      });
    });

    it.each(['../attachment.pdf', '/absolute/attachment.pdf', 'attachments//file.pdf', 'bad\u0000key'])('rejects malformed attachments: %s', (objectKey) => {
      expect(classifyAttachmentReference(objectKey)).toEqual({
        identityClass: 'INVALID_REFERENCE',
        storageCheck: 'NONE',
      });
    });

    it('classifies a valid key-only attachment without storage access', () => {
      expect(classifyAttachmentReference('attachments/attachment.pdf')).toEqual({
        identityClass: 'KEY_ONLY_UNVERSIONED',
        storageCheck: 'NONE',
      });
    });
  });

  describe('ImportJob.original', () => {
    it('uses exact identity for preview version 4 and later', () => {
      expect(
        classifyImportOriginalReference('tenant-a', 4, 'tenant-imports/tenant-a/original.xlsx', 'version-1'),
      ).toEqual({ identityClass: 'EXACT_VERSIONED', storageCheck: 'EXACT' });
    });

    it('makes missing version identity a contract violation at preview version 4', () => {
      expect(classifyImportOriginalReference('tenant-a', 4, 'tenant-imports/tenant-a/original.xlsx', null)).toEqual({
        identityClass: 'CONTRACT_VIOLATION',
        storageCheck: 'NONE',
      });
      expect(classifyImportOriginalReference('tenant-a', 4, 'tenant-imports/tenant-a/original.xlsx', '  ')).toEqual({
        identityClass: 'CONTRACT_VIOLATION',
        storageCheck: 'NONE',
      });
    });

    it('permits key-only current lookup only for legacy preview versions', () => {
      expect(classifyImportOriginalReference('tenant-a', 3, 'tenant-imports/tenant-a/original.xlsx', null)).toEqual({
        identityClass: 'LEGACY_KEY_ONLY',
        storageCheck: 'CURRENT',
      });
      expect(
        classifyImportOriginalReference('tenant-a', 3, 'tenant-imports/tenant-a/original.xlsx', 'version-1'),
      ).toEqual({ identityClass: 'EXACT_VERSIONED', storageCheck: 'EXACT' });
    });

    it('rejects a cross-tenant original key without storage access', () => {
      expect(
        classifyImportOriginalReference('tenant-a', 4, 'tenant-imports/tenant-b/original.xlsx', 'version-1'),
      ).toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
    });
  });

  describe('ImportJob.normalized', () => {
    it('classifies null/null as a legitimate absence', () => {
      expect(classifyImportNormalizedReference('tenant-a', 4, ImportJobStatus.BLOCKED, null, null)).toEqual({
        identityClass: 'NOT_APPLICABLE',
        storageCheck: 'NONE',
      });
    });

    it.each([ImportJobStatus.READY, ImportJobStatus.CONFIRMING, ImportJobStatus.CONFIRMED])(
      'requires normalized identity for %s at preview version 4',
      (status) => {
        expect(classifyImportNormalizedReference('tenant-a', 4, status, null, null)).toEqual({
          identityClass: 'CONTRACT_VIOLATION',
          storageCheck: 'NONE',
        });
      },
    );

    it('allows failed imports to have no normalized identity', () => {
      expect(classifyImportNormalizedReference('tenant-a', 4, ImportJobStatus.FAILED, null, null)).toEqual({
        identityClass: 'NOT_APPLICABLE',
        storageCheck: 'NONE',
      });
    });

    it.each([ImportJobStatus.BLOCKED, ImportJobStatus.FAILED])(
      'allows %s imports to have no normalized identity at preview version 3',
      (status) => {
        expect(classifyImportNormalizedReference('tenant-a', 3, status, null, null)).toEqual({
          identityClass: 'NOT_APPLICABLE',
          storageCheck: 'NONE',
        });
      },
    );

    it.each([ImportJobStatus.READY, ImportJobStatus.CONFIRMING, ImportJobStatus.CONFIRMED])(
      'requires normalized identity for %s at preview version 3',
      (status) => {
        expect(classifyImportNormalizedReference('tenant-a', 3, status, null, null)).toEqual({
          identityClass: 'CONTRACT_VIOLATION',
          storageCheck: 'NONE',
        });
      },
    );

    it('requires exact identity when a normalized key is present at preview version 4', () => {
      expect(
        classifyImportNormalizedReference(
          'tenant-a',
          4,
          ImportJobStatus.READY,
          'tenant-imports/tenant-a/normalized.json',
          'version-1',
        ),
      ).toEqual({ identityClass: 'EXACT_VERSIONED', storageCheck: 'EXACT' });
      expect(
        classifyImportNormalizedReference(
          'tenant-a',
          4,
          ImportJobStatus.READY,
          'tenant-imports/tenant-a/normalized.json',
          null,
        ),
      ).toEqual({ identityClass: 'CONTRACT_VIOLATION', storageCheck: 'NONE' });
    });

    it('uses legacy current lookup for a key-only normalized reference before preview version 4', () => {
      expect(
        classifyImportNormalizedReference(
          'tenant-a',
          3,
          ImportJobStatus.READY,
          'tenant-imports/tenant-a/normalized.json',
          null,
        ),
      ).toEqual({ identityClass: 'LEGACY_KEY_ONLY', storageCheck: 'CURRENT' });
    });

    it('rejects structurally contradictory normalized references', () => {
      expect(classifyImportNormalizedReference('tenant-a', 4, ImportJobStatus.READY, null, 'version-1')).toEqual({
        identityClass: 'CONTRACT_VIOLATION',
        storageCheck: 'NONE',
      });
      expect(classifyImportNormalizedReference('tenant-a', 4, ImportJobStatus.READY, ' ', null)).toEqual({
        identityClass: 'INVALID_REFERENCE',
        storageCheck: 'NONE',
      });
      expect(classifyImportNormalizedReference('tenant-a', 4, ImportJobStatus.READY, null, '')).toEqual({
        identityClass: 'INVALID_REFERENCE',
        storageCheck: 'NONE',
      });
    });

    it('rejects malformed exact and legacy version ids without storage access', () => {
      expect(
        classifyImportNormalizedReference(
          'tenant-a',
          4,
          ImportJobStatus.READY,
          'tenant-imports/tenant-a/normalized.json',
          'bad\u0001version',
        ),
      ).toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
      expect(
        classifyImportNormalizedReference(
          'tenant-a',
          3,
          ImportJobStatus.READY,
          'tenant-imports/tenant-a/normalized.json',
          'bad\u0001version',
        ),
      ).toEqual({ identityClass: 'INVALID_REFERENCE', storageCheck: 'NONE' });
      expect(classifyFileReference('tenant-a', 'buildingos', 'tenant-tenant-a/file.pdf', 'bad\u0001version')).toEqual({
        identityClass: 'INVALID_REFERENCE',
        storageCheck: 'NONE',
      });
    });
  });
});
