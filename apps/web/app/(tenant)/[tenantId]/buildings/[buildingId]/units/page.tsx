'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { routes } from '@/shared/lib/routes';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import Skeleton from '@/shared/components/ui/Skeleton';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { useBuildings } from '@/features/buildings/hooks';
import { useUnits } from '@/features/buildings/hooks/useUnits';
import { useToast } from '@/shared/components/ui/Toast';
import { Loader2, Plus, Edit, Trash2, LayoutGrid, X } from 'lucide-react';
import type { Unit } from '@/features/units/units.types';

type UnitParams = {
  tenantId: string;
  buildingId: string;
};

/**
 * UnitsPage: List all units in a building
 * Shows: units table with occupancy status, resident info, create/edit/delete actions
 */
export default function UnitsPage() {
  const params = useParams<UnitParams>();
  const router = useRouter();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;
  const { toast } = useToast();

  const { buildings, loading: buildingsLoading, error: buildingsError, refetch: refetchBuildings } = useBuildings(tenantId);
  const {
    units,
    loading: unitsLoading,
    error: unitsError,
    create: createUnit,
    update: updateUnit,
    delete: deleteUnit,
    refetch: refetchUnits,
  } = useUnits(tenantId, buildingId);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    code: '',
    label: '',
    unitType: 'APARTMENT',
    occupancyStatus: 'UNKNOWN',
  });
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit state
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [editFormData, setEditFormData] = useState({
    code: '',
    label: '',
    unitType: 'APARTMENT',
    occupancyStatus: 'UNKNOWN',
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    unitId: string | null;
  }>({ isOpen: false, unitId: null });
  const [isDeleting, setIsDeleting] = useState(false);

  const building = buildings.find((b) => b.id === buildingId);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code.trim()) return;

    setCreateError(null);
    setSubmitting(true);
    try {
      await createUnit(formData);
      setFormData({ code: '', label: '', unitType: 'APARTMENT', occupancyStatus: 'UNKNOWN' });
      setShowCreateForm(false);
      toast('Unit created successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create unit';
      setCreateError(message);
      toast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditClick = (unit: Unit) => {
    setEditingUnit(unit);
    setEditFormData({
      code: unit.unitCode || '',
      label: unit.label,
      unitType: unit.unitType || 'APARTMENT',
      occupancyStatus: unit.occupancyStatus || 'UNKNOWN',
    });
    setEditError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUnit || !editFormData.code.trim()) return;

    setEditError(null);
    setEditSubmitting(true);
    try {
      await updateUnit(editingUnit.id, {
        code: editFormData.code,
        label: editFormData.label,
        unitType: editFormData.unitType,
        occupancyStatus: editFormData.occupancyStatus,
      });
      toast('Unit updated successfully', 'success');
      setEditingUnit(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update unit';
      setEditError(message);
      toast(message, 'error');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm.unitId) return;

    setIsDeleting(true);
    try {
      await deleteUnit(deleteConfirm.unitId);
      toast('Unit deleted successfully', 'success');
      setDeleteConfirm({ isOpen: false, unitId: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete unit';
      toast(message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

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

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName={building.name}
        buildingId={buildingId}
      />

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Units</h1>
          <p className="text-muted-foreground mt-1">
            Manage units in {building.name}
          </p>
        </div>
        {!showCreateForm && !editingUnit && (
          <Button onClick={() => setShowCreateForm(!showCreateForm)}>
            <Plus className="w-4 h-4 mr-2" />
            New Unit
          </Button>
        )}
      </div>

      {/* Navigation Tabs */}
      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      {/* Create Form */}
      {showCreateForm && (
        <Card className="border-blue-200 bg-blue-50">
          <div className="mb-4 flex justify-between items-center">
            <h3 className="text-lg font-semibold">Create New Unit</h3>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setCreateError(null);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {createError && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
              {createError}
            </div>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Unit Code *
                </label>
                <input
                  type="text"
                  required
                  value={formData.code}
                  onChange={(e) =>
                    setFormData({ ...formData, code: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 101"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Label (optional)
                </label>
                <input
                  type="text"
                  value={formData.label}
                  onChange={(e) =>
                    setFormData({ ...formData, label: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Apt 101"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Type
                </label>
                <select
                  value={formData.unitType}
                  onChange={(e) =>
                    setFormData({ ...formData, unitType: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="APARTMENT">Apartment</option>
                  <option value="HOUSE">House</option>
                  <option value="OFFICE">Office</option>
                  <option value="STORAGE">Storage</option>
                  <option value="PARKING">Parking</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Occupancy Status
                </label>
                <select
                  value={formData.occupancyStatus}
                  onChange={(e) =>
                    setFormData({ ...formData, occupancyStatus: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="UNKNOWN">Unknown</option>
                  <option value="VACANT">Vacant</option>
                  <option value="OCCUPIED">Occupied</option>
                </select>
              </div>
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
                  'Create Unit'
                )}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Edit Form */}
      {editingUnit && (
        <Card className="border-green-200 bg-green-50">
          <div className="mb-4 flex justify-between items-center">
            <h3 className="text-lg font-semibold">Edit Unit</h3>
            <button
              onClick={() => setEditingUnit(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {editError && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
              {editError}
            </div>
          )}
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Unit Code *
                </label>
                <input
                  type="text"
                  required
                  value={editFormData.code}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, code: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Label (optional)
                </label>
                <input
                  type="text"
                  value={editFormData.label}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, label: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Type
                </label>
                <select
                  value={editFormData.unitType}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, unitType: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="APARTMENT">Apartment</option>
                  <option value="HOUSE">House</option>
                  <option value="OFFICE">Office</option>
                  <option value="STORAGE">Storage</option>
                  <option value="PARKING">Parking</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Occupancy Status
                </label>
                <select
                  value={editFormData.occupancyStatus}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, occupancyStatus: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="UNKNOWN">Unknown</option>
                  <option value="VACANT">Vacant</option>
                  <option value="OCCUPIED">Occupied</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditingUnit(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Units Error State */}
      {unitsError && (
        <ErrorState
          message={unitsError}
          onRetry={() => refetchUnits()}
        />
      )}

      {/* Loading State */}
      {unitsLoading ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Code</th>
                  <th className="text-left py-3 px-4 font-medium">Label</th>
                  <th className="text-left py-3 px-4 font-medium">Type</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                  <th className="text-left py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3].map((i) => (
                  <tr key={i} className="border-b">
                    <td className="py-3 px-4"><Skeleton width="60px" height="20px" /></td>
                    <td className="py-3 px-4"><Skeleton width="80px" height="20px" /></td>
                    <td className="py-3 px-4"><Skeleton width="80px" height="20px" /></td>
                    <td className="py-3 px-4"><Skeleton width="80px" height="20px" /></td>
                    <td className="py-3 px-4"><Skeleton width="60px" height="20px" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : units.length === 0 ? (
        /* Empty State */
        <EmptyState
          icon={<LayoutGrid className="w-12 h-12 text-muted-foreground" />}
          title="No units yet"
          description="Create your first unit to start managing occupancy and resident information."
          cta={{
            text: 'Create First Unit',
            onClick: () => setShowCreateForm(true),
          }}
        />
      ) : (
        /* Units Table */
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Code</th>
                  <th className="text-left py-3 px-4 font-medium">Label</th>
                  <th className="text-left py-3 px-4 font-medium">Type</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                  <th className="text-left py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.id} className="border-b hover:bg-muted/50 transition">
                    <td className="py-3 px-4 font-medium">{unit.unitCode || 'N/A'}</td>
                    <td className="py-3 px-4">{unit.label || '-'}</td>
                    <td className="py-3 px-4">
                      <span className="text-xs bg-gray-200 px-2 py-1 rounded">
                        {unit.unitType || 'N/A'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs px-2 py-1 rounded font-medium ${
                          unit.occupancyStatus === 'OCCUPIED'
                            ? 'bg-green-100 text-green-800'
                            : unit.occupancyStatus === 'VACANT'
                              ? 'bg-orange-100 text-orange-800'
                              : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {unit.occupancyStatus || 'Unknown'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => router.push(routes.unitDashboard(tenantId, buildingId, unit.id))}
                        >
                          View
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleEditClick(unit)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => setDeleteConfirm({ isOpen: true, unitId: unit.id })}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete Unit"
        description="This action cannot be undone. The unit and all associated occupant data will be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm({ isOpen: false, unitId: null })}
        isLoading={isDeleting}
      />
    </div>
  );
}
