'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import ErrorState from '@/shared/components/ui/ErrorState';
import EmptyState from '@/shared/components/ui/EmptyState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { routes } from '@/shared/lib/routes';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { useBuildings } from '@/features/buildings/hooks';
import { useUnits } from '@/features/buildings/hooks/useUnits';
import { useToast } from '@/shared/components/ui/Toast';
import { Home, Grid3x3, Plus, Settings, Users, Ticket, CreditCard } from 'lucide-react';

type BuildingParams = {
  tenantId: string;
  buildingId: string;
};

/**
 * BuildingHubPage: Central operations hub for a building
 */
export default function BuildingHubPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;
  const router = useRouter();

  const { buildings, loading: buildingsLoading, error: buildingsError, refetch: refetchBuildings } = useBuildings(tenantId);
  const { units, loading: unitsLoading, error: unitsError, refetch: refetchUnits } = useUnits(tenantId, buildingId);

  const [pendingPayments, setPendingPayments] = useState(0);
  const [totalPayments, setTotalPayments] = useState(0);

  const building = buildings.find((b) => b.id === buildingId);

  // Load payment data from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined' && tenantId) {
      try {
        const raw = localStorage.getItem(`bo_payments_${tenantId}`);
        const payments = raw ? JSON.parse(raw) : [];
        const pending = payments.filter((p: any) => p.status === 'PENDING').length;
        setPendingPayments(pending);
        setTotalPayments(payments.length);
      } catch (err) {
        // Silently ignore localStorage errors
      }
    }
  }, [tenantId]);

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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <div className="h-20 animate-pulse bg-muted rounded" />
            </Card>
          ))}
        </div>
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

  const occupiedUnits = units.filter((u) => u.occupancyStatus === 'OCCUPIED').length;
  const vacantUnits = units.filter((u) => u.occupancyStatus === 'VACANT').length;
  const totalUnits = units.length;
  const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName={building.name}
        buildingId={buildingId}
      />

      {/* Header with quick actions */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">{building.name}</h1>
          {building.address && (
            <p className="text-muted-foreground mt-1">{building.address}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => router.push(routes.buildingUnits(tenantId, buildingId))}
            variant="secondary"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Unit
          </Button>
          <Button
            onClick={() => router.push(routes.buildingSettings(tenantId, buildingId))}
            variant="secondary"
            size="sm"
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      {/* Units Error State */}
      {unitsError && (
        <ErrorState
          message={unitsError}
          onRetry={() => refetchUnits()}
        />
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="pb-3">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Grid3x3 className="w-4 h-4" />
              Total Units
            </p>
          </div>
          <div className="text-2xl font-bold">
            {unitsLoading ? (
              <Skeleton width="48px" height="32px" />
            ) : (
              totalUnits
            )}
          </div>
        </Card>

        <Card>
          <div className="pb-3">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Home className="w-4 h-4" />
              Occupied
            </p>
          </div>
          <div className="text-2xl font-bold text-green-600">
            {unitsLoading ? (
              <Skeleton width="48px" height="32px" />
            ) : (
              occupiedUnits
            )}
          </div>
        </Card>

        <Card>
          <div className="pb-3">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Home className="w-4 h-4" />
              Vacant
            </p>
          </div>
          <div className="text-2xl font-bold text-orange-600">
            {unitsLoading ? (
              <Skeleton width="48px" height="32px" />
            ) : (
              vacantUnits
            )}
          </div>
        </Card>

        <Card>
          <div className="pb-3">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Grid3x3 className="w-4 h-4" />
              Occupancy Rate
            </p>
          </div>
          <div className="text-2xl font-bold text-blue-600">
            {unitsLoading ? (
              <Skeleton width="48px" height="32px" />
            ) : (
              `${occupancyRate}%`
            )}
          </div>
        </Card>
      </div>

      {/* Section Cards - Quick Navigation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Units Card */}
        <div
          className="cursor-pointer"
          onClick={() => router.push(routes.buildingUnits(tenantId, buildingId))}
        >
          <Card className="hover:border-primary transition h-full">
            <div className="flex items-start justify-between mb-3">
              <Grid3x3 className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Units</h3>
            <p className="text-sm text-muted-foreground">
              {unitsLoading ? 'Loading...' : `${totalUnits} units · Manage`}
            </p>
          </Card>
        </div>

        {/* Residents Card - Coming Soon */}
        <div>
          <Card className="opacity-60 cursor-not-allowed h-full">
            <div className="flex items-start justify-between mb-3">
              <Users className="w-5 h-5 text-gray-400" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Residents</h3>
            <p className="text-sm text-muted-foreground">Coming soon</p>
          </Card>
        </div>

        {/* Payments Card */}
        <div
          className={totalPayments > 0 ? 'cursor-pointer' : ''}
          onClick={() => {
            if (totalPayments > 0) {
              router.push(routes.buildingPayments(tenantId, buildingId));
            }
          }}
        >
          <Card className={totalPayments > 0 ? 'hover:border-primary transition h-full' : 'h-full'}>
            <div className="flex items-start justify-between mb-3">
              <CreditCard className={totalPayments > 0 ? 'w-5 h-5 text-orange-600' : 'w-5 h-5 text-gray-400'} />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Payments</h3>
            <p className="text-sm text-muted-foreground">
              {totalPayments === 0
                ? 'No payment records yet'
                : pendingPayments > 0
                ? `${pendingPayments} pending`
                : 'All paid'}
            </p>
          </Card>
        </div>

        {/* Tickets Card - Coming Soon */}
        <div>
          <Card className="opacity-60 cursor-not-allowed h-full">
            <div className="flex items-start justify-between mb-3">
              <Ticket className="w-5 h-5 text-gray-400" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Tickets</h3>
            <p className="text-sm text-muted-foreground">Coming soon</p>
          </Card>
        </div>
      </div>

      {/* Recent Units Table */}
      {!unitsLoading && units.length > 0 && (
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-semibold">Recent Units</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Label</th>
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Code</th>
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Type</th>
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Status</th>
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {units.slice(0, 5).map((unit) => (
                  <tr key={unit.id} className="border-b hover:bg-muted/50 transition">
                    <td className="py-3 px-4">{unit.label}</td>
                    <td className="py-3 px-4 text-muted-foreground">{unit.unitCode || '—'}</td>
                    <td className="py-3 px-4">{unit.unitType}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full ${
                          unit.occupancyStatus === 'OCCUPIED'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}
                      >
                        {unit.occupancyStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          router.push(routes.buildingUnits(tenantId, buildingId))
                        }
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!unitsLoading && units.length === 0 && (
        <EmptyState
          icon={<Grid3x3 className="w-12 h-12 text-muted-foreground" />}
          title="No Units Yet"
          description="Start by adding your first unit to this building."
          cta={{
            text: 'Add Unit',
            onClick: () => router.push(routes.buildingUnits(tenantId, buildingId)),
          }}
        />
      )}
    </div>
  );
}
