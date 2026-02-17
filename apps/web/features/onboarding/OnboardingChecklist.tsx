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
import { listProperties } from "@/features/properties/properties.storage";
import { listUnits } from "@/features/units/units.storage";
import { listBankAccounts } from "@/features/banking/banking.storage";
import { listPayments } from "@/features/payments/payments.storage";

import { useTenantOnboarding } from "./useTenantOnboarding";
import { mergeStepStatus } from "./onboarding.utils";
import type { OnboardingStep } from "./onboarding.types";

export default function OnboardingChecklist() {
  const [isMounted, setIsMounted] = useState(false);
  const tenantId = useTenantId();
  const canReview = useCan("payments.review");

  // Storage tick para reactividad de datos automáticos (localStorage)
  const storageTick = useBoStorageTick();

  // Hook de onboarding para datos manuales (simula API)
  const { manualCompletions, toggleStep, loading: loadingManual } =
    useTenantOnboarding(tenantId || "");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
  }, []);

  const session = isMounted ? getSession() : null;

  const steps = useMemo(() => {
    if (!tenantId || !session) return [];

    // 1) Estado automático (source of truth: storages por feature)
    // Depende de storageTick para actualizarse cuando cambie el storage
    const hasProperties = listProperties(tenantId).length > 0;
    const hasUnits = listUnits(tenantId).length > 0;
    const hasAccounts = listBankAccounts(tenantId).length > 0;
    const hasPayments = listPayments(tenantId).length > 0;

    const autoStatus: Record<string, boolean> = {
      properties: hasProperties,
      units: hasUnits,
      banking: hasAccounts,
      payments: hasPayments,
      review: hasPayments,
    };

    // 2) Base steps
    const baseSteps: OnboardingStep[] = [
      {
        id: "properties",
        label: "Crear Propiedades",
        description: "Registra el edificio o condominio.",
        path: `/${tenantId}/properties`,
        status: "TODO",
        condition: true,
        isManualOverrideAllowed: false,
      },
      {
        id: "units",
        label: "Cargar Unidades",
        description: "Da de alta los departamentos y funcionales.",
        path: `/${tenantId}/units`,
        status: "TODO",
        condition: true,
        isManualOverrideAllowed: false,
      },
      {
        id: "banking",
        label: "Configurar Banco",
        description: "Agrega cuenta para recibir transferencias.",
        path: `/${tenantId}/settings/banking`,
        status: "TODO",
        condition: true,
        isManualOverrideAllowed: true,
      },
      {
        id: "payments",
        label: "Reportar Pago (Prueba)",
        description: "Simula un reporte de pago de residente.",
        path: `/${tenantId}/payments`,
        status: "TODO",
        condition: true,
        isManualOverrideAllowed: true,
      },
      {
        id: "review",
        label: "Validar Pagos",
        description: "Revisa y aprueba los pagos reportados.",
        path: `/${tenantId}/payments/review`,
        status: "TODO",
        condition: canReview,
        isManualOverrideAllowed: true,
      },
    ];

    // 3) Merge final: auto + manual
    return mergeStepStatus(baseSteps, autoStatus, manualCompletions);
  }, [tenantId, session, storageTick, manualCompletions, canReview]);

  // Evitar render en SSR/hidratación (localStorage)
  if (!isMounted || !session || !tenantId) return null;

  const rolesForTenant: Role[] =
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

  if (completedSteps === totalSteps) return null;

  return (
    <Card className="p-6 mb-8 border-l-4 border-l-primary">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            Configuración Inicial{" "}
            {loadingManual && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                (Sincronizando...)
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            Completa estos pasos para activar tu cuenta al 100%.
          </p>
        </div>

        <div className="text-right">
          <span className="text-2xl font-bold text-primary">{progress}%</span>
          <p className="text-xs text-muted-foreground">Completado</p>
        </div>
      </div>

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
              <div
                onClick={() => step.isManualOverrideAllowed && toggleStep(step.id)}
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
              </div>
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
              <Link href={step.path}>
                <Button variant="secondary" size="sm">
                  Ir ahora
                </Button>
              </Link>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
