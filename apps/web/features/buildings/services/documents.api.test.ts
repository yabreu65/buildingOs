import { apiClient, apiClientWithResponse } from '@/shared/lib/http/client';
import {
  downloadDocumentContent,
  downloadProtectedDocumentContent,
  uploadFileToMinio,
  type DocumentCategory,
} from './documents.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
  apiClientWithResponse: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);
const mockedApiClientWithResponse = jest.mocked(apiClientWithResponse);

function createResponse(headers: Record<string, string | undefined>) {
  return {
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()];
      },
    },
  } as never;
}

describe('documents api', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    mockedApiClientWithResponse.mockReset();
  });

  it('downloads resident document content through the protected endpoint and parses the filename from Content-Disposition', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' });
    mockedApiClientWithResponse.mockResolvedValue({
      data: blob,
      response: createResponse({
        'content-disposition': 'inline; filename="Acta Asamblea.pdf"',
        'content-type': 'application/pdf',
      }),
    } as never);

    const result = await downloadProtectedDocumentContent('tenant-1', 'document-1', 'fallback.pdf');

    expect(mockedApiClientWithResponse).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/documents/document-1/content',
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-1' },
      responseType: 'blob',
    });
    expect(result.blob).toBe(blob);
    expect(result.fileName).toBe('Acta Asamblea.pdf');
    expect(result.contentType).toBe('application/pdf');
  });

  it('falls back to the document original name when Content-Disposition is missing', async () => {
    const blob = new Blob(['sheet'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    mockedApiClientWithResponse.mockResolvedValue({
      data: blob,
      response: createResponse({
        'content-disposition': undefined,
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    } as never);

    const result = await downloadProtectedDocumentContent('tenant-1', 'document-2', 'original-name.xlsx');

    expect(result.fileName).toBe('original-name.xlsx');
    expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('includes RULES as a valid DocumentCategory matching the Prisma enum', () => {
    const category: DocumentCategory = 'RULES';
    expect(category).toBe('RULES');
  });

  it('keeps the legacy blob helper available for other resident flows', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' });
    mockedApiClientWithResponse.mockResolvedValue({
      data: blob,
      response: createResponse({
        'content-disposition': 'attachment; filename="recibo.pdf"',
      }),
    } as never);

    const result = await downloadDocumentContent('tenant-1', 'document-3');

    expect(result).toBe(blob);
  });

  it('returns the exact object version exposed by the storage PUT response', async () => {
    let loadHandler: (() => void) | undefined;
    const xhr = {
      upload: { addEventListener: jest.fn() },
      addEventListener: jest.fn((event: string, handler: () => void) => {
        if (event === 'load') loadHandler = handler;
      }),
      open: jest.fn(),
      setRequestHeader: jest.fn(),
      send: jest.fn(),
      status: 200,
      statusText: 'OK',
      getResponseHeader: jest.fn().mockReturnValue('version-1'),
    };
    const originalXMLHttpRequest = globalThis.XMLHttpRequest;
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
      configurable: true,
      value: jest.fn(() => xhr),
    });

    try {
      const upload = uploadFileToMinio(
        'https://storage.example/upload',
        new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' }),
      );
      loadHandler?.();

      await expect(upload).resolves.toEqual({ versionId: 'version-1' });
      expect(xhr.open).toHaveBeenCalledWith('PUT', 'https://storage.example/upload', true);
      expect(xhr.getResponseHeader).toHaveBeenCalledWith('x-amz-version-id');
    } finally {
      Object.defineProperty(globalThis, 'XMLHttpRequest', {
        configurable: true,
        value: originalXMLHttpRequest,
      });
    }
  });

  it('rejects a successful PUT when storage does not expose an object version', async () => {
    let loadHandler: (() => void) | undefined;
    const xhr = {
      upload: { addEventListener: jest.fn() },
      addEventListener: jest.fn((event: string, handler: () => void) => {
        if (event === 'load') loadHandler = handler;
      }),
      open: jest.fn(),
      setRequestHeader: jest.fn(),
      send: jest.fn(),
      status: 200,
      statusText: 'OK',
      getResponseHeader: jest.fn().mockReturnValue(null),
    };
    const originalXMLHttpRequest = globalThis.XMLHttpRequest;
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
      configurable: true,
      value: jest.fn(() => xhr),
    });

    try {
      const upload = uploadFileToMinio(
        'https://storage.example/upload',
        new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' }),
      );
      loadHandler?.();

      await expect(upload).rejects.toThrow('exact object version');
    } finally {
      Object.defineProperty(globalThis, 'XMLHttpRequest', {
        configurable: true,
        value: originalXMLHttpRequest,
      });
    }
  });
});
