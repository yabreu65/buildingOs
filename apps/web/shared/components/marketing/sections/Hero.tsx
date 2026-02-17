import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Badge from "@/shared/components/ui/Badge";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-linear-to-b from-muted/60 to-background pt-24 pb-20 lg:pt-32 lg:pb-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="flex flex-col gap-6 text-center lg:text-left">
            <div className="inline-flex items-center justify-center lg:justify-start">
              <Badge className="bg-accent/15 text-accent border border-accent/30 hover:bg-accent/15">
                MVP: Pagos por transferencia + comprobante
              </Badge>
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Administrá tu condominio{" "}
              <span className="text-primary">sin caos</span>
            </h1>

            <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto lg:mx-0">
              Pagos, reclamos, comunicaciones y control por edificio. La plataforma multi-tenant
              diseñada para administradoras que buscan orden y confianza.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <a href="#demo" className="w-full sm:w-auto">
                <Button size="md" className="w-full h-12 px-8 text-base">
                  Pedir demo
                </Button>
              </a>
              <a href="#como-funciona" className="w-full sm:w-auto">
                <Button
                  variant="secondary"
                  size="md"
                  className="w-full h-12 px-8 text-base"
                >
                  Ver cómo funciona
                </Button>
              </a>
            </div>
          </div>

          {/* Right Preview */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-full">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary to-accent rounded-2xl blur opacity-20" />
            <Card className="relative bg-card/80 backdrop-blur border-border shadow-xl p-6">
              <div className="flex items-center justify-between border-b border-border/60 pb-4 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-danger/80" />
                  <div className="w-3 h-3 rounded-full bg-warning/80" />
                  <div className="w-3 h-3 rounded-full bg-success/80" />
                </div>
                <div className="text-xs font-medium text-muted-foreground">
                  BuildingOS Preview
                </div>
              </div>

              <div className="space-y-4">
                {/* Mock Row 1 */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                      $
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        Pagos pendientes
                      </div>
                      <div className="text-xs text-muted-foreground">
                        3 por revisar
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-warning">Revisar</div>
                </div>

                {/* Mock Row 2 */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center text-accent text-xs font-bold">
                      !
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        Reclamos abiertos
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Sin asignar
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-primary">Gestionar</div>
                </div>

                {/* Mock Row 3 */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                      U
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        Unidades
                      </div>
                      <div className="text-xs text-muted-foreground">
                        120 registradas
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Actualizado
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
