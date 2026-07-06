'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Button from '@/shared/components/ui/Button';
import { OverviewMetricWidget } from '@/features/super-admin/components/OverviewMetricWidget';
import { getGlobalStats, seedSuperAdminIfEmpty } from '@/features/super-admin/tenants.storage';
import { useBoStorageTick } from '@/shared/lib/storage/useBoStorage';
import type { GlobalStats } from '@/features/super-admin/super-admin.types';

export default function OverviewPage() {
  // Re-render cuando cambie localStorage
  useBoStorageTick();

  const [stats, setStats] = useState<GlobalStats>({
    totalTenants: 0,
    activeTenants: 0,
    trialTenants: 0,
    suspendedTenants: 0,
    totalBuildings: 0,
    totalUnits: 0,
    totalResidents: 0,
  });

  useEffect(() => {
    // Seed demo tenants if storage is empty.
    seedSuperAdminIfEmpty();

    // Load stats.
    const globalStats = getGlobalStats();
    setStats(globalStats);
  }, []);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Visión general</h1>
        <p className="text-muted-foreground">Panel interno de control de la plataforma</p>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link href="/super-admin/tenants/create">
          <Button>+ Crear administradora</Button>
        </Link>
        <Link href="/super-admin/tenants">
          <Button variant="secondary">Ver administradoras</Button>
        </Link>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <OverviewMetricWidget label="Total administradoras" value={stats.totalTenants} />
        <OverviewMetricWidget
          label="Administradoras activas"
          value={stats.activeTenants}
          color="green"
        />
        <OverviewMetricWidget label="En prueba" value={stats.trialTenants} color="blue" />
        <OverviewMetricWidget
          label="Administradoras suspendidas"
          value={stats.suspendedTenants}
          color="red"
        />
        <OverviewMetricWidget label="Total edificios" value={stats.totalBuildings} />
        <OverviewMetricWidget label="Total unidades" value={stats.totalUnits} />
      </div>

      {/* Info */}
      <div className="border border-border rounded-lg p-6 bg-muted/30">
        <p className="text-sm">
          Consola interna de BuildingOS para seguimiento de cuentas, uso y soporte.
        </p>
      </div>
    </div>
  );
}
