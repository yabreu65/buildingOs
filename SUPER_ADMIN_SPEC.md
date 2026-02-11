# SUPER_ADMIN Dashboard — Especificación MVP v0

## Decisión de Producto
**Cambio de prioridades:** Implementar SUPER_ADMIN Dashboard ANTES de expandir Units.

**Razón:** Units es un submódulo dentro de Tenant → Building. Necesitamos el "entry point" claro.

---

## Arquitectura de Roles y Navegación

```
┌─────────────────────────────────────────────────────────────┐
│ SUPER_ADMIN Dashboard (SaaS Owner)                          │
│ ├─ Overview (métricas globales)                            │
│ ├─ Tenants (crear, ver, editar, suspender)                │
│ ├─ Platform Users (super admins internos)                  │
│ └─ Audit Logs / Settings (placeholders)                    │
│                                                              │
│ ACCIÓN: "Ingresar al Tenant" → Cambiar contexto           │
│                                ↓                             │
├─────────────────────────────────────────────────────────────┤
│ TENANT Dashboard (Tenant Owner/Admin)                       │
│ ├─ Overview (métricas del tenant)                          │
│ ├─ Buildings (listado, crear, editar)                      │
│ │   └─ ACCIÓN: "Ver Building" → Cambiar contexto           │
│ │                ↓                                           │
│ ├─ Units (solo dentro de un building)                      │
│ ├─ Residents                                                │
│ └─ Operaciones (pagos, tickets, etc.)                      │
└─────────────────────────────────────────────────────────────┘

Breadcrumb: SUPER_ADMIN > Tenants > {Tenant} > Buildings > Units
```

---

## Pantalla 1: Overview (SUPER_ADMIN)

### Widgets
| Widget | Cálculo | Purpose |
|--------|---------|---------|
| Total Tenants | COUNT(tenants) | Visión rápida |
| Tenants Activos | COUNT(status=ACTIVE) | Health check |
| Tenants Trial | COUNT(status=TRIAL) | Onboarding tracking |
| Tenants Suspendidos | COUNT(status=SUSPENDED) | Risk monitoring |
| Total Buildings | SUM(buildings por tenant) | Scale visualization |
| Total Units | SUM(units por building) | Platform load |
| Total Residents | SUM(residents por unit) | User base |

### Acciones Rápidas
- Button: "+ Crear Tenant"
- Button: "Ver Tenants"

### Componente
```typescript
interface OverviewWidget {
  title: string;
  value: number;
  trend?: 'up' | 'down' | 'stable';
  link?: string; // para navegar a Tenants, etc.
}
```

---

## Pantalla 2: Tenants (Listado + CRUD)

### Tabla: columns
```
| Tenant Name | Type | Status | Plan | Buildings | Users | Created | Actions |
|-------------|------|--------|------|-----------|-------|---------|---------|
| Acme Corp   | ADM  | ACTIVE | PRO  | 3         | 12    | 2026... | ... |
| XYZ Bldg    | EDIF | TRIAL  | FREE | 1         | 2     | 2026... | ... |
```

### Status Badges
```typescript
type TenantStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED';
// Visual: TRIAL=blue, ACTIVE=green, SUSPENDED=red
```

### Plan (MVP)
```typescript
type PlanType = 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
// MVP: almacenar como string, sin límites enforced
// Future: agregar `limits` object con validación
```

### Type
```typescript
type TenantType = 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
// ADMINISTRADORA: Empresa inmobiliaria (múltiples edificios)
// EDIFICIO_AUTOGESTION: Consorcio individual (1 edificio)
```

### Row Actions
- **"Entrar al Tenant"** → Set `activeTenantId` en context/session → Redirect a `/tenant/{id}/dashboard`
- **"Editar"** → Modal o drawer con campos: name, type, plan, status
- **"Suspender/Activar"** → Toggle status ACTIVE ↔ SUSPENDED (confirm dialog)
- **"Ver Detalles"** → Drawer con info completa + historial

### Filtros/Buscar (MVP simple)
- Buscar por nombre (text input)
- Filter por status (dropdown)
- Filter por plan (dropdown)

---

## Pantalla 3: Crear Tenant (Wizard)

### Step 1: Información Básica
```
- Tenant Name (required, min 2 chars)
- Tenant Type (required, radio/select):
  ○ ADMINISTRADORA (empresa inmobiliaria)
  ○ EDIFICIO_AUTOGESTION (consorcio)
```

