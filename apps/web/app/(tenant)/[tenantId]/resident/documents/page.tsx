'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Building2, Calendar, Download, FileText, Folder, Loader2 } from 'lucide-react';
import { useResidentContext } from '../../../../../features/resident/hooks/useResidentContext';
import { useContextOptions } from '../../../../../features/context/useContextOptions';
import { useTenants } from '../../../../../features/tenants/tenants.hooks';
import Card from '../../../../../shared/components/ui/Card';
import Skeleton from '../../../../../shared/components/ui/Skeleton';
import {
  Document,
  downloadProtectedDocumentContent,
  listDocuments,
} from '../../../../../features/buildings/services/documents.api';

const CATEGORY_LABELS: Record<string, string> = {
  MINUTES: 'Actas',
  CONTRACT: 'Contrato',
  BUDGET: 'Presupuesto',
  INVOICE: 'Factura',
  RECEIPT: 'Recibo',
  OTHER: 'Otro',
};

const PREVIEWABLE_MIME_PREFIXES = ['application/pdf', 'image/'];
const PREVIEW_URL_REVOKE_DELAY_MS = 60_000;
const DOWNLOAD_URL_REVOKE_DELAY_MS = 5_000;

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

function isPreviewableMimeType(mimeType?: string): boolean {
  if (!mimeType) return false;
  const normalizedMimeType = mimeType.toLowerCase();
  return PREVIEWABLE_MIME_PREFIXES.some((prefix) => normalizedMimeType.startsWith(prefix));
}

function getSafeFileName(document: Document): string {
  return document.file?.originalName?.trim() || 'Archivo sin nombre';
}

function getSafeMimeType(document: Document): string {
  return document.file?.mimeType?.trim() || 'Tipo desconocido';
}

function getSafeSize(document: Document): string {
  return formatFileSize(document.file?.size);
}

function getFileIcon(mimeType?: string): string {
  if (!mimeType) return '📁';
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.includes('pdf')) return '📄';
  if (normalizedMimeType.startsWith('image/')) return '🖼️';
  if (normalizedMimeType.includes('word') || normalizedMimeType.includes('document')) return '📝';
  if (normalizedMimeType.includes('sheet') || normalizedMimeType.includes('excel')) return '📊';
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

export default function ResidentDocumentsPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;

  const [openError, setOpenError] = useState<string | null>(null);
  const [openErrorDocumentTitle, setOpenErrorDocumentTitle] = useState<string | null>(null);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const openingDocumentIdRef = useRef<string | null>(null);
  const activeObjectUrlsRef = useRef<string[]>([]);
  const activeTimersRef = useRef<number[]>([]);

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

  const handleOpenDocument = async (document: Document) => {
    if (openingDocumentIdRef.current) return;
    if (!tenantId) return;

    openingDocumentIdRef.current = document.id;
    setOpeningDocumentId(document.id);
    setOpenError(null);
    setOpenErrorDocumentTitle(null);

    const previewable = isPreviewableMimeType(document.file?.mimeType);
    const popupWindow = previewable ? window.open('', '_blank', 'noopener,noreferrer') : null;

    try {
      const protectedContent = await downloadProtectedDocumentContent(
        tenantId,
        document.id,
        getSafeFileName(document),
      );

      const blob = protectedContent.blob;
      const resolvedFileName = protectedContent.fileName || getSafeFileName(document);
      const contentType = protectedContent.contentType || getSafeMimeType(document);

      if (previewable && popupWindow) {
        const objectUrl = window.URL.createObjectURL(blob);
        registerObjectUrl(objectUrl, PREVIEW_URL_REVOKE_DELAY_MS);
        popupWindow.location.href = objectUrl;
        return;
      }

      const objectUrl = downloadBlob(
        blob.type ? blob : new Blob([blob], { type: contentType }),
        resolvedFileName,
      );
      registerObjectUrl(objectUrl, DOWNLOAD_URL_REVOKE_DELAY_MS);
      popupWindow?.close();
    } catch (error) {
      popupWindow?.close();

      if (error instanceof Error) {
        setOpenError(error.message);
      } else {
        setOpenError('No pudimos abrir el documento. Intentá nuevamente.');
      }

      setOpenErrorDocumentTitle(document.title || getSafeFileName(document));
    } finally {
      openingDocumentIdRef.current = null;
      setOpeningDocumentId(null);
    }
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
                  ? `No pudimos abrir “${openErrorDocumentTitle}”`
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
      ) : (
        <div className="space-y-3">
          {documents.map((document) => {
            const fileName = getSafeFileName(document);
            const mimeType = getSafeMimeType(document);
            const sizeLabel = getSafeSize(document);
            const isOpening = openingDocumentId === document.id;
            const actionLabel = isPreviewableMimeType(mimeType) ? 'Abrir' : 'Descargar';

            return (
              <Card key={document.id} className="p-4 transition hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="text-2xl">{getFileIcon(mimeType)}</div>
                    <div className="min-w-0 space-y-1">
                      <h3 className="truncate font-medium">{document.title}</h3>
                      <p className="truncate text-sm text-muted-foreground">{fileName}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Folder className="h-3 w-3" />
                          {CATEGORY_LABELS[document.category] ?? document.category}
                        </span>
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {getDocumentScopeLabel(document.buildingId ?? null, document.unitId ?? null)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(document.createdAt)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{mimeType}</span>
                        <span>{sizeLabel}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleOpenDocument(document)}
                    disabled={isOpening}
                    aria-label={`${actionLabel} ${document.title}`}
                    className="inline-flex items-center gap-1 rounded bg-blue-50 px-3 py-1.5 text-sm text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {actionLabel}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
