"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { routes } from "../../../shared/lib/routes";
import { useTenantId } from "../../../features/tenancy/tenant.hooks";
import { useCan } from "../../../features/rbac/rbac.hooks";
import { useIsSuperAdmin } from "../../../features/auth/useAuthSession";
import { useImpersonation } from "../../../features/impersonation/useImpersonation";

function NavItem({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
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
}

export default function Sidebar() {
  const tenantId = useTenantId();
  const canReview = useCan("payments.review");
  const isSuperAdmin = useIsSuperAdmin();
  const { isImpersonating } = useImpersonation();

  // SUPER_ADMIN users should not see tenant-level sidebar
  // EXCEPT during impersonation (when they're acting as tenant admin)
  if ((isSuperAdmin && !isImpersonating) || !tenantId) return null;

  return (
    <aside className="w-64 border-r border-border bg-card text-card-foreground">
      <div className="p-4">
        <div className="font-semibold text-base">BuildingOS</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Tenant: <span className="font-medium text-foreground">{tenantId}</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-2 pb-4">
        <NavItem href={routes.tenantDashboard(tenantId)} label="Dashboard" />
        <NavItem href={routes.buildingsList(tenantId)} label="Buildings" />
        <NavItem href={`/${tenantId}/properties`} label="Properties" />
        <NavItem href={`/${tenantId}/units`} label="Units" />
        <NavItem href={`/${tenantId}/payments`} label="Payments" />
        <NavItem href={routes.tenantReports(tenantId)} label="Reportes" />

        {canReview && (
          <>
            <div className="mt-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Admin
            </div>
            <NavItem href={`/${tenantId}/payments/review`} label="Review Payments" />
          </>
        )}
      </nav>
    </aside>
  );
}
