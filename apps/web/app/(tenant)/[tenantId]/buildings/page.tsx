'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import { useBuildings } from '@/features/buildings/hooks';
import { useToast } from '@/shared/components/ui/Toast';
import { routes } from '@/shared/lib/routes';
import { Loader2, Plus, Edit, Trash2, Building2 } from 'lucide-react';
import Link from 'next/link';

type TenantParams = {
  tenantId: string;
};

/**
 * BuildingsPage: List all buildings for a tenant
 * Shows: building list, create button, edit/delete actions
 */
export default function BuildingsPage() {
  const params = useParams<TenantParams>();
  const tenantId = params?.tenantId;
  const { toast } = useToast();

  const { buildings, loading, error, create, delete: deleteBuilding, refetch } =
    useBuildings(tenantId);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', address: '' });
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    buildingId: string | null;
  }>({ isOpen: false, buildingId: null });
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setCreateError(null);
    setSubmitting(true);
    try {
      await create({ name: formData.name, address: formData.address });
      setFormData({ name: '', address: '' });
      setShowCreateForm(false);
      toast('Building created successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create building';
      setCreateError(message);
      toast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm.buildingId) return;

    setIsDeleting(true);
    try {
      await deleteBuilding(deleteConfirm.buildingId);
      toast('Building deleted successfully', 'success');
      setDeleteConfirm({ isOpen: false, buildingId: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete building';
      toast(message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!tenantId) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Buildings</h1>
          <p className="text-muted-foreground mt-1">
            Manage your properties and units
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)}>
          <Plus className="w-4 h-4 mr-2" />
          New Building
        </Button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <Card className="border-blue-200 bg-blue-50">
          <div className="mb-4">
            <h3 className="text-lg font-semibold">Create New Building</h3>
          </div>
          {createError && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
              {createError}
            </div>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Building Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Main Tower"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Address (optional)
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., 123 Main Street"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Building'
                )}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <ErrorState
          message={error}
          onRetry={() => refetch()}
        />
      )}

      {/* Loading State */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}><div className="h-36 animate-pulse bg-muted rounded" /></Card>
          ))}
        </div>
      ) : buildings.length === 0 ? (
        /* Empty State */
        <EmptyState
          icon={<Building2 className="w-12 h-12 text-muted-foreground" />}
          title="No buildings yet"
          description="Create your first building to get started managing properties and units."
          cta={{
            text: 'Create First Building',
            onClick: () => setShowCreateForm(true),
          }}
        />
      ) : (
        /* Buildings Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {buildings.map((building) => (
            <Card
              key={building.id}
              className="hover:shadow-md transition"
            >
              <Link href={routes.buildingOverview(tenantId, building.id)}>
                <h3 className="text-lg font-semibold hover:text-blue-600 transition mb-2 cursor-pointer">
                  {building.name}
                </h3>
              </Link>
              <div className="space-y-4">
                {building.address && (
                  <p className="text-sm text-muted-foreground">{building.address}</p>
                )}
                <div className="flex gap-2">
                  <Link href={routes.buildingOverview(tenantId, building.id)} className="flex-1">
                    <Button
                      className="w-full"
                      variant="secondary"
                      size="sm"
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      View
                    </Button>
                  </Link>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => setDeleteConfirm({ isOpen: true, buildingId: building.id })}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete Building"
        description="This action cannot be undone. All units and occupants associated with this building will be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm({ isOpen: false, buildingId: null })}
        isLoading={isDeleting}
      />
    </div>
  );
}
