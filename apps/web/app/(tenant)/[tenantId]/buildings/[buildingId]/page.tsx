'use client';

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
import { PaymentStatus } from '@/features/finance/services/finance.api';
import { useBuildingPayments } from '@/features/payments/hooks/useBuildingPayments';

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
  const {
    data: payments = [],
    isLoading: paymentsLoading,
    error: paymentsError,
  } = useBuildingPayments(buildingId);

  const building = buildings.find((b) => b.id === buildingId);
  const totalPayments = payments.length;
  const pendingPayments = payments.filter((payment) => payment.status === PaymentStatus.SUBMITTED).length;

  if (!tenantId || !buildingId) {
    return <div>Parámetros inválidos</div>;
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
            Agregar unidad
          </Button>
          <Button
            onClick={() => router.push(routes.buildingSettings(tenantId, buildingId))}
            variant="secondary"
            size="sm"
          >
            <Settings className="w-4 h-4 mr-2" />
            Configuración
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
              Total de unidades
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
              Ocupadas
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
              Vacantes
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
              Tasa de ocupación
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
              {unitsLoading ? t('common.loading') : `${totalUnits} ${t('navigation.units')} · Administrar`}
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
          className={!paymentsLoading && totalPayments > 0 ? 'cursor-pointer' : ''}
          onClick={() => {
            if (!paymentsLoading && totalPayments > 0) {
              router.push(routes.buildingPayments(tenantId, buildingId));
            }
          }}
        >
          <Card className={!paymentsLoading && totalPayments > 0 ? 'hover:border-primary transition h-full' : 'h-full'}>
            <div className="flex items-start justify-between mb-3">
              <CreditCard className={!paymentsLoading && totalPayments > 0 ? 'w-5 h-5 text-orange-600' : 'w-5 h-5 text-gray-400'} />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Pagos</h3>
            <p className="text-sm text-muted-foreground">
              {paymentsLoading
                ? 'Cargando pagos...'
                : paymentsError
                ? 'No se pudieron cargar los pagos'
                : totalPayments === 0
                ? 'Sin pagos registrados'
                : pendingPayments > 0
                ? `${pendingPayments} pagos pendientes`
                : 'Todos los pagos están al día'}
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
            <p className="text-sm text-muted-foreground">Próximamente</p>
          </Card>
        </div>
      </div>

    </div>
  );
};

export default BuildingHubPage;
