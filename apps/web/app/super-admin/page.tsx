'use client';

import Link from 'next/link';
import Card from '@/shared/components/ui/Card';

export default function SuperAdminDashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Centro de operación</h1>
        <p className="text-muted-foreground mt-2">
          Administra la plataforma BuildingOS desde un panel interno claro y centralizado.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/super-admin/tenants">
          <Card className="h-32 flex flex-col justify-between hover:bg-accent/5 cursor-pointer transition-colors">
            <div>
              <h2 className="text-xl font-semibold">Administradoras</h2>
              <p className="text-sm text-muted-foreground">
                Ver y administrar las cuentas de cada cliente.
              </p>
            </div>
            <div className="text-2xl font-bold text-primary">→</div>
          </Card>
        </Link>

        <Link href="/super-admin/overview">
          <Card className="h-32 flex flex-col justify-between hover:bg-accent/5 cursor-pointer transition-colors">
            <div>
              <h2 className="text-xl font-semibold">Visión general</h2>
              <p className="text-sm text-muted-foreground">
                Consultar métricas básicas de la plataforma.
              </p>
            </div>
            <div className="text-2xl font-bold text-primary">→</div>
          </Card>
        </Link>

        <Link href="/super-admin/audit-logs">
          <Card className="h-32 flex flex-col justify-between hover:bg-accent/5 cursor-pointer transition-colors">
            <div>
              <h2 className="text-xl font-semibold">Registro de auditoría</h2>
              <p className="text-sm text-muted-foreground">
                Revisar actividad y eventos sensibles.
              </p>
            </div>
            <div className="text-2xl font-bold text-primary">→</div>
          </Card>
        </Link>

        <Link href="/super-admin/users">
          <Card className="h-32 flex flex-col justify-between hover:bg-accent/5 cursor-pointer transition-colors">
            <div>
              <h2 className="text-xl font-semibold">Usuarios globales</h2>
              <p className="text-sm text-muted-foreground">
                Gestionar usuarios con acceso a la consola interna.
              </p>
            </div>
            <div className="text-2xl font-bold text-primary">→</div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
