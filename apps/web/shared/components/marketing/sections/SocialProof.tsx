import Card from "@/shared/components/ui/Card";

export default function SocialProof() {
  return (
    <section className="py-16 bg-muted/50 border-y border-border">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid md:grid-cols-3 gap-8 text-center">
          <div>
            <div className="text-4xl font-extrabold text-primary mb-2">LATAM</div>
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Pensado para VE / AR / CO
            </div>
          </div>

          <div>
            <div className="text-4xl font-extrabold text-primary mb-2">Auditado</div>
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Trazabilidad por tenant
            </div>
          </div>

          <div>
            <div className="text-4xl font-extrabold text-primary mb-2">Menos</div>
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Errores en comprobantes
            </div>
          </div>
        </div>

        <div className="mt-8 mx-auto max-w-3xl">
          <Card className="p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Diseñado para administración profesional: separación de datos por cliente (tenant),
              control de roles y procesos claros para pagos y operación.
            </p>
          </Card>
        </div>
      </div>
    </section>
  );
}
