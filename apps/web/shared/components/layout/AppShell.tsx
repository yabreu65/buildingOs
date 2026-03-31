"use client";

import { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { ImpersonationBanner } from "../../../features/impersonation/ImpersonationBanner";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <ImpersonationBanner />
        <Topbar />
        <main className="p-6 overflow-x-auto">
          <div className="mx-auto w-full max-w-6xl">
            <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm overflow-hidden">
              <div className="p-6 overflow-x-auto">{children}</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
