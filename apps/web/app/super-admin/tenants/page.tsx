'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/shared/components/ui/Button';
import TenantTable from '@/features/super-admin/components/TenantTable';
import { listTenants, updateTenant } from '@/features/super-admin/tenants.storage';
import { useBoStorageTick } from '@/shared/lib/storage/useBoStorage';
import type { Tenant } from '@/features/super-admin/super-admin.types';

export default function TenantsPage() {
  useBoStorageTick();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loaded = listTenants();
    setTenants(loaded);
  }, []);

  const filteredTenants = tenants.filter((tenant) => {
    const matchesSearch = tenant.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = !statusFilter || tenant.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleToggleSuspend = (tenant: Tenant) => {
    try {
      setIsLoading(true);
      const newStatus = tenant.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
      updateTenant(tenant.id, { status: newStatus });
      const updated = listTenants();
      setTenants(updated);
      setFeedback({ type: 'success', message: `Tenant ${newStatus === 'SUSPENDED' ? 'suspendido' : 'activado'}` });
      setTimeout(() => setFeedback(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error';
      setFeedback({ type: 'error', message });
    } finally {
      setIsLoading(false);
    }
  };

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

      {/* Filters */}
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Buscar por nombre..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-4 py-2 border border-input rounded-md flex-1 text-sm"
          disabled={isLoading}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-input rounded-md text-sm"
          disabled={isLoading}
        >
          <option value="">Todos los estados</option>
          <option value="ACTIVE">Activo</option>
          <option value="TRIAL">Trial</option>
          <option value="SUSPENDED">Suspendido</option>
        </select>
      </div>

      {/* Table */}
      <TenantTable
        tenants={filteredTenants}
        onToggleSuspend={handleToggleSuspend}
        isLoading={isLoading}
      />
    </div>
  );
}
