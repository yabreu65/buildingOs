'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  BadgeInfo,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Select, useToast } from '@/shared/components/ui';
import { Table, TBody, TD, TH, THead, TR } from '@/shared/components/ui/Table';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import {
  confirmOnboardingImport,
  downloadOnboardingImportTemplate,
  getOnboardingImport,
  listOnboardingImportIssues,
  previewOnboardingImport,
  type ConfirmOnboardingImportResult,
  type ImportIssueFilters,
  type ImportIssueSeverity,
  type ImportPreviewSummary,
  type OnboardingImportJob,
  type OnboardingImportIssuePage,
  ONBOARDING_IMPORT_ALLOWED_MIME_TYPES,
} from './onboarding-import.api';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 25;
const SHEET_OPTIONS = [
  'Instrucciones',
  'Diccionario_de_Datos',
  'Catalogos',
  'Ejemplos',
  'Edificios',
  'Unidades',
  'Personas',
  'Relaciones_Unidad',
  'Saldos_Iniciales',
];

type WizardPhase = 'template' | 'upload' | 'processing' | 'preview' | 'issues' | 'confirming' | 'result' | 'expired' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadgeClass(status: OnboardingImportJob['status']): string {
  switch (status) {
    case 'READY':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'BLOCKED':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'FAILED':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'CONFIRMING':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'CONFIRMED':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'EXPIRED':
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function statusLabel(status: OnboardingImportJob['status']): string {
  switch (status) {
    case 'READY':
      return 'Lista para confirmar';
    case 'BLOCKED':
      return 'Tiene bloqueos';
    case 'FAILED':
      return 'Fallida';
    case 'CONFIRMING':
      return 'Confirmando';
    case 'CONFIRMED':
      return 'Confirmada';
    case 'EXPIRED':
    default:
      return 'Expirada';
  }
}

function summarizeSheetStats(summary: ImportPreviewSummary['buildings']): string {
  return `nuevos ${summary.new} · reutilizables ${summary.reusable} · conflictos ${summary.conflict} · inválidos ${summary.invalid}`;
}

function formatIssueCount(count: number): string {
  return count === 1 ? '1 entrada' : `${count} entradas`;
}

function validateSpreadsheetFile(file: File): string | null {
  const fileName = file.name.toLowerCase();
  const mimeTypeAllowed = file.type === '' || ONBOARDING_IMPORT_ALLOWED_MIME_TYPES.includes(file.type);

  if (!fileName.endsWith('.xlsx')) {
    return 'Solo se permiten archivos .xlsx.';
  }

  if (!mimeTypeAllowed) {
    return `Tipo de archivo no compatible: ${file.type || 'desconocido'}`;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'El libro supera el límite de 10 MB.';
  }

  return null;
}

function createDownload(fileName: string, blob: Blob): void {
  if (typeof window.URL.createObjectURL !== 'function') {
    return;
  }

  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function getImportStep(job: OnboardingImportJob | null, isUploading: boolean, isConfirming: boolean): WizardPhase {
  if (isConfirming) {
    return 'confirming';
  }

  if (job?.status === 'CONFIRMED') {
    return 'result';
  }

  if (job?.status === 'EXPIRED') {
    return 'expired';
  }

  if (job?.status === 'FAILED') {
    return 'error';
  }

  if (job?.status === 'READY' || job?.status === 'BLOCKED') {
    return 'preview';
  }

  if (isUploading) {
    return 'processing';
  }

  return 'upload';
}

export function OnboardingImportWizard() {
  const tenantId = useTenantId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [job, setJob] = useState<OnboardingImportJob | null>(null);
  const [issues, setIssues] = useState<OnboardingImportIssuePage | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isTemplateDownloading, setIsTemplateDownloading] = useState(false);
  const [isLoadingImport, setIsLoadingImport] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [issueFilters, setIssueFilters] = useState<ImportIssueFilters>({
    severity: '',
    sheet: '',
    code: '',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const importIdFromUrl = searchParams.get('importId');
  const activeImportId = job?.importId ?? null;
  const phase = getImportStep(job, isUploading, isConfirming);

  const syncImportId = useCallback(
    (nextImportId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextImportId) {
        params.set('importId', nextImportId);
      } else {
        params.delete('importId');
      }

      const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const resetWizard = useCallback(() => {
    setJob(null);
    setIssues(null);
    setSelectedFile(null);
    setActionError(null);
    setIssueFilters({
      severity: '',
      sheet: '',
      code: '',
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    syncImportId(null);
  }, [syncImportId]);

  const loadImport = useCallback(
    async (importId: string) => {
      if (!tenantId) {
        return;
      }

      setIsLoadingImport(true);
      setActionError(null);

      try {
        const nextJob = await getOnboardingImport(tenantId, importId);
        setJob(nextJob);
        syncImportId(nextJob.importId);
        setIssues(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo cargar el estado de la importación';
        setActionError(message);
        setJob(null);
        setIssues(null);
      } finally {
        setIsLoadingImport(false);
      }
    },
    [syncImportId, tenantId],
  );

  const loadIssues = useCallback(
    async (jobId: string, filters: ImportIssueFilters) => {
      if (!tenantId) {
        return;
      }

      setIsLoadingIssues(true);

      try {
        const page = await listOnboardingImportIssues(tenantId, jobId, filters);
        setIssues(page);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudieron cargar las incidencias de la importación';
        setActionError(message);
        setIssues(null);
      } finally {
        setIsLoadingIssues(false);
      }
    },
    [tenantId],
  );

  useEffect(() => {
    if (!tenantId) {
      return;
    }

    if (!importIdFromUrl) {
      setJob(null);
      setIssues(null);
      setActionError(null);
      return;
    }

    void loadImport(importIdFromUrl);
  }, [importIdFromUrl, loadImport, tenantId]);

  useEffect(() => {
    if (!tenantId || !activeImportId) {
      return;
    }

    void loadIssues(activeImportId, issueFilters);
  }, [activeImportId, issueFilters, loadIssues, tenantId]);

  const handleTemplateDownload = async () => {
    if (!tenantId) {
      return;
    }

    setIsTemplateDownloading(true);
    setActionError(null);

    try {
      const { blob, fileName } = await downloadOnboardingImportTemplate(tenantId);
      createDownload(fileName, blob);
      toast('La plantilla se descargó correctamente.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo descargar la plantilla';
      setActionError(message);
      toast(message, 'error');
    } finally {
      setIsTemplateDownloading(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      return;
    }

    const validationError = validateSpreadsheetFile(file);
    if (validationError) {
      setActionError(validationError);
      setSelectedFile(null);
      toast(validationError, 'error');
      event.target.value = '';
      return;
    }

    setSelectedFile(file);
    setActionError(null);
  };

  const handlePreview = async () => {
    if (!tenantId) {
      return;
    }

    if (!selectedFile) {
      setActionError('Elija un archivo .xlsx antes de previsualizar la importación.');
      return;
    }

    setIsUploading(true);
    setActionError(null);

    try {
      const nextJob = await previewOnboardingImport(tenantId, selectedFile);
      setJob(nextJob);
      syncImportId(nextJob.importId);
      setIssues(null);
      setIssueFilters((current) => ({
        ...current,
        page: 1,
      }));
      toast('Vista previa lista.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo previsualizar la importación';
      setActionError(message);
      toast(message, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!tenantId || !job) {
      return;
    }

    setIsConfirming(true);
    setActionError(null);

    try {
      const result: ConfirmOnboardingImportResult = await confirmOnboardingImport(tenantId, job.importId, {
        expectedPreviewVersion: job.previewVersion,
      });

      toast(`Importación ${result.status.toLowerCase()} correctamente.`, 'success');
      await loadImport(result.importId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo confirmar la importación';
      setActionError(message);
      toast(message, 'error');
    } finally {
      setIsConfirming(false);
    }
  };

  const canShowIssues = Boolean(job && job.status !== 'FAILED' && job.status !== 'EXPIRED');
  const totalIssues = issues?.total ?? job?.issueCount ?? 0;
  const totalBlocking = job?.blockingIssueCount ?? 0;
  const totalWarnings = job?.warningCount ?? 0;

  const issueSummary = useMemo(() => {
    if (!job) {
      return null;
    }

    return [
      { label: 'Edificios', stats: job.summary.buildings },
      { label: 'Unidades', stats: job.summary.units },
      { label: 'Personas', stats: job.summary.people },
      { label: 'Relaciones', stats: job.summary.relations },
      { label: 'Saldos iniciales', stats: job.summary.openingBalances },
    ];
  }, [job]);

  if (!tenantId) {
    return (
      <EmptyState
        icon={<AlertCircle className="text-muted-foreground" size={32} />}
        title="No hay contexto de tenant"
        description="Este asistente debe abrirse desde una ruta con tenant."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Asistente de importación inicial</h1>
        <p className="text-sm text-muted-foreground">
          Descargue la plantilla, cargue el libro completado, revise la vista previa y confirme la importación cuando esté lista.
        </p>
      </div>

      {actionError && (
        <Card className="border-red-200 bg-red-50 text-red-900">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 flex-shrink-0 text-red-600" size={20} />
            <div className="space-y-1">
              <p className="text-sm font-semibold">La acción falló</p>
              <p className="text-sm">{actionError}</p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">1. Descargar la plantilla</h2>
              <p className="text-sm text-muted-foreground">
                Use el libro oficial para que el backend pueda validar las hojas y los encabezados esperados.
              </p>
            </div>
            <Button onClick={handleTemplateDownload} disabled={isTemplateDownloading} variant="secondary" size="sm">
              {isTemplateDownloading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}
              Descargar
            </Button>
          </div>

          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            El libro debe ser un archivo válido <strong>.xlsx</strong> y no puede superar {formatBytes(MAX_FILE_SIZE_BYTES)}.
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">2. Cargar y previsualizar</h2>
            <p className="text-sm text-muted-foreground">
              Elija el libro completado y genere una vista previa antes de confirmar.
            </p>
          </div>

          {!job ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="onboarding-import-file">
                  Archivo del libro
                </label>
                <Input
                  id="onboarding-import-file"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleFileChange}
                />
              </div>

              {selectedFile && (
                <div className="rounded-lg border border-border bg-card p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <FileSpreadsheet size={16} />
                    {selectedFile.name}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(selectedFile.size)} · {selectedFile.type || 'tipo desconocido'}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handlePreview}
                  disabled={isUploading || !selectedFile}
                  variant="primary"
                >
                  {isUploading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Upload size={16} className="mr-2" />}
                  Previsualizar importación
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                La previsualización sube el archivo al backend y devuelve el resumen determinista de importación y las incidencias del tenant.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge className={statusBadgeClass(job.status)}>{statusLabel(job.status)}</Badge>
                      <span className="text-xs text-muted-foreground">Importación #{job.importId.slice(0, 8)}</span>
                    </div>
                    <p className="text-sm font-medium">{job.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.schemaVersion} · preview v{job.previewVersion} · expires {new Date(job.expiresAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void loadImport(job.importId)}
                      variant="secondary"
                      size="sm"
                      disabled={isLoadingImport}
                    >
                      {isLoadingImport ? <Loader2 size={16} className="mr-2 animate-spin" /> : <RefreshCw size={16} className="mr-2" />}
                      Actualizar
                    </Button>
                    <Button onClick={resetWizard} variant="ghost" size="sm">
                      <ArrowLeft size={16} className="mr-2" />
                      Comenzar de nuevo
                    </Button>
                  </div>
                </div>
              </div>

              {selectedFile && (
                <div className="rounded-lg border border-border bg-card p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <FileSpreadsheet size={16} />
                    Listo para volver a cargar: {selectedFile.name}
                  </div>
                </div>
              )}

              {job.status === 'READY' && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  La vista previa está lista y ya puede confirmarse.
                </div>
              )}

              {job.status === 'BLOCKED' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  La vista previa tiene bloqueos. Revíselos antes de confirmar.
                </div>
              )}

              {job.status === 'FAILED' && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  El backend no pudo completar la vista previa. Vuelva a cargar el libro o comience de nuevo.
                </div>
              )}

              {job.status === 'EXPIRED' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900">
                  La vista previa expiró. Comience de nuevo y cargue el libro otra vez.
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Card className="border-border/80 bg-muted/20">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Incidencias</div>
                  <div className="mt-1 text-2xl font-semibold">{totalIssues}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{totalBlocking} bloqueos · {totalWarnings} advertencias</div>
                </Card>
                <Card className="border-border/80 bg-muted/20">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Puede confirmar</div>
                  <div className="mt-1 text-2xl font-semibold">{job.canConfirm ? 'Sí' : 'No'}</div>
                  <div className="mt-1 text-xs text-muted-foreground">La confirmación la gestiona el backend.</div>
                </Card>
                <Card className="border-border/80 bg-muted/20">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Hash del archivo</div>
                  <div className="mt-1 break-all text-sm font-medium">{job.fileHash}</div>
                </Card>
              </div>

              {job.canConfirm && job.status === 'READY' && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleConfirm} disabled={isConfirming} variant="primary">
                    {isConfirming ? <Loader2 size={16} className="mr-2 animate-spin" /> : <CheckCircle2 size={16} className="mr-2" />}
                    Confirmar importación
                  </Button>
                </div>
              )}

              {phase === 'confirming' && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                  Confirmando la importación con el backend. Espere.
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {job && issueSummary && (
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Resumen de vista previa</h2>
              <p className="text-sm text-muted-foreground">
                Conteos deterministas devueltos por la vista previa del backend para este tenant.
              </p>
            </div>
            <BadgeInfo className="text-muted-foreground" size={18} />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {issueSummary.map((entry) => (
              <Card key={entry.label} className="border-border/80 bg-muted/20">
                <div className="text-sm font-semibold">{entry.label}</div>
                <div className="mt-2 text-xs text-muted-foreground">{summarizeSheetStats(entry.stats)}</div>
              </Card>
            ))}
          </div>
        </Card>
      )}

      {job && canShowIssues && (
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Incidencias</h2>
              <p className="text-sm text-muted-foreground">
                Revise los bloqueos y las advertencias antes de confirmar la importación.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isLoadingIssues ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              {issues ? formatIssueCount(issues.total) : 'Cargando...'}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label htmlFor="issue-severity" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Severidad
              </label>
              <Select
                id="issue-severity"
                value={issueFilters.severity ?? ''}
                onChange={(event) =>
                  setIssueFilters((current) => ({
                    ...current,
                    severity: (event.target.value as ImportIssueSeverity | '') || '',
                    page: 1,
                  }))
                }
              >
                <option value="">Todas</option>
                <option value="BLOCKER">Bloqueo</option>
                <option value="WARNING">Advertencia</option>
                <option value="INFO">Información</option>
              </Select>
            </div>

            <div className="space-y-1">
              <label htmlFor="issue-sheet" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Hoja
              </label>
              <Select
                id="issue-sheet"
                value={issueFilters.sheet ?? ''}
                onChange={(event) =>
                  setIssueFilters((current) => ({
                    ...current,
                    sheet: event.target.value,
                    page: 1,
                  }))
                }
              >
                <option value="">Todas las hojas</option>
                {SHEET_OPTIONS.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1 md:col-span-2">
              <label htmlFor="issue-code" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Código
              </label>
              <Input
                id="issue-code"
                value={issueFilters.code ?? ''}
                onChange={(event) =>
                  setIssueFilters((current) => ({
                    ...current,
                    code: event.target.value,
                    page: 1,
                  }))
                }
                placeholder="Filtrar por código"
              />
            </div>
          </div>

          {issues && issues.data.length > 0 ? (
            <div className="space-y-4">
              <Table>
                <THead>
                  <TR>
                    <TH>Severidad</TH>
                    <TH>Hoja</TH>
                    <TH>Fila</TH>
                    <TH>Código</TH>
                    <TH>Mensaje</TH>
                    <TH>Recibido</TH>
                    <TH>Normalizado</TH>
                  </TR>
                </THead>
                <TBody>
                  {issues.data.map((issue) => (
                    <TR key={issue.id}>
                      <TD>
                        <Badge className={issue.severity === 'BLOCKER' ? 'bg-red-100 text-red-800 border-red-200' : issue.severity === 'WARNING' ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-700 border-slate-200'}>
                          {issue.severity}
                        </Badge>
                      </TD>
                      <TD>{issue.sheet}</TD>
                      <TD>{issue.row ?? '—'}</TD>
                      <TD className="font-mono text-xs">{issue.code}</TD>
                      <TD className="max-w-md">{issue.message}</TD>
                      <TD className="font-mono text-xs">{issue.receivedValue ?? '—'}</TD>
                      <TD className="font-mono text-xs">{issue.normalizedValue ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="text-muted-foreground">
                  Página {issues.page} de {issues.totalPages}
                </p>
                <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={issues.page <= 1}
                    onClick={() =>
                      setIssueFilters((current) => ({
                        ...current,
                        page: Math.max(1, (current.page ?? 1) - 1),
                      }))
                    }
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={issues.page >= issues.totalPages}
                    onClick={() =>
                      setIssueFilters((current) => ({
                        ...current,
                        page: (current.page ?? 1) + 1,
                      }))
                    }
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
              {isLoadingIssues ? 'Cargando incidencias...' : 'No hay incidencias que coincidan con los filtros actuales.'}
            </div>
          )}
        </Card>
      )}

      {job?.status === 'CONFIRMED' && (
        <Card className="border-emerald-200 bg-emerald-50">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="mt-1 text-emerald-600" size={24} />
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-emerald-900">Importación confirmada</h2>
                <p className="text-sm text-emerald-800">
                  El backend confirmó este libro y los datos del tenant se guardaron de forma atómica.
                </p>
              </div>

              {job && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {issueSummary?.map((entry) => (
                    <Card key={`confirmed-${entry.label}`} className="border-emerald-200 bg-white/70">
                      <div className="text-sm font-semibold text-emerald-900">{entry.label}</div>
                      <div className="mt-2 text-xs text-emerald-800">{summarizeSheetStats(entry.stats)}</div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {job?.status === 'EXPIRED' && (
        <ErrorState
          message="La vista previa de importación expiró. Comience de nuevo para subir el libro otra vez."
          onRetry={resetWizard}
        />
      )}

      {phase === 'processing' && (
        <Card className="border-blue-200 bg-blue-50">
          <div className="flex items-center gap-3 text-blue-900">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm font-medium">Cargando el libro y generando la vista previa...</span>
          </div>
        </Card>
      )}

      {!job && isLoadingImport && (
        <Card className="border-border/80 bg-muted/20">
          <div className="flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Cargando el estado existente de la importación...</span>
          </div>
        </Card>
      )}
    </div>
  );
}

export default OnboardingImportWizard;
