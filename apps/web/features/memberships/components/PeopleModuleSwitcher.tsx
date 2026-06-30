'use client';

import Link from 'next/link';
import Card from '@/shared/components/ui/Card';

interface PeopleModuleSwitcherProps {
  tenantId: string;
  active: 'residents' | 'team';
}

const peopleCards = {
  residents: {
    title: 'Residentes del edificio',
    description: 'Personas vinculadas a unidades. No se usan para asignar tickets.',
    href: (tenantId: string) => `/${tenantId}/settings/members`,
    cta: 'Ir a Residentes',
  },
  team: {
    title: 'Equipo operativo',
    description: 'Administradores y operadores que pueden atender solicitudes y aparecer en “Asignar a”.',
    href: (tenantId: string) => `/${tenantId}/settings/team`,
    cta: 'Ir a Equipo operativo',
  },
} as const;

export function PeopleModuleSwitcher({ tenantId, active }: PeopleModuleSwitcherProps) {
  return (
    <div className="mb-8">
      <div className="mb-4 space-y-1">
        <h2 className="text-lg font-semibold">Navegación rápida</h2>
        <p className="text-sm text-muted-foreground">
          Accede a la vista de residentes o al equipo operativo desde el mismo módulo.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(peopleCards) as Array<keyof typeof peopleCards>).map((key) => {
          const card = peopleCards[key];
          const isActive = active === key;

          return (
            <Card
              key={key}
              className={[
                'p-4 border transition-colors',
                isActive
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-border bg-card hover:border-blue-200',
              ].join(' ')}
            >
              <div className="flex h-full flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold">{card.title}</h3>
                    {isActive && (
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                        Vista actual
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{card.description}</p>
                </div>

                <div>
                  <Link
                    href={card.href(tenantId)}
                    className="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    {card.cta}
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
