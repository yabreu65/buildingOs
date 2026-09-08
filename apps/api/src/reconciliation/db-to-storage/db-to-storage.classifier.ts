import { ImportJobStatus } from '@prisma/client';
import { ONBOARDING_IMPORT_EXACT_OBJECT_IDENTITY_PREVIEW_VERSION } from '../../onboarding-imports/onboarding-imports.constants';
import {
  ClassificationDecision,
  IdentityClass,
  StorageCheck,
} from './db-to-storage.types';

type NullableString = string | null | undefined;

type ValueState = 'ABSENT' | 'BLANK' | 'VALID' | 'INVALID';

const FILE_OBJECT_KEY_NAMESPACES = ['tenant-', 'tenant/', 'pilot-data-pack/'] as const;
const IMPORT_OBJECT_KEY_NAMESPACE = 'tenant-imports/';
const IMPORT_OBJECT_KEY_NAMESPACES = [IMPORT_OBJECT_KEY_NAMESPACE] as const;
const RECOGNIZED_TENANT_KEY_NAMESPACES = [
  'tenant-imports/',
  'pilot-data-pack/',
  'tenant/',
  'tenant-',
] as const;

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

function hasTenantScopedObjectKey(
  tenantId: NullableString,
  objectKey: NullableString,
  namespaces: readonly string[],
): boolean {
  if (classifyValue(tenantId, true) !== 'VALID' || typeof objectKey !== 'string') {
    return false;
  }

  return namespaces.some((namespace) => {
    const prefix = `${namespace}${tenantId}/`;
    return objectKey.startsWith(prefix) && objectKey.length > prefix.length;
  });
}

function hasForeignTenantScopedObjectKey(tenantId: NullableString, objectKey: string): boolean {
  if (classifyValue(tenantId, true) !== 'VALID') {
    return false;
  }

  const namespace = RECOGNIZED_TENANT_KEY_NAMESPACES.find((candidate) => objectKey.startsWith(candidate));
  if (!namespace) {
    return false;
  }

  const segments = objectKey.slice(namespace.length).split('/');
  if (segments.length < 2 || !segments[0] || !segments[1]) {
    return false;
  }

  return segments[0] !== tenantId;
}

function classifyKeyOnlyAttachmentReference(
  tenantId: NullableString,
  objectKey: NullableString,
): ClassificationDecision {
  if (objectKey === null || objectKey === undefined) {
    return decision('NOT_APPLICABLE', 'NONE');
  }

  if (
    classifyValue(objectKey, true) !== 'VALID'
    || objectKey.includes('\\')
    || objectKey.startsWith('/')
    || hasForeignTenantScopedObjectKey(tenantId, objectKey)
  ) {
    return decision('INVALID_REFERENCE', 'NONE');
  }

  const segments = objectKey.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return decision('INVALID_REFERENCE', 'NONE');
  }

  return decision('KEY_ONLY_UNVERSIONED', 'NONE');
}

export function classifyExpenseAttachmentReference(
  tenantId: string,
  objectKey: NullableString,
): ClassificationDecision {
  return classifyKeyOnlyAttachmentReference(tenantId, objectKey);
}

export function classifyIncomeAttachmentReference(
  tenantId: string,
  objectKey: NullableString,
): ClassificationDecision {
  return classifyKeyOnlyAttachmentReference(tenantId, objectKey);
}

export function classifyFileReference(
  tenantId: string,
  bucket: NullableString,
  objectKey: NullableString,
  objectVersionId: NullableString,
): ClassificationDecision {
  const bucketState = classifyValue(bucket, true);
  const keyState = classifyValue(objectKey, true);

  if (
    bucketState !== 'VALID' ||
    keyState !== 'VALID' ||
    !hasTenantScopedObjectKey(tenantId, objectKey, FILE_OBJECT_KEY_NAMESPACES)
  ) {
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
  tenantId: string,
  previewVersion: number,
  objectKey: NullableString,
  objectVersionId: NullableString,
): ClassificationDecision {
  if (
    classifyValue(objectKey, true) !== 'VALID' ||
    !hasTenantScopedObjectKey(tenantId, objectKey, IMPORT_OBJECT_KEY_NAMESPACES)
  ) {
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
  tenantId: string,
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

  if (!hasTenantScopedObjectKey(tenantId, objectKey, IMPORT_OBJECT_KEY_NAMESPACES)) {
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
