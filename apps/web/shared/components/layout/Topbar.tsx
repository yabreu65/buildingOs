'use client';

import { useRouter, useParams } from 'next/navigation';
import { getSession, setSession, setLastTenant, clearAuth } from '../../../features/auth/session.storage';
import { useTenants } from '../../../features/tenants/tenants.hooks';
import Select from '../ui/Select';

export default function Topbar() {
  const router = useRouter();
  const params = useParams();
  const urlTenantId = params?.tenantId as string | undefined;

  const session = getSession();
  const { data: tenants, isLoading, error } = useTenants();

  // Determinar tenant activo: URL > session.activeTenantId > memberships[0]
  const activeTenantId =
    urlTenantId || session?.activeTenantId || session?.memberships[0]?.tenantId || '-';

  // Obtener tenant actual con nombre (fallback a ID si no está en la lista)
  const activeTenant = tenants?.find((t) => t.id === activeTenantId);
  const activeTenantName = activeTenant?.name || activeTenantId;

  // Obtener rol del usuario en el tenant activo
  const activeMembership = session?.memberships.find((m) => m.tenantId === activeTenantId);
  const role = activeMembership?.roles[0] || 'Guest';

  const handleTenantChange = (nextTenantId: string) => {
    if (!session) return;

    // Actualizar sesión con nuevo tenant activo
    setSession({
      ...session,
      activeTenantId: nextTenantId,
    });

    // Persistir último tenant
    setLastTenant(nextTenantId);

    // Navegar al dashboard del nuevo tenant
    router.replace(`/${nextTenantId}/dashboard`);
  };

  const handleLogout = () => {
    clearAuth();
    router.replace('/login');
  };

  // Si no hay sesión, mostrar estado vacío
  if (!session) {
    return (
      <header className="h-14 border-b border-border bg-card text-card-foreground flex items-center justify-between px-4">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </header>
    );
  }

  // Mostrar selector de tenant si hay múltiples memberships
  const canSelectTenant = session.memberships.length > 1;

  // Fallback si no hay tenants cargados: mostrar por ID
  const fallbackTenants = tenants || session.memberships.map((m) => ({
    id: m.tenantId,
    name: m.tenantId,
    type: 'EDIFICIO_AUTOGESTION' as const,
  }));

  return (
    <header className="h-14 border-b border-border bg-card text-card-foreground flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <div className="text-sm font-semibold">BuildingOS</div>

        {canSelectTenant ? (
          <div className="flex items-center gap-2">
            <label htmlFor="tenant-select" className="text-xs text-muted-foreground">
              {isLoading ? 'Cargando...' : 'Edificio:'}
            </label>
            <Select
              id="tenant-select"
              value={activeTenantId}
              onChange={(e) => handleTenantChange(e.target.value)}
              className="text-xs"
              disabled={isLoading}
            >
              {fallbackTenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            {error && (
              <span className="text-xs text-red-500" title="Error al cargar tenants">
                ⚠️
              </span>
            )}
          </div>
        ) : (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
            {activeTenantName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
          {role}
        </span>

        <button
          className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>
    </header>
  );
}
