'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import ErrorState from '@/shared/components/ui/ErrorState';
import Skeleton from '@/shared/components/ui/Skeleton';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { useBuildings } from '@/features/buildings/hooks';
import { routes } from '@/shared/lib/routes';
import { useToast } from '@/shared/components/ui/Toast';
import { Trash2 } from 'lucide-react';

type BuildingParams = {
  tenantId: string;
  buildingId: string;
};

/**
 * SettingsPage: Edit building details and manage dangerous actions
 */
export default function SettingsPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;
  const router = useRouter();
  const { toast } = useToast();

  const { buildings, loading: buildingsLoading, error: buildingsError, update, delete: deleteBuilding, refetch: refetchBuildings } = useBuildings(tenantId);

  const [formData, setFormData] = useState({ name: '', address: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const building = buildings.find((b) => b.id === buildingId);

  // Initialize form when building loads
  if (building && formData.name === '') {
    setFormData({ name: building.name, address: building.address || '' });
  }

  if (!tenantId || !buildingId) {
    return <div>Invalid parameters</div>;
  }

  if (buildingsError) {
    return (
      <ErrorState
        message={buildingsError}
        onRetry={() => refetchBuildings()}
      />
    );
  }

  if (buildingsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton width="300px" height="32px" />
        <Card>
          <div className="h-40 animate-pulse bg-muted rounded" />
        </Card>
      </div>
    );
  }

  if (!building) {
    return (
      <ErrorState
        message="Building not found. It may have been deleted or you don't have access."
        onRetry={() => refetchBuildings()}
      />
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await update(buildingId, {
        name: formData.name,
        address: formData.address || undefined,
      });
      toast('Building updated successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update building';
      setSubmitError(message);
      toast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      await deleteBuilding(buildingId);
      toast('Building deleted successfully', 'success');
      router.push(routes.buildingsList(tenantId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete building';
      toast(message, 'error');
      setShowDeleteDialog(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName="Settings"
        buildingId={buildingId}
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      {/* Edit Form */}
      <Card>
        <div className="mb-6">
          <h2 className="text-xl font-semibold">Building Details</h2>
          <p className="text-sm text-muted-foreground mt-1">Update your building information</p>
        </div>

        {submitError && (
          <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Building Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Address (optional)
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2 justify-start pt-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200 bg-red-50">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-red-900">Danger Zone</h2>
          <p className="text-sm text-red-700 mt-1">Irreversible actions</p>
        </div>

        <div className="flex items-center justify-between p-4 bg-white border border-red-200 rounded-md">
          <div>
            <p className="font-medium text-foreground">Delete Building</p>
            <p className="text-sm text-muted-foreground">Permanently delete this building and all its data</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            className="text-red-600 hover:text-red-700"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        </div>
      </Card>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={showDeleteDialog}
        title="Delete Building"
        description="This action cannot be undone. The building and all associated data will be permanently deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setShowDeleteDialog(false)}
        isLoading={isDeleting}
      />
    </div>
  );
}
