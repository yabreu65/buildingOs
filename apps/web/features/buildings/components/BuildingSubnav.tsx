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
export function BuildingSubnav({ tenantId, buildingId }: BuildingSubnavProps) {
  const pathname = usePathname();

  const items: NavItem[] = [
    {
      label: 'Overview',
      href: `/${tenantId}/buildings/${buildingId}`,
    },
    {
      label: 'Units',
      href: `/${tenantId}/buildings/${buildingId}/units`,
    },
    {
      label: 'Residents',
      href: `/${tenantId}/buildings/${buildingId}/residents`,
    },
    {
      label: 'Tickets',
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
      label: 'Payments',
      href: `/${tenantId}/buildings/${buildingId}/payments`,
    },
    {
      label: 'Reportes',
      href: `/${tenantId}/buildings/${buildingId}/reports`,
    },
    {
      label: 'Settings',
      href: `/${tenantId}/buildings/${buildingId}/settings`,
    },
  ];

  return (
    <div className="border-b mb-6">
      <nav className="flex gap-1">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'px-4 py-2 border-b-2 transition -mb-px',
                isActive
                  ? 'border-primary text-foreground'
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
