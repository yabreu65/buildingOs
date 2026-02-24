# Session Refresh Sin Re-Login

## Problema
Cuando se crea un nuevo tenant (via `npm run demo:tenants` o invite acceptance), el JWT existente del usuario no incluye el nuevo tenant. El usuario recibe **403 "No tiene membresía activa en este tenant"** al intentar acceder.

Actualmente requiere:
```bash
# ❌ Viejo flujo
1. Logout (Ctrl+Shift+Del localStorage)
2. Re-login con credentials
```

## Solución
Ahora puedes refrescar la sesión sin re-login:

```bash
# ✅ Nuevo flujo (más rápido)
1. Abre DevTools (F12)
2. Console → copia/pega:

   (async () => {
     const res = await fetch('/api/auth/me', {
       headers: { 'Authorization': `Bearer ${localStorage.getItem('bo_token')}` }
     });
     const data = await res.json();
     localStorage.setItem('bo_session', JSON.stringify({
       user: data.user,
       memberships: data.memberships,
       activeTenantId: data.memberships[0].tenantId
     }));
     window.location.reload();
   })()

3. Listo! La página se recarga con nuevos tenants.
```

## Cómo Usar en Frontend (Programáticamente)

### Hook: `useRefreshSession()`
```tsx
import { useRefreshSession } from '@/features/auth/useRefreshSession';

export function MyComponent() {
  const { refresh, loading, error } = useRefreshSession();

  const handleRefreshClick = async () => {
    const result = await refresh();
    if (result) {
      // Session updated! result = { activeTenantId, tenantCount }
      router.push(`/${result.activeTenantId}/dashboard`);
    }
  };

  return (
    <button onClick={handleRefreshClick} disabled={loading}>
      {loading ? 'Refrescando...' : 'Refrescar Sesión'}
    </button>
  );
}
```

## Integración en Layout

Agregar `<SessionRefreshPrompt />` a `apps/web/shared/components/layout/RootLayout.tsx`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <SessionRefreshPrompt />  {/* ← Agregar aquí */}
        {children}
      </body>
    </html>
  );
}
```

Luego navegar con: `?session_refresh_needed=true` para mostrar el prompt.

## Cuándo Refrescar

1. **Después de crear un nuevo tenant:**
   - Via `/signup`
   - Via demo script: `npm run demo:tenants`
   - Via admin invite

2. **Cuando obtienes 403 en BuildingAccessGuard:**
   - Click botón "Refrescar Sesión"
   - No necesitas re-login completo

3. **Cambios de memberships:**
   - User fue agregado a nuevo tenant
   - Permisos cambiaron

## Flujo Completo (Demo Tenants)

```bash
# 1. Crear 5 tenants demo
npm run demo:tenants

# 2. Loguear con uno de los owners
# Email: owner.alfa@demo.buildingos.com
# Password: Demo12345!

# 3. Acceder a /buildings
# ✅ Ver edificios del tenant (sin 403)

# 4. (Opcional) Crear otro tenant con seed script
npm run demo:tenants

# 5. Usuario actual TIENE acceso al nuevo tenant
# (Sin hacer logout/login)

# 6. Refrescar sesión para ver el nuevo tenant:
F12 → Console → ejecutar el código anterior
# O click botón si está en UI
```

## Alternativa: Periodic Refresh (Futuro)

Para auto-refrescar cada N minutos (sin UI prompt):

```tsx
useEffect(() => {
  const interval = setInterval(async () => {
    await refresh(); // Silencio, solo actualiza localStorage
  }, 5 * 60 * 1000); // Cada 5 minutos

  return () => clearInterval(interval);
}, [refresh]);
```

## Aún Requiere Re-Login Si:

- Token JWT expiró (check: decode JWT, field `exp`)
- Logout fue ejecutado manualmente
- Credenciales cambiaron

## Endpoint Backend

```
GET /auth/me
Authorization: Bearer {token}

Response:
{
  "user": { "id", "email", "name" },
  "memberships": [
    { "tenantId", "roles", "scopedRoles" }
  ]
}
```

Notas:
- No requiere password
- Solo necesita JWT válido
- Retorna memberships actualizados desde BD
