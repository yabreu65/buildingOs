import { UnifiedLeadForm } from '@/features/public/components/UnifiedLeadForm';

export const metadata = {
  title: 'Contacto | BuildingOS',
  description: 'Contáctanos para solicitar una demo guiada o recibir más información sobre BuildingOS.',
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl">
            Hablemos de tu operación
          </h1>
          <p className="mt-4 text-lg text-gray-600">
            Contanos sobre tu edificio o administradora y te ayudamos a entender cómo
            BuildingOS puede ordenar pagos, reclamos y documentación.
          </p>
        </div>

        {/* Form */}
        <UnifiedLeadForm
          intent="CONTACT"
          title="Solicitar contacto"
          subtitle="Compartí algunos datos y nuestro equipo te contactará para coordinar una llamada o demo guiada."
          successTitle="¡Gracias!"
          successMessage="Recibimos tu información y te vamos a contactar pronto para coordinar el próximo paso."
        />

        {/* Footer */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          <div>
            <div className="text-3xl font-bold text-blue-600">24h</div>
            <p className="text-gray-600 mt-2">Tiempo de respuesta estimado</p>
          </div>
          <div>
            <div className="text-3xl font-bold text-blue-600">14 días</div>
            <p className="text-gray-600 mt-2">Prueba gratuita, sin tarjeta</p>
          </div>
          <div>
            <div className="text-3xl font-bold text-blue-600">99.9%</div>
            <p className="text-gray-600 mt-2">Disponibilidad objetivo</p>
          </div>
        </div>
      </div>
    </div>
  );
}
