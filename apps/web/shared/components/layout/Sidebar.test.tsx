/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

let pathname = "/tenant-1/tickets/ticket-1";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

jest.mock("../../../features/tenancy/tenant.hooks", () => ({
  useTenantId: () => "tenant-1",
}));

jest.mock("../../../features/auth/useAuthSession", () => ({
  useIsSuperAdmin: () => false,
  useHasRole: (role: string) => role === "RESIDENT",
}));

jest.mock("../../../features/impersonation/useImpersonation", () => ({
  useImpersonation: () => ({ isImpersonating: false }),
}));

jest.mock("../../../features/tenants/tenants.hooks", () => ({
  useTenants: () => ({ data: [{ id: "tenant-1", name: "Horizonte" }] }),
}));

jest.mock("@/i18n", () => ({
  t: (key: string) => ({
    "common.condominium": "Condominio",
    "navigation.dashboard": "Panel",
    "navigation.payments": "Pagos",
    "navigation.communications": "Comunicados",
    "navigation.tickets": "Solicitudes",
    "navigation.myUnit": "Mi unidad",
    "navigation.documents": "Documentos",
  })[key] ?? key,
}));

describe("Sidebar", () => {
  beforeEach(() => {
    pathname = "/tenant-1/tickets/ticket-1";
  });

  it("uses desktop-only structural classes and desktop link density by default", () => {
    const { container } = render(<Sidebar />);
    const aside = container.querySelector("aside");

    expect(aside?.className).toContain("hidden");
    expect(aside?.className).toContain("w-64");
    expect(aside?.className).toContain("lg:block");
    expect(screen.getByRole("link", { name: "Solicitudes" }).className).not.toContain("min-h-11");
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

  it("keeps Solicitudes active for the canonical resident ticket detail route", () => {
    render(<Sidebar variant="drawer" />);

    expect(screen.getByRole("link", { name: "Solicitudes" }).className).toContain("bg-primary");
  });
});
