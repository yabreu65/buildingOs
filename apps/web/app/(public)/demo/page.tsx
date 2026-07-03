import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  Building2,
  FileText,
  Landmark,
  MessageSquareText,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';

export const metadata = {
  title: 'Demo interactiva | BuildingOS',
  description:
    'Explorá BuildingOS con una administración demo y probá módulos de edificios, finanzas, residentes y tickets.',
};

interface FeatureCard {
  title: string;
  description: string;
  icon: LucideIcon;
}

const features: FeatureCard[] = [
  {
    title: 'Panel de administración',
    description: 'Indicadores clave para entender el estado de la operación en segundos.',
    icon: Building2,
  },
  {
    title: 'Edificios y unidades',
    description: 'Organización por cliente, edificio y unidad con navegación clara.',
    icon: Landmark,
  },
  {
    title: 'Residentes y propietarios',
    description: 'Relación de personas, ocupantes y vínculos con cada unidad.',
    icon: Users,
  },
  {
    title: 'Finanzas y morosidad',
    description: 'Seguimiento de saldos, períodos y comportamiento de pago.',
    icon: PiggyBank,
  },
  {
    title: 'Pagos y validaciones',
    description: 'Registro de pagos, revisión de comprobantes y conciliación.',
    icon: BadgeCheck,
  },
  {
    title: 'Solicitudes y tickets',
    description: 'Canalización de reclamos y seguimiento de estado.',
    icon: MessageSquareText,
  },
  {
    title: 'Documentos',
    description: 'Acceso a archivos y material operativo centralizado.',
    icon: FileText,
  },
  {
    title: 'Entorno protegido',
    description: 'Datos de ejemplo para evaluar el producto sin afectar cuentas reales.',
    icon: ShieldCheck,
  },
];

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/40 via-background to-background">
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="bg-accent/15 text-accent border border-accent/30">Entorno demo</Badge>
          <span className="text-sm text-muted-foreground">
            Los datos son de ejemplo y pueden reiniciarse periódicamente.
          </span>
        </div>

        <div className="mt-6 grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Probá BuildingOS sin salir del producto
            </div>

            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Explorá BuildingOS con una administración demo
            </h1>

            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Probá cómo se gestionan edificios, unidades, residentes, finanzas, pagos,
              morosidad y solicitudes desde un solo lugar.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="w-full h-12 px-8 text-base sm:w-auto">
                <Link href="/login?demo=true">Entrar a la demo</Link>
              </Button>
              <Button asChild variant="secondary" className="w-full h-12 px-8 text-base sm:w-auto">
                <Link href="/demo-guiada">Solicitar demo guiada</Link>
              </Button>
            </div>

            <Card className="mt-10 bg-card/90">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-1 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">Entorno de prueba</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Esta demo está pensada para mostrar la experiencia comercial del producto,
                    no una cuenta real de cliente.
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="border-primary/20 bg-primary text-primary-foreground shadow-lg">
            <div className="flex items-center justify-between border-b border-primary-foreground/15 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-danger/80" />
                <div className="h-3 w-3 rounded-full bg-warning/80" />
                <div className="h-3 w-3 rounded-full bg-success/80" />
              </div>
              <span className="text-xs font-medium text-primary-foreground/80">Acceso demo</span>
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-sm uppercase tracking-wide text-primary-foreground/70">
                  Acceso demo
                </p>
                <div className="mt-3 rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 p-4">
                  <div className="space-y-3 text-sm text-primary-foreground/90">
                    <p>
                      El acceso demo está habilitado en este entorno y no se muestra en la UI pública.
                    </p>
                    <p>
                      Si querés avanzar sin ayuda, ingresá desde el login demo. Si preferís,
                      el equipo puede acompañarte en una demo guiada.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 p-4">
                <p className="text-sm font-semibold text-primary-foreground">Cómo empezar</p>
                <ol className="mt-3 space-y-2 text-sm text-primary-foreground/85">
                  <li className="flex gap-2">
                    <span className="font-semibold">1.</span>
                    Entrá a la demo o usá el botón de abajo.
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold">2.</span>
                    Iniciá sesión con los datos de prueba.
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold">3.</span>
                    Navegá por el panel, finanzas y tickets.
                  </li>
                </ol>
              </div>

              <Button asChild variant="secondary" className="w-full h-12 px-8 text-base">
                <Link href="/login?demo=true">Entrar a la demo</Link>
              </Button>
            </div>
          </Card>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <Card key={feature.title} className="h-full bg-card/90">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-foreground">{feature.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <Card className="mt-14 border-amber-200 bg-amber-50 text-amber-950">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
                Importante
              </p>
              <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
                Si buscás una demo más personalizada, el equipo comercial puede mostrarte
                BuildingOS con foco en tu tipo de operación.
              </p>
            </div>
            <Button asChild variant="secondary" className="w-full sm:w-auto">
              <Link href="/demo-guiada">Solicitar demo guiada</Link>
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}
