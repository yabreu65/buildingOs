'use client';

import React, { useState } from 'react';
import { Document } from '../../services/documents.api';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import { useToast } from '@/shared/components/ui/Toast';
import { Download, Trash2, FileText } from 'lucide-react';
import { getDownloadUrl } from '../../services/documents.api';

interface DocumentListProps {
  documents: Document[];
  loading: boolean;
  error: string | null;
  tenantId: string;
  onRetry: () => void;
  onDelete?: (documentId: string) => Promise<void>;
  readOnly?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  RULES: 'Reglamento',
  MINUTES: 'Actas',
  CONTRACT: 'Contrato',
  BUDGET: 'Presupuesto',
  INVOICE: 'Factura',
  RECEIPT: 'Recibo',
  OTHER: 'Otro',
};

const VISIBILITY_LABELS: Record<string, string> = {
  TENANT_ADMINS: 'Solo Admins',
  RESIDENTS: 'Residentes',
  PRIVATE: 'Privado',
};

export function DocumentList({
  documents,
  loading,
  error,
  tenantId,
  onRetry,
  onDelete,
  readOnly = false,
}: DocumentListProps) {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (doc: Document) => {
    try {
      setDownloading(doc.id);
      const { url } = await getDownloadUrl(tenantId, doc.id);
      window.open(url, '_blank');
      toast('Descargando archivo...', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al descargar';
      toast(message, 'error');
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId || !onDelete) return;
    try {
      await onDelete(deleteId);
      toast('Documento eliminado', 'success');
      setDeleteId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar';
      toast(message, 'error');
    }
  };

  // Loading state
  if (loading) {
    return (
      <Card className="p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Documentos
        </h3>
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} width="100%" height="48px" />
          ))}
        </div>
      </Card>
    );
  }

  // Error state
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  // Empty state
  if (documents.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Documentos
        </h3>
        <EmptyState
          icon={<FileText className="w-12 h-12 text-muted-foreground" />}
          title="Sin documentos"
          description={readOnly ? 'No hay documentos disponibles' : 'Sube tu primer documento'}
        />
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Documentos ({documents.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="text-left py-2 px-2 font-semibold">Título</th>
                <th className="text-left py-2 px-2 font-semibold">Categoría</th>
                <th className="text-left py-2 px-2 font-semibold">Acceso</th>
                <th className="text-left py-2 px-2 font-semibold">Subido por</th>
                <th className="text-left py-2 px-2 font-semibold">Fecha</th>
                <th className="text-right py-2 px-2 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 px-2 font-medium">{doc.title}</td>
                  <td className="py-3 px-2 text-xs text-muted-foreground">
                    {CATEGORY_LABELS[doc.category] || doc.category}
                  </td>
                  <td className="py-3 px-2 text-xs">
                    <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-800 font-medium">
                      {VISIBILITY_LABELS[doc.visibility] || doc.visibility}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-xs text-muted-foreground">
                    {doc.createdByMembership?.user.name || 'Sistema'}
                  </td>
                  <td className="py-3 px-2 text-xs text-muted-foreground">
                    {new Date(doc.createdAt).toLocaleDateString('es-AR')}
                  </td>
                  <td className="py-3 px-2 text-right space-x-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownload(doc)}
                      disabled={downloading === doc.id}
                      title={doc.file.originalName}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    {!readOnly && onDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setDeleteId(doc.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Delete confirmation dialog */}
      {deleteId && (
        <DeleteConfirmDialog
          isOpen={true}
          title="Eliminar documento"
          description="Esta acción no se puede deshacer. El documento será eliminado permanentemente."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  );
}
