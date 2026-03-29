'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { routes } from '@/shared/lib/routes';
import { t } from '@/i18n';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import Skeleton from '@/shared/components/ui/Skeleton';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { useBuildings } from '@/features/buildings/hooks';
import { useUnits } from '@/features/buildings/hooks/useUnits';
import { UnitCreateForm } from '@/features/units/components';
import { useCategories } from '@/features/expense-allocation';
import { useToast } from '@/shared/components/ui/Toast';
import { handlePlanLimitError } from '@/features/billing/utils/handlePlanLimitError';
import { Edit, Trash2, LayoutGrid, Plus, X } from 'lucide-react';
import type { Unit } from '@/features/units/units.types';
import type { Unit as ApiUnit, CreateUnitInput } from '@/features/units/units.api';
import { ErrorBoundary } from '@/shared/components/error-boundary';
import CategoryChangeDialog from './CategoryChangeDialog';

interface UnitParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

/**
 * UnitsPage: List all units in a building
 * Shows: units table with occupancy status, resident info, create/edit/delete actions
 */
const UnitsPage = () => {
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
  const { data: categories = [] } = useCategories(tenantId, buildingId);

  const [showCreateForm, setShowCreateForm] = useState(false);

  // Edit state
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [editFormData, setEditFormData] = useState({
    code: '',
    label: '',
    unitType: 'APARTMENT',
    occupancyStatus: 'UNKNOWN',
    m2: undefined as number | undefined,
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    unitId: string | null;
  }>({ isOpen: false, unitId: null });
  const [isDeleting, setIsDeleting] = useState(false);

  // Category change dialog state
  const [categoryChangeDialog, setCategoryChangeDialog] = useState<{
    isOpen: boolean;
    unitId: string | null;
    newCategoryId: string | null;
    newCategoryName?: string;
    newM2?: number;
  }>({ isOpen: false, unitId: null, newCategoryId: null });
  const [isCategoryChanging, setIsCategoryChanging] = useState(false);

  const building = buildings.find((b) => b.id === buildingId);

  const handleCreateSuccess = (unit: ApiUnit) => {
    setShowCreateForm(false);
    toast(t('units.created'), 'success');
  };

  const handleCreateUnit = async (buildingId: string, input: Omit<CreateUnitInput, 'buildingId'>): Promise<ApiUnit> => {
    try {
      const unit = await createUnit(input);
      // Convert from old Unit type to ApiUnit type for UnitCreateForm
      return unit as ApiUnit;
    } catch (err) {
      // Check if it's a plan limit error first
      if (!handlePlanLimitError(err, (msg, type = 'error', duration = 3000) => {
        toast(msg, type, duration);
      })) {
        // If not a plan limit error, rethrow
        throw err;
      }
      throw err;
    }
  };

  const handleEditClick = (unit: Unit) => {
    setEditingUnit(unit);
    setEditFormData({
      code: unit.unitCode || '',
      label: unit.label,
      unitType: unit.unitType || 'APARTMENT',
      occupancyStatus: unit.occupancyStatus || 'UNKNOWN',
      m2: unit.m2 || undefined,
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
      toast(t('units.updated'), 'success');
      setEditingUnit(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('units.errors.updateFailed');
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
      toast(t('units.deleted'), 'success');
      setDeleteConfirm({ isOpen: false, unitId: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('units.errors.deleteFailed');
      toast(message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCategoryChange = (unitId: string, categoryId: string) => {
    const selectedCategory = categories.find((c) => c.id === categoryId);
    const m2ToSet = selectedCategory ? selectedCategory.maxM2 || selectedCategory.minM2 : undefined;

    // Open dialog for confirmation
    setCategoryChangeDialog({
      isOpen: true,
      unitId,
      newCategoryId: categoryId || null,
      newCategoryName: selectedCategory?.name,
      newM2: m2ToSet,
    });
  };

  const handleCategoryChangeConfirm = async () => {
    const { unitId, newCategoryId, newM2 } = categoryChangeDialog;
    if (!unitId || newCategoryId === null) return;

    setIsCategoryChanging(true);
    try {
      await updateUnit(unitId, {
        unitCategoryId: newCategoryId || null,
        m2: newM2,
      });
      toast('Categoría actualizada' + (newM2 ? ` (m² actualizado: ${newM2})` : ''), 'success');
      setCategoryChangeDialog({ isOpen: false, unitId: null, newCategoryId: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al actualizar categoría';
      toast(message, 'error');
    } finally {
      setIsCategoryChanging(false);
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
    <ErrorBoundary level="page">
      <div className="space-y-6">
        {/* Breadcrumb */}
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName={building.name}
        buildingId={buildingId}
        sectionName="Unidades"
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

      {/* Create Form - Unified Component */}
      {showCreateForm && (
        <UnitCreateForm
          tenantId={tenantId}
          buildings={buildings}
          defaultBuildingId={buildingId}
          onSuccess={handleCreateSuccess}
          onCancel={() => setShowCreateForm(false)}
          onCreateUnit={handleCreateUnit}
        />
      )}

      {/* Edit Form */}
      {editingUnit && (
        <Card className="border-green-200 bg-green-50">
          <div className="mb-4 flex justify-between items-center">
            <h3 className="text-lg font-semibold">{t('units.edit')}</h3>
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
            <div>
              <label className="block text-sm font-medium mb-1">
                m² (Square Meters) - Optional
              </label>
              <input
                type="number"
                step="0.01"
                value={editFormData.m2 ?? ''}
                onChange={(e) =>
                  setEditFormData({
                    ...editFormData,
                    m2: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
                placeholder="e.g., 65"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditingUnit(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? t('units.saving') : t('units.saveChanges')}
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
                  <th className="text-left py-3 px-4 font-medium">m²</th>
                  <th className="text-left py-3 px-4 font-medium">Categoría</th>
                  <th className="text-left py-3 px-4 font-medium">Tipo</th>
                  <th className="text-left py-3 px-4 font-medium">Estado</th>
                  <th className="text-left py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3].map((i) => (
                  <tr key={i} className="border-b">
                    <td className="py-3 px-4"><Skeleton width="60px" height="20px" /></td>
                    <td className="py-3 px-4"><Skeleton width="80px" height="20px" /></td>
                    <td className="py-3 px-4"><Skeleton width="60px" height="20px" /></td>
                    <td className="py-3 px-4"><Skeleton width="100px" height="20px" /></td>
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
        description={t('units.empty')}
        cta={{
          text: t('units.createFirst'),
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
                  <th className="text-left py-3 px-4 font-medium">m²</th>
                  <th className="text-left py-3 px-4 font-medium">Categoría</th>
                  <th className="text-left py-3 px-4 font-medium">Tipo</th>
                  <th className="text-left py-3 px-4 font-medium">Estado</th>
                  <th className="text-left py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.id} className="border-b hover:bg-muted/50 transition">
                    <td className="py-3 px-4 font-medium">{unit.unitCode || 'N/A'}</td>
                    <td className="py-3 px-4">{unit.label || '-'}</td>
                    <td className="py-3 px-4 text-right">{unit.m2 ? `${unit.m2} m²` : '-'}</td>
                    <td className="py-3 px-4">
                      <select
                        value={unit.unitCategory?.id || ''}
                        onChange={(e) => handleCategoryChange(unit.id, e.target.value)}
                        className="px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Sin categoría</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs px-2 py-1 rounded font-medium ${
                          unit.unitType === 'APARTMENT'
                            ? 'bg-blue-100 text-blue-800'
                            : unit.unitType === 'HOUSE'
                              ? 'bg-green-100 text-green-800'
                              : unit.unitType === 'OFFICE'
                                ? 'bg-purple-100 text-purple-800'
                                : unit.unitType === 'STORAGE'
                                  ? 'bg-gray-200 text-gray-700'
                                  : unit.unitType === 'PARKING'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {unit.unitType === 'APARTMENT' && 'Apartamento'}
                        {unit.unitType === 'HOUSE' && 'Casa'}
                        {unit.unitType === 'OFFICE' && 'Oficina'}
                        {unit.unitType === 'STORAGE' && 'Depósito'}
                        {unit.unitType === 'PARKING' && 'Estacionamiento'}
                        {unit.unitType === 'OTHER' && 'Otro'}
                        {!unit.unitType && '—'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs px-2 py-1 rounded font-medium ${
                          unit.occupancyStatus === 'OCCUPIED'
                            ? 'bg-green-100 text-green-800'
                            : unit.occupancyStatus === 'VACANT'
                              ? 'bg-orange-100 text-orange-800'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {unit.occupancyStatus === 'OCCUPIED' && 'Ocupado'}
                        {unit.occupancyStatus === 'VACANT' && 'Vacío'}
                        {unit.occupancyStatus === 'UNKNOWN' && 'Desconocido'}
                        {!unit.occupancyStatus && '—'}
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
        title={t('units.delete')}
        description={t('units.confirmDelete')}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm({ isOpen: false, unitId: null })}
        isLoading={isDeleting}
      />

      {/* Category Change Dialog */}
      {categoryChangeDialog.unitId && (
        <CategoryChangeDialog
          isOpen={categoryChangeDialog.isOpen}
          unitLabel={units.find((u) => u.id === categoryChangeDialog.unitId)?.label || ''}
          currentCategory={units.find((u) => u.id === categoryChangeDialog.unitId)?.unitCategory?.name}
          newCategory={categoryChangeDialog.newCategoryName || ''}
          currentM2={units.find((u) => u.id === categoryChangeDialog.unitId)?.m2}
          newM2={categoryChangeDialog.newM2}
          onConfirm={handleCategoryChangeConfirm}
          onCancel={() => setCategoryChangeDialog({ isOpen: false, unitId: null, newCategoryId: null })}
          isLoading={isCategoryChanging}
        />
      )}
      </div>
    </ErrorBoundary>
  );
};

export default UnitsPage;
