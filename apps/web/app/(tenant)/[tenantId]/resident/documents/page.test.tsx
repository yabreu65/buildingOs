/**
 * @jest-environment jsdom
 */

import fs from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams } from 'next/navigation';
import ResidentDocumentsPage from './page';
import { useResidentContext } from '../../../../../features/resident/hooks/useResidentContext';
import { useContextOptions } from '../../../../../features/context/useContextOptions';
import { useTenants } from '../../../../../features/tenants/tenants.hooks';
import * as reactQuery from '@tanstack/react-query';
import {
  downloadProtectedDocumentContent,
  listDocuments,
  type Document,
} from '../../../../../features/buildings/services/documents.api';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('../../../../../features/resident/hooks/useResidentContext', () => ({
  useResidentContext: jest.fn(),
}));

jest.mock('../../../../../features/context/useContextOptions', () => ({
  useContextOptions: jest.fn(),
}));

jest.mock('../../../../../features/tenants/tenants.hooks', () => ({
  useTenants: jest.fn(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));

jest.mock('../../../../../features/buildings/services/documents.api', () => ({
  listDocuments: jest.fn(),
  downloadProtectedDocumentContent: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseResidentContext = jest.mocked(useResidentContext);
const mockedUseContextOptions = jest.mocked(useContextOptions);
const mockedUseTenants = jest.mocked(useTenants);
const mockedUseQuery = jest.mocked(reactQuery.useQuery);
const mockedListDocuments = jest.mocked(listDocuments);
const mockedDownloadProtectedDocumentContent = jest.mocked(downloadProtectedDocumentContent);

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'document-1',
    tenantId: 'tenant-1',
    title: 'Reglamento',
    category: 'MINUTES',
    visibility: 'RESIDENTS',
    buildingId: 'building-1',
    unitId: 'unit-1',
    file: {
      id: 'file-1',
      bucket: 'documents',
      objectKey: 'tenant-1/documents/document-1',
      originalName: 'reglamento.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      checksum: 'checksum-1',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ResidentDocumentsPage', () => {
  let openSpy: jest.SpyInstance;
  let appendSpy: jest.SpyInstance | null = null;
  const originalAppendChild = document.body.appendChild.bind(document.body);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appendSpy = null;

    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUseResidentContext.mockReturnValue({
      data: {
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    mockedUseContextOptions.mockReturnValue({
      data: {
        buildings: [{ id: 'building-1', name: 'Complejo Horizonte' }],
      },
    } as never);
    mockedUseTenants.mockReturnValue({
      data: [{ id: 'tenant-1', name: 'Tenant Uno' }],
    } as never);
    mockedListDocuments.mockResolvedValue([]);
    mockedDownloadProtectedDocumentContent.mockResolvedValue({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      fileName: 'reglamento.pdf',
      contentType: 'application/pdf',
    });

    (window.URL as typeof window.URL & {
      createObjectURL: jest.Mock;
      revokeObjectURL: jest.Mock;
    }).createObjectURL = jest.fn(() => 'blob:document-url');
    (window.URL as typeof window.URL & {
      createObjectURL: jest.Mock;
      revokeObjectURL: jest.Mock;
    }).revokeObjectURL = jest.fn();
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    appendSpy?.mockRestore();
    appendSpy = null;
    openSpy.mockRestore();
    jest.useRealTimers();
  });

  it('shows loading, empty, and list retry states', () => {
    mockedUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    const { rerender } = render(<ResidentDocumentsPage />);
    expect(screen.queryByRole('button', { name: /abrir/i })).toBeNull();

    mockedUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    rerender(<ResidentDocumentsPage />);
    expect(screen.getByText('No hay documentos disponibles para tu unidad.')).toBeTruthy();

    const refetch = jest.fn();
    mockedUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Sin conexión'),
      refetch,
    } as never);
    rerender(<ResidentDocumentsPage />);

    expect(screen.getByText('No pudimos cargar los documentos')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders file metadata from document.file and tolerates incomplete metadata', async () => {
    mockedUseQuery.mockReturnValue({
      data: [
        makeDocument({
          file: {
            ...makeDocument().file,
            originalName: 'contrato.pdf',
            mimeType: 'application/pdf',
            size: 1536000,
          },
        }),
        makeDocument({
          id: 'document-2',
          title: 'Sin metadatos completos',
          file: {
            id: 'file-2',
            bucket: 'documents',
            objectKey: 'tenant-1/documents/document-2',
            originalName: '',
            mimeType: '',
            size: undefined as never,
            checksum: undefined,
            createdAt: '2026-07-02T00:00:00.000Z',
          },
        }),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);

    expect(await screen.findByText('contrato.pdf')).toBeTruthy();
    expect(screen.getByText('application/pdf')).toBeTruthy();
    expect(screen.getByText('1.5 MB')).toBeTruthy();
    expect(screen.getByText('Archivo sin nombre')).toBeTruthy();
    expect(screen.getByText('Tipo desconocido')).toBeTruthy();
    expect(screen.getByText('Tamaño desconocido')).toBeTruthy();
  });

  it('opens PDFs through a protected blob URL and revokes it later', async () => {
    const previewWindow = { location: { href: '' }, close: jest.fn() } as unknown as Window;
    openSpy.mockImplementation(() => previewWindow);
    mockedUseQuery.mockReturnValue({
      data: [makeDocument({ title: 'Reglamento', file: { ...makeDocument().file, mimeType: 'application/pdf' } })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Reglamento' }));

    await waitFor(() => {
      expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledWith('tenant-1', 'document-1', 'reglamento.pdf');
      expect(openSpy).toHaveBeenCalledWith('', '_blank', 'noopener,noreferrer');
      expect(previewWindow.location.href).toBe('blob:document-url');
    });

    expect((window.URL as typeof window.URL & { revokeObjectURL: jest.Mock }).revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect((window.URL as typeof window.URL & { revokeObjectURL: jest.Mock }).revokeObjectURL).toHaveBeenCalledWith('blob:document-url');
  });

  it('opens images through a protected blob URL and keeps the button disabled while opening', async () => {
    const previewWindow = { location: { href: '' }, close: jest.fn() } as unknown as Window;
    openSpy.mockImplementation(() => previewWindow);
    const deferred = createDeferred<{
      blob: Blob;
      fileName: string;
      contentType: string;
    }>();

    mockedDownloadProtectedDocumentContent.mockReturnValue(deferred.promise as never);
    mockedUseQuery.mockReturnValue({
      data: [makeDocument({ id: 'document-image', title: 'Plano', file: { ...makeDocument().file, mimeType: 'image/png', originalName: 'plano.png' } })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    const button = (await screen.findByRole('button', { name: 'Abrir Plano' })) as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);

    expect(button.disabled).toBe(true);
    expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(1);

    deferred.resolve({
      blob: new Blob(['image'], { type: 'image/png' }),
      fileName: 'plano.png',
      contentType: 'image/png',
    });

    await waitFor(() => {
      expect(previewWindow.location.href).toBe('blob:document-url');
    });
  });

  it('downloads non-previewable documents with the resolved filename', async () => {
    const clickedAnchors: HTMLAnchorElement[] = [];
    appendSpy = jest.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      if (node instanceof HTMLAnchorElement) {
        clickedAnchors.push(node);
      }
      return originalAppendChild(node);
    });
    mockedDownloadProtectedDocumentContent.mockResolvedValue({
      blob: new Blob(['csv'], { type: 'text/csv' }),
      fileName: 'listado.csv',
      contentType: 'text/csv',
    });
    mockedUseQuery.mockReturnValue({
      data: [
        makeDocument({
          id: 'document-csv',
          title: 'Listado',
          category: 'OTHER',
          file: {
            ...makeDocument().file,
            mimeType: 'text/csv',
            originalName: 'listado.csv',
          },
        }),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar Listado' }));

    await waitFor(() => {
      expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledWith('tenant-1', 'document-csv', 'listado.csv');
      expect(openSpy).not.toHaveBeenCalled();
      expect(clickedAnchors[0].download).toBe('listado.csv');
    });
  });

  it('surfaces an opening error without reusing the list error copy', async () => {
    mockedDownloadProtectedDocumentContent.mockRejectedValueOnce(new Error('No pudimos abrir el archivo. Intentá nuevamente.'));
    mockedUseQuery.mockReturnValue({
      data: [makeDocument({ title: 'Reglamento' })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Reglamento' }));

    expect(await screen.findByText('No pudimos abrir “Reglamento”')).toBeTruthy();
    expect(screen.getByText('No pudimos abrir el archivo. Intentá nuevamente.')).toBeTruthy();
    expect(screen.queryByText('No pudimos cargar los documentos')).toBeNull();
  });

  it('falls back to anchor download when window.open is blocked for a previewable document', async () => {
    openSpy.mockImplementation(() => null);

    const clickedAnchors: HTMLAnchorElement[] = [];
    appendSpy = jest.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      if (node instanceof HTMLAnchorElement) {
        clickedAnchors.push(node);
      }
      return originalAppendChild(node);
    });
    mockedDownloadProtectedDocumentContent.mockResolvedValue({
      blob: new Blob(['image'], { type: 'image/png' }),
      fileName: 'plano.png',
      contentType: 'image/png',
    });

    mockedUseQuery.mockReturnValue({
      data: [
        makeDocument({
          id: 'doc-popup-blocked',
          title: 'Plano Bloqueado',
          file: {
            ...makeDocument().file,
            mimeType: 'image/png',
            originalName: 'plano.png',
          },
        }),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Plano Bloqueado' }));

    await waitFor(() => {
      expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(1);
      expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledWith('tenant-1', 'doc-popup-blocked', 'plano.png');
    });

    expect(clickedAnchors.length).toBe(1);
    expect(clickedAnchors[0].download).toBe('plano.png');
    expect(screen.queryByText('No pudimos abrir')).toBeNull();

    await waitFor(() => {
      expect((screen.queryByRole('button', { name: /abrir plano bloqueado/i }) as HTMLButtonElement | null)?.disabled).toBe(false);
    });
  });

  it('prevents duplicate requests while a document is opening', async () => {
    const deferred = createDeferred<{
      blob: Blob;
      fileName: string;
      contentType: string;
    }>();
    mockedDownloadProtectedDocumentContent.mockReturnValue(deferred.promise as never);
    mockedUseQuery.mockReturnValue({
      data: [makeDocument({ title: 'Reglamento' })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    const button = (await screen.findByRole('button', { name: 'Abrir Reglamento' })) as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    deferred.resolve({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      fileName: 'reglamento.pdf',
      contentType: 'application/pdf',
    });

    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('does not reference the legacy download route or MinIO metadata in the resident screen source', () => {
    const source = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toContain('/download');
    expect(source).not.toContain('bucket');
    expect(source).not.toContain('objectKey');
    expect(source).not.toContain('minio');
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
