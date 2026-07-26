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
import { useTenants } from '../../../../../features/tenants/tenants.hooks';
import Card from '../../../../../shared/components/ui/Card';
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

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  SUBMITTED: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  RECONCILED: 'bg-blue-100 text-blue-800',
};

function formatDate(dateValue: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateValue));
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
  const tenantName = tenants?.find((tenant) => tenant.id === tenantId)?.name ?? tenantId;

  const { data: context, isLoading: contextLoading } = useResidentContext(tenantId ?? null);
  const buildingId = context?.activeBuildingId;
  const unitId = context?.activeUnitId;

  const { data: contextOptions } = useContextOptions(tenantId ?? null);
  const buildingName = contextOptions?.buildings.find((building) => building.id === buildingId)?.name ?? null;

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
    queryKey: ['residentDocuments', tenantId, buildingId, unitId],
    queryFn: () => listDocuments(tenantId!, { buildingId: buildingId ?? undefined, unitId: unitId ?? undefined }),
    enabled: !!tenantId && !!buildingId && !!unitId,
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

        <Card className="mt-6 border-yellow-300 bg-yellow-50 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="text-yellow-600" size={20} />
            <div>
              <p className="font-medium text-yellow-800">Sin unidad asignada</p>
              <p className="text-sm text-yellow-700">Comunicate con la administración para que te asignen una unidad.</p>
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
        <Card className="border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 text-red-600" size={20} />
            <div className="space-y-1">
              <p className="font-medium text-red-800">No pudimos cargar los documentos</p>
              <p className="text-sm text-red-700">{listErrorMessage}</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="text-sm font-medium text-red-700 hover:underline"
              >
                Reintentar
              </button>
            </div>
          </div>
        </Card>
      )}

      {openError && (
        <Card className="border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 text-red-600" size={20} />
            <div className="space-y-1">
              <p className="font-medium text-red-800">
                {openErrorDocumentTitle
                  ? `No pudimos abrir "${openErrorDocumentTitle}"`
                  : 'No pudimos abrir el documento'}
              </p>
              <p className="text-sm text-red-700">{openError}</p>
              <button
                type="button"
                onClick={() => {
                  setOpenError(null);
                  setOpenErrorDocumentTitle(null);
                }}
                className="text-sm font-medium text-red-700 hover:underline"
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
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                PAYMENT_STATUS_STYLES[document.payment.status] ?? 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {PAYMENT_STATUS_LABELS[document.payment.status] ?? document.payment.status}
                            </span>
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

      {previewDocument && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label={`Vista de ${previewDocument.title}`}
        >
          <div ref={dialogRef} className="relative mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
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
      )}
    </div>
  );
}
