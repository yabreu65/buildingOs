# SUPER_ADMIN Dashboard — Plan de Implementación Detallado

## Fase 1: Setup (1 día)

### 1.1 Crear estructura de carpetas
```bash
apps/web/features/super-admin/
├── super-admin.types.ts          # Types: Tenant, User SUPER_ADMIN
├── tenants.storage.ts            # CRUD tenants (localStorage)
├── super-admin-layout.tsx         # Sidebar + protección rol
├── pages/
│   ├── overview.tsx              # Dashboard con widgets
│   ├── tenants/
│   │   ├── list.tsx              # Tabla de tenants
│   │   ├── create.tsx            # Wizard crear tenant
│   │   └── detail.tsx            # Modal/drawer detalles
│   └── placeholder/
│       ├── users.tsx             # Placeholder
│       └── audit-logs.tsx        # Placeholder
├── components/
│   ├── TenantTable.tsx           # Componente tabla
│   ├── OverviewWidgets.tsx       # Componentes de widgets
│   ├── TenantCreateWizard.tsx    # Wizard (pasos)
│   └── TenantActions.tsx         # Botones de acciones
└── hooks/
    └── useSuperAdminContext.ts   # Hook para contexto
```

### 1.2 Actualizar estructura de rutas
```
apps/web/app/
├── (auth)/
│   ├── login/
│   └── signup/
│
├── super-admin/                   # NUEVA
│   ├── layout.tsx
│   ├── overview/
│   │   └── page.tsx
│   ├── tenants/
│   │   ├── page.tsx
│   │   ├── create/
│   │   │   └── page.tsx
│   │   └── [tenantId]/
│   │       └── page.tsx
│   ├── users/
│   │   └── page.tsx
│   └── audit-logs/
│       └── page.tsx
│
└── (tenant)/
    └── [tenantId]/
        ├── layout.tsx (actualizar)
        ├── dashboard/
        │   └── page.tsx
        ├── buildings/
        └── units/
```

---

## Fase 2: Types y Storage Layer (1 día)

### 2.1 super-admin.types.ts
```typescript
// Tenant
export type Tenant = {
  id: string;
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED';
  plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
  ownerId?: string;
  createdAt: string;
  updatedAt?: string;
  limits?: {
    buildings: number;
    units: number;
    users: number;
  };
};

export type CreateTenantInput = {
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
  ownerEmail: string;
};

export type UpdateTenantInput = Partial<{
  name: string;
  plan: PlanType;
  status: TenantStatus;
}>;
```

### 2.2 tenants.storage.ts
```typescript
// Funciones CRUD
export function listTenants(): Tenant[]
export function getTenantById(tenantId: string): Tenant | null
export function createTenant(input: CreateTenantInput): Tenant
export function updateTenant(tenantId: string, input: UpdateTenantInput): Tenant
export function deleteTenant(tenantId: string): void

// Helpers
export function calculateLimits(plan: PlanType): Limits
export function getTenantStats(tenantId: string): {
  buildingsCount: number;
  unitsCount: number;
  usersCount: number;
}
export function getGlobalStats(): {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  totalBuildings: number;
  totalUnits: number;
  totalResidents: number;
}
```

### 2.3 Seed inicial
```typescript
// Crear 2-3 tenants de demo para testing
export function seedSuperAdminIfEmpty(): void
```

---

## Fase 3: Components (1-1.5 días)

### 3.1 super-admin-layout.tsx
```typescript
// Layout con:
// - Sidebar con menú (Overview, Tenants, Users, Audit Logs, Settings)
// - Breadcrumb dinámico
// - Protección rol SUPER_ADMIN
// - Logo/branding SaaS
```

### 3.2 overview.tsx
```typescript
// Renderizar OverviewWidgets
// Mostrar:
// - Total Tenants
// - Tenants Activos / Trial / Suspendidos
// - Total Buildings / Units / Residents
// - Botones de acciones rápidas
```

### 3.3 list.tsx (Tenants)
```typescript
// Renderizar TenantTable
// Funcionalidades:
// - Mostrar tabla con columnas (name, type, status, plan, buildings, users, actions)
// - Buscar por nombre
// - Filtrar por status/plan
// - Paginación (opcional para MVP)
// - Row actions (Entrar, Editar, Suspender, Ver detalles)
```

