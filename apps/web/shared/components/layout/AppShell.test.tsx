/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AppShell from "./AppShell";

jest.mock("next/navigation", () => ({
  useParams: () => ({ tenantId: "tenant-1" }),
  usePathname: () => "/tenant-1/resident/dashboard",
}));

jest.mock("./Sidebar", () => ({
  __esModule: true,
  default: ({ id, onNavigate }: { id?: string; onNavigate?: () => void }) => (
    <aside id={id}>
      {onNavigate && <button type="button" onClick={onNavigate}>Ir a pagos</button>}
    </aside>
  ),
}));

jest.mock("./Topbar", () => ({
  __esModule: true,
  default: ({
    isMobileMenuOpen,
    menuButtonRef,
    onMobileMenuToggle,
  }: {
    isMobileMenuOpen: boolean;
    menuButtonRef: React.RefObject<HTMLButtonElement | null>;
    onMobileMenuToggle: () => void;
  }) => (
    <button
      ref={menuButtonRef}
      type="button"
      aria-label="Abrir menú de navegación"
      aria-controls="mobile-navigation"
      aria-expanded={isMobileMenuOpen}
      onClick={onMobileMenuToggle}
    >
      Menú
    </button>
  ),
}));

jest.mock("../../../features/impersonation/ImpersonationBanner", () => ({
  ImpersonationBanner: () => null,
}));

jest.mock("@/shared/components/assistant", () => ({
  AssistantWidget: () => <button type="button">Asistente disponible</button>,
  useAssistantContext: () => ({}),
}));

jest.mock("@/features/notifications/components/PushPermissionControl", () => ({
  PushPermissionControl: () => null,
}));

const openDrawer = () => {
  const trigger = screen.getByRole("button", { name: "Abrir menú de navegación" });
  fireEvent.click(trigger);
  return trigger;
};

describe("AppShell mobile drawer", () => {
  beforeEach(() => {
    document.body.style.overflow = "";
  });

  it("moves focus into the drawer and traps Tab in both directions", () => {
    render(<AppShell>Contenido</AppShell>);
    openDrawer();

    const closeButton = screen.getByRole("button", { name: "Cerrar menú" });
    const lastControl = screen.getByRole("button", { name: "Ir a pagos" });

    expect(document.activeElement).toBe(closeButton);

    lastControl.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastControl);
  });


  it("recalculates focusable drawer controls on every Tab event", () => {
    render(<AppShell>Contenido</AppShell>);
    openDrawer();

    const drawer = screen.getByRole("dialog", { name: "Navegación principal" });
    const closeButton = screen.getByRole("button", { name: "Cerrar menú" });
    const existingLastControl = screen.getByRole("button", { name: "Ir a pagos" });
    const dynamicControl = document.createElement("button");
    dynamicControl.type = "button";
    dynamicControl.textContent = "Control dinámico";
    dynamicControl.disabled = true;
    drawer.appendChild(dynamicControl);

    existingLastControl.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    dynamicControl.disabled = false;
    dynamicControl.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(dynamicControl);
  });

  it("closes the drawer and restores scroll when the desktop breakpoint becomes active", async () => {
    let changeListener: ((event: MediaQueryListEvent) => void) | undefined;
    const addEventListener = jest.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === "change") changeListener = listener;
    });
    const removeEventListener = jest.fn();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn(() => ({
        matches: false,
        addEventListener,
        removeEventListener,
      })),
    });

    try {
      render(<AppShell>Contenido</AppShell>);
      const trigger = openDrawer();
      const triggerFocus = jest.spyOn(trigger, "focus");
      triggerFocus.mockClear();

      expect(document.body.style.overflow).toBe("hidden");
      act(() => {
        changeListener?.({ matches: true } as MediaQueryListEvent);
      });

      await waitFor(() => {
        expect(screen.queryByTestId("mobile-navigation-drawer")).toBeNull();
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(document.body.style.overflow).toBe("");
      });
      expect(triggerFocus).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    }
  });

  it("removes the desktop breakpoint listener on unmount", () => {
    const removeEventListener = jest.fn();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener,
      })),
    });

    try {
      const { unmount } = render(<AppShell>Contenido</AppShell>);
      unmount();
      expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    }
  });

  it("suppresses the assistant surface without unmounting it while the drawer is open", () => {
    render(<AppShell>Contenido</AppShell>);
    const assistantSurface = screen.getByTestId("assistant-shell-surface");

    expect(assistantSurface.getAttribute("aria-hidden")).toBe("false");
    expect(assistantSurface.querySelector("button")).toBeTruthy();

    openDrawer();
    expect(assistantSurface.getAttribute("aria-hidden")).toBe("true");
    expect(assistantSurface.className).toContain("invisible");
    expect(assistantSurface.className).toContain("pointer-events-none");
    expect(assistantSurface.querySelector("button")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(assistantSurface.getAttribute("aria-hidden")).toBe("false");
  });

  it("locks body scroll and restores trigger focus after Escape", async () => {
    render(<AppShell>Contenido</AppShell>);
    const trigger = openDrawer();

    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("mobile-navigation-drawer")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("returns focus to the trigger after closing from the overlay or close button", async () => {
    render(<AppShell>Contenido</AppShell>);
    const trigger = openDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar menú de navegación" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar menú" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes after navigation without returning focus to the previous page trigger", () => {
    render(<AppShell>Contenido</AppShell>);
    const trigger = openDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Ir a pagos" }));

    expect(screen.queryByTestId("mobile-navigation-drawer")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("restores the previous body overflow when unmounted while open", () => {
    document.body.style.overflow = "scroll";
    const { unmount } = render(<AppShell>Contenido</AppShell>);

    openDrawer();
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("keeps horizontal scrolling on exactly the content layer", () => {
    const { container } = render(<AppShell>Contenido</AppShell>);
    const root = container.firstElementChild;
    const main = container.querySelector("main");
    const horizontalScrollLayers = container.querySelectorAll(".overflow-x-auto");

    expect(root?.className).toContain("min-h-dvh");
    expect(root?.className).not.toContain("min-h-screen");
    expect(main?.className).toContain("min-w-0");
    expect(horizontalScrollLayers).toHaveLength(1);
    expect(horizontalScrollLayers[0]?.className).toContain("min-w-0");
  });
});
