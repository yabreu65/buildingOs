'use client';

import { Table, THead, TR, TH, TBody, TD } from '@/shared/components/ui/Table';
import Badge from '@/shared/components/ui/Badge';
import TenantActions from './TenantActions';
import { getStatusBadgeClass } from '../super-admin.utils';
import type { Tenant } from '../super-admin.types';

interface TenantTableProps {
  tenants: Tenant[];
  onToggleSuspend: (tenant: Tenant) => void;
  isLoading?: boolean;
}

export default function TenantTable({
  tenants,
  onToggleSuspend,
  isLoading = false,
}: TenantTableProps) {
  if (tenants.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Sin tenants registrados
      </div>
    );
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>Nombre</TH>
          <TH>Tipo</TH>
          <TH>Estado</TH>
          <TH>Plan</TH>
          <TH>Edificios</TH>
          <TH>Usuarios</TH>
          <TH>Creado</TH>
          <TH>Acciones</TH>
        </TR>
      </THead>
      <TBody>
        {tenants.map((tenant) => (
          <TR key={tenant.id}>
            <TD className="font-medium">{tenant.name}</TD>
            <TD className="text-sm">
              {tenant.type === 'ADMINISTRADORA' ? 'ADM' : 'EDIF'}
            </TD>
            <TD>
              <Badge className={getStatusBadgeClass(tenant.status)}>
                {tenant.status}
              </Badge>
            </TD>
            <TD className="text-sm">{tenant.plan}</TD>
            <TD className="text-sm">0</TD>
            <TD className="text-sm">0</TD>
            <TD className="text-sm">{tenant.createdAt.split('T')[0]}</TD>
            <TD>
              <TenantActions
                tenant={tenant}
                onToggleSuspend={onToggleSuspend}
                isLoading={isLoading}
              />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
