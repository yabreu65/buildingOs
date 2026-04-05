'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import ErrorState from '@/shared/components/ui/ErrorState';
import EmptyState from '@/shared/components/ui/EmptyState';
import Skeleton from '@/shared/components/ui/Skeleton';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import { useToast } from '@/shared/components/ui/Toast';
import { handlePlanLimitError } from '@/features/billing/utils/handlePlanLimitError';
import { useBuildings } from '@/features/buildings/hooks';
import { useUnits } from '@/features/buildings/hooks/useUnits';
import { useOccupants } from '@/features/buildings/hooks/useOccupants';
import { useAuth } from '@/features/auth/useAuth';
import { routes } from '@/shared/lib/routes';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { UnitTicketsList } from '@/features/tickets';
import { InboxList } from '@/features/communications';
import { t } from '@/i18n';
import { DocumentList } from '@/features/buildings/components/documents';
import { useDocumentsUnit } from '@/features/buildings/hooks/useDocumentsUnit';
import { UnitFinanceTab } from '@/features/finance/components/UnitFinanceTab';
import { useUnitLedger } from '@/features/finance/hooks/useUnitLedger';
import { formatCurrency } from '@/shared/lib/format/money';
import { Users, Mail, Phone, User, Trash2, Plus, Lock, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Unit } from '@/features/units/units.types';
import { ErrorBoundary } from '@/shared/components/error-boundary';
import { AssignResidentModal } from './AssignResidentModal';

interface UnitParams {
  tenantId: string;
  buildingId: string;
  unitId: string;
  [key: string]: string | string[];
}

/**
 * UnitDashboard: View unit details and manage occupants
 * - Admins: can assign/remove occupants for any unit
 * - Residents: can view their own unit info
 */
