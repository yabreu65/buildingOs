'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  CreditCard,
  AlertCircle,
  CheckCircle,
  DollarSign,
  Upload,
  Loader2,
  FileText,
} from 'lucide-react';

import { useResidentContext } from '@/features/resident/hooks/useResidentContext';
import { useContextOptions } from '@/features/context/useContextOptions';
import { getResidentLedger, type UnitLedger } from '@/features/resident/api/resident-context.api';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useTenants } from '@/features/tenants/tenants.hooks';
import { listPayments, submitPayment, type Payment, PaymentMethod, ChargeStatus, PaymentStatus } from '@/features/finance/services/finance.api';
import {
  downloadDocumentContent,
  presignUpload,
  uploadFileToMinio,
  createDocument,
} from '@/features/buildings/services/documents.api';
import Card from '@/shared/components/ui/Card';
import Input from '@/shared/components/ui/Input';
import Select from '@/shared/components/ui/Select';
import Button from '@/shared/components/ui/Button';
import Skeleton from '@/shared/components/ui/Skeleton';
import { formatCurrency, getLocaleForCurrency } from '@/shared/lib/format/money';

const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatCivilDate(dateValue: string | undefined | null): string {
  if (!dateValue || !CIVIL_DATE_PATTERN.test(dateValue)) return '—';

  const [year, month, day] = dateValue.split('-');
  if (!year || !month || !day) return '—';

  return `${day}/${month}/${year}`;
}

function formatLocalTimestampDate(dateValue: string | undefined | null): string {
  if (!dateValue) return '—';

  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) return '—';

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsedDate);
}

function formatPaymentDisplayDate(dateValue: string | undefined | null): string {
  if (!dateValue) return '—';

  return CIVIL_DATE_PATTERN.test(dateValue)
    ? formatCivilDate(dateValue)
    : formatLocalTimestampDate(dateValue);
}

function getCurrentCivilDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getChargeStatusFromDebt(amount: number, allocated: number | undefined, status: ChargeStatus): string {
  const debt = amount - (allocated ?? 0);
  if (status === ChargeStatus.CANCELED) return 'Cancelado';
  if (debt <= 0) return 'Pagado';
  if (allocated && allocated > 0 && allocated < amount) return 'Parcial';
  return 'Pendiente';
}

function paymentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    SUBMITTED: 'Enviado',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
    RECONCILED: 'Conciliado',
  };
  return labels[status] ?? status;
}

function paymentStatusColor(status: string): string {
  const colors: Record<string, string> = {
    SUBMITTED: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    APPROVED: 'bg-green-100 text-green-700 border-green-200',
    REJECTED: 'bg-red-100 text-red-700 border-red-200',
    RECONCILED: 'bg-blue-100 text-blue-700 border-blue-200',
  };
  return colors[status] ?? 'bg-muted text-muted-foreground border-border';
}

interface PaymentFormData {
  selectedChargeId: string;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  proofFileId?: string;
}

interface PaymentConfirmationData {
  chargeId: string;
  amountMinor: number;
  amountLabel: string;
  chargeLabel: string;
  currency: string;
  paidAtLabel: string;
  referenceLabel?: string;
  proofFileName: string;
}

const MAX_PAYMENT_PROOF_SIZE_BYTES = 10 * 1024 * 1024;
const PAYMENT_PROOF_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

const PAYMENT_REJECTION_REASON_LABELS: Record<string, string> = {
  MONTO_INCORRECTO: 'Monto incorrecto',
  REFERENCIA_INVALIDA: 'Referencia inválida',
  SIN_COMPROBANTE: 'Sin comprobante',
  COMPROBANTE_ILEGIBLE: 'Comprobante ilegible',
  PAGO_DUPLICADO: 'Pago duplicado',
  CUENTA_DESTINO_INVALIDA: 'Cuenta destino inválida',
  OTRO: 'Otro',
};

function getPaymentRejectionReasonLabel(reason?: string | null): string | null {
  if (!reason) return null;
  return PAYMENT_REJECTION_REASON_LABELS[reason] ?? reason;
}

