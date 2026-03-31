'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Download,
  AlertCircle,
  CheckCircle,
  Loader2,
  Building2,
  Home,
  Folder,
  Calendar,
} from 'lucide-react';
import { useResidentContext } from '../../../../../features/resident/hooks/useResidentContext';
import { getContextOptions } from '../../../../../features/context/context.api';
import { useTenants } from '../../../../../features/tenants/tenants.hooks';
import { apiClient } from '../../../../../shared/lib/http/client';
import Card from '../../../../../shared/components/ui/Card';
import Skeleton from '../../../../../shared/components/ui/Skeleton';

interface Document {
  id: string;
  title: string;
  category: string;
  visibility: 'TENANT_ADMIN' | 'RESIDENTS' | 'PRIVATE';
  buildingId: string | null;
  unitId: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  createdBy: {
    name: string;
    email: string;
  };
}

async function getResidentDocuments(
  tenantId: string,
  buildingId?: string,
  unitId?: string
): Promise<Document[]> {
  const params = new URLSearchParams();
  if (buildingId) params.append('buildingId', buildingId);
  if (unitId) params.append('unitId', unitId);
  
  const query = params.toString();
  const endpoint = `/tenants/${tenantId}/documents${query ? '?' + query : ''}`;
  
  return apiClient<Document[]>({
    path: endpoint,
    method: 'GET',
  });
}

async function getDownloadUrl(tenantId: string, documentId: string): Promise<string> {
  return apiClient<string>({
    path: `/tenants/${tenantId}/documents/${documentId}/download`,
    method: 'GET',
  });
}

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    RULES: 'Reglamento',
    FINANCIAL: 'Financiero',
    ASSEMBLY: 'Asambleas',
    MAINTENANCE: 'Mantenimiento',
    OTHER: 'Otros',
  };
  return labels[category] ?? category;
}

function visibilityLabel(visibility: Document['visibility']): string {
  const labels: Record<Document['visibility'], string> = {
    TENANT_ADMIN: 'Solo admins',
    RESIDENTS: 'Todos los residentes',
    PRIVATE: 'Privado',
  };
  return labels[visibility] ?? visibility;
}

function scopeLabel(buildingId: string | null, unitId: string | null): string {
  if (unitId) return 'Unidad';
  if (buildingId) return 'Edificio';
  return '全局';
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateStr));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(mimeType: string) {
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('image')) return '🖼️';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  return '📁';
}

export default function ResidentDocumentsPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;

  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((t) => t.id === tenantId)?.name ?? tenantId;

  const { data: context, isLoading: contextLoading } = useResidentContext(tenantId ?? null);
  const buildingId = context?.activeBuildingId;
  const unitId = context?.activeUnitId;

  const { data: contextOptions } = useQuery({
    queryKey: ['contextOptions', tenantId],
    queryFn: () => getContextOptions(tenantId!),
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });

  const buildingName = contextOptions?.buildings.find((b) => b.id === buildingId)?.name ?? null;

  const { data: documents = [], isLoading: docsLoading, refetch } = useQuery<Document[]>({
    queryKey: ['residentDocuments', tenantId, buildingId, unitId],
    queryFn: () => getResidentDocuments(tenantId!, buildingId ?? undefined, unitId ?? undefined),
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });

  const handleDownload = async (doc: Document) => {
    try {
      const url = await getDownloadUrl(tenantId!, doc.id);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Failed to get download URL:', error);
    }
  };

  if (contextLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (!buildingId || !unitId) {
    return (
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FileText className="w-6 h-6" />
          Documentos
        </h1>
        <p className="text-muted-foreground mt-1">{tenantName}</p>

        <Card className="p-4 mt-6 border-yellow-300 bg-yellow-50">
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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FileText className="w-6 h-6" />
          Documentos
        </h1>
        <p className="text-muted-foreground mt-1">
          {tenantName}
          {buildingName && ` • ${buildingName}`}
        </p>
      </div>

      {/* Documents List */}
      {docsLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <Card className="p-8 text-center">
          <Folder className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No hay documentos disponibles</p>
          <p className="text-sm text-muted-foreground mt-1">
            Los documentos subidos por la administración aparecerán aquí
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <Card key={doc.id} className="p-4 hover:shadow-md transition">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="text-2xl">{getFileIcon(doc.mimeType)}</div>
                  <div className="min-w-0">
                    <h3 className="font-medium truncate">{doc.title}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Folder className="w-3 h-3" />
                        {categoryLabel(doc.category)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        {scopeLabel(doc.buildingId, doc.unitId)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(doc.createdAt)}
                      </span>
                      <span>{formatFileSize(doc.size)}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(doc)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition"
                >
                  <Download className="w-4 h-4" />
                  Descargar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