const UnitDashboardPage = () => {
  const params = useParams<UnitParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;
  const unitId = params?.unitId;
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAuth();

  const { buildings, loading: buildingsLoading, error: buildingsError } = useBuildings(tenantId);
  const { units, loading: unitsLoading, error: unitsError } = useUnits(tenantId, buildingId);
  const { occupants, loading: occupantsLoading, error: occupantsError, remove: removeOccupant, refetch: refetchOccupants } = useOccupants(
    tenantId,
    buildingId,
    unitId
  );

  const { documents, loading: documentsLoading, error: documentsError, fetch: refetchDocuments } = useDocumentsUnit({
    tenantId,
    buildingId,
    unitId,
  });

  const { data: ledger, isLoading: ledgerLoading } = useUnitLedger(buildingId, unitId);

  const [showDeleteDialog, setShowDeleteDialog] = useState<{ isOpen: boolean; occupantId: string | null }>({
    isOpen: false,
    occupantId: null,
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'finance' | 'tickets' | 'messages' | 'documents'>('overview');
  const [showAssignModal, setShowAssignModal] = useState(false);

  const unit = units.find((u) => u.id === unitId);
  const building = buildings.find((b) => b.id === buildingId);

  // Check if current user is admin (can manage any unit)
  const isAdmin = currentUser?.roles?.some((r) => ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].includes(r));

  // Check if current user is occupant of this unit
  const isOccupantOfUnit = occupants.some((o) => o.user?.id === currentUser?.id);

  // Access control: residents can only see their own unit
  const hasAccess = isAdmin || isOccupantOfUnit;

  if (!tenantId || !buildingId || !unitId) {
    return <div>Invalid parameters</div>;
  }

  if (buildingsError || unitsError) {
    return (
      <ErrorState
        message={buildingsError || unitsError || t('common.error')}
        onRetry={() => {}}
      />
    );
  }

  if (buildingsLoading || unitsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton width="300px" height="32px" />
        <Card>
          <div className="h-40 animate-pulse bg-muted rounded" />
        </Card>
      </div>
    );
  }

  if (!unit) {
    return (
      <ErrorState
        message={t('units.notFound')}
        onRetry={() => router.back()}
      />
    );
  }

  if (!hasAccess) {
    return (
      <div className="space-y-6">
        <BuildingBreadcrumb tenantId={tenantId} buildingName={unit.label} buildingId={buildingId} />
        <EmptyState
          icon={<Lock className="w-12 h-12 text-muted-foreground" />}
          title={t('common.accessDenied')}
          description={t('units.accessDenied')}
          cta={{
            text: t('common.goBack'),
            onClick: () => router.back(),
          }}
        />
      </div>
    );
  }

  const handleRemoveOccupant = async () => {
    if (!showDeleteDialog.occupantId) return;

    setIsDeleting(true);
    try {
      await removeOccupant(showDeleteDialog.occupantId);
      toast(t('units.residentRemoved'), 'success');
      setShowDeleteDialog({ isOpen: false, occupantId: null });
      await refetchOccupants();
    } catch (err) {
      // Check if it's a plan limit error first
      if (!handlePlanLimitError(err, (msg, type = 'error', duration = 3000) => {
        toast(msg, type, duration);
      })) {
        // If not a plan limit error, handle as normal error
        const message = err instanceof Error ? err.message : t('units.removeOccupantError');
        toast(message, 'error');
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ErrorBoundary level="page">
      <div className="space-y-6">
        {/* Breadcrumb */}
      <BuildingBreadcrumb tenantId={tenantId} buildingName={unit.label} buildingId={buildingId} />

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">{unit.label}</h1>
        {unit.unitCode && <p className="text-muted-foreground mt-1">Code: {unit.unitCode}</p>}
      </div>

      {/* Unit Details Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Unit Information</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {unit.unitCode && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Code</p>
                <p className="text-lg">{unit.unitCode}</p>
              </div>
            )}
            {unit.unitType && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Type</p>
                <p className="text-lg">{unit.unitType}</p>
              </div>
            )}
            {unit.occupancyStatus && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <div>
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      unit.occupancyStatus === 'OCCUPIED'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-orange-100 text-orange-700'
                    }`}
                  >
                    {unit.occupancyStatus}
                  </span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Financial Status Card */}
        <Card>
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Estado Financiero</h2>
          </div>
          {ledgerLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : ledger && ledger.totals.totalCharges > 0 ? (
            <div className="space-y-3">
              <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-orange-600" />
                  <div>
                    <p className="text-xs text-muted-foreground">Deuda Total</p>
                    <p className="text-2xl font-bold text-orange-600">
                      {formatCurrency(ledger.totals.totalCharges, ledger.totals.currency || 'USD')}
                    </p>
                  </div>
                </div>
              </div>
              {(ledger.totals.totalPaid ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Pagado: {formatCurrency(ledger.totals.totalPaid ?? 0, ledger.totals.currency || 'USD')}
                </p>
              )}
            </div>
          ) : (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <div>
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <p className="font-semibold text-green-700">Al día</p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Occupants Section */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Occupants</h2>
          {isAdmin && (
            <Button
              onClick={() => setShowAssignModal(true)}
              variant="secondary"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              Assign Resident
            </Button>
          )}
        </div>

        {occupantsError && (
          <ErrorState message={occupantsError} onRetry={() => refetchOccupants()} />
        )}

        {occupantsLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} width="100%" height="80px" />
            ))}
          </div>
        ) : occupants.length === 0 ? (
          <EmptyState
            icon={<Users className="w-12 h-12 text-muted-foreground" />}
            title="No Occupants"
            description={t('units.noOccupants')}
            cta={
              isAdmin
                ? {
                    text: t('units.assignResident'),
                    onClick: () => setShowAssignModal(true),
                  }
                : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {occupants.map((occupant) => (
              <div key={occupant.id} className="p-4 border rounded-lg hover:bg-muted/50 transition">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <p className="font-semibold">{occupant.user?.fullName || t('common.unknown')}</p>
                      <span className="text-xs font-medium px-2 py-1 rounded bg-blue-100 text-blue-700">
                        {occupant.role}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {occupant.user?.email && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Mail className="w-4 h-4" />
                          <a href={`mailto:${occupant.user.email}`} className="hover:text-foreground">
                            {occupant.user.email}
                          </a>
                        </div>
                      )}
                      {occupant.user?.phone && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Phone className="w-4 h-4" />
                          <a href={`tel:${occupant.user.phone}`} className="hover:text-foreground">
                            {occupant.user.phone}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowDeleteDialog({ isOpen: true, occupantId: occupant.id })}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>


      {/* Tabs for Tickets, Messages, Documents */}
      <Card>
        <div className="border-b mb-4">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 font-medium border-b-2 transition ${
                activeTab === 'overview'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('finance')}
              className={`px-4 py-2 font-medium border-b-2 transition ${
                activeTab === 'finance'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Finanzas
            </button>
            <button
              onClick={() => setActiveTab('tickets')}
              className={`px-4 py-2 font-medium border-b-2 transition ${
                activeTab === 'tickets'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Tickets
            </button>
            <button
              onClick={() => setActiveTab('messages')}
              className={`px-4 py-2 font-medium border-b-2 transition ${
                activeTab === 'messages'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Comunicados
            </button>
            <button
              onClick={() => setActiveTab('documents')}
              className={`px-4 py-2 font-medium border-b-2 transition ${
                activeTab === 'documents'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Documentos
            </button>
          </div>
        </div>

        {/* Finance Tab */}
        {activeTab === 'finance' && (
          <UnitFinanceTab buildingId={buildingId} unitId={unitId} buildingName={building?.name} unitLabel={unit?.label} />
        )}

        {/* Tickets Tab */}
        {activeTab === 'tickets' && (
          <div>
            <UnitTicketsList buildingId={buildingId} unitId={unitId} />
          </div>
        )}

        {/* Messages Tab */}
        {activeTab === 'messages' && (
          <div>
            <InboxList buildingId={buildingId} />
          </div>
        )}

        {/* Documents Tab */}
        {activeTab === 'documents' && (
          <div>
            <DocumentList
              documents={documents}
              loading={documentsLoading}
              error={documentsError}
              tenantId={tenantId}
              onRetry={refetchDocuments}
              readOnly={true}
            />
          </div>
        )}
      </Card>

      {/* Assign Resident Modal */}
      {showAssignModal && (
        <AssignResidentModal
          tenantId={tenantId}
          buildingId={buildingId}
          unitId={unitId}
          onClose={() => setShowAssignModal(false)}
          onSuccess={() => {
            setShowAssignModal(false);
            refetchOccupants();
            toast('Resident assigned successfully', 'success');
          }}
        />
      )}

      {/* Delete Occupant Dialog */}
      <DeleteConfirmDialog
        isOpen={showDeleteDialog.isOpen}
        title="Remove Occupant"
        description="This occupant will be unassigned from this unit. This action cannot be undone."
        onConfirm={handleRemoveOccupant}
        onCancel={() => setShowDeleteDialog({ isOpen: false, occupantId: null })}
        isLoading={isDeleting}
      />
      </div>
    </ErrorBoundary>
  );
};

export default UnitDashboardPage;
