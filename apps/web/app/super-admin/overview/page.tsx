'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Button from '@/shared/components/ui/Button';
import { OverviewMetricWidget } from '@/features/super-admin/components/OverviewMetricWidget';
import { listTenants } from '@/features/super-admin/tenants.api';

export default function OverviewPage() {
  const [stats, setStats] = useState({
    totalTenants: null as number | null,
    activeTenants: 0,
    trialTenants: 0,
    suspendedTenants: null as number | null,
  });

  useEffect(() => {
    void listTenants({ take: 100 })
      .then((response) => {
        const count = (status: string) => response.data.filter((tenant) => tenant.subscription?.status === status).length;
        setStats({ totalTenants: response.total, activeTenants: count('ACTIVE'), trialTenants: count('TRIAL'), suspendedTenants: null });
      })
      .catch(() => setStats({ totalTenants: null, activeTenants: 0, trialTenants: 0, suspendedTenants: null }));
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
        <OverviewMetricWidget label="Total administradoras" value={stats.totalTenants ?? 'Dato no disponible'} />
        <OverviewMetricWidget
          label="Administradoras activas"
          value={stats.activeTenants ?? 'Dato no disponible'}
          color="green"
        />
        <OverviewMetricWidget label="En prueba" value={stats.trialTenants ?? 'Dato no disponible'} color="blue" />
        <OverviewMetricWidget label="Administradoras suspendidas" value={stats.suspendedTenants ?? 'Dato no disponible'} color="red" />
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
