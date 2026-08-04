/**
 * @jest-environment jsdom
 */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

let pathname = "/tenant-1/tickets/ticket-1";
let currentSearch = "";
let tenantId = "tenant-1";
let session: {
  user: { id: string; email: string; name: string };
  memberships: Array<{ tenantId: string; roles: string[] }>;
  activeTenantId: string;
} | null = null;

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

jest.mock("../../../features/tenancy/tenant.hooks", () => ({
  useTenantId: () => tenantId,
}));

jest.mock("../../../features/auth/useAuthSession", () => ({
  useAuthSession: () => session,
  useIsSuperAdmin: () => false,
}));

jest.mock("../../../features/impersonation/useImpersonation", () => ({
  useImpersonation: () => ({ isImpersonating: false }),
}));

jest.mock("../../../features/tenants/tenants.hooks", () => ({
  useTenants: () => ({ data: [{ id: "tenant-1", name: "Horizonte" }] }),
}));

jest.mock("@/i18n", () => ({
  t: (key: string) =>
    ({
      "common.condominium": "Condominio",
      "navigation.dashboard": "Panel",
      "navigation.myProfile": "Mi perfil",
      "navigation.payments": "Pagos",
      "navigation.communications": "Comunicados",
      "navigation.tickets": "Solicitudes",
      "navigation.myUnit": "Mi unidad",
      "navigation.documents": "Documentos",
      "navigation.buildings": "Edificios",
      "navigation.units": "Unidades",
      "navigation.finanzas": "Finanzas",
      "navigation.rubros": "Rubros",
      "navigation.reports": "Reportes",
      "navigation.settings": "Configuración",
      "settings.general": "Configuración general",
      "navigation.residents": "Residentes",
      "sidebar.team": "Equipo",
    })[key] ?? key,
}));

