'use client';

import { useTenantStats } from '@/features/tenancy/hooks/useTenantStats';
import { useBuildings } from '@/features/buildings/hooks/useBuildings';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import ErrorState from '@/shared/components/ui/ErrorState';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Building2 } from 'lucide-react';

interface OperatorDashboardProps {
  tenantId: string;
}

export default function OperatorDashboard({ tenantId }: OperatorDashboardProps) {
  const { stats, loading: statsLoading, error: statsError, refetch: refetchStats } = useTenantStats(tenantId);
  const { buildings, loading: buildingsLoading, error: buildingsError } = useBuildings(tenantId);

  if (statsLoading && !stats) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
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

  return (
    <div className="space-y-8">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="text-sm text-muted-foreground">Total Buildings</div>
          <div className="text-2xl font-semibold text-foreground">
            {stats?.totalBuildings ?? 0}
          </div>
        </Card>

        <Card>
          <div className="text-sm text-muted-foreground">Occupied Units</div>
          <div className="text-2xl font-semibold text-green-600">
            {stats?.occupiedUnits ?? 0}
          </div>
        </Card>

        <Card>
          <div className="text-sm text-muted-foreground">Vacant Units</div>
          <div className="text-2xl font-semibold text-orange-600">
            {stats?.vacantUnits ?? 0}
          </div>
        </Card>
      </div>

      {/* Buildings List with Unit Summary */}
      <Card>
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Buildings Overview
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
            icon={<Building2 className="w-8 h-8 text-muted-foreground" />}
            title="No Buildings"
            description="Contact your administrator to create buildings"
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Building Name</TH>
                <TH>Address</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {buildings.map((building) => (
                <TR key={building.id}>
                  <TD className="font-medium">{building.name}</TD>
                  <TD className="text-muted-foreground">
                    {building.address || '-'}
                  </TD>
                  <TD>
                    <Badge className="bg-green-100 text-green-800 border-green-300">Active</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Maintenance Note */}
      <Card className="bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <div className="w-1 h-1 rounded-full bg-blue-600 mt-2 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-blue-900">Maintenance Mode</h4>
            <p className="text-sm text-blue-700">
              As an Operator, you can view building and unit information. Contact your administrator to make changes.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
