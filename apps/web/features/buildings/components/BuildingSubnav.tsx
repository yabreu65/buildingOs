'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/shared/lib/utils';

interface BuildingSubnavProps {
  tenantId: string;
  buildingId: string;
}

interface NavItem {
  label: string;
  href: string;
}

/**
 * BuildingSubnav: Tabs for building sections
 * Overview, Units, Residents, Tickets, Payments, Settings
 */
export const BuildingSubnav = ({ tenantId, buildingId }: BuildingSubnavProps) => {
  const pathname = usePathname();

  const items: NavItem[] = [
    {
      label: 'Resumen',
      href: `/${tenantId}/buildings/${buildingId}`,
    },
    {
      label: 'Unidades',
      href: `/${tenantId}/buildings/${buildingId}/units`,
    },
    {
      label: 'Residentes',
      href: `/${tenantId}/buildings/${buildingId}/residents`,
    },
    {
      label: 'Solicitudes',
      href: `/${tenantId}/buildings/${buildingId}/tickets`,
    },
    {
      label: 'Comunicados',
      href: `/${tenantId}/buildings/${buildingId}/communications`,
    },
    {
      label: 'Documentos',
      href: `/${tenantId}/buildings/${buildingId}/documents`,
    },
    {
      label: 'Proveedores',
      href: `/${tenantId}/buildings/${buildingId}/vendors`,
    },
    {
      label: 'Presupuestos',
      href: `/${tenantId}/buildings/${buildingId}/quotes`,
    },
    {
      label: 'Órdenes de Trabajo',
      href: `/${tenantId}/buildings/${buildingId}/work-orders`,
    },
    {
      label: 'Finanzas',
      href: `/${tenantId}/buildings/${buildingId}/finance`,
    },
    {
      label: 'Rubros',
      href: `/${tenantId}/buildings/${buildingId}/finance/categories`,
    },
    {
      label: 'Expensas',
      href: `/${tenantId}/buildings/${buildingId}/expense-allocation`,
    },
    {
      label: 'Automation QA',
      href: `/${tenantId}/buildings/${buildingId}/automation-qa`,
    },
    {
      label: 'Reportes',
      href: `/${tenantId}/buildings/${buildingId}/reports`,
    },
    {
      label: 'Configuración',
      href: `/${tenantId}/buildings/${buildingId}/settings`,
    },
  ];

  return (
    <div className="border-b mb-6 overflow-x-auto">
      <nav className="flex gap-1 min-w-max">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'px-3 py-2 border-b-2 transition -mb-px whitespace-nowrap text-sm',
                isActive
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