describe("Sidebar", () => {
  beforeEach(() => {
    pathname = "/tenant-1/tickets/ticket-1";
    currentSearch = "";
    tenantId = "tenant-1";
    window.history.pushState({}, "", pathname);
    session = {
      user: { id: "user-1", email: "test@test.com", name: "Test User" },
      memberships: [{ tenantId: "tenant-1", roles: ["RESIDENT", "TENANT_ADMIN"] }],
      activeTenantId: "tenant-1",
    };
  });

  it("uses desktop-only structural classes and desktop link density by default", () => {
    const { container } = render(<Sidebar />);
    const aside = container.querySelector("aside");

    expect(aside?.className).toContain("hidden");
    expect(aside?.className).toContain("w-64");
    expect(aside?.className).toContain("lg:block");
    expect(screen.getByRole("link", { name: "Edificios" }).className).not.toContain("min-h-11");
  });

  it("uses visible touch-sized links without a fixed desktop width in the drawer variant", () => {
    const { container } = render(<Sidebar variant="drawer" />);
    const aside = container.querySelector("aside");

    expect(aside?.className).toContain("block");
    expect(aside?.className).not.toContain("w-64");
    screen.getAllByRole("link").forEach((link) => {
      expect(link.className).toContain("min-h-11");
      expect(link.className).toContain("items-center");
    });
  });

  it("renders resident navigation on resident routes for mixed-role users", () => {
    pathname = "/tenant-1/resident/profile";
    currentSearch = "portal=resident";

    render(<Sidebar variant="drawer" />);

    expect(screen.getByRole("link", { name: "Panel" }).getAttribute("href")).toBe(
      "/tenant-1/resident/dashboard",
    );
    expect(screen.getByRole("link", { name: "Mi perfil" }).className).toContain("bg-primary");
    expect(screen.queryByRole("link", { name: "Cuentas bancarias" })).toBeNull();
  });

  it("renders admin navigation on admin routes for mixed-role users", () => {
    pathname = "/tenant-1/dashboard";
    window.history.pushState({}, "", pathname);

    render(<Sidebar variant="drawer" />);

    expect(screen.getByRole("link", { name: "Panel" }).getAttribute("href")).toBe("/tenant-1/dashboard");
    expect(screen.getByRole("link", { name: "Edificios" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Configuración general" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cuentas bancarias" }).getAttribute("href")).toBe(
      "/tenant-1/settings/banking",
    );
    expect(screen.queryByRole("link", { name: "Mi perfil" })).toBeNull();
  });

  it("keeps resident navigation active on the canonical resident ticket detail route", () => {
    pathname = "/tenant-1/tickets/ticket-1";
    currentSearch = "portal=resident";

    render(<Sidebar variant="drawer" />);

    expect(screen.getByRole("link", { name: "Solicitudes" }).className).toContain("bg-primary");
    expect(screen.queryByRole("link", { name: "Cuentas bancarias" })).toBeNull();
  });

  it("falls back to resident navigation for resident-only users on admin routes", () => {
    pathname = "/tenant-1/dashboard";
    window.history.pushState({}, "", pathname);
    session = {
      user: { id: "resident-1", email: "resident@test.com", name: "Resident User" },
      memberships: [{ tenantId: "tenant-1", roles: ["RESIDENT"] }],
      activeTenantId: "tenant-1",
    };

    render(<Sidebar variant="drawer" />);

    expect(screen.getByRole("link", { name: "Panel" }).getAttribute("href")).toBe(
      "/tenant-1/resident/dashboard",
    );
    expect(screen.getByRole("link", { name: "Mi perfil" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Edificios" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Cuentas bancarias" })).toBeNull();
  });

  it("hides banking navigation for operator users", () => {
    pathname = "/tenant-1/dashboard";
    session = {
      user: { id: "operator-1", email: "operator@test.com", name: "Operator User" },
      memberships: [{ tenantId: "tenant-1", roles: ["OPERATOR"] }],
      activeTenantId: "tenant-1",
    };

    render(<Sidebar variant="drawer" />);

    expect(screen.queryByRole("link", { name: "Cuentas bancarias" })).toBeNull();
  });

  it("hides banking navigation for mixed-role users when the portal resolves to resident", () => {
    pathname = "/tenant-1/resident/profile";
    currentSearch = "portal=resident";
    session = {
      user: { id: "mixed-1", email: "mixed@test.com", name: "Mixed Resident" },
      memberships: [{ tenantId: "tenant-1", roles: ["RESIDENT", "TENANT_ADMIN"] }],
      activeTenantId: "tenant-1",
    };

    render(<Sidebar variant="drawer" />);

    expect(screen.queryByRole("link", { name: "Cuentas bancarias" })).toBeNull();
  });

  it("shows banking navigation for mixed-role users when the portal resolves to admin", () => {
    pathname = "/tenant-1/dashboard";
    session = {
      user: { id: "mixed-2", email: "mixed@test.com", name: "Mixed Admin" },
      memberships: [{ tenantId: "tenant-1", roles: ["RESIDENT", "TENANT_ADMIN"] }],
      activeTenantId: "tenant-1",
    };

    render(<Sidebar variant="drawer" />);

    expect(screen.getByRole("link", { name: "Cuentas bancarias" }).getAttribute("href")).toBe(
      "/tenant-1/settings/banking",
    );
  });

  it("does not leak tenant A admin permissions when evaluating tenant B", () => {
    tenantId = "tenant-2";
    pathname = "/tenant-2/dashboard";
    session = {
      user: { id: "user-2", email: "test2@test.com", name: "Test User 2" },
      memberships: [
        { tenantId: "tenant-1", roles: ["TENANT_ADMIN"] },
        { tenantId: "tenant-2", roles: ["RESIDENT"] },
      ],
      activeTenantId: "tenant-2",
    };

    render(<Sidebar variant="drawer" />);

    expect(screen.queryByRole("link", { name: "Cuentas bancarias" })).toBeNull();
  });

  it("marks the banking link as active on the banking settings route", () => {
    pathname = "/tenant-1/settings/banking";
    session = {
      user: { id: "owner-1", email: "owner@test.com", name: "Owner User" },
      memberships: [{ tenantId: "tenant-1", roles: ["TENANT_OWNER"] }],
      activeTenantId: "tenant-1",
    };

    render(<Sidebar variant="drawer" />);

    expect(screen.getByRole("link", { name: "Cuentas bancarias" }).className).toContain(
      "bg-primary",
    );
  });
});
