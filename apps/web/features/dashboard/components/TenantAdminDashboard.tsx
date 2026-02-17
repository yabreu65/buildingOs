'use client';

import { useTenantStats } from '@/features/tenancy/hooks/useTenantStats';
import { useTenantBilling } from '@/features/tenancy/hooks/useTenantBilling';
import { useBuildings } from '@/features/buildings/hooks/useBuildings';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import ErrorState from '@/shared/components/ui/ErrorState';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Link } from 'lucide-react';

interface TenantAdminDashboardProps {
  tenantId: string;
  role: 'TENANT_OWNER' | 'TENANT_ADMIN';
  onViewAuditLogs?: () => void;
}

export default function TenantAdminDashboard({
  tenantId,
  role,
  onViewAuditLogs,
}: TenantAdminDashboardProps) {
  const { stats, loading: statsLoading, error: statsError, refetch: refetchStats } = useTenantStats(tenantId);
  const { billing, loading: billingLoading, error: billingError, refetch: refetchBilling } = useTenantBilling(tenantId);
  const { buildings, loading: buildingsLoading, error: buildingsError } = useBuildings(tenantId);

  if (statsLoading && !stats) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="h-20">
              <Skeleton className="h-full" />
            </Card>
          ))}
        </div>
        <Card>
          <Skeleton className="h-40" />
        </Card>
      </div>
    );
  }

  if (statsError) {
    return <ErrorState message={statsError} onRetry={refetchStats} />;
  }

  const occupancyRate = stats
    ? Math.round(
        ((stats.occupiedUnits / (stats.totalUnits || 1)) * 100)
      )
    : 0;

  return (
    <div className="space-y-8">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="text-sm text-muted-foreground">Total Buildings</div>
          <div className="text-2xl font-semibold text-foreground">
            {stats?.totalBuildings ?? 0}
          </div>
        </Card>

        <Card>
          <div className="text-sm text-muted-foreground">Total Units</div>
          <div className="text-2xl font-semibold text-foreground">
            {stats?.totalUnits ?? 0}
          </div>
        </Card>

        <Card>
          <div className="text-sm text-muted-foreground">Occupied Units</div>
          <div className="text-2xl font-semibold text-green-600">
            {stats?.occupiedUnits ?? 0}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {occupancyRate}% occupancy
          </div>
        </Card>

        <Card>
          <div className="text-sm text-muted-foreground">Total Residents</div>
          <div className="text-2xl font-semibold text-blue-600">
            {stats?.totalResidents ?? 0}
          </div>
        </Card>
      </div>

      {/* Billing Plan Card */}
      {billingLoading && !billing ? (
        <Card>
          <Skeleton className="h-32" />
        </Card>
      ) : billingError ? (
        <ErrorState message={billingError} onRetry={refetchBilling} />
      ) : billing ? (
        <Card>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {billing.plan.name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Status: {billing.subscription.status}
                </p>
              </div>
              <Badge className={billing.subscription.status === 'ACTIVE' ? 'bg-green-100 text-green-800 border-green-300' : 'bg-muted text-muted-foreground border-border'}>
                {billing.subscription.status}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t">
              <div>
                <div className="text-xs text-muted-foreground">Max Buildings</div>
                <div className="text-sm font-semibold">
                  {billing.usage.buildings} / {billing.plan.maxBuildings}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Max Units</div>
                <div className="text-sm font-semibold">
                  {billing.usage.units} / {billing.plan.maxUnits}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Max Residents</div>
                <div className="text-sm font-semibold">
                  {billing.usage.residents} / {billing.plan.maxOccupants}
                </div>
              </div>
            </div>

            {billing.subscription.trialEndDate && (
              <p className="text-xs text-amber-600 pt-2">
                Trial ends: {new Date(billing.subscription.trialEndDate).toLocaleDateString()}
              </p>
            )}
          </div>
        </Card>
      ) : null}

      {/* Recent Buildings */}
      <Card>
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Recent Buildings
        </h3>

        {buildingsLoading && !buildings.length ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : buildingsError ? (
          <ErrorState message={buildingsError} onRetry={() => {}} />
        ) : buildings.length === 0 ? (
          <EmptyState
            icon={<Link className="w-8 h-8 text-muted-foreground" />}
            title="No Buildings Yet"
            description="Create your first building to get started"
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Building Name</TH>
                <TH>Address</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {buildings.slice(0, 5).map((building) => (
                <TR key={building.id}>
                  <TD className="font-medium">{building.name}</TD>
                  <TD className="text-muted-foreground">
                    {building.address || '-'}
                  </TD>
                  <TD className="text-sm text-muted-foreground">
                    {building.createdAt ? new Date(building.createdAt).toLocaleDateString() : '-'}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Audit Logs - Only for TENANT_ADMIN */}
      {role === 'TENANT_ADMIN' && onViewAuditLogs && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">
              Recent Activity
            </h3>
            <button
              onClick={onViewAuditLogs}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View All →
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            View complete audit logs and system activity
          </p>
        </Card>
      )}
    </div>
  );
}
