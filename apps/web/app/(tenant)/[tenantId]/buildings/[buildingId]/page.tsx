'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import ErrorState from '@/shared/components/ui/ErrorState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { routes } from '@/shared/lib/routes';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { useBuildings } from '@/features/buildings/hooks';
import { useUnits } from '@/features/buildings/hooks/useUnits';
import { t } from '@/i18n';

import { Home, Grid3x3, Plus, Settings, Users, Ticket, CreditCard } from 'lucide-react';
import { StorageService } from '@/shared/lib/storage';
import type { Payment } from '@/features/payments/payments.types';

import BuildingOnboardingCard from '@/features/onboarding/BuildingOnboardingCard';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

/**
 * BuildingHubPage: Central operations hub for a building
 */
const BuildingHubPage = () => {
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
    if (tenantId) {
      try {
        const payments = StorageService.get<Payment[]>('payments', tenantId, []);
        const pending = payments.filter((p) => p.status === 'PENDING').length;
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
        message={t('buildings.notFound')}
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

      {/* Onboarding Card */}
      <BuildingOnboardingCard tenantId={tenantId} buildingId={buildingId} />

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
            <h3 className="font-semibold text-foreground mb-1">{t('navigation.units')}</h3>
            <p className="text-sm text-muted-foreground">
              {unitsLoading ? t('common.loading') : `${totalUnits} ${t('navigation.units')} · ${t('common.manage')}`}
            </p>
          </Card>
        </div>

        {/* Residents Card - Coming Soon */}
        <div>
          <Card className="opacity-60 cursor-not-allowed h-full">
            <div className="flex items-start justify-between mb-3">
              <Users className="w-5 h-5 text-gray-400" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">{t('navigation.residents')}</h3>
            <p className="text-sm text-muted-foreground">Próximamente</p>
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
            <h3 className="font-semibold text-foreground mb-1">{t('finance.payments')}</h3>
            <p className="text-sm text-muted-foreground">
              {totalPayments === 0
                ? t('finance.noPaymentRecords')
                : pendingPayments > 0
                ? `${pendingPayments} ${t('finance.pending')}`
                : t('finance.allPaid')}
            </p>
          </Card>
        </div>

        {/* Tickets Card - Coming Soon */}
        <div>
          <Card className="opacity-60 cursor-not-allowed h-full">
            <div className="flex items-start justify-between mb-3">
              <Ticket className="w-5 h-5 text-gray-400" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">{t('navigation.tickets')}</h3>
            <p className="text-sm text-muted-foreground">Coming soon</p>
          </Card>
        </div>
      </div>

    </div>
  );
};

export default BuildingHubPage;
