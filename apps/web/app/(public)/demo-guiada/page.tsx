import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { UnifiedLeadForm } from '@/features/public/components/UnifiedLeadForm';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';

export const metadata = {
  title: 'Demo guiada | BuildingOS',
  description:
    'Solicitá una demo guiada de BuildingOS y conocé cómo ayuda a administrar edificios, pagos, morosidad y tickets.',
};

interface BenefitCard {
  title: string;
  description: string;
  icon: LucideIcon;
}

const benefits: BenefitCard[] = [
  {
    title: 'Presentación comercial clara',
    description: 'Te mostramos el valor del producto con foco en tu operación y tus prioridades.',
    icon: Sparkles,
  },
  {
    title: 'Alineación con tu equipo',
    description: 'Ideal para administradoras, consorcios y equipos que toman la decisión.',
    icon: Users,
  },
  {
    title: 'Agenda simple',
    description: 'Coordinamos una llamada o presentación sin fricción ni pasos extras.',
    icon: CalendarDays,
  },
  {
    title: 'Preguntas y contexto',
    description: 'Nos contás tu situación y vemos si BuildingOS realmente encaja.',
    icon: MessageSquareText,
  },
];

const walkthroughSteps = [
  'Entendemos tu tipo de administración y el tamaño de tu operación.',
  'Te mostramos los módulos más relevantes para tu caso.',
  'Aterrizamos próximos pasos sin obligarte a probar por tu cuenta.',
];

export default function DemoGuidedPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_28%),linear-gradient(to_bottom,_rgba(15,23,42,0.02),_transparent_22%),linear-gradient(to_bottom,_var(--tw-gradient-stops))] from-muted/30 via-background to-background">
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="bg-accent/15 text-accent border border-accent/30">Demo guiada</Badge>
          <span className="text-sm text-muted-foreground">
            Una presentación comercial clara, pensada para decisiones reales.
          </span>
        </div>

        <div className="mt-6 grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
          <div className="space-y-8">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-sm text-muted-foreground shadow-sm">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Sin inicio automático de sesión, sin fricción, sin perder contexto
              </div>

              <div>
                <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                  Solicitá una demo guiada de BuildingOS
                </h1>
                <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                  Te mostramos la plataforma con foco comercial: cómo ayuda a gestionar edificios,
                  unidades, residentes, finanzas, pagos, morosidad y solicitudes.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="rounded-full border border-border bg-background px-4 py-2 text-sm text-muted-foreground shadow-sm">
                  Presentación para administradoras
                </div>
                <div className="rounded-full border border-border bg-background px-4 py-2 text-sm text-muted-foreground shadow-sm">
                  Ideal para consorcios y equipos de decisión
                </div>
                <div className="rounded-full border border-border bg-background px-4 py-2 text-sm text-muted-foreground shadow-sm">
                  Coordinación simple
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {benefits.map((benefit) => {
                const Icon = benefit.icon;

                return (
                  <Card key={benefit.title} className="bg-card/90">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-primary/10 p-2 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-semibold text-foreground">{benefit.title}</h2>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {benefit.description}
                        </p>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            <Card className="bg-card/95">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-1 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">Cómo transcurre la demo</p>
                  <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                    {walkthroughSteps.map((step, index) => (
                      <div key={step} className="flex gap-3">
                        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {index + 1}
                        </span>
                        <p className="leading-relaxed">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="border-emerald-200 bg-emerald-50 text-emerald-950">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 h-5 w-5 text-emerald-600" />
                <div>
                  <p className="font-semibold">Qué pasa después</p>
                  <p className="mt-1 text-sm leading-relaxed text-emerald-900/90">
                    Te contactamos para coordinar la presentación y entender si BuildingOS es la
                    opción correcta para tu equipo.
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-4 lg:sticky lg:top-24">
            <Card className="border-border bg-card/95 shadow-lg">
              <div className="flex items-center justify-between border-b border-border/60 pb-4 mb-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Paso 1</p>
                  <h2 className="text-2xl font-bold tracking-tight text-foreground">
                    Dejanos tus datos
                  </h2>
                </div>
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <ArrowRight className="h-5 w-5" />
                </div>
              </div>

              <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
                Te escribimos para coordinar una presentación guiada, sin obligarte a navegar la
                plataforma por tu cuenta.
              </p>

              <UnifiedLeadForm
                intent="DEMO"
                title="Solicitar demo guiada"
                subtitle="Completá tus datos y coordinamos el próximo paso."
                successTitle="Solicitud recibida"
                successMessage="Te vamos a contactar pronto para agendar la demo guiada."
              />
            </Card>

            <Card className="bg-muted/40">
              <p className="text-sm font-semibold text-foreground">¿Querés ver el producto ya?</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Si preferís explorar por tu cuenta, entrá a la demo interactiva desde el login demo.
              </p>
              <div className="mt-4">
                <Button asChild variant="secondary" className="w-full">
                  <Link href="/demo">Explorar demo</Link>
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}