### 3.4 create.tsx (Wizard)
```typescript
// Renderizar TenantCreateWizard
// Pasos:
// 1. Información básica (name, type)
// 2. Plan y contacto (plan, ownerEmail)
// 3. Review & crear
// - Validación Zod + RHF
// - Feedback messages
```

### 3.5 detail.tsx (Drawer)
```typescript
// Modal/drawer con detalles de tenant:
// - Mostrar datos completos
// - Botones: Editar, Entrar, Suspender, Cerrar
// - (Opcional: Historial de cambios)
```

---

## Fase 4: Context y Middleware (0.5 día)

### 4.1 SuperAdminContext
```typescript
export type SuperAdminContextType = {
  currentUser: User;
  activeTenantId?: string;
  setActiveTenant: (tenantId: string) => void;
};

export const SuperAdminContext = createContext<SuperAdminContextType>(null);
export const useSuperAdminContext = () => useContext(SuperAdminContext);
```

### 4.2 super-admin/layout.tsx (protección)
```typescript
export default function SuperAdminLayout({ children }) {
  const { currentUser } = useAuth();

  if (!currentUser?.roles?.includes('SUPER_ADMIN')) {
    redirect('/login');
  }

  return (
    <SuperAdminProvider>
      <div className="flex">
        <Sidebar />
        <main>{children}</main>
      </div>
    </SuperAdminProvider>
  );
}
```

### 4.3 "Entrar al Tenant"
```typescript
const handleEnterTenant = (tenantId: string) => {
  // Set localStorage
  localStorage.setItem('bo_active_tenant_id', tenantId);

  // Emitir evento
  emitBoStorageChange();

  // Redirect
  router.push(`/tenant/${tenantId}/dashboard`);
};
```

---

## Fase 5: Testing y QA (1 día)

### 5.1 Checklist de QA
- [ ] Crear tenant (wizard completo)
- [ ] Ver listado de tenants
- [ ] Editar tenant (campos actualizables)
- [ ] Suspender/Activar tenant (toggle status)
- [ ] "Entrar al Tenant" (navega a /tenant/{id}/dashboard)
- [ ] Overview muestra métricas correctas
- [ ] Búsqueda y filtros funcionan
- [ ] Protección rol SUPER_ADMIN funciona
- [ ] localStorage persiste datos
- [ ] 0 TypeScript errors
- [ ] 0 breaking changes

---

## Cambios a Archivos Existentes

### authContext.ts (actualizar)
```typescript
// Agregar campo
type User = {
  ...
  roles: string[]; // ['SUPER_ADMIN'] | ['TENANT_OWNER'] | ['RESIDENT']
};

// Agregar campo al contexto
type AuthContextType = {
  ...
  activeTenantId?: string;
  setActiveTenantId: (id: string) => void;
};
```

### (tenant)/layout.tsx (actualizar)
```typescript
// Usar activeTenantId del context en lugar de hardcoded tenantId
const { activeTenantId } = useAuth();
const tenantId = activeTenantId || params.tenantId;

// Si no hay activeTenantId, mostrar un selector de tenant
// (UX: "Selecciona un tenant para continuar")
```

### AuthBootstrap.tsx (actualizar)
```typescript
// Detectar rol SUPER_ADMIN
// Si es SUPER_ADMIN, redirigir a /super-admin/overview
// Si es TENANT_OWNER, set activeTenantId del usuario
```

---

## Dependencies (No agregar nuevas)
```
zod            ✓ (ya instalado)
react-hook-form ✓ (ya instalado)
next           ✓ (ya instalado)
```

---

## Estimación Final
- Phase 1 (Setup): 1 día
- Phase 2 (Storage): 1 día
- Phase 3 (Components): 1-1.5 días
- Phase 4 (Context): 0.5 día
- Phase 5 (QA): 1 día
- **Total: 4-5 días (1 dev)**

---

## Crítico: Decidir ahora
1. ¿Pausamos Units QA para priorizar SUPER_ADMIN?
2. ¿O hacemos ambos en paralelo?
3. ¿Timeline esperado para SUPER_ADMIN MVP v0?

---

## Decisión PM
🔴 **SI** pausamos Units → Enfocarse 100% en SUPER_ADMIN
🟢 **O** paralelo → 1 dev Units, 1 dev SUPER_ADMIN

**Recomendación:** 🔴 Pausar Units, completar SUPER_ADMIN primero.
Razón: SUPER_ADMIN es bloqueante para UX coherente.
