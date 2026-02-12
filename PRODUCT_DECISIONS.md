# BuildingOS – Resumen de decisiones y respuestas (conversación)

Fecha: 2026-02-08 (America/Argentina/Buenos_Aires)

> Este archivo consolida **las respuestas y decisiones** tomadas en la conversación para que lo puedas dejar en la **raíz del repo** (por ejemplo: `./PRODUCT_DECISIONS.md`).
> Es la **fuente de verdad** de producto: reglas, invariantes y decisiones que no deben reinterpretarse.

---

## 0) Invariantes del producto (NO negociables)
- **Un solo SaaS** multi-tenant (no múltiples apps).
- **Aislamiento total por tenant**: ningún acceso a datos cross-tenant.
- Multi-tenant: **un schema** en Postgres; todas las tablas de dominio llevan `tenant_id` (y `property_id` cuando aplique).
- Las diferencias entre ADMINISTRADORA y EDIFICIO_AUTOGESTION se resuelven con **configuración + permisos**, nunca con ramas de lógica duplicada.
- **Auditoría mínima** en entidades core: `created_at`, `updated_at`, `created_by` (y `updated_by` cuando aplique). Aprobaciones/reversos siempre auditados.
- **Source of truth**: el estado financiero proviene del **ledger** (cuenta corriente). Evitar “saldo guardado” como verdad (solo cache si hace falta).

---

## 1) Objetivo del producto

### ¿Qué estás construyendo?
Un **único SaaS multi-tenant** para **administración de edificios/condominios** que soporte:

- **Tenant tipo ADMINISTRADORA**: empresa que gestiona muchos edificios/condominios.
- **Tenant tipo EDIFICIO_AUTOGESTION**: un edificio/condominio que se administra a sí mismo.
- Módulos core: estructura (propiedades/unidades/personas), expensas/cobranzas, gastos/proveedores, reclamos/mantenimiento, comunicaciones/documentos, y luego add-ons (reservas, accesos, BI, integraciones).

### Definición unificada (sin duplicar lógica)
- Un **edificio/condominio** se modela como una sola entidad: `Property`.
- Diferencias de operación se resuelven con **configuración + permisos**, no con ramas de código.

---

## 2) Stack recomendado (Front / Back / BD)

### Frontend (Web)
- **Next.js + React + TypeScript**
- **Tailwind CSS + shadcn/ui**
- **TanStack Query**
- **React Hook Form + Zod**
- **Recharts** (dashboards)

### Backend (API)
- **NestJS + TypeScript**
- **Prisma** (ORM + migraciones)
- **OpenAPI/Swagger**
- **Redis + BullMQ** (jobs/colas)
- Storage **S3-compatible** (MinIO local; S3/R2 en prod)

### Base de datos
- **PostgreSQL**
- Multi-tenant recomendado: **un schema**, todas las tablas con `tenant_id` (y `property_id` cuando aplique).
- Opcional futuro: **Postgres RLS**.

---

## 3) Estructura de archivos recomendada (Front y Back)

### Repo (monorepo)
Estructura “de batalla” para SaaS modular:

buildingos/
apps/
web/ # Next.js
api/ # NestJS
worker/ # opcional (colas/cron), o dentro de api
packages/
contracts/ # DTOs/types/schemas Zod/enums compartidos
permissions/ # matriz permisos + helpers
ui/ # design system (opcional)
config/ # tsconfig/eslint/env schema
infra/
docker/ # postgres, redis, minio
docs/
adr/ # decisiones de arquitectura


**Regla clave:** lo “compartible” (DTOs/enums/schemas) vive en `packages/contracts` para evitar desalineación front/back.

### Front (Next.js) – Feature-first (por dominio)

apps/web/src/
app/
(public)/login/
(tenant)/[tenantId]/
dashboard/
properties/
units/
expenses/
payments/
tickets/
communications/
settings/
features/
auth/
tenancy/
rbac/
properties/
units/
expenses/
payments/
tickets/
communications/
shared/
lib/http/
components/
styles/
middleware.ts


### Back (NestJS) – Módulos por dominio + capas
apps/api/src/
modules/
auth/
tenancy/
rbac/
properties/
units/
expenses/
payments/
tickets/
communications/
common/
decorators/
guards/
interceptors/
filters/
pipes/
errors/
infra/
db/
cache/
queue/
storage/
mail/
integrations/


**Regla multi-tenant:** ningún repository/service debe consultar sin filtrar por `tenant_id`.

