import {
  isAllowedMediaType,
  isStorageObjectMimeCompatible,
  parseMediaType,
} from '@buildingos/contracts';

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

const ONBOARDING_IMPORT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/octet-stream',
]);

const PAYMENT_PROOF_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

describe('media type validation', () => {
  it('parses canonical media type essences while retaining the raw value', () => {
    expect(parseMediaType('  TEXT/PLAIN; CHARSET=UTF-8  ')).toEqual({
      raw: '  TEXT/PLAIN; CHARSET=UTF-8  ',
      essence: 'text/plain',
      parameters: [{ name: 'charset', value: 'UTF-8' }],
    });
  });

  it.each([
    'text/plain',
    'text/plain; charset=UTF-8',
    'text/plain;charset=utf-8',
    'TEXT/PLAIN; CHARSET=UTF-8',
    'text/plain; charset="UTF-8"',
  ])('allows the approved text/plain representation %s', (mimeType) => {
    expect(isAllowedMediaType(mimeType, DOCUMENT_MIME_TYPES)).toBe(true);
  });

  it.each([
    'text/html; charset=UTF-8',
    'text/plain-evil',
    'text/plainx',
    '*/*',
    'text/*',
    'text/',
    'text/plain; charset',
    'text/plain; charset=iso-8859-1',
    'text/plain; boundary=attacker',
    'application/pdf; charset=UTF-8',
    'application/pdf; charset="UTF-8',
    'application/pdf; charset=UTF-8; charset=UTF-8',
    '\r\ntext/plain',
    'application/pdf\r\nX-Content-Type: text/html',
    'application/pdf-evil',
  ])('rejects unsafe or malformed MIME input %s', (mimeType) => {
    expect(isAllowedMediaType(mimeType, DOCUMENT_MIME_TYPES)).toBe(false);
  });

  it.each([...DOCUMENT_MIME_TYPES])('preserves every allowed document MIME type: %s', (mimeType) => {
    expect(isAllowedMediaType(mimeType, DOCUMENT_MIME_TYPES)).toBe(true);
  });

  it.each([...ONBOARDING_IMPORT_MIME_TYPES])('preserves every allowed onboarding MIME type: %s', (mimeType) => {
    expect(isAllowedMediaType(mimeType, ONBOARDING_IMPORT_MIME_TYPES)).toBe(true);
  });

  it.each([...PAYMENT_PROOF_MIME_TYPES])('preserves every allowed payment proof MIME type: %s', (mimeType) => {
    expect(isAllowedMediaType(mimeType, PAYMENT_PROOF_MIME_TYPES)).toBe(true);
  });

  it('allows storage text/plain normalization only after hash and size equality', () => {
    const comparison = {
      sourceContentType: 'text/plain',
      destinationContentType: 'text/plain; charset=UTF-8',
      sourceSha256: 'source-hash',
      destinationSha256: 'source-hash',
      sourceSize: 42,
      destinationSize: 42,
    };

    expect(isStorageObjectMimeCompatible(comparison)).toBe(true);
    expect(isStorageObjectMimeCompatible({ ...comparison, destinationSha256: 'other-hash' })).toBe(false);
    expect(isStorageObjectMimeCompatible({ ...comparison, destinationSize: 43 })).toBe(false);
    expect(isStorageObjectMimeCompatible({ ...comparison, destinationContentType: 'application/pdf' })).toBe(false);
  });

  it('keeps non-text storage MIME comparisons strict', () => {
    expect(isStorageObjectMimeCompatible({
      sourceContentType: 'application/pdf',
      destinationContentType: 'application/pdf; charset=UTF-8',
      sourceSha256: 'hash',
      destinationSha256: 'hash',
      sourceSize: 1,
      destinationSize: 1,
    })).toBe(false);
  });
});
