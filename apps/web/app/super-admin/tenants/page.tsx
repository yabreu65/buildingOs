'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/shared/components/ui/Button';
import Badge from '@/shared/components/ui/Badge';
import { listTenants } from '@/features/super-admin/tenants.api';
import TenantActions from '@/features/super-admin/components/TenantActions';
import type { TenantFromAPI } from '@/features/super-admin/tenants.api';
import type { Tenant } from '@/features/super-admin/super-admin.types';

export default function TenantsPage() {
  const [tenants, setTenants] = useState<TenantFromAPI[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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

  const filteredTenants = tenants.filter((tenant) => {
    return tenant.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tenants</h1>
          <p className="text-muted-foreground">Gestión de clientes del SaaS</p>
        </div>
        <Link href="/super-admin/tenants/create">
          <Button>+ Crear Tenant</Button>
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
          <p className="text-muted-foreground">Cargando tenants...</p>
        </div>
      )}

      {/* Filters */}
      {!loading && (
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Buscar por nombre..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 border border-input rounded-md flex-1 text-sm"
          />
        </div>
      )}

      {/* Empty State */}
      {!loading && tenants.length === 0 && (
        <div className="text-center py-12 border border-dashed rounded-md">
          <p className="text-muted-foreground mb-4">No hay tenants</p>
          <Link href="/super-admin/tenants/create">
            <Button>Crear primer tenant</Button>
          </Link>
        </div>
      )}

      {/* Table */}
      {!loading && tenants.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold">Nombre</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Tipo</th>
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
                  status: status as 'TRIAL' | 'ACTIVE' | 'SUSPENDED',
                  plan: planId as 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE',
                  createdAt: tenant.createdAt,
                };

                return (
                  <tr key={tenant.id} className="hover:bg-muted/50">
                    <td className="px-6 py-4 text-sm font-medium">{tenant.name}</td>
                    <td className="px-6 py-4 text-sm">{tenant.type === 'ADMINISTRADORA' ? 'ADM' : 'EDIF'}</td>
                    <td className="px-6 py-4 text-sm">
                      <Badge className={`${
                        status === 'TRIAL' ? 'bg-blue-100 text-blue-800' :
                        status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {status}
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