---

## 4) “¿Cómo se llama esta estructura?” (feature + capas)
La estructura como:

- `products/ components/ services/ adapters/`
- `cart/ components/ services/ adapters/`

Se conoce como:
- **Arquitectura Feature-based / Feature-first** (organización por módulo/dominio),
- con inspiración **Clean Architecture / Hexagonal (Ports & Adapters)** en frontend (ligera):
  - `components` = UI
  - `services` = acceso a datos / casos de uso
  - `adapters` = mapeo DTO ↔ ViewModel

---

## 5) Países objetivo
- **Venezuela**
- **Argentina**
- **Colombia**

---

## 6) Multi-tenancy: selección de tenant y sesión (DECISIÓN)
- Un `User` puede pertenecer a **múltiples tenants**.
- El “tenant activo” se determina por la ruta `/(tenant)/[tenantId]/...` (y/o header `X-Tenant-Id` desde el front).
- Si el usuario no tiene `TenantMembership` para ese `tenantId`, el sistema debe responder **403 o 404** (según política de seguridad; recomendado 404 para no filtrar existencia).
- Todo endpoint de dominio exige: `auth` + `tenantId` + membership válida.

---

## 7) Roles y permisos (RBAC) — patrón mínimo
Roles base:
- `SUPER_ADMIN`: dueño del SaaS (cross-tenant).
- `TENANT_OWNER`: responsable máximo del tenant.
- `TENANT_ADMIN`: administra edificios dentro del tenant.
- `OPERATOR`: usuario operativo (opcional).
- `RESIDENT`: usuario final asociado a unidad.

Reglas:
- Un mismo usuario puede tener **múltiples roles** dentro del tenant.
- Permisos se definen como **(recurso, acción, scope)**:
  - scope: `tenant` → `property` → `unit`
- Regla Resident: solo puede leer/operar sobre datos a los que accede vía `unit_memberships` (scope `unit`).

---

## 8) Property como entidad unificada + settings (EVITA forks)
`Property` (edificio/condominio) es la misma entidad para ambos tipos de tenant.
Diferencias se resuelven con `PropertySettings` (o campos equivalentes), mínimo:
- **Prorrateo**: coeficiente / m² / fijo / mixto (configurable).
- **Moneda** (por property o tenant).
- **Política de mora**: interés/punitorio, días de gracia, orden de imputación.
- **Pagos**: cuentas bancarias e instrucciones; política de validación.
- **Aprobaciones**: si requiere doble aprobación (futuro, opcional).

---

## 9) Pagos: decisión de MVP (transferencia/deposito + comprobante)

### Decisión propuesta y aceptada como MVP
El cliente (residente) realiza el pago **por transferencia o depósito** y luego:
- **sube el comprobante al SaaS**
- la administración lo recibe
- **aprueba/rechaza**
- al aprobar, el sistema **imputa** el pago a la deuda de la unidad (cuenta corriente).

### Por qué es lo más conveniente para VE/AR/CO
- Reduce complejidad y riesgos de integraciones al inicio.
- Funciona con múltiples bancos/realidades locales.
- Mantiene trazabilidad/auditoría.

### Flujo
1. Configuración por `property_id`: cuentas bancarias + instrucciones + política de validación.
2. Residente crea `PaymentSubmission` con monto/fecha/unidad/periodo + adjunto.
3. Administración valida: `APPROVED` o `REJECTED` (con motivo).
4. Al aprobar: se crea `Payment` + `LedgerEntry` y baja la deuda.

### Estados sugeridos
- `PENDING`
- `APPROVED` (terminal)
- `REJECTED` (terminal)
- `CANCELLED` (terminal)

### Reglas clave
- Un submission **no reduce deuda** hasta ser aprobado.
- Pagos aprobados **no se editan**: solo **reversal** (contraasiento) con auditoría.
- Rechazo exige motivo (`rejection_reason`) + `rejected_by`.
- Detección de duplicados configurable: (hash adjunto + monto/fecha/unidad) en ventana configurable.
- Imputación recomendada: **punitorios/intereses primero**, luego deuda más antigua (FIFO).
- Idempotencia: un approve debe ser **atómico** (no duplicar ledger entries si se reintenta).

### Notificaciones MVP
- In-app + email (WhatsApp/push después).

---

