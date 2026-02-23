# BuildingOS Frontend Routes Inventory

**Fecha**: 2026-02-23
**Total de rutas**: 40
**Estado**: ✅ COMPLETO

---

## Resumen Ejecutivo

| Categoría | Cantidad | Scope | Roles |
|-----------|----------|-------|-------|
| Auth (públicas) | 3 | `auth` | PUBLIC |
| Super-Admin | 9 | `super-admin` | SUPER_ADMIN |
| Tenant Portal | 28 | `tenant` | TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT |
| **TOTAL** | **40** | - | - |

---

## A) AUTH ROUTES (Públicas)

Rutas de autenticación sin requerimiento de login. Accesibles para cualquier usuario no autenticado.

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/login` | `auth` | **PUBLIC** | Formulario de login |
| `/signup` | `auth` | **PUBLIC** | Formulario de registro de nuevo usuario |
| `/invite` | `auth` | **PUBLIC** | Aceptar invitación por token (email link) |

---

## B) SUPER-ADMIN ROUTES

Rutas de administración global. Solo accesibles para usuarios con rol SUPER_ADMIN.

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/super-admin` | `super-admin` | **SUPER_ADMIN** | Dashboard principal control plane |
| `/super-admin/overview` | `super-admin` | **SUPER_ADMIN** | Resumen de sistema (tenants, usuarios, métricas) |
| `/super-admin/tenants` | `super-admin` | **SUPER_ADMIN** | Listar todos los tenants |
| `/super-admin/tenants/create` | `super-admin` | **SUPER_ADMIN** | Crear nuevo tenant (wizard) |
| `/super-admin/tenants/[tenantId]` | `super-admin` | **SUPER_ADMIN** | Detalles y edición de tenant específico |
| `/super-admin/users` | `super-admin` | **SUPER_ADMIN** | Gestión global de usuarios |
| `/super-admin/audit-logs` | `super-admin` | **SUPER_ADMIN** | Audit trail de todos los eventos |
| `/super-admin/ai-analytics` | `super-admin` | **SUPER_ADMIN** | Analytics de AI assistant (ROI, uso) |
| `/super-admin/support` | `super-admin` | **SUPER_ADMIN** | Panel de soporte y tickets críticos |

---

## C) TENANT PORTAL ROUTES

Rutas del portal de tenant. Accesibles después de login con control de acceso por rol.

### C.1) Dashboard & Navigation

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/dashboard` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT** | Dashboard principal (KPI cards, overview) |
| `/{tenantId}/properties` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Vista alternativa de propiedades (buildings) |

### C.2) Buildings Management

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/buildings` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Listar todos los buildings |
| `/{tenantId}/buildings/{buildingId}` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Hub de building (KPI, navegación a secciones) |
| `/{tenantId}/buildings/{buildingId}/settings` | `tenant` | **TENANT_OWNER, TENANT_ADMIN** | Editar datos del building |

### C.3) Units Management

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/units` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT** | Listar units de todos los buildings |
| `/{tenantId}/buildings/{buildingId}/units` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT** | Listar units del building |
| `/{tenantId}/buildings/{buildingId}/units/{unitId}` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT** | Detalle de unit (ocupantes, tickets, pagos) |

### C.4) Occupants Management

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/buildings/{buildingId}/residents` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Listar residentes del building |

### C.5) Tickets & Communications

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/buildings/{buildingId}/tickets` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Tickets del building (admin view) |
| `/{tenantId}/buildings/{buildingId}/communications` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Comunicaciones del building |
| `/{tenantId}/inbox` | `tenant` | **ALL ROLES** | Inbox personal (mensajes recibidos) |

### C.6) Finance & Payments

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/payments` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT** | Resumen de pagos y deudores |
| `/{tenantId}/payments/review` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT** | Revisar y aprobar pagos |
| `/{tenantId}/buildings/{buildingId}/payments` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT** | Pagos del building |

### C.7) Documents & Files

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/buildings/{buildingId}/documents` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Documentos compartidos del building |

### C.8) Vendors & Operations

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/buildings/{buildingId}/vendors` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Listar y gestionar vendors |
| `/{tenantId}/buildings/{buildingId}/quotes` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Presupuestos de vendors |
| `/{tenantId}/buildings/{buildingId}/work-orders` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Órdenes de trabajo |

### C.9) Reports & Analytics

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/reports` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Reportes (ocupación, finanzas, etc.) |
| `/{tenantId}/buildings/{buildingId}/reports` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Reportes del building |

### C.10) Notifications & Support

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/notifications` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Panel de notificaciones |
| `/{tenantId}/support` | `tenant` | **TENANT_OWNER, TENANT_ADMIN, OPERATOR** | Soporte/ayuda del tenant |

