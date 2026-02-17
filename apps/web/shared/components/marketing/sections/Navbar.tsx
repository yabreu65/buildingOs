import Link from "next/link";
import Button from "@/shared/components/ui/Button";

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-bold text-primary tracking-tight">
            BuildingOS
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <a href="#beneficios" className="hover:text-foreground transition-colors">
              Beneficios
            </a>
            <a href="#como-funciona" className="hover:text-foreground transition-colors">
              Cómo funciona
            </a>
            <a href="#modulos" className="hover:text-foreground transition-colors">
              Módulos
            </a>
            <a href="#faq" className="hover:text-foreground transition-colors">
              FAQ
            </a>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground hidden sm:block">
            Ingresar
          </Link>
          <a href="#demo">
            <Button size="sm">Pedir demo</Button>
          </a>
        </div>
      </div>
    </nav>
  );
}
