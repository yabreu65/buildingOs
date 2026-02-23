"use client";

import { UnifiedLeadForm } from "@/features/public/components/UnifiedLeadForm";

export default function CtaForm() {
  return (
    <section id="demo" className="py-20 bg-primary text-primary-foreground">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6 text-primary-foreground">
          ¿Listo para ordenar tu administración?
        </h2>
        <p className="text-lg text-primary-foreground/80 mb-10 max-w-2xl mx-auto">
          Sumate a la lista de espera y sé de los primeros en probar BuildingOS.
        </p>

        <div className="max-w-md mx-auto">
          <UnifiedLeadForm
            intent="DEMO"
            title="Solicitar Demo"
            subtitle="Completa el formulario y nos pondremos en contacto."
            successTitle="¡Solicitud recibida!"
            successMessage="Te contactaremos pronto para agendar tu demo. Gracias por tu interés en BuildingOS."
          />
        </div>
      </div>
    </section>
  );
}
