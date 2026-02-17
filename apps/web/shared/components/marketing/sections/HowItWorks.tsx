export default function HowItWorks() {
  const steps = [
    {
      title: "Configurás propiedades",
      description: "Cargá tus edificios, unidades y asigná propietarios o inquilinos en minutos.",
    },
    {
      title: "Residentes reportan",
      description: "Ellos informan pagos o crean reclamos desde su panel de autogestión.",
    },
    {
      title: "Administración valida",
      description: "Revisás comprobantes, aprobás pagos y gestionás los tickets de mantenimiento.",
    },
    {
      title: "Control total",
      description: "Monitoreá el estado financiero y operativo de cada edificio en tiempo real.",
    },
  ];

  return (
    <section id="como-funciona" className="py-20 bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Cómo funciona BuildingOS
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Ordená tu gestión en 4 pasos simples.
          </p>
        </div>
        <div className="grid md:grid-cols-4 gap-8 relative">
          {/* Connecting line for desktop */}
          <div className="hidden md:block absolute top-6 left-0 w-full h-0.5 bg-border -z-10 transform translate-y-4"></div>
          
          {steps.map((step, index) => (
            <div key={index} className="flex flex-col items-center text-center bg-background md:bg-transparent p-6 md:p-0 rounded-xl md:rounded-none shadow-sm md:shadow-none border md:border-none border-border">
              <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold mb-4 shadow-sm z-10">
                {index + 1}
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