## 10) Ledger / Cuenta corriente por unidad (DECISIÓN)
- Existe un **ledger por unidad** (`unit_id`) como fuente de verdad.
- Entradas (`LedgerEntry`) representan:
  - Cargos (expensas, punitorios, ajustes)
  - Pagos (aprobados)
  - Reversos (contra-asientos)
- Convención mínima recomendada:
  - `type` (CHARGE | PAYMENT | ADJUSTMENT | REVERSAL)
  - `amount`, `currency`
  - `effective_date`
  - `reference_type` + `reference_id` (ej: PAYMENT_SUBMISSION, EXPENSE_BATCH)
- El saldo se calcula como suma de entries (cache opcional).

---

## 11) Aclaraciones sobre preguntas 4 y 5 (del set de 5 definiciones)

### (4) “Portal de residentes en MVP sí/no”
Significa si en la primera versión los residentes podrán:
- ver deuda/expensas,
- descargar comprobantes,
- reportar pagos,
- crear reclamos.

Recomendación: **Sí**, al menos básico, especialmente si hay pagos (aunque sean offline con comprobante).

### (5) “Cuenta corriente por unidad sí/no”
Significa tener un **ledger** por unidad:
- cargos (expensas, punitorios, ajustes)
- pagos
- saldo final

Recomendación: **Sí** desde el inicio (simple), para soportar pagos parciales, mora y ajustes.

---

## 12) Principios de diseño acordados (constantes)
- **Un solo SaaS**, no múltiples apps.
- **Multi-tenant** con aislamiento total por `tenant_id`.
- No duplicar lógica por tipo de cliente: resolver con **configuración y permisos**.
- Roles base: `SUPER_ADMIN`, `TENANT_OWNER`, `TENANT_ADMIN`, `OPERATOR`, `RESIDENT`.
- Permisos granulares con scopes: `property_id` y (cuando aplica) `unit_id`.

---

## 13) Internacionalización LATAM (decisiones mínimas)
- Zona horaria: configurable por tenant (y opcional por property). Default: `America/Argentina/Buenos_Aires`.
- Moneda: al menos configurable por property (para VE/AR/CO).
- Formatos: números/fechas deben estar preparados para i18n (aunque el MVP sea ES).

---

## 14) Monetización (placeholder para no hardcodear)
- El producto debe soportar **planes** y límites por tenant (sin lógica hardcode):
  - # properties, # units, # usuarios, storage, módulos habilitados.
- Add-ons futuros: pagos online, WhatsApp, BI, integraciones.

---

## 15) Próximos pasos recomendados
1. Definir prorrateo por propiedad: coeficiente/m²/fijo/mixto (configurable).
2. Definir políticas de mora (intereses/punitorios) por propiedad/tenant.
3. Implementar módulo pagos MVP (PaymentSubmission + validación + ledger).
4. Implementar módulo expensas v1 (liquidación mensual + recibo).
5. Implementar tickets/reclamos + comunicaciones.

---

## 16) Registro de preguntas del usuario (hasta ahora)
1. “quiero que siempres recuerdes mi preguntas para luego hacerun archivo .md”
2. “quiero hacer un saas … administracion de edificios … y que tambien desde alli pueda tambien administrar condomios”
3. “ok que me recomiendas para el fronted, backend y bd, dime”
4. “ahora como vamos a hacer la estructura de los archivos en el front y el back, que me recomiendas”
5. “y este tipo como se llama … (estructura por modules: products/cart/checkout con components/services/adapters)”
6. “tu quiero que sea mi project manager”
7. “perfecto, pero lo hablamos despues quiero la estructura mas recomendada para lo que quiero?”
8. “te pido lo mas recomendado … es lo mejor para el proyecto”
9. “que otra pregunta me haria falta”
10. “1) venezuela, argentina y colombia … 2) depende del condominio … 3) pagos online si …”
11. “te propongo algo en cuanto pagos … transferencia o deposito y que se suba el pago a la saas …”

---
# DECISIÓN DE PRODUCTO — Implementación por capas (top-down) y orden fijo hasta la última capa

## Decisión
Vamos a trabajar **en este orden**, sin saltarnos capas:

1) **SUPER_ADMIN (SaaS Owner)**
2) **TENANT_OWNER / TENANT_ADMIN (Backoffice del Tenant)**
3) **OPERATOR (Operativo)**
4) **RESIDENT (App/portal del residente)**

Regla: **no bajamos a la siguiente capa hasta cerrar la anterior** con:
- reglas de negocio definidas
- navegación clara
- MVP funcional (aunque sea con localStorage/mock)
- checklist QA aprobado