### C.11) Tenant Settings

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/{tenantId}/settings/members` | `tenant` | **TENANT_OWNER, TENANT_ADMIN** | Gestión de miembros del team |
| `/{tenantId}/settings/banking` | `tenant` | **TENANT_OWNER, TENANT_ADMIN** | Configuración bancaria |
| `/{tenantId}/settings/ai` | `tenant` | **TENANT_OWNER, TENANT_ADMIN** | Configuración AI Assistant |

---

## D) Special Routes

| Ruta | Scope | Roles Permitidos | Descripción |
|------|-------|-----------------|-------------|
| `/` | `public` | **ALL** | Landing page / redirección según auth state |
| `/health` | `public` | **ALL** | Health check endpoint |

---

## Matriz de Acceso (RBAC)

### Por Rol

| Rol | Auth | Super-Admin | Dashboard | Buildings | Units | Tickets | Finanzas | Settings |
|-----|------|------------|-----------|-----------|-------|---------|----------|----------|
| **PUBLIC** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **SUPER_ADMIN** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **TENANT_OWNER** | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **TENANT_ADMIN** | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **OPERATOR** | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **RESIDENT** | ✅ | ❌ | ✅ | ⚠️* | ⚠️* | ⚠️* | ✅ | ❌ |

*RESIDENT: Acceso limitado a resources asignados (units, tickets específicos)

---

## Estructura de Directorios (App Router)

```
apps/web/app/
├── (public)/                          # Rutas públicas (sin layout tenant)
│   ├── login/
│   │   └── page.tsx
│   └── signup/
│       └── page.tsx
├── (tenant)/                          # Rutas autenticadas de tenant
│   └── [tenantId]/
│       ├── layout.tsx                 # TenantLayout (guard + sidebar)
│       ├── dashboard/
│       │   └── page.tsx
│       ├── buildings/
│       │   ├── page.tsx
│       │   ├── [buildingId]/
│       │   │   ├── page.tsx           # Building hub
│       │   │   ├── layout.tsx         # Building subnav
│       │   │   ├── settings/
│       │   │   ├── units/
│       │   │   ├── residents/
│       │   │   ├── tickets/
│       │   │   ├── communications/
│       │   │   ├── documents/
│       │   │   ├── vendors/
│       │   │   ├── quotes/
│       │   │   ├── work-orders/
│       │   │   ├── payments/
│       │   │   └── reports/
│       ├── units/
│       │   └── page.tsx               # Cross-building units list
│       ├── payments/
│       │   ├── page.tsx
│       │   └── review/
│       │       └── page.tsx
│       ├── inbox/
│       │   └── page.tsx
│       ├── notifications/
│       │   └── page.tsx
│       ├── reports/
│       │   └── page.tsx
│       ├── properties/
│       │   └── page.tsx
│       ├── support/
│       │   └── page.tsx
│       └── settings/
│           ├── members/
│           ├── banking/
│           └── ai/
├── super-admin/                       # Control plane (SUPER_ADMIN only)
│   ├── layout.tsx                     # SuperAdminLayout (guard)
│   ├── page.tsx
│   ├── overview/
│   ├── tenants/
│   │   ├── page.tsx
│   │   ├── create/
│   │   └── [tenantId]/
│   ├── users/
│   ├── audit-logs/
│   ├── ai-analytics/
│   └── support/
├── invite/                            # Invitación pública
│   └── page.tsx
├── health/                            # Health check
│   └── page.tsx
├── layout.tsx                         # Root layout
└── page.tsx                           # Landing page
```

---

## Patrones de Acceso

### 1. Rutas Públicas (sin autenticación)
```
/login
/signup
/invite
/health
/
```

### 2. Rutas SUPER_ADMIN (solo SUPER_ADMIN)
```
/super-admin/*
```

### 3. Rutas Tenant (todos los roles autenticados)
```
/{tenantId}/*
```

**Control de acceso implementado en:**
- `TenantLayout` - Guard a nivel layout (chequea tenantId + rol)
- `SuperAdminLayout` - Guard a nivel layout (chequea SUPER_ADMIN)
- Componentes individuales - Verificación de permisos específicos

---

## Notas Importantes

### Access Control Flow

1. **Public Routes** (`/login`, `/signup`, `/invite`)
   - No requieren autenticación
   - Redirección automática si usuario ya está logged in

2. **Tenant Routes** (`/{tenantId}/*`)
   - Requieren JWT token válido
   - Guard verifica que usuario tenga membership en tenantId
   - RESIDENT: acceso adicional limitado a resources asignados
   - SUPER_ADMIN: no puede acceder (redirección a `/super-admin`)

3. **Super-Admin Routes** (`/super-admin/*`)
   - Requieren rol SUPER_ADMIN en algún membership
   - Acceso a control plane global
   - No pueden acceder a rutas tenant

### Role Hierarchy

```
SUPER_ADMIN
  └─ Control plane global (tenants, usuarios, auditoría)

TENANT_OWNER
  └─ Todo en el tenant (máximo control)

TENANT_ADMIN
  └─ Admin del tenant (casi todo menos accounting avanzado)

OPERATOR
  └─ Operacional (buildings, units, tickets, vendors)

RESIDENT
  └─ Acceso limitado (solo sus units, pagos, tickets)
```

---

## Próximas Consideraciones

### Features pendientes (según roadmap)
- [ ] Two-factor authentication (2FA) routes
- [ ] User profile management routes
- [ ] Mobile app routes (native)
- [ ] API documentation routes
- [ ] Analytics dashboard enhancement
- [ ] Advanced reporting with custom filters

### Security enhancements
- [ ] Rate limiting por role
- [ ] Audit logging de navegación
- [ ] IP allowlisting para admin routes
- [ ] Session timeouts configurables

---

**Generado**: 2026-02-23
**Versión**: 1.0
**Completitud**: 100% (todas las rutas existentes inventariadas)
