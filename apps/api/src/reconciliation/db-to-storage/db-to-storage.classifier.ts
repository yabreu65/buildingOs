import { ImportJobStatus } from '@prisma/client';
import { ONBOARDING_IMPORT_EXACT_OBJECT_IDENTITY_PREVIEW_VERSION } from '../../onboarding-imports/onboarding-imports.constants';
import {
  ClassificationDecision,
  IdentityClass,
  StorageCheck,
} from './db-to-storage.types';

type NullableString = string | null | undefined;

type ValueState = 'ABSENT' | 'BLANK' | 'VALID' | 'INVALID';

function classifyValue(value: NullableString, allowNullishOnly: boolean): ValueState {
  if (value === null || value === undefined) {
    return 'ABSENT';
  }

  if (typeof value !== 'string') {
    return 'INVALID';
  }

  if (value.trim().length === 0) {
    return allowNullishOnly ? 'INVALID' : 'BLANK';
  }

  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    return 'INVALID';
  }

  return 'VALID';
}

function decision(identityClass: IdentityClass, storageCheck: StorageCheck): ClassificationDecision {
  return { identityClass, storageCheck };
}

export function classifyFileReference(
  bucket: NullableString,
  objectKey: NullableString,
  objectVersionId: NullableString,
): ClassificationDecision {
  const bucketState = classifyValue(bucket, true);
  const keyState = classifyValue(objectKey, true);

  if (bucketState !== 'VALID' || keyState !== 'VALID') {
    return decision('INVALID_REFERENCE', 'NONE');
  }

  const versionState = classifyValue(objectVersionId, false);
  if (versionState === 'VALID') {
    return decision('EXACT_VERSIONED', 'EXACT');
  }

  return versionState === 'INVALID'
    ? decision('INVALID_REFERENCE', 'NONE')
    : decision('LEGACY_OR_UNKNOWN', 'CURRENT');
}

export function classifyImportOriginalReference(
  previewVersion: number,
  objectKey: NullableString,
  objectVersionId: NullableString,
): ClassificationDecision {
  if (classifyValue(objectKey, true) !== 'VALID') {
    return decision('INVALID_REFERENCE', 'NONE');
  }

  const versionState = classifyValue(objectVersionId, false);
  if (versionState === 'VALID') {
    return decision('EXACT_VERSIONED', 'EXACT');
  }

  if (versionState === 'INVALID') {
    return decision('INVALID_REFERENCE', 'NONE');
  }

  return previewVersion >= ONBOARDING_IMPORT_EXACT_OBJECT_IDENTITY_PREVIEW_VERSION
    ? decision('CONTRACT_VIOLATION', 'NONE')
    : decision('LEGACY_KEY_ONLY', 'CURRENT');
}

export function classifyImportNormalizedReference(
  previewVersion: number,
  status: ImportJobStatus,
  objectKey: NullableString,
  objectVersionId: NullableString,
): ClassificationDecision {
  const keyState = classifyValue(objectKey, true);
  const versionState = classifyValue(objectVersionId, false);

  if (keyState === 'ABSENT' && versionState === 'ABSENT') {
    if (status !== ImportJobStatus.BLOCKED && status !== ImportJobStatus.FAILED) {
      return decision('CONTRACT_VIOLATION', 'NONE');
    }

    return decision('NOT_APPLICABLE', 'NONE');
  }

  if (keyState === 'INVALID' || (keyState === 'ABSENT' && versionState !== 'ABSENT')) {
    return decision(
      keyState === 'ABSENT' && versionState === 'VALID'
        ? 'CONTRACT_VIOLATION'
        : 'INVALID_REFERENCE',
      'NONE',
    );
  }

  if (versionState === 'INVALID') {
    return decision('INVALID_REFERENCE', 'NONE');
  }

  if (versionState === 'VALID') {
    return decision('EXACT_VERSIONED', 'EXACT');
  }

  return previewVersion >= ONBOARDING_IMPORT_EXACT_OBJECT_IDENTITY_PREVIEW_VERSION
    ? decision('CONTRACT_VIOLATION', 'NONE')
    : decision('LEGACY_KEY_ONLY', 'CURRENT');
}

export function redactObjectReference(objectKey: string | null | undefined): string {
  if (typeof objectKey !== 'string' || objectKey.trim().length === 0) {
    return '[invalid-or-empty-key]';
  }

  const segments = objectKey.split('/');
  const leaf = segments[segments.length - 1] ?? '';
  return `[redacted:${segments.length}-segments:leaf-length-${leaf.length}]`;
}