interface PaymentConfirmDialogProps {
  isOpen: boolean;
  data: PaymentConfirmationData | null;
  errorMessage: string | null;
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function PaymentConfirmDialog({
  isOpen,
  data,
  errorMessage,
  isLoading,
  onCancel,
  onConfirm,
}: PaymentConfirmDialogProps) {
  const dialogSurfaceRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      lastFocusedElementRef.current?.focus();
      lastFocusedElementRef.current = null;
      return;
    }

    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const timer = window.setTimeout(() => {
      dialogSurfaceRef.current?.querySelector<HTMLButtonElement>('[data-payment-confirm-primary]')?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!isLoading) {
          onCancel();
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogSurfaceRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
      );
      if (focusable.length === 0) return;

      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = activeElement ? focusable.indexOf(activeElement) : -1;
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);

      event.preventDefault();
      focusable[nextIndex]?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, isOpen, onCancel]);

  if (!isOpen || !data) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogSurfaceRef}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-confirm-title"
        aria-describedby="payment-confirm-description"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="payment-confirm-title" className="text-lg font-semibold text-foreground">
              Confirmar reporte de pago
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Revisá los datos antes de enviarlo a administración.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Cerrar confirmación"
            data-payment-confirm-close
          >
            ×
          </Button>
        </div>

        <div id="payment-confirm-description" className="space-y-3">
          <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
            <span className="font-medium text-muted-foreground">Monto</span>
            <span className="text-foreground">{data.amountLabel}</span>

            <span className="font-medium text-muted-foreground">Fecha de pago</span>
            <span className="text-foreground">{data.paidAtLabel}</span>

            <span className="font-medium text-muted-foreground">Cargo / período</span>
            <span className="text-foreground">{data.chargeLabel}</span>

            {data.referenceLabel ? (
              <>
                <span className="font-medium text-muted-foreground">Referencia</span>
                <span className="text-foreground">{data.referenceLabel}</span>
              </>
            ) : null}

            <span className="font-medium text-muted-foreground">Comprobante</span>
            <span className="text-foreground">{data.proofFileName}</span>
          </div>

          <p className="text-sm text-muted-foreground">
            La administración revisará el comprobante antes de aprobarlo.
          </p>

          {errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/40">
              <p className="text-sm text-red-700 dark:text-red-200" aria-live="polite">
                {errorMessage}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isLoading}
            data-payment-confirm-cancel
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="gap-2"
            data-payment-confirm-primary
          >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isLoading ? 'Confirmando...' : 'Confirmar pago'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Resident payments page.
 *
 * Loads resident context, ledger, payments history, and supports proof upload
 * plus payment submission with explicit confirmation before sending.
 */
