"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { X } from "lucide-react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { ImpersonationBanner } from "../../../features/impersonation/ImpersonationBanner";
import { AssistantWidget, useAssistantContext } from "@/shared/components/assistant";
import { PushPermissionControl } from "@/features/notifications/components/PushPermissionControl";
import { PushPermissionProvider } from "@/features/notifications/components/PushPermissionProvider";

function AssistantWrapper({ isDrawerOpen }: { readonly isDrawerOpen: boolean }) {
  const context = useAssistantContext();
  return (
    <div
      data-testid="assistant-shell-surface"
      aria-hidden={isDrawerOpen}
      className={isDrawerOpen ? "invisible pointer-events-none" : undefined}
    >
      <AssistantWidget context={context} defaultUseLlm={false} suspendEscapeHandling={isDrawerOpen} />
    </div>
  );
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];

  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.tabIndex >= 0);
}

export default function AppShell({ children }: { readonly children: ReactNode }) {
  const params = useParams();
  const tenantId = params?.tenantId as string | undefined;
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const drawerCloseButtonRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback((restoreFocus = true) => {
    setIsDrawerOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }, []);

  const toggleDrawer = useCallback(() => {
    setIsDrawerOpen((open) => !open);
  }, []);

  useEffect(() => {
    if (!isDrawerOpen) return;

    const previousOverflow = document.body.style.overflow;

    drawerCloseButtonRef.current?.focus();
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements(drawerPanelRef.current);
      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement = focusableElements.at(-1);
      if (!firstFocusableElement || !lastFocusableElement) return;

      const activeElement = document.activeElement;
      const isFocusInsideDrawer = drawerPanelRef.current?.contains(activeElement);
      if (!isFocusInsideDrawer) {
        event.preventDefault();
        firstFocusableElement.focus();
        return;
      }

      if (event.shiftKey && activeElement === firstFocusableElement) {
        event.preventDefault();
        lastFocusableElement.focus();
      } else if (!event.shiftKey && activeElement === lastFocusableElement) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDrawer, isDrawerOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const desktopMediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleBreakpointChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        closeDrawer(false);
      }
    };

    desktopMediaQuery.addEventListener("change", handleBreakpointChange);
    return () => desktopMediaQuery.removeEventListener("change", handleBreakpointChange);
  }, [closeDrawer]);

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <Sidebar />
      <PushPermissionProvider key={tenantId ?? "tenant-unavailable"} tenantId={tenantId ?? ""}>
        <div className="flex min-w-0 flex-1 flex-col">
          <ImpersonationBanner />
          <Topbar
            isMobileMenuOpen={isDrawerOpen}
            menuButtonRef={menuButtonRef}
            onMobileMenuToggle={toggleDrawer}
          />
          <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">
            <div className="mx-auto w-full max-w-6xl">
              <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                <div className="min-w-0 overflow-x-auto p-3 sm:p-4 lg:p-6">{children}</div>
              </div>
            </div>
          </main>
        </div>

        {isDrawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" data-testid="mobile-navigation-drawer">
            <button
              type="button"
              aria-label="Cerrar menú de navegación"
              className="absolute inset-0 bg-black/50"
              onClick={() => closeDrawer()}
            />
            <div
              ref={drawerPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Navegación principal"
              className="relative z-10 flex h-full w-[min(20rem,calc(100vw-2rem))] flex-col overflow-y-auto border-r border-border bg-card pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-card-foreground shadow-xl"
            >
              <div className="flex items-center justify-between px-4 pb-2">
                <span className="font-semibold">BuildingOS</span>
                <button
                  ref={drawerCloseButtonRef}
                  type="button"
                  aria-label="Cerrar menú"
                  className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                  onClick={() => closeDrawer()}
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <Sidebar
                id="mobile-navigation"
                variant="drawer"
                className="min-h-0 w-full flex-1 border-0"
                onNavigate={() => closeDrawer(false)}
                footer={tenantId ? (
                  <div className="border-t border-border p-4">
                    <PushPermissionControl />
                  </div>
                ) : null}
              />
            </div>
          </div>
        )}
        <AssistantWrapper isDrawerOpen={isDrawerOpen} />
      </PushPermissionProvider>
    </div>
  );
}
