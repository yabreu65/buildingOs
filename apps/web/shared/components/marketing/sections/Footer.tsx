import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-background border-t border-border py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-primary tracking-tight">BuildingOS</span>
            <span className="text-sm text-muted-foreground">© {new Date().getFullYear()}</span>
          </div>
          
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground transition-colors">
              Ingreso clientes
            </Link>
            <a href="#" className="hover:text-foreground transition-colors">
              Contacto
            </a>
            <a href="#" className="hover:text-foreground transition-colors">
              Política de privacidad
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
