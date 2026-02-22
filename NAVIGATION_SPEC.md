# BuildingOS — NAVIGATION_SPEC (Dashboards & UX Flows)

Fecha: 2026-02-22  
Owner: Producto / UX / Frontend  
Estado: Living spec  

---

# 0) Propósito

Este documento define la **navegación oficial del SaaS BuildingOS**:

- Dashboards jerárquicos
- Rutas
- Contexto activo
- Sidebars
- Flujos UX
- Visibilidad por rol

NO define:

- DB
- Backend
- Permisos
- Arquitectura

Eso vive en `ARCHITECTURE.md`.

Este documento responde a:

👉 qué pantallas existen  
👉 cómo se navega  
👉 qué contexto está activo  
👉 qué ve cada rol  

---

# 1) Modelo de Contexto (fundamental)

Toda pantalla autenticada debe conocer:

```ts
type AppContext = {
  tenantId?: string
  buildingId?: string
  unitId?: string
  activeRole: Role
  scope?: {
    buildingScope?: string | null
    unitScope?: string | null
  }
}
2) Reglas de URL (canónicas)
Global (sin tenant)
/super-admin/*
Tenant
/(tenant)/[tenantId]/*
Building
/(tenant)/[tenantId]/buildings/[buildingId]/*
Unit
/(tenant)/[tenantId]/units/[unitId]/*
3) Reglas de Consistencia

Si hay buildingId → debe existir tenantId

Si hay unitId → debe existir tenantId

Building/unit deben pertenecer al tenant (backend)

UI nunca confía en sí misma para seguridad

4) Flujo Macro de Navegación
Login
  ↓
IF SUPER_ADMIN
  → /super-admin/overview

ELSE
  → /(tenant)/[tenantId]/dashboard

Dentro del tenant:

dashboard
  → seleccionar building
    → building overview
      → (opcional) unit
5) Layout Base (AppShell)

Toda pantalla autenticada usa:

Sidebar

Topbar

Breadcrumbs de contexto

Role selector

Tenant switcher

Assistant widget

6) SUPER_ADMIN Navigation
URL Structure
/super-admin
  /overview
  /tenants
  /tenants/create
  /users
  /audit-logs
  /monitoring
  /billing
  /support
  /config
Sidebar

Overview

Tenants

Users

Audit Logs

Monitoring

Billing

Support

Config

Pantallas
/overview

KPIs globales

Actividad reciente

Alertas sistema

Métricas SaaS

/tenants

Tabla tenants

Filtros

Acciones CRUD

Impersonation

/tenants/create

Wizard 3 pasos:

Datos

Plan

Owner inicial

7) TENANT Navigation
URL Structure
/(tenant)/[tenantId]
  /dashboard
  /buildings
  /users
  /inbox
  /reports
  /settings
Sidebar

Dashboard

Buildings

Users

Inbox

Reports

Settings

Pantallas
/dashboard

KPIs tenant

Alertas

Actividad

Selector buildings

/buildings

Grid / tabla edificios

CRUD

Navegar a building

/users

Usuarios tenant

Invitar

Roles

Desactivar

/inbox

Tickets

Pagos

Mensajes

Filtros

/reports

Reclamos

Morosidad

Finanzas

Export

/settings

Datos tenant

Branding

Integraciones

8) BUILDING Navigation
URL Structure
/(tenant)/[tenantId]/buildings/[buildingId]
  /overview
  /tickets
  /communications
  /units
  /residents
  /providers
  /documents
  /finances
  /settings
Sidebar

Overview

Tickets

Communications

Units

Residents

Providers

Documents

Finances

Settings

Pantallas
/overview

KPIs building

Alertas

Actividad

/tickets

Tabla

Crear

Detalle

Comentarios

Evidencia

/communications

Lista

Crear

Segmentación

Tracking

/units

Tabla unidades

CRUD

Assign resident

Historial

/residents

Tabla residentes

CRUD

Detalle

/providers

Tabla proveedores

CRUD

Categoría

/documents

Lista docs

Upload

Categoría

Share

/finances

Expensas

Pagos

Morosidad

Export

/settings

Datos edificio

Config

Servicios

9) UNIT Navigation
URL Structure
/(tenant)/[tenantId]/units/[unitId]
  /overview
  /payments
  /tickets
  /communications
  /profile
  /amenities
Sidebar

Overview

Payments

Tickets

Communications

Profile

Amenities

Pantallas
/overview

Saldo

Vencimientos

Historial

/payments

Historial pagos

Pagar / comprobante

/tickets

Crear reclamo

Mis reclamos

/communications

Comunicados

Leídos

/profile

Datos

Convivientes

/amenities

Reservas

Historial

10) Role Visibility Matrix
Rol	Navigation
SUPER_ADMIN	super-admin
TENANT_OWNER	tenant + building
TENANT_ADMIN	tenant + building
OPERATOR	building limitado
RESIDENT	unit
11) Tenant Switcher
SUPER_ADMIN

Cambia tenant globalmente

Desde cualquier pantalla

Usuario normal

Cambia entre memberships

Guarda lastTenant

12) Role Selector

Si user tiene múltiples roles:

Topbar:

Viewing as: TENANT_ADMIN ▼

Cambiar rol:

cambia navegación visible

NO cambia permisos backend

13) Breadcrumbs de Contexto

Ejemplo:

Tenant: ACME Condos > Building: Torre Norte > Unit: 101

Cada segmento navegable.

14) Flujos Críticos
Login → Tenant

lastTenant si existe

sino primer membership

sino error

Tenant → Building

seleccionar building

ir a overview

Building → Unit

click unidad

ir a unit overview

SUPER_ADMIN → Impersonation

entrar como tenant

sesión real

redirect tenant

15) Assistant Widget

Visible en:

super-admin

tenant

building

unit

Context enviado:

{
  "tenantId": "...",
  "buildingId": "...",
  "unitId": "...",
  "role": "TENANT_ADMIN"
}
16) Redirect Rules
Caso	Redirect
No auth	/login
SUPER_ADMIN login	/super-admin/overview
User login	/(tenant)/[tenantId]/dashboard
No tenant access	/no-access
Invalid building	404
Invalid unit	404
17) Sidebar Rules

Sidebar depende de:

contexto

rol

Orden:

Overview
Core modules
Management
Reports
Settings
18) Navigation Implementation Checklist

 Rutas existen

 Sidebar correcto

 Breadcrumbs correctos

 Tenant switcher funciona

 Role selector funciona

 Redirects coherentes

 Context hook correcto

 Assistant recibe contexto

19) Context Hook (referencia)
function useAppContext() {
  return {
    tenantId,
    buildingId,
    unitId,
    activeRole
  }
}
20) Principios UX

Nunca perder contexto

Jerarquía clara

Rol visible

Tenant visible

Navegación predecible

Sin ambigüedad tenant/building/unit

21) Estado

Navigation definida para:

SUPER_ADMIN

TENANT

BUILDING

UNIT

Alineado con ARCHITECTURE.md ✅
Listo para implementar rutas Next.js ✅

END — NAVIGATION_SPEC

---

