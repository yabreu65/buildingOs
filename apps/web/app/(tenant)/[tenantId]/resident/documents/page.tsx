'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Building2,
  Calendar,
  Download,
  FileText,
  Folder,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { useResidentContext } from '../../../../../features/resident/hooks/useResidentContext';
import { useContextOptions } from '../../../../../features/context/useContextOptions';
import { useAuthSession } from '../../../../../features/auth/useAuthSession';
import { useTenants } from '../../../../../features/tenants/tenants.hooks';
import Card from '../../../../../shared/components/ui/Card';
import Badge, { type BadgeVariant } from '../../../../../shared/components/ui/Badge';
import Skeleton from '../../../../../shared/components/ui/Skeleton';
import {
  Document,
  FunctionalType,
  downloadProtectedDocumentContent,
  listDocuments,
} from '../../../../../features/buildings/services/documents.api';
import { formatCurrency } from '../../../../../shared/lib/format/money';

type FunctionalTypeFilter = 'ALL' | 'PAYMENT_RECEIPT' | 'PAYMENT_PROOF' | 'OTHER';

const DOWNLOAD_URL_REVOKE_DELAY_MS = 5_000;

const FUNCTIONAL_TYPE_LABELS: Record<FunctionalType, string> = {
  PAYMENT_RECEIPT: 'Recibo de pago',
  PAYMENT_PROOF: 'Comprobante de pago',
};

const ORIGIN_LABELS: Record<string, string> = {
  PAYMENT_RECEIPT: 'Generado por BuildingOS',
  PAYMENT_PROOF: 'Subido por el residente',
};

const FUNCTIONAL_TYPE_FILTER_OPTIONS: Array<{ value: FunctionalTypeFilter; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'PAYMENT_RECEIPT', label: 'Recibos de pago' },
  { value: 'PAYMENT_PROOF', label: 'Comprobantes' },
  { value: 'OTHER', label: 'Otros documentos' },
];

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  RECONCILED: 'Conciliado',
};

const PAYMENT_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  RECONCILED: 'info',
};

function formatDate(dateValue: string): string {
  const civilDate = parseCivilDate(dateValue);
  if (!civilDate) {
    return 'Fecha desconocida';
  }

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(civilDate);
}

function parseCivilDate(dateValue: string | null | undefined): Date | null {
  if (!dateValue || dateValue.trim() === '') return null;

  const trimmed = dateValue.trim();
  const civilDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (civilDateMatch) {
    const [, year, month, day] = civilDateMatch;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMonthLabel(monthValue: string): string {
  const normalized = monthValue.trim();
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(normalized);
  if (monthMatch) {
    const [, year, month] = monthMatch;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    const label = new Intl.DateTimeFormat('es-AR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  const date = parseCivilDate(normalized);
  if (!date) return normalized;
  const label = new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function useIsMobileViewport(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
      }

      const mediaQueryList = window.matchMedia('(max-width: 767px)');
      const handleChange = () => onStoreChange();

      if (typeof mediaQueryList.addEventListener === 'function') {
        mediaQueryList.addEventListener('change', handleChange);
        return () => mediaQueryList.removeEventListener('change', handleChange);
      }

      mediaQueryList.addListener(handleChange);
      return () => mediaQueryList.removeListener(handleChange);
    },
    () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
      }
      return window.matchMedia('(max-width: 767px)').matches;
    },
    () => false,
  );
}

type MobileDocumentItem =
  | {
      kind: 'bundle';
      key: string;
      paymentId: string;
      title: string;
      payment: NonNullable<Document['payment']>;
      documents: Document[];
      primaryDocument: Document;
      sectionLabel: string;
    }
  | {
      kind: 'document';
      key: string;
      document: Document;
      sectionLabel: string;
    };

interface MobileDocumentSection {
  key: string;
  label: string;
  items: MobileDocumentItem[];
}

