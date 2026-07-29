/**
 * @jest-environment jsdom
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useParams } from 'next/navigation';
import ResidentPaymentsPage from './page';
import { useResidentContext } from '@/features/resident/hooks/useResidentContext';
import { useContextOptions } from '@/features/context/useContextOptions';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useTenants } from '@/features/tenants/tenants.hooks';
import { getResidentLedger } from '@/features/resident/api/resident-context.api';
import { listPayments, submitPayment, PaymentMethod, PaymentStatus, ChargeStatus, ChargeType, type Payment } from '@/features/finance/services/finance.api';
import { createDocument, downloadDocumentContent, presignUpload, uploadFileToMinio } from '@/features/buildings/services/documents.api';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('@/features/resident/hooks/useResidentContext', () => ({
  useResidentContext: jest.fn(),
}));

jest.mock('@/features/context/useContextOptions', () => ({
  useContextOptions: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('@/features/tenants/tenants.hooks', () => ({
  useTenants: jest.fn(),
}));

jest.mock('@/features/resident/api/resident-context.api', () => ({
  getResidentLedger: jest.fn(),
}));

jest.mock('@/features/finance/services/finance.api', () => ({
  listPayments: jest.fn(),
  submitPayment: jest.fn(),
  PaymentMethod: {
    TRANSFER: 'TRANSFER',
  },
  ChargeType: {
    COMMON_EXPENSE: 'COMMON_EXPENSE',
  },
  PaymentStatus: {
    SUBMITTED: 'SUBMITTED',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    RECONCILED: 'RECONCILED',
  },
  ChargeStatus: {
    PENDING: 'PENDING',
    PARTIAL: 'PARTIAL',
    PAID: 'PAID',
    CANCELED: 'CANCELED',
  },
}));

jest.mock('@/features/buildings/services/documents.api', () => ({
  downloadDocumentContent: jest.fn(),
  presignUpload: jest.fn(),
  uploadFileToMinio: jest.fn(),
  createDocument: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseResidentContext = jest.mocked(useResidentContext);
const mockedUseContextOptions = jest.mocked(useContextOptions);
const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedUseTenants = jest.mocked(useTenants);
const mockedGetResidentLedger = jest.mocked(getResidentLedger);
const mockedListPayments = jest.mocked(listPayments);
const mockedSubmitPayment = jest.mocked(submitPayment);
const mockedDownloadDocumentContent = jest.mocked(downloadDocumentContent);
const mockedPresignUpload = jest.mocked(presignUpload);
const mockedUploadFileToMinio = jest.mocked(uploadFileToMinio);
const mockedCreateDocument = jest.mocked(createDocument);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches,
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

function makeLedger(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    unitId: 'unit-1',
    unitLabel: 'TN-01-01',
    buildingId: 'building-1',
    buildingName: 'Complejo Horizonte',
    charges: [makeCharge()],
    payments: [],
    totals: {
      balance: 9998,
      currency: 'ARS',
      totalCharges: 9998,
      totalPaid: 0,
      totalAllocated: 0,
    },
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    buildingId: 'building-1',
    unitId: 'unit-1',
    amount: 12345,
    currency: 'ARS',
    method: PaymentMethod.TRANSFER,
    status: PaymentStatus.SUBMITTED,
    reference: 'TRX-001',
    proofFileId: undefined,
    proofDocumentId: undefined,
    receiptDocumentId: undefined,
    receiptNumber: undefined,
    receiptStatus: 'PENDING',
    receiptError: undefined,
    createdAt: '2026-07-01',
    updatedAt: '2026-07-01T00:00:00.000Z',
    paidAt: '2026-07-01',
    rejectionReason: null,
    rejectionComment: null,
    ...overrides,
  };
}

function makeCharge(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'charge-1',
    unitId: 'unit-1',
    type: ChargeType.COMMON_EXPENSE,
    concept: 'Expensas Julio 2026',
    period: '2026-07',
    amount: 9998,
    allocated: 0,
    currency: 'ARS',
    dueDate: '2026-07-24',
    status: ChargeStatus.PENDING,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ResidentPaymentsPage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
    jest.clearAllMocks();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUseAuthSession.mockReturnValue({
      user: {
        id: 'resident-user-1',
        email: 'resident@example.com',
        name: 'Resident Test',
      },
      memberships: [
        {
          tenantId: 'tenant-1',
          roles: ['RESIDENT'],
        },
      ],
      activeTenantId: 'tenant-1',
    } as never);
    mockedUseTenants.mockReturnValue({
      data: [{ id: 'tenant-1', name: 'Complejo Horizonte' }],
    } as never);
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
        unitsByBuilding: {
          'building-1': [{ id: 'unit-1', label: 'TN-01-01' }],
        },
      },
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    mockedGetResidentLedger.mockResolvedValue(makeLedger());
    mockedListPayments.mockResolvedValue([]);
    mockedSubmitPayment.mockResolvedValue(undefined as never);
    mockedDownloadDocumentContent.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
    mockedPresignUpload.mockResolvedValue({
      url: 'https://upload.example/proof.pdf',
      bucket: 'documents',
      objectKey: 'tenant-1/documents/proof.pdf',
      expiresAt: '2026-07-24T00:00:00.000Z',
    });
    mockedUploadFileToMinio.mockResolvedValue(undefined);
    mockedCreateDocument.mockResolvedValue({
      id: 'document-1',
      file: { id: 'file-1' },
    } as never);
    mockMatchMedia(false);
    (window.URL as typeof window.URL & {
      createObjectURL: jest.Mock;
      revokeObjectURL: jest.Mock;
    }).createObjectURL = jest.fn(() => 'blob:download-url');
    (window.URL as typeof window.URL & {
      createObjectURL: jest.Mock;
      revokeObjectURL: jest.Mock;
    }).revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows loading and error states before rendering the resident payment history', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    expect(screen.queryByRole('button', { name: /reportar pago/i })).toBeNull();

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
    mockedGetResidentLedger.mockRejectedValueOnce(new Error('Sin conexión'));
    mockedListPayments.mockResolvedValueOnce([]);

    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    expect(await screen.findByText('No pudimos cargar tus pagos.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('renders an empty state when the resident has no payments yet', async () => {
    mockedGetResidentLedger.mockResolvedValueOnce(makeLedger({ charges: [] }));
    mockedListPayments.mockResolvedValueOnce([]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    expect(await screen.findByText('Todavía no tenés pagos registrados.')).toBeTruthy();
    expect(screen.getByText('No tenés cargos pendientes por ahora.')).toBeTruthy();
  });

  it('shows receipt actions and rejection reason only when the backend returns them', async () => {
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-approved',
        status: PaymentStatus.APPROVED,
        proofDocumentId: 'proof-doc-1',
        receiptDocumentId: 'receipt-doc-1',
        receiptNumber: 'R-HORIZ-2026-000001',
        receiptStatus: 'READY',
      }),
      makePayment({
        id: 'payment-rejected',
        status: PaymentStatus.REJECTED,
        proofDocumentId: 'proof-doc-2',
        receiptDocumentId: undefined,
        receiptStatus: 'PENDING',
        rejectionReason: 'SIN_COMPROBANTE',
        rejectionComment: 'Falta el respaldo bancario',
      }),
    ]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    expect(await screen.findByRole('button', { name: /ver recibo del pago de/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /ver comprobante del pago de/i })).toHaveLength(2);
    expect(screen.getByText(/Motivo: Sin comprobante/)).toBeTruthy();
    expect(screen.getByText(/Falta el respaldo bancario/)).toBeTruthy();
    expect(screen.queryByText('Recibo en generación')).toBeNull();
  });

  it('shows receipt generation progress for approved and reconciled payments only', async () => {
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-approved-pending',
        status: PaymentStatus.APPROVED,
        receiptStatus: 'PENDING',
        receiptDocumentId: undefined,
        receiptError: undefined,
      }),
      makePayment({
        id: 'payment-reconciled-pending',
        status: PaymentStatus.RECONCILED,
        receiptStatus: 'PENDING',
        receiptDocumentId: undefined,
        receiptError: undefined,
      }),
      makePayment({
        id: 'payment-submitted-pending',
        status: PaymentStatus.SUBMITTED,
        receiptStatus: 'PENDING',
        receiptDocumentId: undefined,
        receiptError: undefined,
      }),
      makePayment({
        id: 'payment-rejected-pending',
        status: PaymentStatus.REJECTED,
        receiptStatus: 'PENDING',
        receiptDocumentId: undefined,
        receiptError: undefined,
      }),
    ]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    expect(await screen.findAllByText('Recibo en generación')).toHaveLength(2);
    expect(screen.queryByText('No pudimos generar el recibo. La administración ya fue notificada.')).toBeNull();
    expect(screen.queryByRole('button', { name: /ver recibo del pago de/i })).toBeNull();
  });

  it('shows receipt errors for approved and reconciled payments and allows opening the reconciled receipt', async () => {
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-approved-failed',
        status: PaymentStatus.APPROVED,
        receiptStatus: 'FAILED',
        receiptError: 'Error al generar el recibo aprobado',
        receiptDocumentId: undefined,
      }),
      makePayment({
        id: 'payment-reconciled-failed',
        status: PaymentStatus.RECONCILED,
        receiptStatus: 'FAILED',
        receiptError: 'Error al generar el recibo conciliado',
        receiptDocumentId: undefined,
      }),
      makePayment({
        id: 'payment-reconciled-ready',
        status: PaymentStatus.RECONCILED,
        receiptStatus: 'READY',
        receiptDocumentId: 'receipt-doc-1',
        receiptError: undefined,
      }),
    ]);
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    expect(await screen.findByText('Error al generar el recibo aprobado')).toBeTruthy();
    expect(screen.getByText('Error al generar el recibo conciliado')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /ver recibo del pago de/i }));

    await waitFor(() => {
      expect(mockedDownloadDocumentContent).toHaveBeenCalledWith('tenant-1', 'receipt-doc-1');
      expect(openSpy).toHaveBeenCalledWith('blob:download-url', '_blank', 'noopener,noreferrer');
    });

    openSpy.mockRestore();
  });

  it('does not show an invalid receipt action for payments without an approved receipt', async () => {
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-submitted',
        status: PaymentStatus.SUBMITTED,
        receiptDocumentId: undefined,
        receiptStatus: 'PENDING',
      }),
    ]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    expect(await screen.findByText('Enviado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ver recibo del pago de/i })).toBeNull();
  });

  it('downloads an approved receipt through the protected document endpoint as a blob URL', async () => {
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-approved',
        status: PaymentStatus.APPROVED,
        proofDocumentId: 'proof-doc-1',
        receiptDocumentId: 'receipt-doc-1',
        receiptStatus: 'READY',
      }),
    ]);
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    jest.useFakeTimers();

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /ver recibo del pago de/i }));

    await waitFor(() => {
      expect(mockedDownloadDocumentContent).toHaveBeenCalledWith('tenant-1', 'receipt-doc-1');
      expect(openSpy).toHaveBeenCalledWith('blob:download-url', '_blank', 'noopener,noreferrer');
      expect((window.URL as typeof window.URL & { createObjectURL: jest.Mock }).createObjectURL).toHaveBeenCalled();
    });

    expect((window.URL as typeof window.URL & { revokeObjectURL: jest.Mock }).revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect((window.URL as typeof window.URL & { revokeObjectURL: jest.Mock }).revokeObjectURL).toHaveBeenCalledWith('blob:download-url');
    openSpy.mockRestore();
    jest.useRealTimers();
  });

  it('shows a download error when the protected document endpoint returns 401 or 404', async () => {
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-approved',
        status: PaymentStatus.APPROVED,
        receiptDocumentId: 'receipt-doc-1',
        receiptStatus: 'READY',
      }),
    ]);

    mockedDownloadDocumentContent
      .mockRejectedValueOnce(new Error('Sesión expirada. Vuelve a iniciar sesión.'))
      .mockRejectedValueOnce(new Error('Document not found'));

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /ver recibo del pago de/i }));

    expect(await screen.findByText('No pudimos abrir el documento.')).toBeTruthy();
    expect(screen.getByText('Sesión expirada. Vuelve a iniciar sesión.')).toBeTruthy();
    expect(mockedDownloadDocumentContent).toHaveBeenCalledTimes(1);
  });

  it('shows a download error when the protected document endpoint fails with 404 on proof download', async () => {
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-approved',
        status: PaymentStatus.APPROVED,
        proofDocumentId: 'proof-doc-1',
        receiptDocumentId: 'receipt-doc-1',
        receiptStatus: 'READY',
      }),
    ]);
    mockedDownloadDocumentContent.mockRejectedValueOnce(new Error('Document not found'));
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /ver comprobante del pago de/i }));

    expect(await screen.findByText('No pudimos abrir el documento.')).toBeTruthy();
    expect(screen.getByText('Document not found')).toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('blocks oversized payment proofs before uploading them', async () => {
    mockedListPayments.mockResolvedValueOnce([]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /reportar pago/i }));
    const fileInput = screen.getByLabelText(/comprobante de pago/i);
    const file = new File([new Uint8Array(11 * 1024 * 1024)], 'proof.pdf', { type: 'application/pdf' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(await screen.findByText(/El archivo no puede superar 10MB/)).toBeTruthy();
    expect(mockedPresignUpload).not.toHaveBeenCalled();
  });

  it('blocks invalid payment proof MIME types before upload', async () => {
    mockedListPayments.mockResolvedValueOnce([]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /reportar pago/i }));
    const fileInput = screen.getByLabelText(/comprobante de pago/i);
    const file = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(await screen.findByText('El comprobante debe ser PDF, JPG o PNG')).toBeTruthy();
    expect(mockedPresignUpload).not.toHaveBeenCalled();
  });

  it('opens a confirmation modal with the selected charge and keeps the form when canceled', async () => {
    mockedListPayments.mockResolvedValueOnce([]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /reportar pago/i }));
    expect((screen.getByLabelText(/cargo pendiente/i) as HTMLSelectElement).value).toBe('charge-1');
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/comprobante de pago/i), {
        target: {
          files: [new File([new Uint8Array([1, 2, 3])], 'proof.pdf', { type: 'application/pdf' })],
        },
      });
    });

    await waitFor(() => expect(mockedPresignUpload).toHaveBeenCalled());
    expect(mockedPresignUpload).toHaveBeenCalledWith(
      'tenant-1',
      'proof.pdf',
      'application/pdf',
      3,
      'PAYMENT_PROOF',
    );
    expect(await screen.findByText(/proof\.pdf subido correctamente/i)).toBeTruthy();
    expect(screen.getByText('Monto a reportar')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar pago' }));

    const dialog = await screen.findByRole('dialog', { name: /confirmar reporte de pago/i });
    expect(dialog.textContent).toContain('99,98');
    expect(dialog.textContent).toContain('24/07/2026');
    expect(dialog.textContent).not.toContain('23/07/2026');
    expect(dialog.textContent).toContain('Expensas Julio 2026');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /confirmar reporte de pago/i })).toBeNull());
    expect((screen.getByLabelText(/fecha de pago/i) as HTMLInputElement).value).toBe('2026-07-24');
    expect((screen.getByLabelText(/cargo pendiente/i) as HTMLSelectElement).value).toBe('charge-1');
    expect((screen.getByLabelText(/comprobante de pago/i) as HTMLInputElement).files?.[0]?.name).toBe('proof.pdf');
    expect(mockedSubmitPayment).not.toHaveBeenCalled();
  });

  it('submits the selected charge at the full outstanding amount and refreshes the payment list after submission', async () => {
    const initialPayments: Payment[] = [
      makePayment({
        id: 'payment-existing',
        reference: 'TRX-001',
        status: PaymentStatus.SUBMITTED,
        proofDocumentId: 'proof-doc-1',
      }),
    ];
    const updatedPayments: Payment[] = [
      ...initialPayments,
      makePayment({
        id: 'payment-new',
        reference: 'TRX-NEW',
        amount: 20000,
        proofFileId: 'file-1',
        status: PaymentStatus.SUBMITTED,
      }),
    ];
    let paymentsResponse: Payment[] = initialPayments;
    mockedListPayments.mockImplementation(() => Promise.resolve(paymentsResponse));
    const deferred = createDeferred<Payment>();
    mockedSubmitPayment.mockImplementation(async () => {
      paymentsResponse = updatedPayments;
      return deferred.promise;
    });

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /reportar pago/i }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/comprobante de pago/i), {
        target: {
          files: [new File([new Uint8Array([1, 2, 3])], 'proof.pdf', { type: 'application/pdf' })],
        },
      });
    });

    await waitFor(() => expect(mockedPresignUpload).toHaveBeenCalled());
    expect(await screen.findByText(/proof\.pdf subido correctamente/i)).toBeTruthy();
    const submitButton = await screen.findByRole('button', { name: 'Enviar pago' });
    fireEvent.click(submitButton);

    const dialog = await screen.findByRole('dialog', { name: /confirmar reporte de pago/i });
    expect(dialog.textContent).toContain('99,98');
    expect(dialog.textContent).toContain('Expensas Julio 2026');
    expect(dialog.textContent).toContain('24/07/2026');

    const confirmButton = screen.getByRole('button', { name: 'Confirmar pago' });
    expect(confirmButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirmButton);
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockedSubmitPayment).toHaveBeenCalledWith(
        'building-1',
        expect.objectContaining({
          unitId: 'unit-1',
          chargeId: 'charge-1',
          amount: 9998,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          proofFileId: 'file-1',
        }),
        'resident',
      );
    });
    expect(mockedSubmitPayment).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(makePayment({ id: 'payment-submitted' }));
    });

    await waitFor(() => {
      expect(mockedListPayments).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByText(/TRX-NEW/)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('keeps the same civil payment date in history and the confirmation modal', async () => {
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-existing',
        paidAt: '2026-07-24',
        createdAt: '2026-07-24',
      }),
    ]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.queryAllByText('24/07/2026').length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText('23/07/2026')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /reportar pago/i }));
    fireEvent.change(screen.getByLabelText(/fecha de pago/i), { target: { value: '2026-07-24' } });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/comprobante de pago/i), {
        target: {
          files: [new File([new Uint8Array([1, 2, 3])], 'proof.pdf', { type: 'application/pdf' })],
        },
      });
    });

    await waitFor(() => expect(mockedPresignUpload).toHaveBeenCalled());
    expect(await screen.findByText(/proof\.pdf subido correctamente/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar pago' }));

    const dialog = await screen.findByRole('dialog', { name: /confirmar reporte de pago/i });
    expect(dialog.textContent).toContain('24/07/2026');
    expect(dialog.textContent).not.toContain('23/07/2026');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /confirmar reporte de pago/i })).toBeNull());
    expect((screen.getByLabelText(/fecha de pago/i) as HTMLInputElement).value).toBe('2026-07-24');
  });

  it('formats civil and ISO timestamps without shifting the day in the mobile history list', async () => {
    mockMatchMedia(true);
    mockedGetResidentLedger.mockResolvedValueOnce(makeLedger({ charges: [] }));
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-civil',
        paidAt: '2026-07-29',
        createdAt: '2026-07-29',
        reference: 'CIVIL',
      }),
      makePayment({
        id: 'payment-iso-utc',
        paidAt: '2026-07-29T00:00:00.000Z',
        createdAt: '2026-07-29T00:00:00.000Z',
        reference: 'ISO UTC',
      }),
      makePayment({
        id: 'payment-iso-hour',
        paidAt: '2026-07-29T03:00:00.000Z',
        createdAt: '2026-07-29T03:00:00.000Z',
        reference: 'ISO HOUR',
      }),
      makePayment({
        id: 'payment-invalid',
        paidAt: 'invalid-date',
        createdAt: 'invalid-date',
        reference: 'INVALID',
      }),
      makePayment({
        id: 'payment-absent',
        paidAt: undefined as never,
        createdAt: undefined as never,
        reference: 'ABSENT',
      }),
    ]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('tab', { name: 'Historial' }));

    expect(screen.getByText('5 pagos registrados')).toBeTruthy();
    const mobileHistory = document.getElementById('resident-payments-mobile-history');
    expect(mobileHistory).toBeTruthy();
    if (!mobileHistory) {
      throw new Error('Expected the mobile history section to be rendered');
    }
    const mobileHistoryTexts = Array.from(mobileHistory.querySelectorAll('p.text-sm.text-muted-foreground'))
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim());
    expect(mobileHistoryTexts).toContain('29 jul. 2026 · TRANSFER · CIVIL');
    expect(mobileHistoryTexts).toContain('29 jul. 2026 · TRANSFER · ISO UTC');
    expect(mobileHistoryTexts).toContain('29 jul. 2026 · TRANSFER · ISO HOUR');
    expect(mobileHistoryTexts).toContain('— · TRANSFER · INVALID');
    expect(mobileHistoryTexts).toContain('— · TRANSFER · ABSENT');
    expect(screen.queryByText('28 jul. 2026')).toBeNull();
    expect(screen.queryByText('29/07/2026')).toBeNull();
  });

  it('keeps the mobile success visible before closing and restores focus to the trigger', async () => {
    mockMatchMedia(true);
    mockedGetResidentLedger.mockResolvedValueOnce(makeLedger({ charges: [makeCharge()] }));
    mockedListPayments.mockResolvedValueOnce([]);
    const deferred = createDeferred<Payment>();
    mockedSubmitPayment.mockImplementation(async () => deferred.promise);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    const openButton = await screen.findByRole('button', { name: 'Reportar pago' });
    openButton.focus();
    fireEvent.click(openButton);
    const panelIntro = await screen.findByText(
      /Cargá el comprobante y completá los datos del pago para enviarlo a revisión\./i,
    );
    const mobileDialog = panelIntro.closest('[role="dialog"]') as HTMLElement | null;
    expect(mobileDialog).toBeTruthy();
    if (!mobileDialog) {
      throw new Error('Expected the mobile payment panel to be rendered');
    }
    const mobileDialogQueries = within(mobileDialog);

    await act(async () => {
      fireEvent.change(mobileDialogQueries.getByLabelText(/comprobante de pago/i), {
        target: {
          files: [new File([new Uint8Array([1, 2, 3])], 'proof.pdf', { type: 'application/pdf' })],
        },
      });
    });

    await waitFor(() => expect(mockedPresignUpload).toHaveBeenCalled());
    expect(await mobileDialogQueries.findByText(/proof\.pdf subido correctamente/i)).toBeTruthy();
    const submitButtonLabel = mobileDialogQueries.getByText('Enviar pago');
    const submitButton = submitButtonLabel.closest('button');
    expect(submitButton).toBeTruthy();
    if (!submitButton) {
      throw new Error('Expected the mobile payment submit button to be rendered');
    }
    fireEvent.click(submitButton);

    const confirmDialog = await screen.findByRole('dialog', { name: /confirmar reporte de pago/i });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar pago' }));

    await waitFor(() => expect(mockedSubmitPayment).toHaveBeenCalledTimes(1));

    await act(async () => {
      deferred.resolve(makePayment({ id: 'payment-success', status: PaymentStatus.SUBMITTED }));
    });

    await waitFor(() => expect(mobileDialog.textContent).toContain('Pago enviado exitosamente'));
    expect(mobileDialog.isConnected).toBe(true);
    expect(mockedSubmitPayment).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /reportar pago/i })).toBeNull());
    expect(document.activeElement).toBe(openButton);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('keeps the mobile payment panel open when the submission fails', async () => {
    mockMatchMedia(true);
    mockedGetResidentLedger.mockResolvedValueOnce(makeLedger({ charges: [makeCharge()] }));
    mockedListPayments.mockResolvedValueOnce([]);
    mockedSubmitPayment.mockRejectedValueOnce(new Error('No se pudo registrar el pago'));

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    const openButton = await screen.findByRole('button', { name: 'Reportar pago' });
    fireEvent.click(openButton);
    const panelIntro = await screen.findByText(
      /Cargá el comprobante y completá los datos del pago para enviarlo a revisión\./i,
    );
    const mobileDialog = panelIntro.closest('[role="dialog"]') as HTMLElement | null;
    expect(mobileDialog).toBeTruthy();
    if (!mobileDialog) {
      throw new Error('Expected the mobile payment panel to be rendered');
    }
    const mobileDialogQueries = within(mobileDialog);

    await act(async () => {
      fireEvent.change(mobileDialogQueries.getByLabelText(/comprobante de pago/i), {
        target: {
          files: [new File([new Uint8Array([1, 2, 3])], 'proof.pdf', { type: 'application/pdf' })],
        },
      });
    });

    await waitFor(() => expect(mockedPresignUpload).toHaveBeenCalled());
    expect(await mobileDialogQueries.findByText(/proof\.pdf subido correctamente/i)).toBeTruthy();
    const submitButtonLabel = mobileDialogQueries.getByText('Enviar pago');
    const submitButton = submitButtonLabel.closest('button');
    expect(submitButton).toBeTruthy();
    if (!submitButton) {
      throw new Error('Expected the mobile payment submit button to be rendered');
    }
    fireEvent.click(submitButton);

    const confirmDialog = await screen.findByRole('dialog', { name: /confirmar reporte de pago/i });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar pago' }));

    await waitFor(() => expect(mockedSubmitPayment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mobileDialog.textContent).toContain('No se pudo registrar el pago'));
    expect(mobileDialog.isConnected).toBe(true);
    expect(mockedSubmitPayment).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(openButton);
  });

  it.each([
    { count: 1, expectedLabel: '1 pago registrado' },
    { count: 8, expectedLabel: '8 pagos registrados' },
    { count: 20, expectedLabel: 'Mostrando los últimos 20 pagos' },
  ])('labels mobile history as recent records when showing $count results', async ({ count, expectedLabel }) => {
    mockMatchMedia(true);
    mockedGetResidentLedger.mockResolvedValueOnce(makeLedger({ charges: [] }));
    mockedListPayments.mockResolvedValueOnce(
      Array.from({ length: count }, (_, index) =>
        makePayment({
          id: `payment-${index + 1}`,
          reference: `PAY-${index + 1}`,
          paidAt: `2026-07-${String(Math.min(count - index, 28)).padStart(2, '0')}`,
          createdAt: `2026-07-${String(Math.min(count - index, 28)).padStart(2, '0')}`,
        }),
      ),
    );

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('tab', { name: 'Historial' }));

    expect(screen.getByText(expectedLabel)).toBeTruthy();
    expect(screen.queryByText('20 pagos registrados')).toBeNull();
  });

  it('shows an empty-state message when no mobile payment history exists', async () => {
    mockMatchMedia(true);
    mockedGetResidentLedger.mockResolvedValueOnce(makeLedger({ charges: [] }));
    mockedListPayments.mockResolvedValueOnce([]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('tab', { name: 'Historial' }));

    expect(screen.getByText('Todavía no tenés pagos registrados.')).toBeTruthy();
    expect(screen.queryByText('Mostrando los últimos 20 pagos')).toBeNull();
  });

  it('lets the resident switch pending charges and always shows the selected full balance', async () => {
    mockedGetResidentLedger.mockResolvedValueOnce(
      makeLedger({
        charges: [
          makeCharge({
            id: 'charge-1',
            concept: 'Expensas Julio 2026',
            amount: 9998,
            allocated: 0,
          }),
          makeCharge({
            id: 'charge-2',
            concept: 'Expensas Agosto 2026',
            period: '2026-08',
            amount: 2500,
            allocated: 0,
          }),
        ],
        totals: {
          balance: 12498,
          currency: 'ARS',
          totalCharges: 12498,
          totalPaid: 0,
          totalAllocated: 0,
        },
      }),
    );
    mockedListPayments.mockResolvedValueOnce([]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /reportar pago/i }));
    fireEvent.change(screen.getByLabelText(/cargo pendiente/i), { target: { value: 'charge-2' } });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/comprobante de pago/i), {
        target: {
          files: [new File([new Uint8Array([1, 2, 3])], 'proof.pdf', { type: 'application/pdf' })],
        },
      });
    });

    await waitFor(() => expect(mockedPresignUpload).toHaveBeenCalled());
    expect(await screen.findByText(/proof\.pdf subido correctamente/i)).toBeTruthy();
    expect(screen.getByText('Monto a reportar')).toBeTruthy();
    expect((screen.getByLabelText(/cargo pendiente/i) as HTMLSelectElement).value).toBe('charge-2');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pago' }));

    const dialog = await screen.findByRole('dialog', { name: /confirmar reporte de pago/i });
    expect(dialog.textContent).toContain('25,00');
    expect(dialog.textContent).toContain('Expensas Agosto 2026');
    expect(dialog.textContent).toContain('24/07/2026');
  });

  it('surfaces backend validation failures from the proof upload pipeline', async () => {
    mockedListPayments.mockResolvedValueOnce([]);
    mockedCreateDocument.mockRejectedValueOnce(new Error('El archivo supera el máximo de 10485760 bytes'));

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /reportar pago/i }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/comprobante de pago/i), {
        target: {
          files: [new File([new Uint8Array([1, 2, 3])], 'proof.pdf', { type: 'application/pdf' })],
        },
      });
    });

    expect(await screen.findByText(/Error al subir el comprobante/)).toBeTruthy();
    expect(screen.getByText(/El archivo supera el máximo/)).toBeTruthy();
    expect(mockedSubmitPayment).not.toHaveBeenCalled();
  });

  it('uses text-foreground for KPI values instead of text-gray-900', async () => {
    mockedGetResidentLedger.mockResolvedValueOnce(
      makeLedger({
        charges: [
          makeCharge({ dueDate: '2026-08-15', amount: 5000 }),
        ],
        totals: { balance: 5000, currency: 'ARS', totalCharges: 5000, totalPaid: 0, totalAllocated: 0 },
      }),
    );
    mockedListPayments.mockResolvedValueOnce([
      makePayment({ id: 'pay-last', amount: 3000, paidAt: '2026-07-20', status: PaymentStatus.APPROVED }),
    ]);

    const Wrapper = createWrapper();
    const { container } = render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    await screen.findByText('Historial de pagos');

    const kpiElements = container.querySelectorAll('.text-foreground');
    expect(kpiElements.length).toBeGreaterThanOrEqual(2);

    const gray900Elements = container.querySelectorAll('.text-gray-900');
    expect(gray900Elements).toHaveLength(0);
  });

  it('does not use text-black in KPI elements', async () => {
    mockedGetResidentLedger.mockResolvedValueOnce(makeLedger());
    mockedListPayments.mockResolvedValueOnce([]);

    const Wrapper = createWrapper();
    const { container } = render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    await screen.findByText('Historial de pagos');

    const blackElements = container.querySelectorAll('.text-black');
    expect(blackElements).toHaveLength(0);
  });

  it('renders payment status badges with semantic variant classes', async () => {
    mockedGetResidentLedger.mockResolvedValueOnce(makeLedger());
    mockedListPayments.mockResolvedValueOnce([
      makePayment({ id: 'pay-sub', status: PaymentStatus.SUBMITTED }),
      makePayment({ id: 'pay-apr', status: PaymentStatus.APPROVED }),
      makePayment({ id: 'pay-rej', status: PaymentStatus.REJECTED }),
      makePayment({ id: 'pay-rec', status: PaymentStatus.RECONCILED }),
    ]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    await screen.findByText('Historial de pagos');

    const submittedBadge = screen.getByText('Enviado');
    expect(submittedBadge.className).toContain('bg-amber-100');
    expect(submittedBadge.className).toContain('dark:bg-amber-950/40');

    const approvedBadge = screen.getByText('Aprobado');
    expect(approvedBadge.className).toContain('bg-green-100');
    expect(approvedBadge.className).toContain('dark:bg-green-950/40');

    const rejectedBadge = screen.getByText('Rechazado');
    expect(rejectedBadge.className).toContain('bg-red-100');
    expect(rejectedBadge.className).toContain('dark:bg-red-950/40');

    const reconciledBadge = screen.getByText('Conciliado');
    expect(reconciledBadge.className).toContain('bg-blue-100');
    expect(reconciledBadge.className).toContain('dark:bg-blue-950/40');
  });

  it('renders the mobile summary, locks focus inside the payment panel, and restores focus on close', async () => {
    mockMatchMedia(true);
    mockedGetResidentLedger.mockResolvedValueOnce(
      makeLedger({
        charges: [
          makeCharge({
            id: 'charge-1',
            concept: 'Condominio ordinario',
            period: '2026-03',
            amount: 46350,
            allocated: 0,
            dueDate: '2026-03-09',
          }),
          makeCharge({
            id: 'charge-2',
            concept: 'Fondo de reserva',
            period: '2026-04',
            amount: 18500,
            allocated: 0,
            dueDate: '2026-04-12',
          }),
          makeCharge({
            id: 'charge-3',
            concept: 'Multa administrativa',
            period: '2026-05',
            amount: 3200,
            allocated: 0,
            dueDate: '2026-05-05',
          }),
        ],
        totals: {
          balance: 68750,
          currency: 'ARS',
          totalCharges: 68750,
          totalPaid: 0,
          totalAllocated: 0,
        },
      }),
    );
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-recent',
        amount: 49500,
        paidAt: '2026-07-23',
        createdAt: '2026-07-23',
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.APPROVED,
        proofDocumentId: 'proof-doc-1',
        receiptDocumentId: 'receipt-doc-1',
      }),
    ]);

    const Wrapper = createWrapper();
    const { container } = render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    await waitFor(() => expect(container.querySelector('.overflow-x-hidden')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Resumen' }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Reportar pago' }).className).toContain('min-h-12');

    const openMobilePanelButton = screen.getByRole('button', { name: 'Reportar pago' });
    openMobilePanelButton.focus();
    fireEvent.click(openMobilePanelButton);

    const panelIntro = await screen.findByText(/Cargá el comprobante y completá los datos del pago para enviarlo a revisión\./i);
    const panel = panelIntro.closest('[role="dialog"]') as HTMLElement | null;
    expect(panel).toBeTruthy();
    if (!panel) {
      throw new Error('Expected the mobile payment panel to be rendered');
    }
    const closeButton = screen.getByLabelText('Cerrar reporte de pago');
    const cancelButton = screen.getByText('Cancelar');

    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancelButton);

    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(panel, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reportar pago' })).toBeNull());
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
    expect(document.activeElement).toBe(openMobilePanelButton);
  });

  it('switches mobile tabs and shows compact pending and history cards', async () => {
    mockMatchMedia(true);
    mockedGetResidentLedger.mockResolvedValueOnce(
      makeLedger({
        charges: [
          makeCharge({
            id: 'charge-1',
            concept: 'Condominio ordinario',
            period: '2026-03',
            amount: 46350,
            allocated: 0,
            dueDate: '2026-03-09',
          }),
          makeCharge({
            id: 'charge-2',
            concept: 'Fondo de reserva',
            period: '2026-04',
            amount: 18500,
            allocated: 0,
            dueDate: '2026-04-12',
          }),
        ],
        totals: {
          balance: 64850,
          currency: 'ARS',
          totalCharges: 64850,
          totalPaid: 0,
          totalAllocated: 0,
        },
      }),
    );
    mockedListPayments.mockResolvedValueOnce([
      makePayment({
        id: 'payment-recent',
        amount: 49500,
        paidAt: '2026-07-23',
        createdAt: '2026-07-23',
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.APPROVED,
        proofDocumentId: 'proof-doc-1',
        receiptDocumentId: 'receipt-doc-1',
      }),
    ]);

    const Wrapper = createWrapper();
    render(<ResidentPaymentsPage />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'Ver todos' }));

    expect(screen.getByRole('tab', { name: 'Pendientes' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('MAR 2026')).toBeTruthy();
    expect(screen.getAllByText('Vencido')).toHaveLength(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Resumen' }));
    expect(screen.getByRole('tab', { name: 'Resumen' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Ver historial' }));

    expect(screen.getByRole('tab', { name: 'Historial' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Historial de pagos')).toBeTruthy();
    expect(screen.getByRole('button', { name: /ver comprobante del pago de/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /ver recibo del pago de/i })).toBeTruthy();
  });
});
