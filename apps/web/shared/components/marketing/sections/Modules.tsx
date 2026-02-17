import Badge from "@/shared/components/ui/Badge";

type Status = "mvp" | "next";

export default function Modules() {
  const categories: Array<{
    name: string;
    items: Array<{ name: string; status: Status }>;
  }> = [
    {
      name: "Administración",
      items: [
        { name: "Propiedades", status: "mvp" },
        { name: "Unidades", status: "mvp" },
        { name: "Residentes", status: "mvp" },
      ],
    },
    {
      name: "Finanzas",
      items: [
        { name: "Pagos", status: "mvp" },
        { name: "Expensas", status: "next" },
        { name: "Cuenta corriente", status: "next" },
      ],
    },
    {
      name: "Operación",
      items: [
        { name: "Reclamos/Tickets", status: "mvp" },
        { name: "Proveedores", status: "next" },
      ],
    },
    {
      name: "Comunicación",
      items: [
        { name: "Avisos", status: "mvp" },
        { name: "Documentos", status: "mvp" },
      ],
    },
  ];

  const badgeClass =
    {
      mvp: "bg-accent/15 text-accent border border-accent/30",
      next: "bg-muted text-muted-foreground border border-border",
    } as const;

  return (
    <section id="modulos" className="py-20 bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Módulos integrados
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Una suite completa que crece con tus necesidades.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {categories.map((category) => (
            <div key={category.name} className="space-y-4">
              <h3 className="text-lg font-bold text-primary uppercase tracking-wider border-b border-border pb-2">
                {category.name}
              </h3>

              <ul className="space-y-3">
                {category.items.map((item) => (
                  <li
                    key={`${category.name}-${item.name}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-foreground text-sm font-medium">
                      {item.name}
                    </span>

                    {item.status === "mvp" ? (
                      <Badge className={badgeClass.mvp}>MVP</Badge>
                    ) : (
                      <Badge className={badgeClass.next}>Próximo</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center text-sm text-muted-foreground">
          * “Próximo” indica funcionalidades planificadas para el roadmap.
        </div>
      </div>
    </section>
  );
}
