"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useTenantId } from "@/features/tenancy/tenant.hooks";
import { useCan } from "@/features/rbac/rbac.hooks";
import { getSession } from "@/features/auth/session.storage";
import type { Role } from "@/features/auth/auth.types";
import { useBoStorageTick } from "@/shared/lib/storage/useBoStorage";
import { routes } from "@/shared/lib/routes";
import { listBuildings } from "@/features/units/buildings.storage";
import { listUnits } from "@/features/units/units.storage";
import { listResidents } from "@/features/units/users.storage";
import { listBankAccounts } from "@/features/banking/banking.storage";
import { listPayments } from "@/features/payments/payments.storage";

import { useTenantOnboarding } from "./useTenantOnboarding";
import { mergeStepStatus } from "./onboarding.utils";
import type { OnboardingStep } from "./onboarding.types";

export function OnboardingChecklist() {
  const [isMounted, setIsMounted] = useState(false);
  const tenantId = useTenantId();
  const canReview = useCan("payments.review");

  // Storage tick to react to automatic data updates (localStorage).
  const storageTick = useBoStorageTick();

  // Onboarding hook for manual progress data (API-like local state).
  const { manualCompletions, toggleStep, loading: loadingManual } =
    useTenantOnboarding(tenantId || "");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
  }, []);

  const session = isMounted ? getSession() : null;

  const steps = useMemo(() => {
    if (!tenantId || !session) return [];

    // 1) Automatic state (feature storages are the source of truth).
    // Depends on storageTick so it updates when storage changes.
    const hasBuildings = listBuildings(tenantId).length > 0;
    const hasUnits = listUnits(tenantId).length > 0;
    const hasResidents = listResidents(tenantId).length > 0;
    const hasAccounts = listBankAccounts(tenantId).length > 0;
    const hasPayments = listPayments(tenantId).length > 0;

    const autoStatus: Record<string, boolean> = {
      properties: hasBuildings,
      units: hasUnits,
      banking: hasResidents,
      payments: false,
      review: hasAccounts || hasPayments,
    };

    // 2) Base steps.
    const baseSteps: OnboardingStep[] = [
      {
        id: "properties",
        label: "Crear el primer edificio",
        description: "Registrá el edificio o condominio para empezar a operar.",
        path: routes.buildingsList(tenantId),
        status: "TODO",
        condition: true,
        isManualOverrideAllowed: false,
      },
      {
        id: "units",
        label: "Cargar Unidades",
        description: "Agregá departamentos o funcionales antes de vincular personas.",
        path: `/${tenantId}/units`,
        status: "TODO",
        condition: true,
        isManualOverrideAllowed: false,
      },
      {
        id: "banking",
        label: "Vincular residentes",
        description: "Asigná cada residente a su unidad para que empiece a ver su información.",
        path: `/${tenantId}/units`,
        status: "TODO",
        condition: true,
        isManualOverrideAllowed: true,
      },
      {
        id: "payments",
        label: "Invitar al equipo",
        description: "Sumá administradores u operadores para repartir tareas.",
        path: `/${tenantId}/settings/team`,
        status: "TODO",
        condition: true,
        isManualOverrideAllowed: true,
      },
      {
        id: "review",
        label: "Preparar finanzas",
        description: "Cuando cargues gastos, podrás revisar la primera liquidación y registrar pagos.",
        path: `/${tenantId}/finanzas`,
        status: "TODO",
        condition: canReview,
        isManualOverrideAllowed: true,
      },
    ];

    // 3) Final merge: automatic + manual.
    return mergeStepStatus(baseSteps, autoStatus, manualCompletions);
  }, [tenantId, session, storageTick, manualCompletions, canReview]);

  // Avoid rendering during SSR/hydration (localStorage).
  if (!isMounted || !session || !tenantId) return null;

  const rolesForTenant: string[] =
    session.memberships.find((m) => m.tenantId === tenantId)?.roles ?? [];

  const isAdmin =
    rolesForTenant.includes("TENANT_OWNER") ||
    rolesForTenant.includes("TENANT_ADMIN") ||
    rolesForTenant.includes("SUPER_ADMIN");

  if (!isAdmin) return null;

  const visibleSteps = steps.filter((s) => s.condition !== false);
  const totalSteps = visibleSteps.length;
  const completedSteps = visibleSteps.filter((s) => s.status === "DONE").length;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const nextStep = visibleSteps.find((step) => step.status === "TODO");

  if (completedSteps === totalSteps) return null;

  return (
    <Card className="p-6 mb-8 border-l-4 border-l-primary">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            Primeros pasos{" "}
            {loadingManual && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                (Sincronizando...)
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            Seguís este orden para dejar la cuenta lista: edificio, unidades, residentes, equipo y finanzas.
          </p>
        </div>

        <div className="text-right">
          <span className="text-2xl font-bold text-primary">{progress}%</span>
          <p className="text-xs text-muted-foreground">Completado</p>
        </div>
      </div>

      {nextStep && (
        <div className="mb-4 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Siguiente paso recomendado
          </p>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-foreground">{nextStep.label}</p>
              <p className="text-sm text-muted-foreground">{nextStep.description}</p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href={nextStep.path}>Ir ahora</Link>
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visibleSteps.map((step) => (
          <div
            key={step.id}
            className={`flex items-center justify-between p-3 rounded-lg border ${
              step.status === "DONE"
                ? "bg-muted/40 border-border"
                : "bg-card border-border hover:border-primary/40 transition-colors"
            }`}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => step.isManualOverrideAllowed && toggleStep(step.id)}
                disabled={!step.isManualOverrideAllowed}
                aria-pressed={step.status === "DONE"}
                aria-label={
                  step.isManualOverrideAllowed
                    ? `Marcar ${step.label} como completado manualmente`
                    : `Paso automático: ${step.label}`
                }
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                  step.status === "DONE"
                    ? "bg-success/15 text-success"
                    : step.isManualOverrideAllowed
                      ? "bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer"
                      : "bg-muted text-muted-foreground/50 cursor-not-allowed"
                }`}
                title={step.isManualOverrideAllowed ? "Click para marcar manual" : "Automático"}
              >
                {step.status === "DONE" ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                )}
              </button>
              <div>
                <h3
                  className={`font-medium ${
                    step.status === "DONE"
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  }`}
                >
                  {step.label}
                </h3>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </div>

            {step.status === "TODO" && (
              <Button asChild variant="secondary" size="sm">
                <Link href={step.path}>Ir ahora</Link>
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
