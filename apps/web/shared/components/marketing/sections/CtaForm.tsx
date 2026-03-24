"use client";

import { useState } from "react";
import { UnifiedLeadForm } from "@/features/public/components/UnifiedLeadForm";

export default function CtaForm() {
  const [activeTab, setActiveTab] = useState<"DEMO" | "SIGNUP">("DEMO");

  const isDemoTab = activeTab === "DEMO";
  const title = isDemoTab
    ? "¿Listo para ordenar tu administración?"
    : "Comienza tu prueba gratuita";
  const subtitle = isDemoTab
    ? "Sumate a la lista de espera y sé de los primeros en probar BuildingOS."
    : "Crea tu cuenta ahora y accede a todas las funciones.";

  return (
    <section id="demo" className="py-20 bg-primary text-primary-foreground">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6 text-primary-foreground">
          {title}
        </h2>
        <p className="text-lg text-primary-foreground/80 mb-10 max-w-2xl mx-auto">
          {subtitle}
        </p>

        {/* Toggle Tabs */}
        <div className="mb-8 flex justify-center">
          <div className="inline-flex border-b border-primary-foreground/30">
            <button
              onClick={() => setActiveTab("DEMO")}
              className={`px-6 py-3 font-medium transition-all ${
                activeTab === "DEMO"
                  ? "border-b-2 border-primary-foreground text-primary-foreground"
                  : "text-primary-foreground/60 hover:text-primary-foreground/80"
              }`}
            >
              Solicitar Demo
            </button>
            <button
              onClick={() => setActiveTab("SIGNUP")}
              className={`px-6 py-3 font-medium transition-all ${
                activeTab === "SIGNUP"
                  ? "border-b-2 border-primary-foreground text-primary-foreground"
                  : "text-primary-foreground/60 hover:text-primary-foreground/80"
              }`}
            >
              Crear Cuenta
            </button>
          </div>
        </div>

        <div className="max-w-md mx-auto">
          <UnifiedLeadForm
            intent={activeTab}
            title={isDemoTab ? "Solicitar Demo" : "Crear Cuenta"}
            subtitle={
              isDemoTab
                ? "Completa el formulario y nos pondremos en contacto."
                : "Completa el formulario para acceder inmediatamente."
            }
            successTitle={
              isDemoTab ? "¡Solicitud recibida!" : "¡Cuenta creada exitosamente!"
            }
            successMessage={
              isDemoTab
                ? "Te contactaremos pronto para agendar tu demo. Gracias por tu interés en BuildingOS."
                : "Tu cuenta ha sido creada. Redirigiendo al dashboard..."
            }
          />
        </div>
      </div>
    </section>
  );
}