### Step 2: Plan y Contacto
```
- Plan (required, select):
  ○ FREE (limits: 1 building, 10 units, 20 users)
  ○ BASIC (limits: 5 buildings, 50 units, 100 users)
  ○ PRO (limits: 20 buildings, 500 units, 500 users)
  ○ ENTERPRISE (unlimited, custom)

- Owner Email (required, email validation)
```

### Step 3: Review & Create
```
- Mostrar resumen
- Botones: "Crear" | "Volver"
```

### On Success
```
1. Crear tenant:
   {
     id: "tenant_...",
     name: input.name,
     type: input.type,
     plan: input.plan,
     status: 'TRIAL', // default para nuevos
     createdAt: now,
     limits: calculateLimits(plan) // opcional en MVP
   }

2. Crear TENANT_OWNER user:
   {
     id: "user_...",
     email: input.email,
     roles: ['TENANT_OWNER'],
     tenantId: createdTenant.id
   }

3. Redirect: → /super-admin/tenants (success message)
```

---

## Data Model (localStorage MVP)

### Tenant Schema
```typescript
type Tenant = {
  id: string; // "tenant_<timestamp>_<random>"
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED';
  plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
  ownerId?: string; // user ID del TENANT_OWNER
  createdAt: string; // ISO datetime
  updatedAt?: string;
  limits?: {
    buildings: number;
    units: number;
    users: number;
  };
};
```

### Storage Keys
```
bo_tenants_<SUPER_ADMIN_ID>: Tenant[]
bo_users: User[] (global, sin tenant)
```

---

## Routing y Protección

### Routes
```
/super-admin
  /super-admin/overview         → Overview dashboard
  /super-admin/tenants          → Listado
  /super-admin/tenants/create   → Wizard crear
  /super-admin/tenants/:id      → Detalle (drawer/modal)
```

### Middleware
```typescript
// Proteger todas las rutas /super-admin
// Si usuario NO tiene rol SUPER_ADMIN:
//   → Redirect a /login
// Si es TENANT_OWNER o RESIDENT:
//   → Redirect a /tenant/{tenantId}/dashboard
```

---

## Context/State (para MVP)

### App Context
```typescript
type AppContext = {
  currentUser?: User;
  activeTenantId?: string; // "tenant_..."
  activeBuildingId?: string; // para Units

  setActiveTenant: (tenantId: string) => void;
  setActiveBuilding: (buildingId: string) => void;
};
```

### localStorage
```
bo_active_tenant_id: string | null
bo_active_building_id: string | null
```

---

## Componentes Necesarios

```
📂 apps/web/
├── features/super-admin/
│   ├── super-admin.types.ts          (Tenant, User types)
│   ├── tenants.storage.ts            (CRUD para tenants)
│   ├── super-admin-layout.tsx         (Sidebar + protección)
│   ├── pages/
│   │   ├── overview.tsx              (dashboard)
│   │   ├── tenants/list.tsx          (listado)
│   │   ├── tenants/create.tsx        (wizard)
│   │   └── tenants/detail.tsx        (drawer/modal)
│   └── components/
│       ├── TenantTable.tsx
│       ├── OverviewWidgets.tsx
│       ├── TenantCreateWizard.tsx
│       └── TenantActions.tsx
│
├── features/auth/
│   ├── authContext.ts (actualizar con activeTenantId)
│   └── AuthBootstrap.tsx
│
└── app/
    ├── (auth)/
    │   └── layout.tsx
    ├── super-admin/ (NEW)
    │   └── layout.tsx (sidebar + routing)
    └── (tenant)/
        └── [tenantId]/
            └── layout.tsx (actualizar para usar activeTenantId)
```

---

## Criterio de Aceptación

### MVP v0 Completado cuando:
- [x] Crear tenant (wizard funcional)
- [x] Ver listado de tenants (tabla)
- [x] Editar tenant (nombre, type, plan, status)
- [x] Suspender/Activar tenant
- [x] "Entrar al Tenant" (set activeTenantId)
- [x] Overview con widgets básicos
- [x] Breadcrumb correcto
- [x] Protección por rol SUPER_ADMIN
- [x] localStorage persiste datos
- [x] 0 TypeScript errors

### NO en MVP v0 (Future):
- [ ] Audit logs (solo placeholder)
- [ ] Platform Users (solo placeholder)
- [ ] Plan limits enforcement (solo almacenar)
- [ ] Multi-tenancy avanzada (impersonation completa)

---

## Timeline Estimado
- Design/spec: ✓ (este documento)
- Implementation: 2-3 días (1 dev)
- QA: 1 día
- Total: 3-4 días

---

## Siguiente Paso
Implementar SUPER_ADMIN Dashboard MVP v0 con especificaciones arriba.
Una vez completo → Units se accede dentro de Tenant context.
