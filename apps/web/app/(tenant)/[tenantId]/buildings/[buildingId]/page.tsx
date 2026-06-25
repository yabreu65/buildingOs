'use client';

import { useParams, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
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

interface SectionHeaderProps {
  title: string;
  description: string;
}

interface MetricCardProps {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  subtitle: string;
  valueClassName?: string;
}

interface ActionCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
}

function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function MetricCard({ icon, title, value, subtitle, valueClassName }: MetricCardProps) {
  return (
    <Card>
      <div className="pb-3">
        <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {title}
        </p>
      </div>
      <div className={`text-2xl font-bold ${valueClassName ?? ''}`.trim()}>
        {value}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
    </Card>
  );
}

function ActionCard({ icon, title, description, onClick, disabled = false }: ActionCardProps) {
  const interactive = Boolean(onClick) && !disabled;

  return (
    <div
      className={interactive ? 'cursor-pointer' : ''}
      onClick={interactive ? onClick : undefined}
    >
      <Card
        className={[
          'h-full',
          interactive ? 'hover:border-primary transition' : '',
          disabled ? 'opacity-60 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <div className="flex items-start justify-between mb-3">
          {icon}
        </div>
        <h3 className="font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </Card>
    </div>
  );
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

      <SectionHeader
        title="Resumen operativo"
        description="Todo lo que ves aquí corresponde al edificio actual. Cada tarjeta abre un módulo específico de gestión."
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          icon={<Grid3x3 className="w-4 h-4" />}
          title="Total de unidades"
          value={unitsLoading ? <Skeleton width="48px" height="32px" /> : totalUnits}
          subtitle="Cantidad total de unidades registradas en este edificio."
        />

        <MetricCard
          icon={<Home className="w-4 h-4" />}
          title="Ocupadas"
          value={unitsLoading ? <Skeleton width="48px" height="32px" /> : occupiedUnits}
          subtitle="Unidades que ya tienen ocupante asignado."
          valueClassName="text-green-600"
        />

        <MetricCard
          icon={<Home className="w-4 h-4" />}
          title="Vacantes"
          value={unitsLoading ? <Skeleton width="48px" height="32px" /> : vacantUnits}
          subtitle="Unidades disponibles para asignar."
          valueClassName="text-orange-600"
        />

        <MetricCard
          icon={<Grid3x3 className="w-4 h-4" />}
          title="Tasa de ocupación"
          value={unitsLoading ? <Skeleton width="48px" height="32px" /> : `${occupancyRate}%`}
          subtitle="Porcentaje de unidades ocupadas sobre el total."
          valueClassName="text-blue-600"
        />
      </div>

      <SectionHeader
        title="Accesos rápidos"
        description="Cada tarjeta abre un módulo distinto para administrar el edificio."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActionCard
          icon={<Grid3x3 className="w-5 h-5 text-blue-600" />}
          title='Unidades del edificio'
          description={
            unitsLoading
              ? 'Cargando unidades...'
              : `${totalUnits} unidades · Administrar ocupación, asignaciones y estados`
          }
          onClick={() => router.push(routes.buildingUnits(tenantId, buildingId))}
        />

        <ActionCard
          icon={<Users className="w-5 h-5 text-gray-400" />}
          title='Residentes del edificio'
          description="Próximamente: ver y gestionar residentes y contactos del edificio."
          disabled
        />

        <ActionCard
          icon={
            <CreditCard
              className={!paymentsLoading && totalPayments > 0 ? 'w-5 h-5 text-orange-600' : 'w-5 h-5 text-gray-400'}
            />
          }
          title="Pagos del edificio"
          description={
            paymentsLoading
              ? 'Cargando pagos registrados...'
              : paymentsError
              ? 'No se pudieron cargar los pagos'
              : totalPayments === 0
              ? 'Sin pagos registrados'
              : pendingPayments > 0
              ? `${pendingPayments} pagos pendientes de revisión`
              : 'Ver pagos cargados y su estado de revisión'
          }
          onClick={() => {
            if (!paymentsLoading && totalPayments > 0) {
              router.push(routes.buildingPayments(tenantId, buildingId));
            }
          }}
        />

        <ActionCard
          icon={<Ticket className="w-5 h-5 text-gray-400" />}
          title='Solicitudes operativas'
          description="Próximamente: ver pedidos, incidencias y casos operativos del edificio."
          disabled
        />
      </div>

    </div>
  );
};

export default BuildingHubPage;
