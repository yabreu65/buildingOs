'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BuildingBreadcrumb } from '@/features/buildings/components/BuildingBreadcrumb';
import { BuildingSubnav } from '@/features/buildings/components/BuildingSubnav';
import { DocumentList, DocumentUploadModal, DocumentFilters } from '@/features/buildings/components/documents';
import { useDocumentsBuilding } from '@/features/buildings/hooks/useDocumentsBuilding';
import { useAuth } from '@/features/auth/useAuth';
import Button from '@/shared/components/ui/Button';
import { Upload } from 'lucide-react';
import { DocumentCategory, DocumentVisibility } from '@/features/buildings/services/documents.api';

export default function DocumentsPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const buildingId = params.buildingId as string;

  const { currentUser } = useAuth();
  const { documents, loading, error, fetch, remove } = useDocumentsBuilding({
    tenantId,
    buildingId,
  });

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategory | null>(null);
  const [selectedVisibility, setSelectedVisibility] = useState<DocumentVisibility | null>(null);

  // Filter documents
  const filteredDocuments = documents.filter((doc) => {
    if (selectedCategory && doc.category !== selectedCategory) return false;
    if (selectedVisibility && doc.visibility !== selectedVisibility) return false;
    return true;
  });

  // Check if user is admin (can upload)
  const isAdmin = currentUser?.roles?.some((r) =>
    ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].includes(r),
  ) || false;

  return (
    <div>
      {/* Breadcrumb */}
      <BuildingBreadcrumb tenantId={tenantId} buildingId={buildingId} />

      {/* Subnav */}
      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      {/* Page Content */}
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Documentos</h1>
          {isAdmin && (
            <Button
              onClick={() => setShowUploadModal(true)}
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              Subir Documento
            </Button>
          )}
        </div>

        {/* Filters */}
        {documents.length > 0 && (
          <DocumentFilters
            onCategoryChange={setSelectedCategory}
            onVisibilityChange={setSelectedVisibility}
            selectedCategory={selectedCategory}
            selectedVisibility={selectedVisibility}
          />
        )}

        {/* Document List */}
        <DocumentList
          documents={filteredDocuments}
          loading={loading}
          error={error}
          tenantId={tenantId}
          onRetry={fetch}
          onDelete={isAdmin ? remove : undefined}
          readOnly={!isAdmin}
        />
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <DocumentUploadModal
          tenantId={tenantId}
          buildingId={buildingId}
          onSuccess={() => {
            setShowUploadModal(false);
            fetch();
          }}
          onClose={() => setShowUploadModal(false)}
        />
      )}
    </div>
  );
}