function getDocumentSectionKey(document: Document): string {
  if (document.payment?.period && /^\d{4}-\d{2}$/.test(document.payment.period.trim())) {
    return `payment:${document.payment.period.trim()}`;
  }

  const parsedDate = parseCivilDate(document.createdAt);
  if (!parsedDate) {
    return 'unknown';
  }

  return `date:${parsedDate.getUTCFullYear()}-${String(parsedDate.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getDocumentSectionLabel(document: Document): string {
  if (document.payment?.period && /^\d{4}-\d{2}$/.test(document.payment.period.trim())) {
    return formatMonthLabel(document.payment.period.trim());
  }

  return parseCivilDate(document.createdAt) ? formatMonthLabel(document.createdAt) : 'Documentos';
}

function getPaymentBundleTitle(payment: NonNullable<Document['payment']>, fallbackTitle: string): string {
  if (payment.period && /^\d{4}-\d{2}$/.test(payment.period.trim())) {
    return `Pago ${formatMonthLabel(payment.period.trim())}`;
  }

  if (payment.reference && payment.reference.trim() !== '') {
    return payment.reference.trim();
  }

  return fallbackTitle;
}

function buildMobileDocumentSections(documents: Document[]): MobileDocumentSection[] {
  const sectionMap = new Map<string, { label: string; items: MobileDocumentItem[]; bundleIndex: Map<string, number> }>();
  const order: string[] = [];

  for (const document of documents) {
    const sectionKey = getDocumentSectionKey(document);
    const sectionLabel = getDocumentSectionLabel(document);
    let section = sectionMap.get(sectionKey);

    if (!section) {
      section = {
        label: sectionLabel,
        items: [],
        bundleIndex: new Map<string, number>(),
      };
      sectionMap.set(sectionKey, section);
      order.push(sectionKey);
    }

    if (document.functionalType && document.payment?.id) {
      const bundleKey = document.payment.id;
      const existingIndex = section.bundleIndex.get(bundleKey);

      if (typeof existingIndex === 'number') {
        const item = section.items[existingIndex];
        if (item.kind === 'bundle') {
          item.documents.push(document);
          if (document.functionalType === 'PAYMENT_RECEIPT' && item.primaryDocument.functionalType !== 'PAYMENT_RECEIPT') {
            item.primaryDocument = document;
            item.title = getPaymentBundleTitle(document.payment, getSafeFileName(document));
          }
        }
        continue;
      }

      const bundleItem: MobileDocumentItem = {
        kind: 'bundle',
        key: `bundle:${sectionKey}:${bundleKey}`,
        paymentId: bundleKey,
        title: getPaymentBundleTitle(document.payment, getSafeFileName(document)),
        payment: document.payment,
        documents: [document],
        primaryDocument: document,
        sectionLabel,
      };
      section.bundleIndex.set(bundleKey, section.items.length);
      section.items.push(bundleItem);
      continue;
    }

    section.items.push({
      kind: 'document',
      key: `document:${document.id}`,
      document,
      sectionLabel,
    });
  }

  return order.map((key) => {
    const section = sectionMap.get(key);
    if (!section) return { key, label: 'Documentos', items: [] };
    return {
      key,
      label: section.label,
      items: section.items,
    };
  });
}

function getBundleActionLabel(document: Document): string {
  if (document.functionalType === 'PAYMENT_RECEIPT') {
    return 'Ver recibo';
  }
  if (document.functionalType === 'PAYMENT_PROOF') {
    return 'Ver comprobante';
  }
  return 'Ver documento';
}

function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) {
    return 'Tamaño desconocido';
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getSafeFileName(doc: Document): string {
  return doc.file?.originalName?.trim() || 'Archivo sin nombre';
}

function getSafeMimeType(doc: Document): string {
  return doc.file?.mimeType?.trim() || 'Tipo desconocido';
}

function getSafeSize(doc: Document): string {
  return formatFileSize(doc.file?.size);
}

function getFileIcon(mimeType?: string): string {
  if (!mimeType) return '📁';
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('pdf')) return '📄';
  if (normalized.startsWith('image/')) return '🖼️';
  if (normalized.includes('word') || normalized.includes('document')) return '📝';
  if (normalized.includes('sheet') || normalized.includes('excel')) return '📊';
  return '📁';
}

function getDocumentScopeLabel(buildingId: string | null | undefined, unitId: string | null | undefined): string {
  if (unitId) return 'Unidad';
  if (buildingId) return 'Edificio';
  return 'General';
}

function renderErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return fallback;
}

function downloadBlob(blob: Blob, fileName: string): string {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return objectUrl;
}

function getDocumentTypeLabel(doc: Document): string | null {
  if (doc.functionalType) {
    return FUNCTIONAL_TYPE_LABELS[doc.functionalType] ?? null;
  }
  return null;
}

function getOriginLabel(doc: Document): string | null {
  if (doc.functionalType && doc.origin) {
    return ORIGIN_LABELS[doc.functionalType] ?? null;
  }
  return null;
}

function classifyDocument(doc: Document): FunctionalTypeFilter {
  if (doc.functionalType === 'PAYMENT_RECEIPT') return 'PAYMENT_RECEIPT';
  if (doc.functionalType === 'PAYMENT_PROOF') return 'PAYMENT_PROOF';
  return 'OTHER';
}

function matchesSearch(doc: Document, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  const amountText = doc.payment?.amount != null
    ? formatCurrency(doc.payment.amount, doc.payment.currency).toLowerCase()
    : null;
  const searchable = [
    doc.title,
    getSafeFileName(doc),
    doc.payment?.reference,
    doc.payment?.receiptNumber,
    doc.payment?.period,
    doc.payment?.status ? PAYMENT_STATUS_LABELS[doc.payment.status] : null,
    amountText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return searchable.includes(q);
}

export default function ResidentDocumentsPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const session = useAuthSession();
  const userId = session?.user.id ?? null;

  const [openError, setOpenError] = useState<string | null>(null);
  const [openErrorDocumentTitle, setOpenErrorDocumentTitle] = useState<string | null>(null);
  const activeObjectUrlsRef = useRef<string[]>([]);
  const activeTimersRef = useRef<number[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const previewBlobUrlRef = useRef<string | null>(null);
  const previewUrlListenerRef = useRef<(() => void) | null>(null);
  const previewRequestRef = useRef(0);

  const [typeFilter, setTypeFilter] = useState<FunctionalTypeFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [previewContent, setPreviewContent] = useState<{ blob: Blob; contentType: string; fileName: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((tenant) => tenant.id === tenantId)?.name ?? 'Administración actual';

  const { data: context, isLoading: contextLoading } = useResidentContext(tenantId ?? null);
  const buildingId = context?.activeBuildingId;
  const unitId = context?.activeUnitId;

  const { data: contextOptions } = useContextOptions(tenantId ?? null);
  const unitsForBuilding = buildingId ? contextOptions?.unitsByBuilding?.[buildingId] ?? [] : [];
  const buildingName = contextOptions?.buildings.find((building) => building.id === buildingId)?.name ?? null;
  const unitName = buildingId && unitId
    ? unitsForBuilding.find((unit) => unit.id === unitId)?.label ??
      unitsForBuilding.find((unit) => unit.id === unitId)?.code ??
      null
    : null;
  const isMobileViewport = useIsMobileViewport();
  const mobileContextPrimaryLabel = [buildingName, unitName].filter(Boolean).join(' · ') || tenantName;
  const mobileContextSecondaryLabel = mobileContextPrimaryLabel !== tenantName ? tenantName : null;

  useEffect(() => {
    return () => {
      activeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      activeTimersRef.current = [];
      activeObjectUrlsRef.current.forEach((objectUrl) => window.URL.revokeObjectURL(objectUrl));
      activeObjectUrlsRef.current = [];
    };
  }, []);

  const {
    data: documents = [],
    isLoading: docsLoading,
    isError: docsError,
    error: docsErrorValue,
    refetch,
  } = useQuery<Document[]>({
    queryKey: ['residentDocuments', tenantId, userId, buildingId, unitId],
    queryFn: () => listDocuments(tenantId!, { buildingId: buildingId ?? undefined, unitId: unitId ?? undefined }),
    enabled: !!tenantId && !!userId && !!buildingId && !!unitId,
    staleTime: 5 * 60 * 1000,
  });

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (typeFilter !== 'ALL' && classifyDocument(doc) !== typeFilter) return false;
      if (!matchesSearch(doc, searchQuery)) return false;
      return true;
    });
  }, [documents, typeFilter, searchQuery]);

  const documentCounts = useMemo(() => {
    const counts: Record<FunctionalTypeFilter, number> = {
      ALL: documents.length,
      PAYMENT_RECEIPT: 0,
      PAYMENT_PROOF: 0,
      OTHER: 0,
    };
    for (const doc of documents) {
      counts[classifyDocument(doc)]++;
    }
    return counts;
  }, [documents]);

  const mobileSections = useMemo(() => buildMobileDocumentSections(filteredDocuments), [filteredDocuments]);

  const listErrorMessage = useMemo(() => {
    if (!docsError) return null;
    return renderErrorMessage(docsErrorValue, 'No pudimos cargar los documentos. Intentá nuevamente.');
  }, [docsError, docsErrorValue]);

  const registerObjectUrl = (objectUrl: string, revokeDelayMs: number): void => {
    activeObjectUrlsRef.current.push(objectUrl);
    const timerId = window.setTimeout(() => {
      window.URL.revokeObjectURL(objectUrl);
      activeObjectUrlsRef.current = activeObjectUrlsRef.current.filter((url) => url !== objectUrl);
      activeTimersRef.current = activeTimersRef.current.filter((id) => id !== timerId);
    }, revokeDelayMs);
    activeTimersRef.current.push(timerId);
  };

  const handleViewDocument = async (document: Document) => {
    if (!tenantId) return;

    const requestId = ++previewRequestRef.current;

    setPreviewDocument(document);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(true);

    try {
      const protectedContent = await downloadProtectedDocumentContent(
        tenantId,
        document.id,
        getSafeFileName(document),
      );

      if (requestId !== previewRequestRef.current) return;

      if (!protectedContent.blob || protectedContent.blob.size <= 0) {
        setPreviewError('El archivo está vacío o no se pudo descargar.');
        return;
      }

      setPreviewContent({
        blob: protectedContent.blob,
        contentType: protectedContent.contentType || getSafeMimeType(document),
        fileName: protectedContent.fileName || getSafeFileName(document),
      });
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      setPreviewError(
        error instanceof Error
          ? error.message
          : 'No se pudo cargar el documento. Intentá nuevamente.',
      );
    } finally {
      if (requestId !== previewRequestRef.current) return;
      setPreviewLoading(false);
    }
  };

  const previewObjectUrl = useSyncExternalStore(
    (callback) => {
      previewUrlListenerRef.current = callback;
      return () => {
        previewUrlListenerRef.current = null;
      };
    },
    () => previewBlobUrlRef.current,
    () => null,
  );

  useEffect(() => {
    if (previewBlobUrlRef.current) {
      window.URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }

    if (!previewContent?.blob || previewContent.blob.size <= 0) {
      previewUrlListenerRef.current?.();
      return;
    }

    const url = window.URL.createObjectURL(previewContent.blob);
    previewBlobUrlRef.current = url;
    previewUrlListenerRef.current?.();

    return () => {
      if (previewBlobUrlRef.current) {
        window.URL.revokeObjectURL(previewBlobUrlRef.current);
        previewBlobUrlRef.current = null;
      }
    };
  }, [previewContent]);

  const handleClosePreview = useCallback(() => {
    previewRequestRef.current++;
    setPreviewDocument(null);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }, []);

  useEffect(() => {
    if (!previewDocument && triggerButtonRef.current) {
      const btn = triggerButtonRef.current;
      requestAnimationFrame(() => {
        btn.focus();
        triggerButtonRef.current = null;
      });
    }
  }, [previewDocument]);

  useEffect(() => {
    if (!previewDocument) return undefined;

    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const timerId = window.setTimeout(() => {
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClosePreview();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timerId);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewDocument, handleClosePreview]);

  const handleDownloadFromPreview = () => {
    if (!previewDocument || !previewContent) return;
    const objectUrl = downloadBlob(
      previewContent.blob.type
        ? previewContent.blob
        : new Blob([previewContent.blob], { type: previewContent.contentType }),
      previewContent.fileName,
    );
    registerObjectUrl(objectUrl, DOWNLOAD_URL_REVOKE_DELAY_MS);
  };

  const renderMobileDocumentCard = (document: Document) => {
    const fileName = getSafeFileName(document);
    const typeLabel = getDocumentTypeLabel(document);
    const mimeType = getSafeMimeType(document);
    const scopeLabel = getDocumentScopeLabel(document.buildingId ?? null, document.unitId ?? null);
    const dateLabel = formatDate(document.createdAt);
    const sizeLabel = getSafeSize(document);

    return (
      <Card key={document.id} className="overflow-hidden border-border/70 bg-background">
        <button
          type="button"
          onClick={(e) => {
            triggerButtonRef.current = e.currentTarget as HTMLButtonElement;
            void handleViewDocument(document);
          }}
          aria-label={`Ver documento ${document.title}`}
          className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <span className="text-xl" aria-hidden="true">
            {getFileIcon(mimeType)}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-[15px] font-medium text-foreground" title={document.title}>
              {document.title}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={fileName}>
              {typeLabel || document.category}
              {' · '}
              {scopeLabel}
            </p>
            <p className="text-xs text-muted-foreground">
              {dateLabel}
              {' · '}
              {sizeLabel}
            </p>
          </div>
          <span className="shrink-0 pt-0.5 text-sm font-medium text-blue-700 dark:text-blue-300">
            Ver documento
          </span>
        </button>
      </Card>
    );
  };

  const renderMobileBundleCard = (_sectionLabel: string, bundle: MobileDocumentItem & { kind: 'bundle' }) => {
    const payment = bundle.payment;
    const actionDocs = Array.from(
      new Map(
        bundle.documents.map((document) => [getBundleActionLabel(document), document] as const),
      ).entries(),
    );
    const paymentStatusLabel = payment.status ? PAYMENT_STATUS_LABELS[payment.status] ?? payment.status : null;
    const amountLabel = formatCurrency(payment.amount, payment.currency);
    const referenceLabel = payment.reference?.trim() || null;

    return (
      <Card key={bundle.key} className="overflow-hidden border-border/70 bg-background">
        <div className="space-y-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-lg font-semibold tabular-nums text-foreground">{amountLabel}</p>
              <p className="truncate text-sm font-medium text-foreground" title={bundle.title}>
                {bundle.title}
              </p>
            </div>
            {paymentStatusLabel && (
              <Badge variant={PAYMENT_STATUS_VARIANTS[payment.status] ?? 'muted'}>
                {paymentStatusLabel}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {referenceLabel && <span>Ref {referenceLabel}</span>}
            <span>{bundle.documents.length} {bundle.documents.length === 1 ? 'documento' : 'documentos'}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {actionDocs.map(([actionLabel, document]) => (
              <button
                key={document.id}
                type="button"
                onClick={(e) => {
                  triggerButtonRef.current = e.currentTarget as HTMLButtonElement;
                  void handleViewDocument(document);
                }}
                aria-label={`${actionLabel} ${document.title}`}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-3 text-sm font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200"
              >
                {actionLabel}
              </button>
            ))}
          </div>
        </div>
      </Card>
    );
  };

  const previewDialog = previewDocument && (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Vista de ${previewDocument.title}`}
    >
      <div
        ref={dialogRef}
        className="relative flex max-h-[min(92dvh,92svh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900 sm:max-h-[90vh]"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-medium" data-testid="modal-title">
              {previewDocument.title}
            </h2>
            <p className="truncate text-sm text-muted-foreground">
              {getSafeFileName(previewDocument)}
              {previewDocument.payment?.period && ` — Período ${previewDocument.payment.period}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadFromPreview()}
              disabled={!previewContent}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              Descargar
            </button>
            <button
              type="button"
              onClick={handleClosePreview}
              className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {previewLoading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="mb-4 h-8 w-8 animate-spin text-blue-600" />
              <p className="text-sm text-muted-foreground">Cargando documento...</p>
            </div>
          )}

          {previewError && (
            <div className="flex flex-col items-center justify-center py-16">
              <AlertCircle className="mb-4 h-8 w-8 text-red-500" />
              <p className="text-sm text-red-600">{previewError}</p>
              <button
                type="button"
                onClick={handleClosePreview}
                className="mt-4 text-sm font-medium text-blue-600 hover:underline"
              >
                Cerrar
              </button>
            </div>
          )}

          {previewObjectUrl && previewDocument && (
            <>
              {previewDocument.file?.mimeType?.toLowerCase().startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewObjectUrl}
                  alt={previewDocument.title}
                  className="mx-auto max-h-[70vh] object-contain"
                />
              ) : previewDocument.file?.mimeType?.toLowerCase() === 'application/pdf' ? (
                <iframe
                  src={previewObjectUrl}
                  title={previewDocument.title}
                  className="h-[70vh] w-full border-0"
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No se puede previsualizar este tipo de archivo.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleDownloadFromPreview()}
                    className="mt-4 text-sm font-medium text-blue-600 hover:underline"
                  >
                    Descargar archivo
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (isMobileViewport) {
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FileText className="h-6 w-6" />
            Documentos
          </h1>
          <p className="text-sm text-muted-foreground">
            Consulta comprobantes, recibos y archivos de tu unidad.
          </p>
        </div>

        <Card className="border-border/70 bg-muted/30 p-3 dark:bg-muted/20">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-foreground">Contexto activo</p>
            <p className="truncate text-sm font-medium text-foreground" title={mobileContextPrimaryLabel}>
              {mobileContextPrimaryLabel}
            </p>
            {mobileContextSecondaryLabel && (
              <p className="truncate text-xs text-muted-foreground" title={mobileContextSecondaryLabel}>
                {mobileContextSecondaryLabel}
              </p>
            )}
          </div>
        </Card>

        {listErrorMessage && (
          <Card className="border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/40">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" size={18} />
              <div className="space-y-1">
                <p className="font-medium text-red-800 dark:text-red-200">No pudimos cargar los documentos</p>
                <p className="text-sm text-red-700 dark:text-red-300">{listErrorMessage}</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="text-sm font-medium text-red-700 hover:underline dark:text-red-300"
                >
                  Reintentar
                </button>
              </div>
            </div>
          </Card>
        )}

        {openError && (
          <Card className="border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/40">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" size={18} />
              <div className="space-y-1">
                <p className="font-medium text-red-800 dark:text-red-200">
                  {openErrorDocumentTitle
                    ? `No pudimos abrir "${openErrorDocumentTitle}"`
                    : 'No pudimos abrir el documento'}
                </p>
                <p className="text-sm text-red-700 dark:text-red-300">{openError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setOpenError(null);
                    setOpenErrorDocumentTitle(null);
                  }}
                  className="text-sm font-medium text-red-700 hover:underline dark:text-red-300"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </Card>
        )}

        {!docsLoading && documents.length > 0 && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                aria-label="Buscar documentos"
                placeholder="Buscar por título, referencia, recibo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 w-full rounded-xl border bg-white py-2 pl-9 pr-10 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:text-foreground"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div
              className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Filtrar documentos"
            >
              {FUNCTIONAL_TYPE_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTypeFilter(option.value)}
                  aria-pressed={typeFilter === option.value}
                  className={`inline-flex min-h-11 flex-none items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                    typeFilter === option.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span>{option.label}</span>
                  <span className="text-xs opacity-75">({documentCounts[option.value]})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {docsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <Card className="p-6 text-center">
            <Folder className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No hay documentos disponibles para tu unidad.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cuando la administración comparta documentos con tu unidad o edificio, los vas a ver acá.
            </p>
          </Card>
        ) : filteredDocuments.length === 0 ? (
          <Card className="p-6 text-center">
            <Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No se encontraron documentos con los filtros aplicados.</p>
            <button
              type="button"
              onClick={() => {
                setTypeFilter('ALL');
                setSearchQuery('');
              }}
              className="mt-2 text-sm font-medium text-blue-600 hover:underline"
            >
              Limpiar filtros
            </button>
          </Card>
        ) : (
          <div className="space-y-4">
            {mobileSections.map((section) => (
              <section key={section.key} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</h2>
                <div className="space-y-2">
                  {section.items.map((item) => (
                    item.kind === 'bundle'
                      ? renderMobileBundleCard(section.label, item)
                      : renderMobileDocumentCard(item.document)
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {previewDialog}
      </div>
    );
  }

  if (contextLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4">
          {[1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (!buildingId || !unitId) {
    return (
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <FileText className="h-6 w-6" />
          Documentos
        </h1>
        <p className="mt-1 text-muted-foreground">{tenantName}</p>

        <Card className="mt-6 border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-900/60 dark:bg-yellow-950/40">
          <div className="flex items-center gap-2">
            <AlertCircle className="text-yellow-600 dark:text-yellow-400" size={20} />
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-200">Sin unidad asignada</p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">Comunicate con la administración para que te asignen una unidad.</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <FileText className="h-6 w-6" />
          Documentos
        </h1>
        <p className="mt-1 text-muted-foreground">
          {tenantName}
          {buildingName && ` • ${buildingName}`}
        </p>
      </div>

      {listErrorMessage && (
        <Card className="border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/40">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 text-red-600 dark:text-red-400" size={20} />
            <div className="space-y-1">
              <p className="font-medium text-red-800 dark:text-red-200">No pudimos cargar los documentos</p>
              <p className="text-sm text-red-700 dark:text-red-300">{listErrorMessage}</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="text-sm font-medium text-red-700 hover:underline dark:text-red-300"
              >
                Reintentar
              </button>
            </div>
          </div>
        </Card>
      )}

      {openError && (
        <Card className="border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/40">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 text-red-600 dark:text-red-400" size={20} />
            <div className="space-y-1">
              <p className="font-medium text-red-800 dark:text-red-200">
                {openErrorDocumentTitle
                  ? `No pudimos abrir "${openErrorDocumentTitle}"`
                  : 'No pudimos abrir el documento'}
              </p>
              <p className="text-sm text-red-700 dark:text-red-300">{openError}</p>
              <button
                type="button"
                onClick={() => {
                  setOpenError(null);
                  setOpenErrorDocumentTitle(null);
                }}
                className="text-sm font-medium text-red-700 hover:underline dark:text-red-300"
              >
                Cerrar
              </button>
            </div>
          </div>
        </Card>
      )}

      {!docsLoading && documents.length > 0 && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por título, referencia, recibo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border bg-white py-2 pl-9 pr-4 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {FUNCTIONAL_TYPE_FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTypeFilter(option.value)}
                className={`rounded-full px-3 py-1 text-sm transition ${
                  typeFilter === option.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {option.label}
                <span className="ml-1 text-xs opacity-75">
                  ({documentCounts[option.value]})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {docsLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <Card className="p-8 text-center">
          <Folder className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No hay documentos disponibles para tu unidad.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuando la administración comparta documentos con tu unidad o edificio, los vas a ver acá.
          </p>
        </Card>
      ) : filteredDocuments.length === 0 ? (
        <Card className="p-8 text-center">
          <Search className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No se encontraron documentos con los filtros aplicados.</p>
          <button
            type="button"
            onClick={() => {
              setTypeFilter('ALL');
              setSearchQuery('');
            }}
            className="mt-2 text-sm font-medium text-blue-600 hover:underline"
          >
            Limpiar filtros
          </button>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredDocuments.map((document) => {
            const fileName = getSafeFileName(document);
            const mimeType = getSafeMimeType(document);
            const sizeLabel = getSafeSize(document);
            const typeLabel = getDocumentTypeLabel(document);
            const originLabel = getOriginLabel(document);
            const isPaymentDocument = !!document.functionalType;

            return (
              <Card key={document.id} className="p-4 transition hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="text-2xl shrink-0">{getFileIcon(mimeType)}</div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <h3
                          className="truncate font-medium"
                          title={document.title}
                        >
                          {document.title}
                        </h3>
                        {document.functionalType && (
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              document.functionalType === 'PAYMENT_RECEIPT'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-orange-100 text-orange-800'
                            }`}
                          >
                            {typeLabel}
                          </span>
                        )}
                        {originLabel && (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {originLabel}
                          </span>
                        )}
                      </div>
                      <p
                        className="truncate text-sm text-muted-foreground"
                        title={fileName}
                      >
                        {fileName}
                      </p>

                      {isPaymentDocument && document.payment && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium text-foreground">
                            {formatCurrency(document.payment.amount, document.payment.currency)}
                          </span>
                          {document.payment.status && (
                            <Badge variant={PAYMENT_STATUS_VARIANTS[document.payment.status] ?? 'muted'}>
                              {PAYMENT_STATUS_LABELS[document.payment.status] ?? document.payment.status}
                            </Badge>
                          )}
                          {document.payment.period && (
                            <span className="text-muted-foreground">
                              Período: {document.payment.period}
                            </span>
                          )}
                          {document.payment.reference && (
                            <span className="text-muted-foreground">
                              Ref: {document.payment.reference}
                            </span>
                          )}
                          {document.payment.receiptNumber && (
                            <span className="text-muted-foreground">
                              Nº {document.payment.receiptNumber}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {typeLabel && (
                          <span className="flex items-center gap-1">
                            <Folder className="h-3 w-3" />
                            {typeLabel}
                          </span>
                        )}
                        {!typeLabel && (
                          <span className="flex items-center gap-1">
                            <Folder className="h-3 w-3" />
                            {document.category}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {getDocumentScopeLabel(document.buildingId ?? null, document.unitId ?? null)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(document.createdAt)}
                        </span>
                        <span>{mimeType}</span>
                        <span>{sizeLabel}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        triggerButtonRef.current = e.currentTarget as HTMLButtonElement;
                        void handleViewDocument(document);
                      }}
                      aria-label={`Ver documento ${document.title}`}
                      className="inline-flex items-center gap-1 rounded bg-blue-50 px-3 py-1.5 text-sm text-blue-700 transition hover:bg-blue-100"
                    >
                      <FileText className="h-4 w-4" />
                      Ver documento
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {previewDialog}
    </div>
  );
}