---

# CAPA 1 — SUPER_ADMIN (MVP v0) — Alcance y Entregables

## Objetivo de la capa
Crear el “control panel” del SaaS:
- gestionar tenants
- gestionar planes/estados
- entrar/switch al contexto de un tenant (para ver la capa 2)

---

## Módulos de la capa 1 (MVP v0)

### A) SUPER_ADMIN Dashboard (Overview)
Widgets mínimos:
- Total Tenants
- Activos / Trial / Suspendidos
- Total Buildings (sum)
- Total Units (sum)
- Total Residents (sum)

Acciones:
- Crear Tenant
- Ver Tenants

### B) Tenants (Listado)
Tabla:
- Name
- Type (ADMINISTRADORA | EDIFICIO_AUTOGESTION)
- Status (TRIAL | ACTIVE | SUSPENDED)
- Plan (FREE | BASIC | PRO | ENTERPRISE)
- Buildings count
- Users count
- CreatedAt
- Actions: Ver / Editar / Suspender / Activar / **Entrar al Tenant**

### C) Create Tenant (Wizard simple)
Campos:
- Tenant name (required)
- Tenant type (required)
- Plan (required)
- Owner email (required)

Al guardar:
- Crear Tenant
- Crear usuario TENANT_OWNER (o “invite pending” MVP)
- Redirigir a detalle o listado

### D) Tenant Detail (para control)
Vista simple:
- info del tenant
- estado/plan
- límites (placeholder)
- botón “Entrar al Tenant”

### E) Switch de contexto (imprescindible)
Acción “Entrar al Tenant”:
- setear `activeTenantId` en storage/state
- navegar a la capa 2 (Tenant Dashboard)

---

# Datos (MVP localStorage)
Keys sugeridas:
- `bo_sa_tenants` (lista global de tenants)
- `bo_sa_platform_users` (super admins) [opcional v0]
- `bo_active_tenant` (tenantId seleccionado)

Por tenant (ya existente):
- `bo_buildings_<tenantId>`
- `bo_units_<tenantId>`
- `bo_users_<tenantId>`
- `bo_unit_residents_<tenantId>`

---

# Reglas de negocio (capa 1)

## Tenants
- `tenant.type` ∈ {ADMINISTRADORA, EDIFICIO_AUTOGESTION}
- `tenant.status` ∈ {TRIAL, ACTIVE, SUSPENDED}
- `tenant.plan` ∈ {FREE, BASIC, PRO, ENTERPRISE}

## Acceso
- Solo rol SUPER_ADMIN puede ver/operar esta capa
- Si `tenant.status == SUSPENDED`:
  - no permitir “Entrar al Tenant” (o entrar en modo read-only) → MVP: bloquear

## Aislamiento multi-tenant
- SUPER_ADMIN puede listar todos los tenants (vista global)
- Al “Entrar”, todo lo de abajo se filtra por `activeTenantId`

---

# Criterios de aceptación (para cerrar la capa 1)
- [ ] SUPER_ADMIN puede ver Overview
- [ ] SUPER_ADMIN puede crear un tenant
- [ ] SUPER_ADMIN puede listar tenants
- [ ] SUPER_ADMIN puede suspender/activar tenant
- [ ] SUPER_ADMIN puede entrar a un tenant (set activeTenantId) y navegar a la capa 2
- [ ] Tenant suspendido no permite entrar (MVP)

---

# QA Checklist (capa 1)
1) Crear tenant (ADMINISTRADORA) → aparece en listado
2) Crear tenant (EDIFICIO_AUTOGESTION) → aparece en listado
3) Cambiar status ACTIVE↔SUSPENDED → persiste
4) Entrar al tenant ACTIVE → set activeTenantId y navega
5) Intentar entrar a SUSPENDED → bloquea y muestra mensaje

---

# Próxima capa (solo cuando esta cierre)
## CAPA 2 — Tenant Backoffice
Tenant Dashboard → Buildings → Units → Residents/Assignments → Operations

La capa 2 consume `activeTenantId`.

---

# Próximo paso (para devs)
Implementar CAPA 1 (SUPER_ADMIN MVP v0) con localStorage:
1) Routing protegido por rol SUPER_ADMIN
2) `TenantsList` + acciones
3) `CreateTenantWizard`
4) `TenantDetail`
5) `switchContext(activeTenantId)`

Entregar PR con:
- pantallas funcionando
- storage keys persistiendo
- QA checklist capa 1 completo
