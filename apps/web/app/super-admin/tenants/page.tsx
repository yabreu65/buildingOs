'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/shared/components/ui/Button';
import Badge from '@/shared/components/ui/Badge';
import { deleteTenant, listTenants } from '@/features/super-admin/tenants.api';
import TenantActions from '@/features/super-admin/components/TenantActions';
import type { TenantFromAPI } from '@/features/super-admin/tenants.api';
import type { Tenant } from '@/features/super-admin/super-admin.types';
import {
  getTenantDemoBadgeClass,
  getTenantDemoLabel,
} from '@/features/super-admin/super-admin.utils';

export default function TenantsPage() {
  const [tenants, setTenants] = useState<TenantFromAPI[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const searchId = 'super-admin-tenants-search';

  useEffect(() => {
    const loadTenants = async () => {
      try {
        setLoading(true);
        const response = await listTenants();
        setTenants(response.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load tenants';
        setFeedback({ type: 'error', message });
      } finally {
        setLoading(false);
      }
    };
    loadTenants();
  }, []);

  const handleToggleSuspend = (tenant: Tenant) => {
    // TODO: Implement suspend/activate functionality
    console.log('Toggle suspend for tenant:', tenant.id);
  };

  const handleDeleteDemo = async (tenant: Tenant) => {
    await deleteTenant(tenant.id);
    const response = await listTenants();
    setTenants(response.data);
    setFeedback({ type: 'success', message: `Tenant de prueba "${tenant.name}" eliminado` });
  };

  const filteredTenants = tenants.filter((tenant) => {
    return tenant.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Administradoras</h1>
          <p className="text-muted-foreground">Gestión de cuentas cliente y su estado operativo</p>
        </div>
        <Link href="/super-admin/tenants/create">
          <Button>+ Crear administradora</Button>
        </Link>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`px-4 py-3 rounded-md text-sm ${
            feedback.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Cargando administradoras...</p>
        </div>
      )}

      {/* Filters */}
      {!loading && (
        <div className="flex gap-4">
          <div className="flex-1 space-y-2">
            <label htmlFor={searchId} className="block text-sm font-medium text-foreground">
              Buscar administradora
            </label>
            <input
              id={searchId}
              type="text"
              placeholder="Buscar por nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-4 py-2 border border-input rounded-md flex-1 text-sm w-full"
            />
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && tenants.length === 0 && (
        <div className="text-center py-12 border border-dashed rounded-md">
          <p className="text-muted-foreground mb-4">No hay administradoras cargadas</p>
          <Link href="/super-admin/tenants/create">
            <Button>Crear primera administradora</Button>
          </Link>
        </div>
      )}

      {!loading && tenants.length > 0 && filteredTenants.length === 0 && (
        <div className="text-center py-12 border border-dashed rounded-md">
          <p className="text-muted-foreground mb-2">No encontramos administradoras con ese filtro</p>
          <Button variant="secondary" onClick={() => setSearchTerm('')}>
            Limpiar búsqueda
          </Button>
        </div>
      )}

      {/* Table */}
      {!loading && filteredTenants.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold">Nombre</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Tipo</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Entorno</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Estado</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Plan</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Creado</th>
                <th className="px-6 py-3 text-right text-sm font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredTenants.map((tenant) => {
                // Derive status from subscription if available
                const status = tenant.status || (tenant.subscription?.[0]?.status) || 'TRIAL';
                const planId = tenant.subscription?.[0]?.plan?.planId || 'BASIC';

                // Convert to Tenant type for TenantActions component
                const tenantForActions: Tenant = {
                  id: tenant.id,
                  name: tenant.name,
                  type: tenant.type,
                  isDemo: tenant.isDemo,
                  status: status as 'TRIAL' | 'ACTIVE' | 'SUSPENDED',
                  plan: planId as 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE',
                  createdAt: tenant.createdAt,
                };

                return (
                  <tr key={tenant.id} className="hover:bg-muted/50">
                    <td className="px-6 py-4 text-sm font-medium">{tenant.name}</td>
                    <td className="px-6 py-4 text-sm">
                      {tenant.type === 'ADMINISTRADORA' ? 'Administradora' : 'Edificio'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <Badge className={getTenantDemoBadgeClass(tenant.isDemo)}>
                        {getTenantDemoLabel(tenant.isDemo)}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <Badge className={`${
                        status === 'TRIAL' ? 'bg-blue-100 text-blue-800' :
                        status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {status === 'TRIAL' ? 'Prueba' : status === 'ACTIVE' ? 'Activa' : 'Suspendida'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-sm">{planId}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {new Date(tenant.createdAt).toLocaleDateString('es-AR')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex gap-2 justify-end">
                        <Link href={`/super-admin/tenants/${tenant.id}`}>
                          <Button size="sm" variant="secondary">
                            Ver
                          </Button>
                        </Link>
                        <TenantActions
                          tenant={tenantForActions}
                          onToggleSuspend={handleToggleSuspend}
                          onDeleteDemo={handleDeleteDemo}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
