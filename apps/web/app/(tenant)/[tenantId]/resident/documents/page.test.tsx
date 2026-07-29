/**
 * @jest-environment jsdom
 */

import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

jest.mock('../../../../../shared/lib/format/money', () => ({
  formatCurrency: (cents: number, currency: string) => `${currency} ${(cents / 100).toFixed(2)}`,
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseResidentContext = jest.mocked(useResidentContext);
const mockedUseContextOptions = jest.mocked(useContextOptions);
const mockedUseTenants = jest.mocked(useTenants);
const mockedUseQuery = jest.mocked(reactQuery.useQuery);
const mockedListDocuments = jest.mocked(listDocuments);
const mockedDownloadProtectedDocumentContent = jest.mocked(downloadProtectedDocumentContent);

function setMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)' ? matches : !matches,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

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

function makeReceiptDocument(overrides: Partial<Document> = {}, paymentId = 'pay-1'): Document {
  return makeDocument({
    id: 'doc-receipt',
    title: 'Comprobante pago - transfer.pdf',
    category: 'RECEIPT',
    functionalType: 'PAYMENT_RECEIPT',
    origin: 'GENERATED',
    payment: {
      id: paymentId,
      amount: 500000,
      currency: 'UYU',
      status: 'APPROVED',
      reference: 'TR-001',
      receiptNumber: 'REC-2025-001',
      period: '2025-07',
    },
    ...overrides,
  });
}

function makeProofDocument(overrides: Partial<Document> = {}, paymentId = 'pay-2'): Document {
  return makeDocument({
    id: 'doc-proof',
    title: 'Comprobante pago - BBVA.pdf',
    category: 'RECEIPT',
    functionalType: 'PAYMENT_PROOF',
    origin: 'UPLOADED',
    payment: {
      id: paymentId,
      amount: 350000,
      currency: 'UYU',
      status: 'SUBMITTED',
      reference: null,
      receiptNumber: null,
      period: null,
    },
    ...overrides,
  });
}

describe('ResidentDocumentsPage', () => {
  let appendSpy: jest.SpyInstance | null = null;
  const originalAppendChild = document.body.appendChild.bind(document.body);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appendSpy = null;
    setMatchMedia(false);

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
  });

  afterEach(() => {
    appendSpy?.mockRestore();
    appendSpy = null;
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
    expect(screen.queryByRole('button', { name: /ver documento/i })).toBeNull();

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

  it('renders file metadata and tolerates incomplete metadata', async () => {
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

  it('opens document in modal via "Ver documento" button', async () => {
    mockedUseQuery.mockReturnValue({
      data: [makeDocument({ title: 'Reglamento', file: { ...makeDocument().file, mimeType: 'application/pdf' } })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

    await waitFor(() => {
      expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledWith('tenant-1', 'document-1', 'reglamento.pdf');
    });

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Descargar')).toBeTruthy();
  });

  it('surfaces an opening error', async () => {
    mockedDownloadProtectedDocumentContent.mockRejectedValueOnce(new Error('No se pudo cargar el documento.'));
    mockedUseQuery.mockReturnValue({
      data: [makeDocument({ title: 'Reglamento' })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

    expect(await screen.findByText('No se pudo cargar el documento.')).toBeTruthy();
  });

  it('does NOT open new windows or tabs — modal only', async () => {
    const openSpy = jest.spyOn(window, 'open');
    mockedUseQuery.mockReturnValue({
      data: [makeDocument({ title: 'Reglamento' })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

    await waitFor(() => {
      expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalled();
    });

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('closes modal when clicking close button', async () => {
    mockedUseQuery.mockReturnValue({
      data: [makeDocument({ title: 'Reglamento' })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Cerrar'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('does NOT have "Abrir" or "Vista previa" buttons', () => {
    mockedUseQuery.mockReturnValue({
      data: [makeDocument()],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<ResidentDocumentsPage />);

    expect(screen.queryByRole('button', { name: /abrir/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /vista previa/i })).toBeNull();
    expect(screen.getByRole('button', { name: /ver documento/i })).toBeTruthy();
  });

  it('does not reference the legacy download route or MinIO metadata', () => {
    const source = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toContain('/download');
    expect(source).not.toContain('bucket');
    expect(source).not.toContain('objectKey');
    expect(source).not.toContain('minio');
  });

  describe('Mobile layout', () => {
    beforeEach(() => {
      setMatchMedia(true);
    });

    it('renders compact context without leaking the tenantId fallback', () => {
      mockedUseTenants.mockReturnValue({
        data: undefined,
      } as never);
      mockedUseQuery.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.getByText('Administración actual')).toBeTruthy();
      expect(screen.queryByText('tenant-1')).toBeNull();
      expect(screen.getByText('Documentos')).toBeTruthy();
      expect(screen.getByText(/Consulta comprobantes, recibos y archivos de tu unidad\./i)).toBeTruthy();
    });

    it('keeps the filter bar horizontal and uses pressed toggles', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument(), makeProofDocument(), makeDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      const filterBar = screen.getByLabelText('Filtrar documentos');
      expect(filterBar.className).toContain('overflow-x-auto');
      expect(screen.getByRole('button', { name: /Todos.*\(3\)/ }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: /Recibos de pago.*\(1\)/ }).getAttribute('aria-pressed')).toBe('false');
    });

    it('groups receipt and proof documents only when they share the same payment id', () => {
      mockedUseQuery.mockReturnValue({
        data: [
          makeReceiptDocument(
            { payment: { ...makeReceiptDocument().payment!, id: 'shared-payment', period: '2025-07' } },
            'shared-payment',
          ),
          makeProofDocument(
            { payment: { ...makeProofDocument().payment!, id: 'shared-payment', period: '2025-07' } },
            'shared-payment',
          ),
          makeDocument({ id: 'document-2', title: 'Reglamento' }),
        ],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.getAllByText(/2 documentos/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('button', { name: /ver comprobante/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /ver recibo/i })).toBeTruthy();
      expect(screen.getByText('Reglamento')).toBeTruthy();
    });

    it('keeps unrelated payment documents separate when their payment ids differ', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument(), makeProofDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.queryByText(/2 documentos/i)).toBeNull();
      expect(screen.getAllByRole('button', { name: /ver comprobante/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /ver recibo/i })).toHaveLength(1);
    });

    it('supports search and clear in the compact mobile view', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument(), makeDocument({ title: 'Reglamento de convivencia' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      const input = screen.getByLabelText('Buscar documentos');
      fireEvent.change(input, { target: { value: 'Reglamento' } });

      expect(screen.queryByText('Comprobante pago - transfer.pdf')).toBeNull();
      expect(screen.getByText('Reglamento de convivencia')).toBeTruthy();

      fireEvent.click(screen.getByLabelText('Limpiar búsqueda'));
      expect((screen.getByLabelText('Buscar documentos') as HTMLInputElement).value).toBe('');
    });

    it('keeps civil dates stable for ISO and date-only inputs', () => {
      mockedUseQuery.mockReturnValue({
        data: [
          makeDocument({ id: 'date-only', title: 'Fecha civil', createdAt: '2026-07-24' }),
          makeDocument({ id: 'iso-ts', title: 'Timestamp ISO', createdAt: '2026-07-24T00:00:00.000Z' }),
        ],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.getAllByText(/24 de jul de 2026/i).length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText(/Fecha desconocida/i)).toBeNull();
    });

    it('shows a safe fallback for invalid dates', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ id: 'invalid-date', title: 'Sin fecha', createdAt: 'not-a-date' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.getByText(/Fecha desconocida/i)).toBeTruthy();
    });
  });

  describe('Filter bar', () => {
    it('renders search input and filter buttons when documents exist', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument(), makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.getByPlaceholderText(/Buscar por título/)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Todos.*\(2\)/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Recibos de pago.*\(1\)/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Comprobantes.*\(0\)/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Otros documentos.*\(1\)/ })).toBeTruthy();
    });

    it('does not render filter bar when no documents exist', () => {
      mockedUseQuery.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.queryByPlaceholderText(/Buscar por título/)).toBeNull();
    });

    it('shows correct document counts on filter buttons', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument(), makeProofDocument(), makeDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.getByRole('button', { name: /Todos.*\(3\)/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Recibos de pago.*\(1\)/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Comprobantes.*\(1\)/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Otros documentos.*\(1\)/ })).toBeTruthy();
    });
  });

  describe('Search', () => {
    it('filters documents by title', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento' }), makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.change(screen.getByPlaceholderText(/Buscar por título/), { target: { value: 'Comprobante' } });

      expect(screen.queryByText('Reglamento')).toBeNull();
      expect(screen.getByText('Comprobante pago - transfer.pdf')).toBeTruthy();
    });

    it('filters documents by payment reference', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.change(screen.getByPlaceholderText(/Buscar por título/), { target: { value: 'TR-001' } });

      expect(screen.getByText('Comprobante pago - transfer.pdf')).toBeTruthy();
    });

    it('filters documents by receipt number', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.change(screen.getByPlaceholderText(/Buscar por título/), { target: { value: 'REC-2025' } });

      expect(screen.getByText('Comprobante pago - transfer.pdf')).toBeTruthy();
    });

    it('shows empty state when search matches nothing', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.change(screen.getByPlaceholderText(/Buscar por título/), { target: { value: 'xyz123' } });

      expect(screen.getByText(/No se encontraron documentos/)).toBeTruthy();
    });

    it('clears search when clicking clear button', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      const input = screen.getByPlaceholderText(/Buscar por título/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'xyz' } });

      fireEvent.click(screen.getByLabelText('Limpiar búsqueda'));

      expect(input.value).toBe('');
    });

    it('filters documents by period', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.change(screen.getByPlaceholderText(/Buscar por título/), { target: { value: '2025-07' } });

      expect(screen.getByText('Comprobante pago - transfer.pdf')).toBeTruthy();
    });

    it('filters documents by payment status label', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.change(screen.getByPlaceholderText(/Buscar por título/), { target: { value: 'Aprobado' } });

      expect(screen.getByText('Comprobante pago - transfer.pdf')).toBeTruthy();
    });

    it('filters documents by amount', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.change(screen.getByPlaceholderText(/Buscar por título/), { target: { value: '5000' } });

      expect(screen.getByText('Comprobante pago - transfer.pdf')).toBeTruthy();
    });

    it('filters documents by payment status keyword', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeProofDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.change(screen.getByPlaceholderText(/Buscar por título/), { target: { value: 'Pendiente' } });

      expect(screen.getByText('Comprobante pago - BBVA.pdf')).toBeTruthy();
    });
  });

  describe('Type filter', () => {
    it('filters to PAYMENT_RECEIPT only', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument(), makeProofDocument(), makeDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(screen.getByRole('button', { name: /Recibos de pago/ }));

      expect(screen.getByText('Comprobante pago - transfer.pdf')).toBeTruthy();
      expect(screen.queryByText('Comprobante pago - BBVA.pdf')).toBeNull();
      expect(screen.queryByText('Reglamento')).toBeNull();
    });

    it('filters to PAYMENT_PROOF only', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument(), makeProofDocument(), makeDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(screen.getByRole('button', { name: /Comprobantes/ }));

      expect(screen.getByText('Comprobante pago - BBVA.pdf')).toBeTruthy();
      expect(screen.queryByText('Comprobante pago - transfer.pdf')).toBeNull();
      expect(screen.queryByText('Reglamento')).toBeNull();
    });

    it('filters to OTHER only', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument(), makeProofDocument(), makeDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(screen.getByRole('button', { name: /Otros documentos/ }));

      expect(screen.getByText('Reglamento')).toBeTruthy();
      expect(screen.queryByText('Comprobante pago - transfer.pdf')).toBeNull();
      expect(screen.queryByText('Comprobante pago - BBVA.pdf')).toBeNull();
    });

    it('clears filters and shows all documents', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument(), makeProofDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      fireEvent.click(screen.getByRole('button', { name: /Recibos de pago/ }));
      await waitFor(() => {
        expect(screen.queryByText('Comprobante pago - BBVA.pdf')).toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /Otros documentos/ }));
      await waitFor(() => {
        expect(screen.getByText(/No se encontraron documentos/)).toBeTruthy();
      });

      fireEvent.click(screen.getByText('Limpiar filtros'));
      await waitFor(() => {
        expect(screen.getByText('Comprobante pago - transfer.pdf')).toBeTruthy();
        expect(screen.getByText('Comprobante pago - BBVA.pdf')).toBeTruthy();
      });
    });
  });

  describe('Payment labels and metadata', () => {
    it('shows RECEIPT badge for PAYMENT_RECEIPT documents', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      const receiptBadges = screen.getAllByText('Recibo de pago');
      expect(receiptBadges.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Generado por BuildingOS')).toBeTruthy();
    });

    it('shows PROOF badge for PAYMENT_PROOF documents', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeProofDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      const proofBadges = screen.getAllByText('Comprobante de pago');
      expect(proofBadges.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Subido por el residente')).toBeTruthy();
    });

    it('does NOT show "Documento" as the type label for payment documents', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      const typeSpans = screen.queryAllByText(/^Documento$/);
      expect(typeSpans.length).toBe(0);
    });

    it('shows document category for non-payment documents', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ category: 'MINUTES' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.getByText('MINUTES')).toBeTruthy();
    });

    it('displays payment amount, status, period, and reference', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeReceiptDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.getByText('UYU 5000.00')).toBeTruthy();
      expect(screen.getByText('Aprobado')).toBeTruthy();
      expect(screen.getByText('Período: 2025-07')).toBeTruthy();
      expect(screen.getByText('Ref: TR-001')).toBeTruthy();
      expect(screen.getByText('Nº REC-2025-001')).toBeTruthy();
    });

    it('does not show payment metadata for non-payment documents', () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument()],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      expect(screen.queryByText(/UYU/)).toBeNull();
      expect(screen.queryByText('Aprobado')).toBeNull();
    });
  });

  describe('Truncation', () => {
    it('truncates long titles with title attribute for full text', () => {
      const longTitle = 'Este es un título extremadamente largo que debería truncarse visualmente para no romper el layout de la tarjeta';
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: longTitle })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      const titleElement = screen.getByText(longTitle);
      expect(titleElement).toBeTruthy();
      expect(titleElement.getAttribute('title')).toBe(longTitle);
      expect(titleElement.className).toContain('truncate');
    });

    it('truncates long filenames with title attribute', () => {
      const longName = 'comprobante-de-pago-transferencia-bancaria-muy-largo-que-deberia-truncarse.pdf';
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ file: { ...makeDocument().file, originalName: longName } })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      const nameElement = screen.getByText(longName);
      expect(nameElement).toBeTruthy();
      expect(nameElement.getAttribute('title')).toBe(longName);
      expect(nameElement.className).toContain('truncate');
    });
  });

  describe('Modal', () => {
    it('opens modal from "Ver documento" and shows PDF iframe', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento', file: { ...makeDocument().file, mimeType: 'application/pdf' } })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByText('Cargando documento...')).toBeTruthy();
      });

      await waitFor(() => {
        expect(screen.getByTestId('modal-title')).toBeTruthy();
      });
    });

    it('download happens inside modal only', async () => {
      jest.useRealTimers();
      const clickedAnchors: HTMLAnchorElement[] = [];
      appendSpy = jest.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
        if (node instanceof HTMLAnchorElement) {
          clickedAnchors.push(node);
        }
        return originalAppendChild(node);
      });

      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento', file: { ...makeDocument().file, mimeType: 'application/pdf' } })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      mockedDownloadProtectedDocumentContent.mockResolvedValue({
        blob: new Blob(['pdf-content'], { type: 'application/pdf' }),
        contentType: 'application/pdf',
        fileName: 'reglamento.pdf',
      });

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });

      await waitFor(() => {
        expect(screen.getByText('Descargar')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('Descargar'));

      await waitFor(() => {
        expect(clickedAnchors.length).toBe(1);
      });
    });

    it('preview and download use a single API request', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByText('Descargar'));

      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(1);
      });
    });

    it('closes modal on Escape key', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    });

    it('shows error when downloaded blob is empty', async () => {
      mockedDownloadProtectedDocumentContent.mockResolvedValueOnce({
        blob: new Blob([], { type: 'application/pdf' }),
        fileName: 'empty.pdf',
        contentType: 'application/pdf',
      });
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Vacío' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento vacío/i }));

      expect(await screen.findByText('El archivo está vacío o no se pudo descargar.')).toBeTruthy();
    });

    it('renders iframe with blob URL for PDF documents', async () => {
      mockedDownloadProtectedDocumentContent.mockResolvedValue({
        blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
        fileName: 'test.pdf',
        contentType: 'application/pdf',
      });
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'PDF Test' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento pdf test/i }));

      await waitFor(() => {
        const iframe = document.querySelector('iframe');
        expect(iframe).toBeTruthy();
        expect(iframe?.getAttribute('src')).toBe('blob:document-url');
      });
    });

    it('calls createObjectURL when preview content arrives', async () => {
      const createObjectURLSpy = jest.fn(() => 'blob:test-url');
      (window.URL as typeof window.URL & { createObjectURL: jest.Mock }).createObjectURL = createObjectURLSpy;

      mockedDownloadProtectedDocumentContent.mockResolvedValue({
        blob: new Blob(['content'], { type: 'application/pdf' }),
        fileName: 'test.pdf',
        contentType: 'application/pdf',
      });
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'URL Test' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento url test/i }));

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
      });
    });
  });

  describe('Focus trap', () => {
    it('dialog contains focusable elements and focus stays inside on Tab', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });
      await waitFor(() => {
        expect(document.querySelector('iframe')).toBeTruthy();
      });

      const dialog = screen.getByRole('dialog');
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
      expect(focusable.length).toBeGreaterThanOrEqual(2);

      focusable[0].focus();
      expect(document.activeElement).toBe(focusable[0]);
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('wraps Tab from last element to first', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });
      await waitFor(() => {
        expect(document.querySelector('iframe')).toBeTruthy();
      });

      const dialog = screen.getByRole('dialog');
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
      expect(focusable.length).toBeGreaterThanOrEqual(2);

      focusable[focusable.length - 1].focus();
      expect(document.activeElement).toBe(focusable[focusable.length - 1]);

      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(focusable[0]);
    });

    it('wraps Shift+Tab from first element to last', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });
      await waitFor(() => {
        expect(document.querySelector('iframe')).toBeTruthy();
      });

      const dialog = screen.getByRole('dialog');
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
      expect(focusable.length).toBeGreaterThanOrEqual(2);

      focusable[0].focus();
      expect(document.activeElement).toBe(focusable[0]);

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(focusable[focusable.length - 1]);
    });

    it('returns focus to trigger button after closing with Escape', async () => {
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      const triggerBtn = screen.getByRole('button', { name: /ver documento reglamento/i });
      fireEvent.click(triggerBtn);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      await act(async () => {
        jest.runAllTimers();
      });

      expect(document.activeElement).toBe(triggerBtn);
    });

    it('returns focus to correct trigger when multiple documents exist', async () => {
      mockedUseQuery.mockReturnValue({
        data: [
          makeDocument({ id: 'doc-1', title: 'Reglamento' }),
          makeDocument({ id: 'doc-2', title: 'Contrato' }),
        ],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      const triggerBtns = screen.getAllByRole('button', { name: /ver documento/i });
      expect(triggerBtns.length).toBe(2);

      fireEvent.click(triggerBtns[1]);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      await act(async () => {
        jest.runAllTimers();
      });

      expect(document.activeElement).toBe(triggerBtns[1]);
    });
  });

  describe('Blob URL lifecycle', () => {
    it('calls createObjectURL exactly once when content arrives', async () => {
      const createSpy = jest.fn(() => 'blob:test-url');
      (window.URL as typeof window.URL & { createObjectURL: jest.Mock }).createObjectURL = createSpy;

      mockedDownloadProtectedDocumentContent.mockResolvedValue({
        blob: new Blob(['content'], { type: 'application/pdf' }),
        fileName: 'test.pdf',
        contentType: 'application/pdf',
      });
      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'URL Test' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento url test/i }));

      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledTimes(1);
      });
    });

    it('revokes URL when modal is closed', async () => {
      const revokeSpy = jest.fn();
      (window.URL as typeof window.URL & { revokeObjectURL: jest.Mock }).revokeObjectURL = revokeSpy;

      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });
      await waitFor(() => {
        expect(window.URL.createObjectURL).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByLabelText('Cerrar'));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      expect(revokeSpy).toHaveBeenCalled();
    });

    it('revokes URL when component unmounts', async () => {
      const revokeSpy = jest.fn();
      (window.URL as typeof window.URL & { revokeObjectURL: jest.Mock }).revokeObjectURL = revokeSpy;

      mockedUseQuery.mockReturnValue({
        data: [makeDocument({ title: 'Reglamento' })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      const { unmount } = render(<ResidentDocumentsPage />);
      fireEvent.click(await screen.findByRole('button', { name: /ver documento reglamento/i }));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });
      await waitFor(() => {
        expect(window.URL.createObjectURL).toHaveBeenCalled();
      });

      unmount();

      expect(revokeSpy).toHaveBeenCalled();
    });

    it('revokes old URL when switching to a different document', async () => {
      const createSpy = jest.fn(() => 'blob:test-url');
      const revokeSpy = jest.fn();
      (window.URL as typeof window.URL & { createObjectURL: jest.Mock }).createObjectURL = createSpy;
      (window.URL as typeof window.URL & { revokeObjectURL: jest.Mock }).revokeObjectURL = revokeSpy;

      mockedUseQuery.mockReturnValue({
        data: [
          makeDocument({ id: 'doc-a', title: 'Doc A' }),
          makeDocument({ id: 'doc-b', title: 'Doc B' }),
        ],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      fireEvent.click(screen.getByRole('button', { name: /ver documento doc a/i }));
      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByRole('button', { name: /ver documento doc b/i }));
      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledTimes(2);
      });

      expect(revokeSpy).toHaveBeenCalled();
    });
  });

  describe('Stale response protection', () => {
    it('keeps showing B when A resolves after B', async () => {
      const docA = makeDocument({ id: 'doc-a', title: 'Doc A' });
      const docB = makeDocument({ id: 'doc-b', title: 'Doc B' });

      let resolveA: (v: unknown) => void;
      let resolveB: (v: unknown) => void;
      const promiseA = new Promise((r) => { resolveA = r; });
      const promiseB = new Promise((r) => { resolveB = r; });

      let callCount = 0;
      mockedDownloadProtectedDocumentContent.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? promiseA as never : promiseB as never;
      });

      mockedUseQuery.mockReturnValue({
        data: [docA, docB],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      // Click A first
      fireEvent.click(screen.getByRole('button', { name: /ver documento doc a/i }));

      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(1);
      });

      // Click B while A is still pending
      fireEvent.click(screen.getByRole('button', { name: /ver documento doc b/i }));

      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(2);
      });

      // Resolve B first
      await act(async () => {
        resolveB!({
          blob: new Blob(['content-b'], { type: 'application/pdf' }),
          fileName: 'doc-b.pdf',
          contentType: 'application/pdf',
        });
      });

      // Modal should show B (use modal-title to scope, since list also has "Doc B")
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByTestId('modal-title').textContent).toBe('Doc B');

      // Resolve A after B (stale)
      await act(async () => {
        resolveA!({
          blob: new Blob(['content-a'], { type: 'application/pdf' }),
          fileName: 'doc-a.pdf',
          contentType: 'application/pdf',
        });
      });

      // Modal should still show B, not A
      expect(screen.getByTestId('modal-title').textContent).toBe('Doc B');
    });

    it('late error from A does not show over B', async () => {
      const docA = makeDocument({ id: 'doc-a', title: 'Doc A' });
      const docB = makeDocument({ id: 'doc-b', title: 'Doc B' });

      let rejectA: (e: Error) => void;
      let resolveB: (v: unknown) => void;
      const promiseA = new Promise((_r, rej) => { rejectA = rej; });
      const promiseB = new Promise((r) => { resolveB = r; });

      let callCount = 0;
      mockedDownloadProtectedDocumentContent.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? promiseA as never : promiseB as never;
      });

      mockedUseQuery.mockReturnValue({
        data: [docA, docB],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      fireEvent.click(screen.getByRole('button', { name: /ver documento doc a/i }));
      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByRole('button', { name: /ver documento doc b/i }));
      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(2);
      });

      // Resolve B successfully
      await act(async () => {
        resolveB!({
          blob: new Blob(['content-b'], { type: 'application/pdf' }),
          fileName: 'doc-b.pdf',
          contentType: 'application/pdf',
        });
      });

      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByTestId('modal-title').textContent).toBe('Doc B');

      // Reject A with error (stale)
      await act(async () => {
        rejectA!(new Error('Network error from A'));
      });

      // No error should appear — B is still displayed correctly
      expect(screen.queryByText('Network error from A')).toBeNull();
      expect(screen.getByTestId('modal-title').textContent).toBe('Doc B');
    });

    it('closing modal before resolution invalidates pending request', async () => {
      const docA = makeDocument({ id: 'doc-a', title: 'Doc A' });

      let resolveA: (v: unknown) => void;
      const promiseA = new Promise((r) => { resolveA = r; });

      mockedDownloadProtectedDocumentContent.mockReturnValue(promiseA as never);

      mockedUseQuery.mockReturnValue({
        data: [docA],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      fireEvent.click(screen.getByRole('button', { name: /ver documento doc a/i }));

      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(1);
      });

      // Close modal while request is pending
      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      // Resolve the pending request — should NOT reopen or error
      await act(async () => {
        resolveA!({
          blob: new Blob(['content-a'], { type: 'application/pdf' }),
          fileName: 'doc-a.pdf',
          contentType: 'application/pdf',
        });
      });

      // Dialog should remain closed
      expect(screen.queryByRole('dialog')).toBeNull();
      // Loading should not be stuck
      expect(screen.queryByText('Cargando documento...')).toBeNull();
    });

    it('download uses the latest document, not a stale one', async () => {
      const docA = makeDocument({ id: 'doc-a', title: 'Doc A' });
      const docB = makeDocument({ id: 'doc-b', title: 'Doc B' });

      let resolveA: (v: unknown) => void;
      let resolveB: (v: unknown) => void;
      const promiseA = new Promise((r) => { resolveA = r; });
      const promiseB = new Promise((r) => { resolveB = r; });

      let callCount = 0;
      mockedDownloadProtectedDocumentContent.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? promiseA as never : promiseB as never;
      });

      mockedUseQuery.mockReturnValue({
        data: [docA, docB],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      } as never);

      render(<ResidentDocumentsPage />);

      fireEvent.click(screen.getByRole('button', { name: /ver documento doc a/i }));
      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByRole('button', { name: /ver documento doc b/i }));
      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(2);
      });

      // Resolve both — A stale, B current
      await act(async () => {
        resolveB!({
          blob: new Blob(['content-b'], { type: 'application/pdf' }),
          fileName: 'doc-b.pdf',
          contentType: 'application/pdf',
        });
      });
      await act(async () => {
        resolveA!({
          blob: new Blob(['content-a'], { type: 'application/pdf' }),
          fileName: 'doc-a.pdf',
          contentType: 'application/pdf',
        });
      });

      // Click download — should use B's content
      fireEvent.click(screen.getByText('Descargar'));

      await waitFor(() => {
        expect(mockedDownloadProtectedDocumentContent).toHaveBeenCalledTimes(2);
      });

      // The dialog title should be B
      expect(screen.getByTestId('modal-title').textContent).toBe('Doc B');
    });
  });
});
