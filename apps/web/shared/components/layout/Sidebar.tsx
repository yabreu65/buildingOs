"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { routes } from "../../../shared/lib/routes";
import { useTenantId } from "../../../features/tenancy/tenant.hooks";
import { useCan } from "../../../features/rbac/rbac.hooks";
import { useIsSuperAdmin, useHasRole } from "../../../features/auth/useAuthSession";
import { useImpersonation } from "../../../features/impersonation/useImpersonation";
import { useTenants } from "../../../features/tenants/tenants.hooks";
import { t } from "@/i18n";

interface NavItemProps {
  href: string;
  label: string;
}

const NavItem = ({ href, label }: NavItemProps) => {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={[
        "px-3 py-2 rounded-md text-sm transition-colors",
        "hover:bg-muted",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-foreground",
      ].join(" ")}
    >
      {label}
    </Link>
  );
};

export const Sidebar = () => {
  const tenantId = useTenantId();
  const { data: tenants } = useTenants();
  const tenantName = tenants?.find(t => t.id === tenantId)?.name;
  const isSuperAdmin = useIsSuperAdmin();
  const isResident = useHasRole("RESIDENT");
  const { isImpersonating } = useImpersonation();

  if ((isSuperAdmin && !isImpersonating) || !tenantId) return null;

  return (
    <aside className="w-64 border-r border-border bg-card text-card-foreground">
      <div className="p-4">
        <div className="font-semibold text-base">BuildingOS</div>
        {tenantName && (
          <div className="mt-1 text-xs text-muted-foreground">
            {t('common.condominium')}: <span className="font-medium text-foreground">{tenantName}</span>
          </div>
        )}
      </div>

      <nav className="flex flex-col gap-1 px-2 pb-4">
        <NavItem href={routes.tenantDashboard(tenantId)} label={t('navigation.dashboard')} />

        {isResident ? (
          <>
            <NavItem href={`/${tenantId}/resident/payments`} label={t('navigation.payments')} />
            <NavItem href={`/${tenantId}/resident/announcements`} label={t('navigation.communications')} />
            <NavItem href={`/${tenantId}/resident/tickets`} label={t('navigation.tickets')} />
            <NavItem href={`/${tenantId}/resident/unit`} label={t('navigation.myUnit')} />
            <NavItem href={`/${tenantId}/resident/documents`} label={t('navigation.documents')} />
          </>
        ) : (
          <>
            <NavItem href={routes.buildingsList(tenantId)} label={t('navigation.buildings')} />
            <NavItem href={`/${tenantId}/units`} label={t('navigation.units')} />
            <NavItem href={`/${tenantId}/finanzas`} label={t('navigation.finanzas')} />
            <NavItem href={routes.tenantReports(tenantId)} label={t('navigation.reports')} />


            <div className="mt-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t('navigation.settings')}
            </div>
            <NavItem href={`/${tenantId}/settings/members`} label={t('sidebar.myTeam')} />
          </>
        )}
      </nav>
    </aside>
  );
};

export default Sidebar;

