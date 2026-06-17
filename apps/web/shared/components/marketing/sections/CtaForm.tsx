import Link from 'next/link';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { ArrowRight, MessageCircle, Sparkles } from 'lucide-react';

export default function CtaForm() {
  return (
    <section id="demo" className="py-20 bg-primary text-primary-foreground">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] items-start">
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1 text-sm text-primary-foreground/90">
              <Sparkles className="h-4 w-4" />
              Elegí cómo querés conocer BuildingOS
            </div>

            <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl text-primary-foreground">
              ¿Querés una demo guiada o explorar por tu cuenta?
            </h2>
            <p className="mt-4 text-lg text-primary-foreground/80 max-w-2xl lg:mx-0 mx-auto">
              Podés hablar con el equipo comercial o entrar directamente a la experiencia demo del producto.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3 text-left">
              <Card className="bg-primary-foreground/10 border-primary-foreground/15 text-primary-foreground shadow-none">
                <div className="flex items-start gap-3">
                  <MessageCircle className="mt-1 h-5 w-5 text-primary-foreground/90" />
                  <div>
                    <p className="font-semibold">Guía comercial</p>
                    <p className="mt-1 text-sm text-primary-foreground/75">
                      Hablá con un especialista.
                    </p>
                  </div>
                </div>
              </Card>
              <Card className="bg-primary-foreground/10 border-primary-foreground/15 text-primary-foreground shadow-none">
                <div className="flex items-start gap-3">
                  <ArrowRight className="mt-1 h-5 w-5 text-primary-foreground/90" />
                  <div>
                    <p className="font-semibold">Exploración libre</p>
                    <p className="mt-1 text-sm text-primary-foreground/75">
                      Entrá a la demo interactiva.
                    </p>
                  </div>
                </div>
              </Card>
              <Card className="bg-primary-foreground/10 border-primary-foreground/15 text-primary-foreground shadow-none">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-1 h-5 w-5 text-primary-foreground/90" />
                  <div>
                    <p className="font-semibold">Sin confusión</p>
                    <p className="mt-1 text-sm text-primary-foreground/75">
                      Dos caminos, dos objetivos distintos.
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="space-y-4">
            <Card className="bg-primary-foreground/10 border-primary-foreground/15 text-primary-foreground shadow-none">
              <h3 className="text-xl font-semibold">Demo guiada</h3>
              <p className="mt-2 text-sm text-primary-foreground/80">
                Un especialista te muestra el producto con foco en tu operación.
              </p>
              <div className="mt-5">
                <Link href="/demo-guiada" className="block">
                  <Button variant="secondary" className="w-full h-12 px-8 text-base">
                    Solicitar demo guiada
                  </Button>
                </Link>
              </div>
            </Card>

            <Card className="bg-primary-foreground/10 border-primary-foreground/15 text-primary-foreground shadow-none">
              <h3 className="text-xl font-semibold">Demo interactiva</h3>
              <p className="mt-2 text-sm text-primary-foreground/80">
                Explorá el producto con credenciales de prueba y datos de ejemplo.
              </p>
              <div className="mt-5">
                <Link href="/demo" className="block">
                  <Button variant="secondary" className="w-full h-12 px-8 text-base">
                    Explorar demo
                  </Button>
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
