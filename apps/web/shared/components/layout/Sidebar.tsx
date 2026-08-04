"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { routes } from "../../../shared/lib/routes";
import { useTenantId } from "../../../features/tenancy/tenant.hooks";
import { useAuthSession, useIsSuperAdmin } from "../../../features/auth/useAuthSession";
import { getLastPortal } from "../../../features/auth/session.storage";
import { useImpersonation } from "../../../features/impersonation/useImpersonation";
import { useTenants } from "../../../features/tenants/tenants.hooks";
import { useCanAdministerTenant } from "../../../features/tenancy/hooks/useEffectiveRole";
import { resolveAuthorizedPortalContext } from "../../../features/auth/landing-route";
import { t } from "@/i18n";

interface NavItemProps {
  readonly href: string;
  readonly label: string;
  readonly isActive: boolean;
  readonly onNavigate?: () => void;
  readonly variant: "desktop" | "drawer";
}

interface SidebarProps {
  readonly className?: string;
  readonly footer?: ReactNode;
  readonly id?: string;
  readonly onNavigate?: () => void;
  readonly variant?: "desktop" | "drawer";
}

const NavItem = ({ href, label, isActive, onNavigate, variant }: NavItemProps) => (
  <Link
    href={href}
    onClick={onNavigate}
    className={[
      variant === "drawer"
        ? "flex min-h-11 items-center rounded-md px-3 text-sm transition-colors"
        : "rounded-md px-3 py-2 text-sm transition-colors",
      "hover:bg-muted",
      isActive ? "bg-primary text-primary-foreground" : "text-foreground",
    ].join(" ")}
  >
    {label}
  </Link>
);

export const Sidebar = ({ className, footer, id, onNavigate, variant = "desktop" }: SidebarProps) => {
  const tenantId = useTenantId();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const session = useAuthSession();
  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((tenant) => tenant.id === tenantId)?.name;
  const isSuperAdmin = useIsSuperAdmin();
  const { isImpersonating } = useImpersonation();
  const canAdministerTenant = useCanAdministerTenant(tenantId ?? undefined);

  if ((isSuperAdmin && !isImpersonating) || !tenantId) return null;

  const activeTenantId = tenantId;
  const portalContext = resolveAuthorizedPortalContext({
    session,
    tenantId: activeTenantId,
    pathname,
    searchParamsString: currentSearch,
    preferredPortal: getLastPortal(),
  });
  const isResidentPortal = portalContext === "resident";
  const dashboardHref = isResidentPortal
    ? routes.residentDashboard(activeTenantId)
    : routes.tenantDashboard(activeTenantId);

  const isActive = (href: string) =>
    pathname === href || (
      isResidentPortal &&
      href === `/${activeTenantId}/resident/tickets` &&
      pathname.startsWith(`/${activeTenantId}/tickets/`)
    );

  const navItem = (href: string, label: string) => (
    <NavItem
      key={href}
      href={href}
      label={label}
      isActive={isActive(href)}
      onNavigate={onNavigate}
      variant={variant}
    />
  );

  return (
    <aside
      id={id}
      className={className ?? (
        variant === "drawer"
          ? "block min-h-0 w-full flex-1 border-r border-border bg-card text-card-foreground"
          : "hidden w-64 border-r border-border bg-card text-card-foreground lg:block"
      )}
    >
      <div className="p-4">
        <div className="text-base font-semibold">BuildingOS</div>
        {tenantName && (
          <div className="mt-1 text-xs text-muted-foreground">
            {t("common.condominium")}: <span className="font-medium text-foreground">{tenantName}</span>
          </div>
        )}
      </div>

      <nav className="flex flex-col gap-1 px-2 pb-4">
        {navItem(dashboardHref, t("navigation.dashboard"))}

        {isResidentPortal ? (
          <>
            {navItem(`/${tenantId}/resident/profile`, t("navigation.myProfile"))}
            {navItem(`/${tenantId}/resident/payments`, t("navigation.payments"))}
            {navItem(`/${tenantId}/resident/announcements`, t("navigation.communications"))}
            {navItem(`/${tenantId}/resident/tickets`, t("navigation.tickets"))}
            {navItem(`/${tenantId}/resident/unit`, t("navigation.myUnit"))}
            {navItem(`/${tenantId}/resident/documents`, t("navigation.documents"))}
          </>
        ) : (
          <>
            {navItem(routes.buildingsList(tenantId), t("navigation.buildings"))}
            {navItem(`/${tenantId}/units`, t("navigation.units"))}
            {navItem(`/${tenantId}/finanzas`, t("navigation.finanzas"))}
            {navItem(`/${tenantId}/finance/categories`, t("navigation.rubros"))}
            {navItem(routes.tenantReports(tenantId), t("navigation.reports"))}
            <div className="mt-3 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("navigation.settings")}
            </div>
            {navItem(`/${tenantId}/settings/general`, t("settings.general"))}
            {canAdministerTenant && navItem(`/${tenantId}/settings/banking`, "Cuentas bancarias")}
            {navItem(routes.onboardingImport(tenantId), "Onboarding import")}
            {navItem(`/${tenantId}/settings/members`, t("navigation.residents"))}
            {navItem(`/${tenantId}/settings/team`, t("sidebar.team"))}
          </>
        )}
      </nav>
      {footer}
    </aside>
  );
};

export default Sidebar;
