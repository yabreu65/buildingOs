'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Badge, { type BadgeVariant } from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import { formatCurrency, getLocaleForCurrency } from '@/shared/lib/format/money';

const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CIVIL_DATE_OR_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/;
const MONTH_SHORT_LABELS = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'] as const;
const MONTH_SHORT_UPPER_LABELS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'] as const;

function useMediaQuery(query: string): boolean {
  const getInitialMatch = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState(getInitialMatch);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);

    updateMatches();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateMatches);
      return () => mediaQuery.removeEventListener('change', updateMatches);
    }

    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(updateMatches);
      return () => mediaQuery.removeListener(updateMatches);
    }

    return undefined;
  }, [query]);

  return matches;
}

function normalizeCivilDateValue(dateValue: string | undefined | null): string | null {
  if (!dateValue) return null;

  const normalizedMatch = CIVIL_DATE_OR_TIMESTAMP_PATTERN.exec(dateValue);
  if (!normalizedMatch) return null;

  return normalizedMatch[1];
}

function parseCivilDateParts(dateValue: string | undefined | null): { readonly year: number; readonly monthIndex: number; readonly day: number } | null {
  const normalizedDateValue = normalizeCivilDateValue(dateValue);
  if (!normalizedDateValue || !CIVIL_DATE_PATTERN.test(normalizedDateValue)) return null;

  const [yearPart, monthPart, dayPart] = normalizedDateValue.split('-');
  const year = Number(yearPart);
  const monthIndex = Number(monthPart);
  const day = Number(dayPart);

  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;
  if (monthIndex < 1 || monthIndex > 12) return null;
  if (day < 1 || day > 31) return null;

  return { year, monthIndex, day };
}

function formatCompactCivilDayMonth(dateValue: string | undefined | null): string {
  const parts = parseCivilDateParts(dateValue);
  if (!parts) return '—';

  return `${String(parts.day).padStart(2, '0')} ${MONTH_SHORT_LABELS[parts.monthIndex - 1]}`;
}

function formatCompactCivilDayMonthYear(dateValue: string | undefined | null): string {
  const parts = parseCivilDateParts(dateValue);
  if (!parts) return '—';

  return `${String(parts.day).padStart(2, '0')} ${MONTH_SHORT_LABELS[parts.monthIndex - 1]} ${parts.year}`;
}

function formatCompactPeriodLabel(period: string | undefined | null): string {
  if (!period || !CIVIL_DATE_PATTERN.test(`${period}-01`)) return '—';

  const [yearPart, monthPart] = period.split('-');
  const year = Number(yearPart);
  const monthIndex = Number(monthPart);

  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > 12) return '—';

  return `${MONTH_SHORT_UPPER_LABELS[monthIndex - 1]} ${year}`;
}

function compareChargeOrder(
  a: { readonly dueDate?: string | null; readonly createdAt?: string | null; readonly id: string },
  b: { readonly dueDate?: string | null; readonly createdAt?: string | null; readonly id: string },
): number {
  const dueDateA = new Date(a.dueDate ?? '').getTime();
  const dueDateB = new Date(b.dueDate ?? '').getTime();
  const dueDateDiff = (Number.isNaN(dueDateA) ? 0 : dueDateA) - (Number.isNaN(dueDateB) ? 0 : dueDateB);
  if (dueDateDiff !== 0) return dueDateDiff;

  const createdAtA = new Date(a.createdAt ?? '').getTime();
  const createdAtB = new Date(b.createdAt ?? '').getTime();
  const createdAtDiff = (Number.isNaN(createdAtA) ? 0 : createdAtA) - (Number.isNaN(createdAtB) ? 0 : createdAtB);
  if (createdAtDiff !== 0) return createdAtDiff;

  return a.id.localeCompare(b.id);
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];

  const focusableSelectors = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelectors)).filter((element) => {
    const hidden = element.getAttribute('aria-hidden') === 'true';
    return !hidden && !element.hasAttribute('disabled');
  });
}

