export default function Faq() {
  const faqs = [
    {
      q: "¿Sirve para un solo edificio?",
      a: "Sí. BuildingOS se adapta tanto a consorcios autogestionados como a grandes administradoras.",
    },
    {
      q: "¿Sirve para administradoras con muchos edificios?",
      a: "Sí. Nuestra arquitectura te permite gestionar cientos de edificios desde un único panel sin mezclar datos.",
    },
    {
      q: "¿Cómo se manejan los pagos?",
      a: "En la versión actual soportamos reporte de transferencias bancarias con adjunto de comprobante. Próximamente sumaremos integración directa con pasarelas.",
    },
    {
      q: "¿Se puede usar en móvil?",
      a: "Totalmente. La plataforma es web responsive y funciona como una PWA en tu celular.",
    },
    {
      q: "¿Los datos están separados por cliente?",
      a: "Sí. Cada condominio es un entorno aislado con sus propios datos, usuarios y permisos.",
    },
  ];

  return (
    <section id="faq" className="py-20 bg-muted/20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <h2 className="text-3xl font-bold tracking-tight text-center mb-12 text-foreground">
          Preguntas frecuentes
        </h2>
        <div className="space-y-6">
          {faqs.map((faq, index) => (
            <div key={index} className="bg-card border border-border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-2">{faq.q}</h3>
              <p className="text-foreground/80">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
