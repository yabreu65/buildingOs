'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SuperAdminProvider } from '@/features/super-admin/super-admin-context';
import { useAuth } from '@/features/auth/useAuth';
import { useIsSuperAdmin, useAuthSession } from '@/features/auth/useAuthSession';
import { UserMenu } from '@/features/super-admin/components/UserMenu';

/**
 * Layout de SUPER_ADMIN Dashboard
 * Protegido por rol SUPER_ADMIN
 */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoading: authLoading } = useAuth();
  const session = useAuthSession();
  const isSuperAdmin = useIsSuperAdmin();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    // Wait for auth to load
    if (authLoading) {
      return;
    }

    // Rule 1: No session → redirect to /login (unauthenticated)
    if (!session) {
      router.replace('/login');
      return;
    }

    // Rule 2: Has session but NOT SUPER_ADMIN → redirect to tenant dashboard
    if (!isSuperAdmin) {
      const tenantId = session.activeTenantId;
      router.replace(tenantId ? `/${tenantId}/dashboard` : '/login');
      setIsAuthorized(false);
      return;
    }

    // Rule 3: Has session AND is SUPER_ADMIN → allow access
    setIsAuthorized(true);
  }, [session, isSuperAdmin, authLoading, router]);

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-screen">Cargando...</div>;
  }

  if (!isAuthorized) {
    return null; // La redirección se maneja en useEffect
  }

  const navLinkClass = (href: string) => {
    const isActive = pathname === href || pathname.startsWith(`${href}/`);
    return [
      'block rounded-md px-4 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent text-foreground',
    ].join(' ');
  };

  return (
    <SuperAdminProvider>
      <div className="flex min-h-screen bg-background">
        {/* Sidebar */}
        <aside className="relative w-64 border-r border-border bg-muted/30">
          <div className="p-6">
            <h1 className="text-xl font-bold">BuildingOS</h1>
            <p className="text-xs text-muted-foreground">SUPER_ADMIN</p>
          </div>

          <nav className="space-y-2 px-4" aria-label="Navegación del super administrador">
            <Link
              href="/super-admin/overview"
              className={navLinkClass('/super-admin/overview')}
            >
              Visión general
            </Link>
            <Link
              href="/super-admin/leads"
              className={navLinkClass('/super-admin/leads')}
            >
              Prospectos
            </Link>
            <Link
              href="/super-admin/tenants"
              className={navLinkClass('/super-admin/tenants')}
            >
              Administradoras
            </Link>
            <Link
              href="/super-admin/ai-analytics"
              className={navLinkClass('/super-admin/ai-analytics')}
            >
              Uso de IA
            </Link>
            <Link
              href="/super-admin/assistant-analytics"
              className={navLinkClass('/super-admin/assistant-analytics')}
            >
              Acciones del asistente
            </Link>
            <Link
              href="/super-admin/users"
              className={navLinkClass('/super-admin/users')}
            >
              Usuarios globales
            </Link>
            <Link
              href="/super-admin/audit-logs"
              className={navLinkClass('/super-admin/audit-logs')}
            >
              Registro de auditoría
            </Link>
          </nav>

          <div className="absolute bottom-4 left-4 right-4">
            {session && (
              <UserMenu
                email={session.user.email}
                name={session.user.name}
              />
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </SuperAdminProvider>
  );
}