function formatCivilDate(dateValue: string | undefined | null): string {
  const normalizedDateValue = normalizeCivilDateValue(dateValue);
  if (!normalizedDateValue) return '—';

  const [year, month, day] = normalizedDateValue.split('-');
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

  const normalizedDateValue = normalizeCivilDateValue(dateValue);
  return normalizedDateValue
    ? formatCivilDate(normalizedDateValue)
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

function getMobileChargeStatusLabel(charge: {
  readonly amount: number;
  readonly allocated?: number;
  readonly status: ChargeStatus;
  readonly dueDate: string;
}, todayCivilDate: string): { readonly label: string; readonly variant: BadgeVariant } {
  const outstandingMinor = charge.amount - (charge.allocated ?? 0);
  const isOverdue = charge.dueDate < todayCivilDate;

  if (charge.status === ChargeStatus.CANCELED) {
    return { label: 'Cancelado', variant: 'muted' };
  }

  if (outstandingMinor <= 0) {
    return { label: 'Pagado', variant: 'success' };
  }

  if (charge.allocated && charge.allocated > 0 && charge.allocated < charge.amount) {
    return { label: 'Parcial', variant: 'info' };
  }

  if (isOverdue) {
    return { label: 'Vencido', variant: 'warning' };
  }

  return { label: 'Pendiente', variant: 'muted' };
}

function getRecentPaymentsLabel(count: number): string | null {
  if (count === 0) return null;
  if (count === 1) return '1 pago registrado';
  if (count >= 20) return 'Mostrando los últimos 20 pagos';
  return `${count} pagos registrados`;
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

function paymentStatusVariant(status: string): BadgeVariant {
  const variants: Record<string, BadgeVariant> = {
    SUBMITTED: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    RECONCILED: 'info',
  };
  return variants[status] ?? 'muted';
}

interface PaymentFormData {
  selectedPrefixLength: number;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
}

interface PaymentConfirmationData {
  chargeIds: string[];
  amountMinor: number;
  amountLabel: string;
  selectionLabel: string;
  chargeLabels: string[];
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
            <span className="font-medium text-muted-foreground">Monto exacto</span>
            <span className="text-foreground">{data.amountLabel}</span>

            <span className="font-medium text-muted-foreground">Fecha de pago</span>
            <span className="text-foreground">{data.paidAtLabel}</span>

            <span className="font-medium text-muted-foreground">Selección</span>
            <span className="text-foreground">{data.selectionLabel}</span>

            {data.referenceLabel ? (
              <>
                <span className="font-medium text-muted-foreground">Referencia</span>
                <span className="text-foreground">{data.referenceLabel}</span>
              </>
            ) : null}

            <span className="font-medium text-muted-foreground">Obligaciones</span>
            <div className="text-foreground">
              <ul className="space-y-1">
                {data.chargeLabels.map((label, index) => (
                  <li key={`${label}-${index}`}>{label}</li>
                ))}
              </ul>
            </div>

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
  const isMobileViewport = useMediaQuery('(max-width: 767px)');

  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((t) => t.id === tenantId)?.name ?? 'Administración actual';

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
    selectedPrefixLength: 0,
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
  const [mobileTab, setMobileTab] = useState<'summary' | 'pending' | 'history'>('summary');
  const [isPaymentPanelOpen, setIsPaymentPanelOpen] = useState(false);
  const activeDownloadObjectUrlsRef = useRef<string[]>([]);
  const activeDownloadTimersRef = useRef<number[]>([]);
  const submitSuccessTimerRef = useRef<number | null>(null);
  const paymentPanelRef = useRef<HTMLDivElement | null>(null);
  const paymentPanelLastFocusedRef = useRef<HTMLElement | null>(null);
  const paymentContextKeyRef = useRef<string>('');

  useEffect(() => {
    paymentContextKeyRef.current = `${tenantId ?? ''}:${buildingId ?? ''}:${unitId ?? ''}`;
    setShowForm(false);
    setIsPaymentPanelOpen(false);
    setIsConfirmOpen(false);
    setPaymentToConfirm(null);
    setSubmitError(null);
    setSubmitSuccess(false);
    setSubmitting(false);
    setUploadingProof(false);
    resetForm();
  }, [buildingId, tenantId, unitId]);

  useEffect(() => {
    return () => {
      if (submitSuccessTimerRef.current !== null) {
        window.clearTimeout(submitSuccessTimerRef.current);
        submitSuccessTimerRef.current = null;
      }
      activeDownloadTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      activeDownloadTimersRef.current = [];
      activeDownloadObjectUrlsRef.current.forEach((objectUrl) => window.URL.revokeObjectURL(objectUrl));
      activeDownloadObjectUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!isPaymentPanelOpen || !isMobileViewport) {
      if (paymentPanelLastFocusedRef.current) {
        paymentPanelLastFocusedRef.current.focus();
        paymentPanelLastFocusedRef.current = null;
      }
      return undefined;
    }

    paymentPanelLastFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = getFocusableElements(paymentPanelRef.current);
    focusables[0]?.focus();

    return () => {
      document.body.style.overflow = originalBodyOverflow;
    };
  }, [isMobileViewport, isPaymentPanelOpen]);

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
    const contextKey = paymentContextKeyRef.current;

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

      if (paymentContextKeyRef.current !== contextKey) {
        return;
      }

      setProofFile(file);
      setProofFileId(createdDocument.file.id);
    } catch (error: unknown) {
      if (paymentContextKeyRef.current !== contextKey) {
        return;
      }
      const errorMessage = error instanceof Error ? error.message : '';
      setSubmitError(`Error al subir el comprobante: ${errorMessage || 'Intentalo de nuevo'}`);
    } finally {
      if (paymentContextKeyRef.current === contextKey) {
        setUploadingProof(false);
      }
    }
  };

  const resetForm = () => {
    setFormData({
      selectedPrefixLength: 0,
      method: PaymentMethod.TRANSFER,
      reference: '',
      paidAt: getCurrentCivilDateInputValue(),
    });
    setProofFile(null);
    setProofFileId(null);
  };

  const openPaymentPanel = useCallback(() => {
    paymentPanelLastFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setShowForm(false);
    setMobileTab('summary');
    setIsPaymentPanelOpen(true);
    setSubmitError(null);
    setSubmitSuccess(false);
  }, []);

  const closePaymentPanel = useCallback((restoreFocus = true) => {
    if (submitSuccessTimerRef.current !== null) {
      window.clearTimeout(submitSuccessTimerRef.current);
      submitSuccessTimerRef.current = null;
    }
    if (!restoreFocus) {
      paymentPanelLastFocusedRef.current = null;
      setIsPaymentPanelOpen(false);
      return;
    }

    paymentPanelLastFocusedRef.current?.focus();
    paymentPanelLastFocusedRef.current = null;
    setIsPaymentPanelOpen(false);
  }, []);

  const handlePaymentPanelKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!submitting) {
        closePaymentPanel();
      }
      return;
    }

    if (event.key !== 'Tab') return;

    const focusables = getFocusableElements(paymentPanelRef.current);
    if (focusables.length === 0) return;

    const activeElement = document.activeElement as HTMLElement | null;
    const currentIndex = activeElement ? focusables.indexOf(activeElement) : -1;
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1)
      : (currentIndex === focusables.length - 1 ? 0 : currentIndex + 1);

    event.preventDefault();
    focusables[nextIndex]?.focus();
  }, [closePaymentPanel, submitting]);

  const handleMobileTabChange = useCallback((tab: 'summary' | 'pending' | 'history') => {
    setMobileTab(tab);
  }, []);

  const handleMobilePaymentFormCancel = useCallback(() => {
    if (!submitting) {
      setIsPaymentPanelOpen(false);
    }
  }, [submitting]);

  const pendingCharges = useMemo(
    () => (ledger?.charges ?? [])
      .filter((charge) => (charge.amount - (charge.allocated ?? 0)) > 0)
      .slice()
      .sort(compareChargeOrder),
    [ledger?.charges],
  );
  const activeSubmittedChargeIds = useMemo(() => {
    const activePayments = payments.filter((payment) => payment.status === PaymentStatus.SUBMITTED);
    return new Set(
      activePayments.flatMap((payment) => (
        payment.paymentAllocations?.map((allocation) => allocation.chargeId) ?? []
      )),
    );
  }, [payments]);
  const selectableCharges = useMemo(() => {
    const charges: typeof pendingCharges = [];
    for (const charge of pendingCharges) {
      if (activeSubmittedChargeIds.has(charge.id)) {
        break;
      }
      charges.push(charge);
    }

    return charges;
  }, [activeSubmittedChargeIds, pendingCharges]);
  const paymentOptions = useMemo(() => (
    selectableCharges.map((_, index) => {
      const charges = selectableCharges.slice(0, index + 1);
      const totalMinor = charges.reduce(
        (sum, charge) => sum + (charge.amount - (charge.allocated ?? 0)),
        0,
      );

      return {
        key: String(index + 1),
        chargeIds: charges.map((charge) => charge.id),
        charges,
        totalMinor,
        currency: charges[0]?.currency ?? ledger?.totals?.currency ?? 'ARS',
      };
    })
  ), [ledger?.totals?.currency, selectableCharges]);
  const selectedPrefixLength = paymentOptions.some((option) => option.chargeIds.length === formData.selectedPrefixLength)
    ? formData.selectedPrefixLength
    : 0;
  const selectedPaymentOption = selectedPrefixLength > 0
    ? paymentOptions[selectedPrefixLength - 1] ?? null
    : null;
  const selectedChargeIds = selectedPaymentOption?.chargeIds ?? [];

  const balance = ledger?.totals?.balance ?? 0;
  const currency = ledger?.totals?.currency ?? 'ARS';
  const sortedRecentPayments = useMemo(
    () => payments
      .slice()
      .sort((a, b) => new Date(b.paidAt ?? b.createdAt).getTime() - new Date(a.paidAt ?? a.createdAt).getTime()),
    [payments],
  );

  const canSubmit = !!proofFileId && selectedPrefixLength > 0 && !!selectedPaymentOption;
  const paymentDateId = 'resident-payment-date';
  const paymentReferenceId = 'resident-payment-reference';
  const paymentMethodId = 'resident-payment-method';
  const paymentProofId = 'resident-payment-proof';

  // Next due charge: use real outstanding, not legacy status
  const nextDueCharge = selectableCharges[0];

  const lastPayment = sortedRecentPayments[0];

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildingId || !unitId) return;

    if (!selectedPaymentOption) {
      setSubmitError('Seleccioná un prefijo válido de obligaciones para continuar.');
      return;
    }

    const amountMinor = selectedPaymentOption.totalMinor;
    if (amountMinor <= 0) {
      setSubmitError('Ese prefijo ya no tiene saldo pendiente. Actualizá la información.');
      refetchLedger();
      refetchPayments();
      return;
    }

    const amountLabel = formatCurrency(amountMinor, selectedPaymentOption.currency, getLocaleForCurrency(selectedPaymentOption.currency));
    const selectionLabel = `${selectedPaymentOption.charges.length} ${selectedPaymentOption.charges.length === 1 ? 'período' : 'períodos'}`;
    const chargeLabels = selectedPaymentOption.charges.map((charge) => (
      `${formatCompactPeriodLabel(charge.period)} · ${charge.concept} · ${formatCurrency(charge.amount - (charge.allocated ?? 0), charge.currency, getLocaleForCurrency(charge.currency))}`
    ));
    if (!proofFileId || !proofFile) {
      setSubmitError('Subí un comprobante antes de continuar.');
      return;
    }

    setSubmitError(null);
    setSubmitSuccess(false);
    setPaymentToConfirm({
      chargeIds: selectedChargeIds,
      amountMinor,
      amountLabel,
      selectionLabel,
      chargeLabels,
      currency: selectedPaymentOption.currency,
      paidAtLabel: formatCivilDate(formData.paidAt),
      referenceLabel: formData.reference.trim() || undefined,
      proofFileName: proofFile.name,
    });
    setIsConfirmOpen(true);
  };

  const handleConfirmPayment = async () => {
    if (!buildingId || !unitId || !paymentToConfirm || submitting) return;

    const contextKey = paymentContextKeyRef.current;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      await submitPayment(buildingId, {
        unitId,
        chargeIds: paymentToConfirm.chargeIds,
        amount: paymentToConfirm.amountMinor,
        currency: paymentToConfirm.currency,
        method: formData.method,
        reference: formData.reference.trim() || undefined,
        paidAt: formData.paidAt || undefined,
        proofFileId: proofFileId || undefined,
      }, 'resident');

      if (paymentContextKeyRef.current !== contextKey) {
        return;
      }

      setSubmitSuccess(true);
      resetForm();
      setIsConfirmOpen(false);
      setPaymentToConfirm(null);
      refetchLedger();
      refetchPayments();
      if (submitSuccessTimerRef.current !== null) {
        window.clearTimeout(submitSuccessTimerRef.current);
      }
      submitSuccessTimerRef.current = window.setTimeout(() => {
        if (isMobileViewport) {
          closePaymentPanel();
        } else {
          setShowForm(false);
        }
        setSubmitSuccess(false);
        submitSuccessTimerRef.current = null;
      }, 2000);
    } catch (err) {
      if (paymentContextKeyRef.current !== contextKey) {
        return;
      }
      setSubmitError(err instanceof Error ? err.message : 'Error al enviar pago');
      void refetchLedger();
      void refetchPayments();
    } finally {
      if (paymentContextKeyRef.current === contextKey) {
        setSubmitting(false);
      }
    }
  };

  const renderPaymentFormSection = (mode: 'desktop' | 'mobile', onCancel: () => void) => {
    const isMobilePanel = mode === 'mobile';
    const formBody = (
      <form
        onSubmit={handleSubmitPayment}
        className={isMobilePanel ? 'flex min-h-0 flex-1 flex-col' : 'space-y-4'}
      >
        <div className={isMobilePanel ? 'min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4' : 'space-y-4'}>
          <fieldset className="space-y-3">
            <div>
              <legend className="block text-sm font-medium text-foreground">
                Seleccioná un prefijo válido
              </legend>
              <p className="mt-1 text-xs text-muted-foreground">
                Tu pago se aplicará a las obligaciones más antiguas. Cada período seleccionado debe pagarse completamente.
              </p>
            </div>

            {paymentOptions.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                No hay obligaciones elegibles para pagar ahora mismo.
                {selectableCharges.length === 0 && pendingCharges.length > 0 ? ' Hay una obligación más antigua en proceso o ya cubierta.' : ''}
              </div>
            ) : (
              <div className="space-y-3" role="radiogroup" aria-label="Prefijos de obligaciones disponibles">
                {paymentOptions.map((option) => {
                  const isSelected = selectedPrefixLength === option.chargeIds.length;
                  const optionId = `resident-payment-prefix-${option.chargeIds.length}`;
                  return (
                    <label
                      key={optionId}
                      htmlFor={optionId}
                      className={`block cursor-pointer rounded-xl border p-4 transition ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20 dark:border-blue-400 dark:bg-blue-950/30'
                          : 'border-border bg-card hover:bg-muted/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <input
                              id={optionId}
                              type="radio"
                              name="resident-payment-prefix"
                              value={option.chargeIds.length}
                              checked={isSelected}
                              onChange={(event) => {
                                setFormData((current) => ({
                                  ...current,
                                  selectedPrefixLength: Number(event.target.value),
                                }));
                              }}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm font-semibold text-foreground">
                              Pagar {option.chargeIds.length} {option.chargeIds.length === 1 ? 'período' : 'períodos'}
                            </span>
                          </div>
                          <ul className="mt-3 space-y-1 pl-7 text-sm text-muted-foreground">
                            {option.charges.map((charge) => {
                              const outstandingMinor = charge.amount - (charge.allocated ?? 0);
                              return (
                                <li key={charge.id}>
                                  {formatCompactPeriodLabel(charge.period)} · {charge.concept} · {formatCurrency(outstandingMinor, charge.currency, getLocaleForCurrency(charge.currency))}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                        <div className="flex shrink-0 flex-col items-end text-right">
                          <span className="text-xs uppercase tracking-wide text-muted-foreground">Total exacto</span>
                          <span className="text-lg font-semibold text-foreground">
                            {formatCurrency(option.totalMinor, option.currency, getLocaleForCurrency(option.currency))}
                          </span>
                          <span className="text-xs text-muted-foreground">{option.currency}</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {selectedPaymentOption ? (
              <p className="text-xs text-muted-foreground">
                Se aplicará primero a la obligación más antigua y no se aceptarán saltos ni montos parciales.
              </p>
            ) : null}
          </fieldset>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor={paymentMethodId}>Método de pago</label>
              <Select id={paymentMethodId} value={PaymentMethod.TRANSFER} disabled>
                <option value={PaymentMethod.TRANSFER}>Transferencia bancaria</option>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Por ahora BuildingOS solo acepta reportes de pago por transferencia.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor={paymentDateId} className="mb-1 block text-sm font-medium">Fecha de pago</label>
              <Input
                id={paymentDateId}
                type="date"
                value={formData.paidAt}
                onChange={(e) => setFormData({ ...formData, paidAt: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={paymentReferenceId} className="mb-1 block text-sm font-medium">Referencia (opcional)</label>
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
            <label htmlFor={paymentProofId} className="mb-1 block text-sm font-medium">
              Comprobante de pago {formData.method === PaymentMethod.TRANSFER && <span className="text-red-500">*</span>}
            </label>
            {formData.method === PaymentMethod.TRANSFER && !proofFile && (
              <p className="mb-2 text-xs text-amber-600">Los pagos por transferencia requieren comprobante</p>
            )}
            <input
              id={paymentProofId}
              type="file"
              accept=".pdf,image/jpeg,image/png"
              onChange={handleFileChange}
              className="block w-full text-sm text-muted-foreground
                file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700
                hover:file:bg-blue-100"
            />
            {proofFile && (
              <p className="mt-1 flex items-center gap-2 text-sm text-green-600">
                ✓ {proofFile.name} subido correctamente
                <button
                  type="button"
                  onClick={() => {
                    setProofFile(null);
                    setProofFileId(null);
                  }}
                  className="font-medium text-red-500 hover:text-red-700"
                >
                  (Quitar)
                </button>
              </p>
            )}
            {uploadingProof && (
              <p className="mt-1 flex items-center gap-2 text-sm text-blue-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Subiendo comprobante...
              </p>
            )}
          </div>

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-600" aria-live="polite" role="alert">{submitError}</p>
            </div>
          )}

          {submitSuccess && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3" role="status" aria-live="polite">
              <p className="text-sm text-green-600">✓ Pago enviado exitosamente</p>
            </div>
          )}
        </div>

        <div className={isMobilePanel ? 'shrink-0 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]' : 'flex gap-2'}>
          <div className={isMobilePanel ? 'flex flex-col-reverse gap-3 sm:flex-row sm:justify-end' : 'flex gap-2'}>
            <Button
              type="submit"
              disabled={submitting || submitSuccess || !canSubmit}
              className={isMobilePanel ? 'min-h-12 flex-1 gap-2 sm:flex-none' : 'gap-2'}
              id="resident-payment-submit-trigger"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting
                ? 'Enviando...'
                : !selectedPaymentOption
                  ? 'Seleccioná un prefijo'
                  : !proofFile
                    ? 'Subí el comprobante'
                    : 'Enviar pago'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              className={isMobilePanel ? 'min-h-11 flex-1 sm:flex-none' : undefined}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </form>
    );

    if (isMobilePanel) {
      return formBody;
    }

    return (
      <Card className="p-4">
        <h3 className="mb-4 text-lg font-semibold">Reportar nuevo pago</h3>
        {formBody}
      </Card>
    );
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

  const mobilePendingPreview = selectableCharges.slice(0, 3);
  const mobileRecentPaymentsPreview = sortedRecentPayments.slice(0, 2);
  const recentPaymentsLabel = getRecentPaymentsLabel(sortedRecentPayments.length);

  if (isMobileViewport) {
    const todayCivilDate = getCurrentCivilDateInputValue();
    const mobileSections = [
      { id: 'summary', label: 'Resumen' },
      { id: 'pending', label: 'Pendientes' },
      { id: 'history', label: 'Historial' },
    ] as const;

    return (
      <div className="space-y-5 overflow-x-hidden px-4 pb-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold leading-tight text-foreground">Pagos</h1>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {tenantName}
            {buildingName && ` • ${buildingName}`}
            {unitLabel && ` • Unidad ${unitLabel}`}
          </p>
        </div>

        {downloadError && (
          <Card className="p-3 border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="text-red-600 mt-0.5" size={18} />
              <div className="space-y-1">
                <p className="font-medium text-red-800">No pudimos abrir el documento.</p>
                <p className="text-sm text-red-700">{downloadError}</p>
              </div>
            </div>
          </Card>
        )}

        {contextOptionsWarning ? <div className="text-sm">{contextOptionsWarning}</div> : null}

        <div role="tablist" aria-label="Secciones de pagos" className="grid grid-cols-3 gap-2 rounded-2xl border border-border bg-muted/40 p-1">
          {mobileSections.map((section) => {
            const isSelected = mobileTab === section.id;
            return (
              <button
                key={section.id}
                type="button"
                role="tab"
                id={`resident-payments-mobile-${section.id}-tab`}
                aria-selected={isSelected}
                aria-controls={`resident-payments-mobile-${section.id}`}
                onClick={() => handleMobileTabChange(section.id)}
                className={[
                  'flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium transition',
                  isSelected
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background/80 hover:text-foreground',
                ].join(' ')}
              >
                {section.label}
              </button>
            );
          })}
        </div>

        {mobileTab === 'summary' && (
          <div id="resident-payments-mobile-summary" role="tabpanel" aria-labelledby="resident-payments-mobile-summary-tab" className="space-y-4">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Saldo pendiente</p>
                  <p className="text-[clamp(1.75rem,8vw,2rem)] font-bold leading-none tabular-nums text-foreground">
                    {formatCurrency(balance, currency, getLocaleForCurrency(currency))}
                  </p>
                  <p className="text-sm text-muted-foreground">
                  {selectableCharges.length} cargos elegibles
                  </p>
                </div>
                {balance > 0 ? (
                  <AlertCircle className="mt-1 text-orange-500" size={24} />
                ) : (
                  <CheckCircle className="mt-1 text-green-500" size={24} />
                )}
              </div>
              <div className="mt-4">
                <Button
                  type="button"
                  onClick={openPaymentPanel}
                  className="w-full min-h-12 gap-2"
                  aria-controls="resident-payments-mobile-panel"
                  aria-expanded={isPaymentPanelOpen}
                >
                  <Upload size={16} />
                  Reportar pago
                </Button>
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
              <Card className="p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Próximo vencimiento</p>
                <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">
                  {nextDueCharge ? formatCompactCivilDayMonth(nextDueCharge.dueDate) : '—'}
                </p>
                {nextDueCharge ? (
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(nextDueCharge.amount, currency, getLocaleForCurrency(currency))}
                  </p>
                ) : null}
              </Card>
              <Card className="p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Último pago</p>
                <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">
                  {lastPayment ? formatCurrency(lastPayment.amount, lastPayment.currency, getLocaleForCurrency(lastPayment.currency)) : '—'}
                </p>
                {lastPayment ? (
                  <p className="text-sm text-muted-foreground">
                    {formatCompactCivilDayMonthYear(lastPayment.paidAt ?? lastPayment.createdAt)}
                  </p>
                ) : null}
              </Card>
            </div>

            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Cargos próximos</p>
                  <h2 className="text-lg font-semibold text-foreground">Lo que tenés por resolver</h2>
                </div>
                {selectableCharges.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 px-3"
                    onClick={() => handleMobileTabChange('pending')}
                  >
                    Ver todos
                  </Button>
                ) : null}
              </div>

              {mobilePendingPreview.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No tenés cargos pendientes por ahora.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {mobilePendingPreview.map((charge) => {
                    const outstandingMinor = charge.amount - (charge.allocated ?? 0);
                    const statusInfo = getMobileChargeStatusLabel(charge, todayCivilDate);
                    const isOverdue = statusInfo.label === 'Vencido';

                    return (
                      <div
                        key={charge.id}
                        className={[
                          'rounded-2xl border bg-card p-4',
                          isOverdue ? 'border-amber-300 dark:border-amber-900/60' : 'border-border',
                        ].join(' ')}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {formatCompactPeriodLabel(charge.period)}
                            </p>
                            <p className="line-clamp-2 text-sm font-medium text-foreground">{charge.concept}</p>
                            <p className="text-xs text-muted-foreground">
                              Vence {formatCompactCivilDayMonth(charge.dueDate)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-base font-semibold tabular-nums text-foreground">
                              {formatCurrency(outstandingMinor, charge.currency, getLocaleForCurrency(charge.currency))}
                            </p>
                            <div className="mt-2 flex justify-end">
                              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {lastPayment ? (
            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Historial reciente</p>
                  <h2 className="text-lg font-semibold text-foreground">Tu último movimiento</h2>
                </div>
                  {payments.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 px-3"
                      onClick={() => handleMobileTabChange('history')}
                    >
                      Ver historial
                    </Button>
                  ) : null}
              </div>
              {recentPaymentsLabel ? (
                <p className="mt-1 text-sm text-muted-foreground">{recentPaymentsLabel}</p>
              ) : null}
              <div className="mt-4 space-y-3">
                {mobileRecentPaymentsPreview.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Todavía no tenés pagos registrados.</p>
                  ) : (
                    mobileRecentPaymentsPreview.map((payment) => {
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
                      const paymentDate = formatCompactCivilDayMonthYear(payment.paidAt ?? payment.createdAt);
                      const statusLabel = paymentStatusLabel(payment.status);

                      return (
                        <div key={payment.id} className="rounded-2xl border border-border bg-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="text-base font-semibold tabular-nums text-foreground">
                                {formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {paymentDate} · {payment.method}
                                {payment.reference ? ` · ${payment.reference}` : ''}
                              </p>
                              {payment.status === 'REJECTED' && (rejectionReasonLabel || payment.rejectionComment) && (
                                <p className="line-clamp-2 text-sm text-red-700 dark:text-red-300">
                                  {rejectionReasonLabel && <span className="font-medium">Motivo: {rejectionReasonLabel}</span>}
                                  {rejectionReasonLabel && payment.rejectionComment ? ' — ' : null}
                                  {payment.rejectionComment}
                                </p>
                              )}
                              {showReceiptGenerationState && (
                                <p className="text-sm text-muted-foreground">Recibo en generación</p>
                              )}
                              {showReceiptErrorState && (
                                <p className="text-sm text-red-700 dark:text-red-300">
                                  {payment.receiptError || 'No pudimos generar el recibo. La administración ya fue notificada.'}
                                </p>
                              )}
                            </div>
                            <Badge variant={paymentStatusVariant(payment.status)} className="shrink-0 whitespace-nowrap">
                              {statusLabel}
                            </Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {hasProof ? (
                              <button
                                onClick={() => handleOpenDocument(proofDocumentId)}
                                disabled={downloadDisabled}
                                type="button"
                                aria-label={`Ver comprobante del pago de ${formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}`}
                                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm text-blue-600 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-50"
                              >
                                {downloadingDocumentId === proofDocumentId ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <FileText className="h-4 w-4" />
                                )}
                                Ver comprobante
                              </button>
                            ) : payment.proofFileId ? (
                              <span className="inline-flex min-h-11 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs text-amber-700">
                                Comprobante en procesamiento
                              </span>
                            ) : null}
                            {hasReceipt ? (
                              <button
                                onClick={() => handleOpenDocument(receiptDocumentId)}
                                disabled={downloadDisabled}
                                type="button"
                                aria-label={`Ver recibo del pago de ${formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}`}
                                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50"
                              >
                                {downloadingDocumentId === receiptDocumentId ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <FileText className="h-4 w-4" />
                                )}
                                Ver recibo
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>
            ) : null}
          </div>
        )}

        {mobileTab === 'pending' && (
          <div id="resident-payments-mobile-pending" role="tabpanel" aria-labelledby="resident-payments-mobile-pending-tab" className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Cargos pendientes</h2>
                <p className="text-sm text-muted-foreground">{selectableCharges.length} cargos con saldo pendiente</p>
              </div>
              <Button
                type="button"
                onClick={openPaymentPanel}
                className="min-h-11 gap-2"
                aria-controls="resident-payments-mobile-panel"
                aria-expanded={isPaymentPanelOpen}
              >
                <Upload size={16} />
                Reportar pago
              </Button>
            </div>

            {selectableCharges.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">No tenés cargos pendientes por ahora.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {selectableCharges.map((charge) => {
                  const outstandingMinor = charge.amount - (charge.allocated ?? 0);
                  const statusInfo = getMobileChargeStatusLabel(charge, todayCivilDate);
                  const isOverdue = statusInfo.label === 'Vencido';

                  return (
                    <Card
                      key={charge.id}
                      className={[
                        'p-4',
                        isOverdue ? 'border-amber-300 dark:border-amber-900/60' : '',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {formatCompactPeriodLabel(charge.period)}
                            </p>
                            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                          </div>
                          <p className="line-clamp-2 text-sm font-medium text-foreground">{charge.concept}</p>
                          <p className="text-sm text-muted-foreground">
                            Vence {formatCompactCivilDayMonth(charge.dueDate)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-semibold tabular-nums text-foreground">
                            {formatCurrency(outstandingMinor, charge.currency, getLocaleForCurrency(charge.currency))}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Saldo pendiente
                          </p>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {mobileTab === 'history' && (
          <div id="resident-payments-mobile-history" role="tabpanel" aria-labelledby="resident-payments-mobile-history-tab" className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Historial de pagos</h2>
              {recentPaymentsLabel ? (
                <p className="text-sm text-muted-foreground">{recentPaymentsLabel}</p>
              ) : null}
            </div>

            {paymentsError ? (
              <Card className="border-red-200 bg-red-50 p-4">
                <p className="font-medium text-red-800">No pudimos cargar tu historial de pagos.</p>
                <p className="mt-1 text-sm text-red-700">
                  {paymentsErrorValue instanceof Error ? paymentsErrorValue.message : 'Intentá nuevamente en unos segundos.'}
                </p>
                <button
                  type="button"
                  onClick={() => refetchPayments()}
                  className="mt-3 text-sm font-medium text-red-700 hover:underline"
                >
                  Reintentar
                </button>
              </Card>
            ) : paymentsLoading ? (
              <Skeleton className="h-32" />
                    ) : sortedRecentPayments.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">Todavía no tenés pagos registrados.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {sortedRecentPayments.map((payment) => {
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
                  const paymentDate = formatCompactCivilDayMonthYear(payment.paidAt ?? payment.createdAt);
                  const statusLabel = paymentStatusLabel(payment.status);

                  return (
                    <Card key={payment.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-base font-semibold tabular-nums text-foreground">
                            {formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {paymentDate} · {payment.method}
                            {payment.reference ? ` · ${payment.reference}` : ''}
                          </p>
                          {payment.status === 'REJECTED' && (rejectionReasonLabel || payment.rejectionComment) && (
                            <p className="line-clamp-2 text-sm text-red-700 dark:text-red-300">
                              {rejectionReasonLabel && <span className="font-medium">Motivo: {rejectionReasonLabel}</span>}
                              {rejectionReasonLabel && payment.rejectionComment ? ' — ' : null}
                              {payment.rejectionComment}
                            </p>
                          )}
                          {showReceiptGenerationState && (
                            <p className="text-sm text-muted-foreground">Recibo en generación</p>
                          )}
                          {showReceiptErrorState && (
                            <p className="text-sm text-red-700 dark:text-red-300">
                              {payment.receiptError || 'No pudimos generar el recibo. La administración ya fue notificada.'}
                            </p>
                          )}
                        </div>
                        <Badge variant={paymentStatusVariant(payment.status)} className="shrink-0 whitespace-nowrap">
                          {statusLabel}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {hasProof ? (
                          <button
                            onClick={() => handleOpenDocument(proofDocumentId)}
                            disabled={downloadDisabled}
                            type="button"
                            aria-label={`Ver comprobante del pago de ${formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}`}
                            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm text-blue-600 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-50"
                          >
                            {downloadingDocumentId === proofDocumentId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                            Ver comprobante
                          </button>
                        ) : payment.proofFileId ? (
                          <span className="inline-flex min-h-11 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs text-amber-700">
                            Comprobante en procesamiento
                          </span>
                        ) : null}
                        {hasReceipt ? (
                          <button
                            onClick={() => handleOpenDocument(receiptDocumentId)}
                            disabled={downloadDisabled}
                            type="button"
                            aria-label={`Ver recibo del pago de ${formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}`}
                            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50"
                          >
                            {downloadingDocumentId === receiptDocumentId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                            Ver recibo
                          </button>
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {isPaymentPanelOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => {
              if (!submitting) {
                closePaymentPanel();
              }
            }}
            aria-hidden="true"
          >
            <div className="flex h-full items-end justify-center">
              <div
                id="resident-payments-mobile-panel"
                ref={paymentPanelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="resident-payments-mobile-panel-title"
                className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card text-card-foreground shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={handlePaymentPanelKeyDown}
              >
                <div className="shrink-0 border-b border-border px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p id="resident-payments-mobile-panel-title" className="text-lg font-semibold text-foreground">
                        Reportar pago
                      </p>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        Cargá el comprobante y completá los datos del pago para enviarlo a revisión.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!submitting) {
                          closePaymentPanel();
                        }
                      }}
                      className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label="Cerrar reporte de pago"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {renderPaymentFormSection('mobile', handleMobilePaymentFormCancel)}
              </div>
            </div>
          </div>
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
  }

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
              <p className="text-2xl font-bold text-foreground">
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
              <p className="text-2xl font-bold text-foreground">
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
        {selectableCharges.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6">
            <CheckCircle className="w-8 h-8 text-green-600 mb-2" />
            <p className="text-muted-foreground">No tenés cargos pendientes por ahora.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {selectableCharges.map((charge) => (
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
                    <Badge variant={paymentStatusVariant(payment.status)} className="whitespace-nowrap">
                      {paymentStatusLabel(payment.status)}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Submit Payment Form */}
      {showForm && renderPaymentFormSection('desktop', () => setShowForm(false))}

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