export const ResidentPaymentsPage = () => {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const session = useAuthSession();
  const userId = session?.user.id ?? null;

  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((t) => t.id === tenantId)?.name ?? tenantId;

  const {
    data: context,
    isLoading: contextLoading,
    isError: contextError,
    error: contextErrorValue,
    refetch: refetchContext,
  } = useResidentContext(tenantId ?? null);
  const buildingId = context?.activeBuildingId ?? null;
  const unitId = context?.activeUnitId ?? null;

  const {
    data: contextOptions,
    isError: contextOptionsError,
    error: contextOptionsErrorValue,
    refetch: refetchContextOptions,
  } = useContextOptions(tenantId ?? null);

  const buildingName = contextOptions?.buildings.find((b) => b.id === buildingId)?.name ?? null;
  const unitLabel = buildingId && unitId ? contextOptions?.unitsByBuilding[buildingId]?.find((u) => u.id === unitId)?.label ?? null : null;

  const {
    data: ledger,
    isLoading: ledgerLoading,
    isError: ledgerError,
    error: ledgerErrorValue,
    refetch: refetchLedger,
  } = useQuery<UnitLedger>({
    queryKey: ['residentLedger', tenantId, userId, unitId],
    queryFn: () => {
      if (!tenantId || !unitId) {
        throw new Error('Missing tenant or unit context for resident ledger');
      }
      return getResidentLedger(tenantId, unitId);
    },
    enabled: !!tenantId && !!unitId,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: payments = [],
    isLoading: paymentsLoading,
    isError: paymentsError,
    error: paymentsErrorValue,
    refetch: refetchPayments,
  } = useQuery<Payment[]>({
    queryKey: ['residentPayments', tenantId, userId, buildingId, unitId],
    queryFn: () => {
      if (!buildingId || !unitId) {
        throw new Error('Missing building or unit context for resident payments');
      }
      return listPayments(buildingId, undefined, unitId, 20);
    },
    enabled: !!tenantId && !!userId && !!buildingId && !!unitId,
    staleTime: 5 * 60 * 1000,
  });

  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<PaymentFormData>({
    selectedChargeId: '',
    method: PaymentMethod.TRANSFER,
    reference: '',
    paidAt: getCurrentCivilDateInputValue(),
  });
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofFileId, setProofFileId] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [downloadingDocumentId, setDownloadingDocumentId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [paymentToConfirm, setPaymentToConfirm] = useState<PaymentConfirmationData | null>(null);
  const activeDownloadObjectUrlsRef = useRef<string[]>([]);
  const activeDownloadTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      activeDownloadTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      activeDownloadTimersRef.current = [];
      activeDownloadObjectUrlsRef.current.forEach((objectUrl) => window.URL.revokeObjectURL(objectUrl));
      activeDownloadObjectUrlsRef.current = [];
    };
  }, []);

  const handleOpenDocument = async (documentId: string) => {
    if (downloadingDocumentId) {
      return;
    }
    setDownloadingDocumentId(documentId);
    try {
      setDownloadError(null);
      const blob = await downloadDocumentContent(tenantId, documentId);
      const objectUrl = window.URL.createObjectURL(blob);
      activeDownloadObjectUrlsRef.current.push(objectUrl);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');

      const timerId = window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
        activeDownloadObjectUrlsRef.current = activeDownloadObjectUrlsRef.current.filter((url) => url !== objectUrl);
        activeDownloadTimersRef.current = activeDownloadTimersRef.current.filter((id) => id !== timerId);
      }, 60_000);
      activeDownloadTimersRef.current.push(timerId);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'No pudimos abrir el documento. Intentá nuevamente.');
    } finally {
      setDownloadingDocumentId(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;

    if (file.size > MAX_PAYMENT_PROOF_SIZE_BYTES) {
      setSubmitError(`El archivo no puede superar ${Math.round(MAX_PAYMENT_PROOF_SIZE_BYTES / 1024 / 1024)}MB`);
      return;
    }

    if (!PAYMENT_PROOF_ALLOWED_MIME_TYPES.includes(file.type as (typeof PAYMENT_PROOF_ALLOWED_MIME_TYPES)[number])) {
      setSubmitError('El comprobante debe ser PDF, JPG o PNG');
      return;
    }

    setUploadingProof(true);
    setSubmitError(null);

    try {
      const presignRes = await presignUpload(
        tenantId,
        file.name,
        file.type,
        file.size,
        'PAYMENT_PROOF',
      );
      await uploadFileToMinio(presignRes.url, file);
      const createdDocument = await createDocument(tenantId, {
        title: `Comprobante pago - ${file.name}`,
        category: 'RECEIPT',
        visibility: 'RESIDENTS',
        file: {
          bucket: presignRes.bucket,
          objectKey: presignRes.objectKey,
          originalName: file.name,
          mimeType: file.type,
          size: file.size,
        },
        buildingId: buildingId ?? undefined,
        unitId: unitId ?? undefined,
      });

      setProofFile(file);
      setProofFileId(createdDocument.file.id);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '';
      setSubmitError(`Error al subir el comprobante: ${errorMessage || 'Intentalo de nuevo'}`);
    } finally {
      setUploadingProof(false);
    }
  };

  const resetForm = () => {
    setFormData({
      selectedChargeId: '',
      method: PaymentMethod.TRANSFER,
      reference: '',
      paidAt: getCurrentCivilDateInputValue(),
    });
    setProofFile(null);
    setProofFileId(null);
  };

  const pendingCharges = ledger?.charges?.filter(
    (c) => (c.amount - (c.allocated ?? 0)) > 0
  ) ?? [];
  const selectedChargeId = pendingCharges.some((charge) => charge.id === formData.selectedChargeId)
    ? formData.selectedChargeId
    : pendingCharges[0]?.id ?? '';
  const selectedCharge = pendingCharges.find((charge) => charge.id === selectedChargeId) ?? null;
  const selectedChargeOutstandingMinor = selectedCharge ? selectedCharge.amount - (selectedCharge.allocated ?? 0) : 0;

  const balance = ledger?.totals?.balance ?? 0;
  const currency = ledger?.totals?.currency ?? 'ARS';

  const canSubmit = !!proofFileId && !!selectedCharge && selectedChargeOutstandingMinor > 0;
  const paymentDateId = 'resident-payment-date';
  const paymentReferenceId = 'resident-payment-reference';
  const paymentMethodId = 'resident-payment-method';
  const paymentProofId = 'resident-payment-proof';

  // Next due charge: use real outstanding, not legacy status
  const nextDueCharge = ledger?.charges
    ?.filter((c) => (c.amount - (c.allocated ?? 0)) > 0)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  const lastPayment = ledger?.payments
    ?.slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildingId || !unitId) return;

    if (!selectedCharge) {
      setSubmitError('Seleccioná un cargo pendiente para continuar.');
      return;
    }

    const amountMinor = selectedChargeOutstandingMinor;
    if (amountMinor <= 0) {
      setSubmitError('Ese cargo ya no tiene saldo pendiente. Actualizá la información.');
      refetchLedger();
      refetchPayments();
      return;
    }

    const amountLabel = formatCurrency(amountMinor, selectedCharge.currency, getLocaleForCurrency(selectedCharge.currency));
    const chargeLabel = `${selectedCharge.concept} • Período ${selectedCharge.period}`;
    if (!proofFileId || !proofFile) {
      setSubmitError('Subí un comprobante antes de continuar.');
      return;
    }

    setSubmitError(null);
    setSubmitSuccess(false);
    setPaymentToConfirm({
      chargeId: selectedCharge.id,
      amountMinor,
      amountLabel,
      chargeLabel,
      currency: selectedCharge.currency,
      paidAtLabel: formatCivilDate(formData.paidAt),
      referenceLabel: formData.reference.trim() || undefined,
      proofFileName: proofFile.name,
    });
    setIsConfirmOpen(true);
  };

  const handleConfirmPayment = async () => {
    if (!buildingId || !unitId || !paymentToConfirm || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      await submitPayment(buildingId, {
        unitId,
        chargeId: paymentToConfirm.chargeId,
        amount: paymentToConfirm.amountMinor,
        currency: paymentToConfirm.currency,
        method: formData.method,
        reference: formData.reference.trim() || undefined,
        paidAt: formData.paidAt || undefined,
        proofFileId: proofFileId || undefined,
      });

      setSubmitSuccess(true);
      resetForm();
      setIsConfirmOpen(false);
      setPaymentToConfirm(null);
      refetchLedger();
      refetchPayments();
      setTimeout(() => {
        setShowForm(false);
        setSubmitSuccess(false);
      }, 2000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error al enviar pago');
      void refetchLedger();
      void refetchPayments();
    } finally {
      setSubmitting(false);
    }
  };

  if (contextLoading || ledgerLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (contextError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pagos</h1>
          <p className="text-muted-foreground">
            {tenantName}
            {buildingName && ` • ${buildingName}`}
            {unitLabel && ` • Unidad ${unitLabel}`}
          </p>
        </div>
        <Card className="p-6 border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-600 mt-0.5" size={24} />
            <div className="space-y-1">
              <p className="font-medium text-red-800">No pudimos cargar tu contexto residente.</p>
              <p className="text-sm text-red-700">
                {contextErrorValue instanceof Error ? contextErrorValue.message : 'Intentá nuevamente en unos segundos.'}
              </p>
              <button
                type="button"
                onClick={() => refetchContext()}
                className="mt-2 text-sm font-medium text-red-700 hover:underline"
              >
                Reintentar
              </button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (ledgerError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pagos</h1>
          <p className="text-muted-foreground">
            {tenantName}
            {buildingName && ` • ${buildingName}`}
            {unitLabel && ` • Unidad ${unitLabel}`}
          </p>
        </div>
        <Card className="p-6 border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-600 mt-0.5" size={24} />
            <div className="space-y-1">
              <p className="font-medium text-red-800">No pudimos cargar tus pagos.</p>
              <p className="text-sm text-red-700">
                {ledgerErrorValue instanceof Error ? ledgerErrorValue.message : 'Intentá nuevamente en unos segundos.'}
              </p>
              <button
                type="button"
                onClick={() => refetchLedger()}
                className="mt-2 text-sm font-medium text-red-700 hover:underline"
              >
                Reintentar
              </button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!unitId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pagos</h1>
          <p className="text-muted-foreground">{tenantName}</p>
        </div>
        <Card className="p-6 border-yellow-300 bg-yellow-50">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-yellow-600" size={24} />
            <div>
              <p className="font-medium text-yellow-800">Sin unidad asignada</p>
              <p className="text-sm text-yellow-700">No tenés una unidad asignada. Comunicate con la administración.</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const contextOptionsWarning = contextOptionsError ? (
    <Card className="p-4 border-amber-200 bg-amber-50">
      <div className="flex items-start gap-3">
        <AlertCircle className="text-amber-600 mt-0.5" size={20} />
        <div className="space-y-1">
          <p className="font-medium text-amber-800">No pudimos cargar el nombre de tu edificio o unidad.</p>
          <p className="text-sm text-amber-700">
            {contextOptionsErrorValue instanceof Error ? contextOptionsErrorValue.message : 'Intentá nuevamente en unos segundos.'}
          </p>
          <button
            type="button"
            onClick={() => refetchContextOptions()}
            className="text-sm font-medium text-amber-800 hover:underline"
          >
            Reintentar
          </button>
        </div>
      </div>
    </Card>
  ) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Pagos</h1>
        <p className="text-muted-foreground">
          {tenantName}
          {buildingName && ` • ${buildingName}`}
          {unitLabel && ` • Unidad ${unitLabel}`}
        </p>
      </div>

      {downloadError && (
        <Card className="p-4 border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-600 mt-0.5" size={20} />
            <div className="space-y-1">
              <p className="font-medium text-red-800">No pudimos abrir el documento.</p>
              <p className="text-sm text-red-700">{downloadError}</p>
            </div>
          </div>
        </Card>
      )}

      {contextOptionsWarning}

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            {balance > 0 ? (
              <AlertCircle className="text-orange-500 mt-0.5" size={22} />
            ) : (
              <CheckCircle className="text-green-500 mt-0.5" size={22} />
            )}
            <div>
              <p className="text-sm font-medium text-muted-foreground">Saldo pendiente</p>
              <p className={`text-2xl font-bold ${balance > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                {formatCurrency(balance, currency, getLocaleForCurrency(currency))}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-3">
            <DollarSign className="text-blue-500 mt-0.5" size={22} />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Próximo vencimiento</p>
              <p className="text-2xl font-bold text-gray-900">
                {nextDueCharge ? formatPaymentDisplayDate(nextDueCharge.dueDate) : '—'}
              </p>
              {nextDueCharge && (
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(nextDueCharge.amount, currency, getLocaleForCurrency(currency))}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-3">
            <CreditCard className="text-green-500 mt-0.5" size={22} />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Último pago</p>
              <p className="text-2xl font-bold text-gray-900">
                {lastPayment ? formatCurrency(lastPayment.amount, lastPayment.currency, getLocaleForCurrency(lastPayment.currency)) : '—'}
              </p>
              {lastPayment && (
                <p className="text-xs text-muted-foreground">
                  {formatPaymentDisplayDate(lastPayment.paidAt ?? lastPayment.createdAt)}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Pending Charges */}
      <Card className="p-4">
        <h3 className="font-semibold text-lg mb-4">Cargos pendientes</h3>
        {pendingCharges.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6">
            <CheckCircle className="w-8 h-8 text-green-600 mb-2" />
            <p className="text-muted-foreground">No tenés cargos pendientes por ahora.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingCharges.map((charge) => (
              <div key={charge.id} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">{charge.concept}</p>
                  <p className="text-sm text-muted-foreground">
                    Período {charge.period} • Vence: {formatPaymentDisplayDate(charge.dueDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{formatCurrency(charge.amount - (charge.allocated ?? 0), charge.currency, getLocaleForCurrency(charge.currency))}</p>
                  <p className="text-xs text-muted-foreground">{getChargeStatusFromDebt(charge.amount, charge.allocated, charge.status)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Payment History */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Historial de pagos</h3>
          <Button onClick={() => setShowForm(!showForm)} className="gap-2">
            <Upload size={16} />
            Reportar pago
          </Button>
        </div>

        {paymentsError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="font-medium text-red-800">No pudimos cargar tu historial de pagos.</p>
            <p className="text-sm text-red-700 mt-1">
              {paymentsErrorValue instanceof Error ? paymentsErrorValue.message : 'Intentá nuevamente en unos segundos.'}
            </p>
            <button
              type="button"
              onClick={() => refetchPayments()}
              className="mt-2 text-sm font-medium text-red-700 hover:underline"
            >
              Reintentar
            </button>
          </div>
        ) : paymentsLoading ? (
          <Skeleton className="h-32" />
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6">
            <p className="text-muted-foreground">Todavía no tenés pagos registrados.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map((payment) => {
              const proofDocumentId = payment.proofDocumentId;
              const receiptDocumentId = payment.receiptDocumentId;
              const rejectionReasonLabel = getPaymentRejectionReasonLabel(payment.rejectionReason);
              const hasReceipt = !!receiptDocumentId;
              const hasProof = !!proofDocumentId;
              const isReceiptTrackingPayment =
                payment.status === PaymentStatus.APPROVED ||
                payment.status === PaymentStatus.RECONCILED;
              const showReceiptGenerationState =
                isReceiptTrackingPayment &&
                !hasReceipt &&
                payment.receiptStatus === 'PENDING';
              const showReceiptErrorState =
                isReceiptTrackingPayment &&
                !hasReceipt &&
                payment.receiptStatus === 'FAILED';
              const downloadDisabled = downloadingDocumentId !== null;
              const paymentDate = formatPaymentDisplayDate(payment.paidAt ?? payment.createdAt);

              return (
                <div key={payment.id} className="flex justify-between items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="flex-1 space-y-1">
                    <p className="font-medium">{formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}</p>
                    <p className="text-sm text-muted-foreground">
                      {payment.method} • {paymentDate}
                      {payment.reference && ` • ${payment.reference}`}
                    </p>
                    {payment.status === 'REJECTED' && (rejectionReasonLabel || payment.rejectionComment) && (
                      <p className="text-sm text-red-700">
                        {rejectionReasonLabel && <span className="font-medium">Motivo: {rejectionReasonLabel}</span>}
                        {rejectionReasonLabel && payment.rejectionComment ? ' — ' : null}
                        {payment.rejectionComment}
                      </p>
                    )}
                    {showReceiptGenerationState && (
                      <p className="text-sm text-muted-foreground">Recibo en generación</p>
                    )}
                    {showReceiptErrorState && (
                      <p className="text-sm text-red-700">
                        {payment.receiptError || 'No pudimos generar el recibo. La administración ya fue notificada.'}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {hasProof ? (
                      <button
                        onClick={() => handleOpenDocument(proofDocumentId)}
                        disabled={downloadDisabled}
                        type="button"
                        aria-label={`Ver comprobante del pago de ${formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}`}
                        className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm disabled:opacity-50"
                      >
                        {downloadingDocumentId === proofDocumentId ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                        Ver comprobante
                      </button>
                    ) : payment.proofFileId ? (
                      <span className="text-xs text-amber-600">Comprobante en procesamiento</span>
                    ) : null}
                    {hasReceipt ? (
                      <button
                        onClick={() => handleOpenDocument(receiptDocumentId)}
                        disabled={downloadDisabled}
                        type="button"
                        aria-label={`Ver recibo del pago de ${formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}`}
                        className="flex items-center gap-1 text-emerald-600 hover:text-emerald-800 text-sm disabled:opacity-50"
                      >
                        {downloadingDocumentId === receiptDocumentId ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                        Ver recibo
                      </button>
                    ) : null}
                    <span className={`px-2 py-1 rounded text-xs font-medium border whitespace-nowrap ${paymentStatusColor(payment.status)}`}>
                      {paymentStatusLabel(payment.status)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Submit Payment Form */}
      {showForm && (
        <Card className="p-4">
          <h3 className="font-semibold text-lg mb-4">Reportar nuevo pago</h3>
          <form onSubmit={handleSubmitPayment} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="resident-payment-charge" className="block text-sm font-medium mb-1">
                  Cargo pendiente
                </label>
                <Select
                  id="resident-payment-charge"
                  value={selectedChargeId}
                  onChange={(e) => setFormData((current) => ({ ...current, selectedChargeId: e.target.value }))}
                  disabled={pendingCharges.length === 0}
                >
                  {pendingCharges.length === 0 ? (
                    <option value="">No tenés cargos pendientes</option>
                  ) : (
                    pendingCharges.map((charge) => {
                      const outstandingMinor = charge.amount - (charge.allocated ?? 0);
                      return (
                        <option key={charge.id} value={charge.id}>
                          {charge.concept} • Período {charge.period} • {formatCurrency(outstandingMinor, charge.currency, getLocaleForCurrency(charge.currency))}
                        </option>
                      );
                    })
                  )}
                </Select>
                {selectedCharge ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Los pagos informados por residentes deben cubrir el saldo completo del período.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No hay cargos pendientes disponibles para reportar.
                  </p>
                )}
                {selectedCharge ? (
                  <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Monto a reportar</p>
                    <p className="text-lg font-semibold">
                      {formatCurrency(selectedChargeOutstandingMinor, selectedCharge.currency, getLocaleForCurrency(selectedCharge.currency))}
                    </p>
                  </div>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor={paymentMethodId}>Método de pago</label>
                <Select id={paymentMethodId} value={PaymentMethod.TRANSFER} disabled>
                  <option value={PaymentMethod.TRANSFER}>Transferencia bancaria</option>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Por ahora BuildingOS solo acepta reportes de pago por transferencia.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor={paymentDateId} className="block text-sm font-medium mb-1">Fecha de pago</label>
                <Input
                  id={paymentDateId}
                  type="date"
                  value={formData.paidAt}
                  onChange={(e) => setFormData({ ...formData, paidAt: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={paymentReferenceId} className="block text-sm font-medium mb-1">Referencia (opcional)</label>
                <Input
                  id={paymentReferenceId}
                  type="text"
                  value={formData.reference}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  placeholder="Ej: Transferencia #12345"
                />
              </div>
            </div>

            <div>
              <label htmlFor={paymentProofId} className="block text-sm font-medium mb-1">
                Comprobante de pago {formData.method === PaymentMethod.TRANSFER && <span className="text-red-500">*</span>}
              </label>
              {formData.method === PaymentMethod.TRANSFER && !proofFile && (
                <p className="text-xs text-amber-600 mb-2">Los pagos por transferencia requieren comprobante</p>
              )}
              <input
                id={paymentProofId}
                type="file"
                accept=".pdf,image/jpeg,image/png"
                onChange={handleFileChange}
                className="block w-full text-sm text-muted-foreground
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-medium
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100"
              />
              {proofFile && (
                <p className="text-sm text-green-600 mt-1 flex items-center gap-2">
                  ✓ {proofFile.name} subido correctamente
                  <button
                    type="button"
                    onClick={() => {
                      setProofFile(null);
                      setProofFileId(null);
                    }}
                    className="text-red-500 hover:text-red-700 font-medium"
                  >
                    (Quitar)
                  </button>
                </p>
              )}
              {uploadingProof && (
                <p className="text-sm text-blue-600 mt-1 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Subiendo comprobante...
                </p>
              )}
            </div>

            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600" aria-live="polite">{submitError}</p>
              </div>
            )}

            {submitSuccess && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-600" aria-live="polite">✓ Pago enviado exitosamente</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button 
                type="submit" 
                disabled={submitting || !canSubmit} 
                className="gap-2"
                id="resident-payment-submit-trigger"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting
                  ? 'Enviando...'
                  : !selectedCharge
                    ? 'Seleccioná un cargo'
                    : !proofFile
                      ? 'Subí el comprobante'
                      : 'Enviar pago'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      <PaymentConfirmDialog
        isOpen={isConfirmOpen}
        data={paymentToConfirm}
        errorMessage={submitError}
        isLoading={submitting}
        onCancel={() => {
          setIsConfirmOpen(false);
          setPaymentToConfirm(null);
          window.setTimeout(() => {
            document.getElementById('resident-payment-submit-trigger')?.focus();
          }, 0);
        }}
        onConfirm={handleConfirmPayment}
      />
    </div>
  );
};

export default ResidentPaymentsPage;
