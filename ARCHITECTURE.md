# BuildingOS — Architecture & Navigation Specification

## Overview

BuildingOS es un SaaS multi-tenant para administración de edificios/condominios. Maneja 4 niveles jerárquicos de acceso:
1. **SUPER_ADMIN** — Dueño del SaaS, control global
2. **TENANT** — Administradora o edificio autogestionado
3. **BUILDING** — Administrador del edificio (puede ser externo)
4. **UNIT** — Residente/propietario

Cada nivel tiene dashboards, módulos y permisos específicos. La **Asistente IA** es transversal a todos los niveles.

---

## 1. Navigation & Context Flow

```
Login
  ↓
IF user.roles.includes(SUPER_ADMIN)
  → Super Admin Dashboard (contexto global)
    → Cambiar tenant libremente
ELSE
  → Tenant Dashboard (contexto: tenant activo)
    → Selector de edificio
      → Building Dashboard (contexto: building activo)
        → Selector de unidad
          → Unit Dashboard (contexto: unit activo)
```

### Context Rules

- **SUPER_ADMIN**: Puede cambiar tenant activo desde cualquier pantalla. No tiene building/unit scope.
- **Usuario normal (no SUPER_ADMIN)**: Siempre dentro de un tenant. Building y unit opcionales.
- **Asistente IA**: Visible en todos los dashboards, contextual a tenant/building/unit activos.

---

## 2. SUPER_ADMIN Dashboard

### URL Structure
```
/super-admin
  /overview          → Visión general + KPIs
  /tenants           → Listado, CRUD
  /tenants/create    → Wizard crear tenant
  /users             → Usuarios de plataforma (stub)
  /audit-logs        → Auditoría global (stub)
  /monitoring        → Salud del sistema, errores, performance (nuevo)
  /billing           → Facturación SaaS (nuevo)
  /support           → Tickets y soporte (nuevo)
  /config            → Config global + integraciones (nuevo)
```

### Dashboard Components

#### A) Visión General
- **Stats Cards**
  - Total tenants activos / en trial / morosos
  - MRR/ARR, churn, crecimiento
  - Total buildings, units, residents

- **Alerts**
  - Tickets críticos abiertos
  - Salud del sistema (errores, latencia, colas)
  - Tenants con morosidad reciente

- **Recent Activity**
  - Últimas creaciones de tenants
  - Cambios de plan
  - Incidentes críticos

#### B) Gestión de Tenants
- Tabla con búsqueda/filtro por plan, status, fecha
- Acciones: Ver → impersonate, Editar, Suspender/Activar, Eliminar
- Crear tenant (wizard 3 pasos)
- **Impersonation real**: "Entrar como" abre sesión como tenant admin (no solo contexto localStorage)

#### C) Monitoreo & Operación
- Bandeja de tickets/soporte
- Auditoría global (quién hizo qué, en qué tenant, cuándo)
- Health checks (DB, Redis, S3)
- Performance dashboards (Recharts)

#### D) Billing SaaS
- Facturas generadas por tenant
- Pagos recibidos vs pendientes
- MRR chart
- Tenants con morosidad (recalco de pago)

#### E) Configuración Global
- Catálogos: países, monedas, idiomas
- Integraciones (pasarelas de pago, WhatsApp, email, SMS)
- Seguridad: 2FA policy, password policy, IP whitelist
- Plantillas globales (email/SMS/push)

### Asistente del SUPER_ADMIN (Contexto: Global)

Ejemplos de prompts:
- "¿Qué tenants están con más reclamos esta semana?"
- "Detectame tenants con caída de pagos"
- "Resumen de incidentes críticos hoy"
- "Generar reporte mensual para comité"

**API calls to assistant**:
- Fetch recent tickets + tenant metadata
- Fetch payment stats per tenant
- Fetch system health logs
- Generate PDF report

---

## 3. Tenant Dashboard

### URL Structure
```
/(tenant)/[tenantId]
  /dashboard         → KPIs + selector de edificio
  /buildings         → Listado de edificios (nuevo)
  /users             → Gestión de usuarios (nuevo)
  /inbox             → Bandeja unificada (reclamos/mensajes) (nuevo)
  /reports           → Reportes cross-building (nuevo)
  /settings          → Configuración del tenant (nuevo)
  /properties        → Properties (legacy, deprecated)
```

### Dashboard Components

#### A) KPIs & Overview
- **Stats Cards**
  - Edificios activos
  - Reclamos abiertos (totales + por severidad)
  - Morosidad / pagos recientes
  - Comunicados no leídos

- **Alerts**
  - Vencimientos próximos
  - Cortes de servicios planificados
  - Reclamos críticos sin asignar

- **Recent Activity**
  - Últimos reclamos
  - Últimos pagos recibidos
  - Comunicados enviados

#### B) Selector de Edificios
- Grid o tabla de edificios
- Click → Building Dashboard con building context activo
- Cada card muestra KPI rápido (reclamos abiertos, morosidad %)

#### C) Gestión de Usuarios
- Tabla de usuarios del tenant
- Invitar usuario (email + rol + scope de edificios)
- Editar roles/permisos
- Desactivar usuario

#### D) Bandeja Unificada
- Reclamos + mensajes + aprobaciones de pago en un solo lugar
- Filtros: por edificio, por estado, por severidad
- Acciones: asignar, cerrar, responder

#### E) Configuración del Tenant
- Datos del tenant (nombre, email, teléfono)
- Branding (logo, colores)
- Integraciones (credenciales propias o heredadas del SaaS)
- Webhook endpoints

#### F) Reportes Cross-Building
- Reclamos por categoría (todos los edificios)
- Morosidad por edificio
- Ingresos vs egresos
- Exportables (CSV, PDF, Excel)

### Asistente del TENANT (Contexto: Tenant activo)

Ejemplos:
- "Resumime reclamos por edificio"
- "¿Qué edificios tienen más morosidad?"
- "Generá comunicado para todos los edificios por corte de agua"
- "Sugerime acciones para bajar reclamos repetidos"

**API calls to assistant**:
- Fetch reclamos + tenant metadata + building metadata
- Fetch payment data per building
- Fetch recent comunicados
- Generate draft announcement

---

## 4. Building Dashboard

### URL Structure
```
/(tenant)/[tenantId]/buildings/[buildingId]
  /overview          → KPIs + operación
  /tickets           → Reclamos: ver/derivar/cerrar (nuevo)
  /communications    → Comunicados: crear/segmentar (nuevo)
  /units             → Unidades: estado, ocupantes (refactor)
  /residents         → Residentes/propietarios: altas/bajas (nuevo)
  /providers         → Proveedores + presupuestos (nuevo)
  /documents         → Documentos (reglamento, actas) (nuevo)
  /finances          → Finanzas: expensas/pagos/morosidad (nuevo)
  /settings          → Config del edificio (nuevo)
```

### Dashboard Components

#### A) Operación (Overview Card)
- Reclamos abiertos por categoría (agua, ascensor, seguridad, etc.)
- Tareas pendientes (aprobaciones, presupuestos)
- Incidentes recientes
- SLA status (ej: "3 reclamos vencidos")

#### B) Tickets/Reclamos
- Tabla: estado, categoría, reporter, asignado a, fecha, prioridad
- Crear reclamo (form guiado: categoría + foto + descripción + prioridad)
- Ver detalle: comentarios, evidencia, asignación, historia
- Acciones: asignar, cerrar, reabrir
- **NUEVO**: Integración con proveedores (para asignar trabajos)

#### C) Comunicados
- Listado de comunicados enviados
- Crear comunicado (título, cuerpo, segmentación: todas las unidades / especificar unidades)
- Envío multi-canal (push, email, SMS, WhatsApp)
- Tracking: confirmaciones, leído/no leído

#### D) Unidades
- Tabla: building name, label, code, occupancy status, active resident, actions
- CRUD: crear/editar/eliminar
- Assign resident (modal)
- Ver historial de ocupantes

#### E) Residentes
- Tabla: nombre, unidad, email, teléfono, rol (OWNER/TENANT/OTHER), estado
- Altas/bajas (crear/desactivar)
- Actualizar contacto
- Ver unidades de un residente

#### F) Proveedores
- Tabla: nombre, email, teléfono, categoría (plomería, electricidad, etc.), estado
- CRUD: crear/editar/desactivar
- Ver presupuestos asociados
- Historial de trabajos completados

#### G) Documentos
- Listado: reglamento, actas, certificados, presupuestos
- Upload (S3/MinIO)
- Categoría, fecha, versión
- Descargar, compartir (link con expiración)

#### H) Finanzas
- **Expensas**: Listado de períodos generados, ver detalle (x unidad)
- **Pagos**: Conciliados vs pendientes
- **Morosidad**: Por unidad, gráfico de tendencia
- **Exportables**: Libro mayor, mayor analítico, reportes contables

#### I) Configuración del Edificio
- Datos: dirección, año construcción, cantidad pisos
- Config: moneda, zona horaria, idioma
- Servicios: agua, luz, gas (para alertas de corte)

### Asistente del BUILDING (Contexto: Building activo)

Ejemplos:
- "Resumime reclamos críticos y responsables"
- "Redactá comunicado por mantenimiento del ascensor"
- "Detectá unidades con morosidad recurrente"
- "Proponé checklist mensual de mantenimiento"

**API calls to assistant**:
- Fetch tickets + building metadata
- Fetch residents + units
- Fetch payment history
- Generate draft communication
- Generate maintenance checklist

---

## 5. Unit Dashboard (Residente/Propietario)

### URL Structure
```
/(tenant)/[tenantId]/units/[unitId]
  /overview          → Saldo + próximos vencimientos
  /payments          → Historial de pagos + pagar (refactor)
  /tickets           → Crear/seguir reclamos (nuevo)
  /communications    → Ver comunicados (nuevo)
  /profile           → Datos de contacto + convivientes (nuevo)
  /amenities         → Reservas (nuevo, opcional)
```

### Dashboard Components

#### A) Estado de Cuenta
- Saldo actual (si es positivo/negativo)
- Próximos vencimientos (tabla)
- Última facturación
- Gráfico de historial de saldo

#### B) Pagos
- Historial de pagos (tabla: fecha, monto, estado, tipo)
- Botón "Pagar ahora" → formulario o redirección a pasarela

#### C) Reclamos
- Crear reclamo (form guiado)
  - Categoría (agua, luz, electricidad, etc.)
  - Fotos (upload)
  - Descripción
  - Prioridad (la UI sugiere basada en categoría)
- Mis reclamos (tabla: estado, fecha, responsable, última actualización)
- Click → ver detalle + comentarios

#### D) Comunicados
- Listado de comunicados del edificio
- Checkbox "Confirmar que leí" (para algunos tipos)
- Filtro: sin leer / todos

#### E) Mi Perfil
- Nombre, email, teléfono
- Convivientes autorizados (nombre, teléfono)
- Mascotas/vehículos (si aplica)
- Actualizar datos

#### F) Amenities (Opcional)
- Ver disponibilidad de salones, cancha, etc.
- Hacer reserva (selector de fecha/hora)
- Mis reservas (tabla: fecha, hora, estado, cancelar)

### Asistente de UNIT (Contexto: Unit activo)

Ejemplos:
- "Ayudame a cargar un reclamo (guiado)"
- "¿Cómo pago la expensa?"
- "Resumime el último comunicado"
- "Qué puedo hacer si el problema persiste"

**API calls to assistant**:
- Fetch unit data + account current
- Fetch payment instructions
- Fetch recent communications
- Generate guided complaint form

---

## 6. Technical Implementation Rules

### A) Multi-Tenant Architecture
- **Every** business API request must include `tenantId` (from JWT membership or URL param)
- If request includes `buildingId` or `unitId`, validate:
  - Building/unit belongs to tenant
  - User has permission to access that building/unit

### B) Context in URLs
```
/super-admin                    → Global context (no tenant)
/(tenant)/[tenantId]/...        → Tenant context
/(tenant)/[tenantId]/buildings/[buildingId]/...   → Building context
/(tenant)/[tenantId]/units/[unitId]/...           → Unit context
```

### C) Permissions & Roles
- **SUPER_ADMIN**: All endpoints, can impersonate any tenant
- **TENANT_OWNER/TENANT_ADMIN**: Full access to buildings/units/users within their tenant
- **BUILDING_ADMIN**: Access only to assigned building(s)
- **OPERATOR**: Read most data, can create/update tickets and communications
- **RESIDENT**: Read-only (own unit data, public communications), can create tickets/payments

**Database schema rule**: Store `buildingId` with each user→role assignment (optional, null = all buildings in tenant).

### D) Multiple Roles per User
- User can be TENANT_ADMIN and also RESIDENT of a unit
- UI shows "role selector" in top bar: "Viewing as TENANT_ADMIN" with dropdown to switch
- Each role view has different navbar/sidebar options

### E) Assistant (IA) Integration

**Widget placement**: Bottom-right corner (Intercom-style) on every dashboard.

**API endpoint**: `POST /assistant/chat` (not yet defined, placeholder in roadmap)
```json
{
  "message": "Resumime reclamos por edificio",
  "context": {
    "tenantId": "...",
    "buildingId": "..." (optional),
    "unitId": "..." (optional),
    "userRole": "TENANT_ADMIN"
  }
}
```

**Assistant context awareness**:
- Tenant active → fetch all tenant data
- Building active → fetch building-scoped data only
- Unit active → fetch unit + building data
- Respects user permissions (don't expose data user can't see)

---

## 7. Data Model Extensions (Prisma Schema)

### New Models Needed

```prisma
// Tickets/Reclamos
model Ticket {
  id              String      @id @default(cuid())
  tenantId        String
  buildingId      String
  createdById     String      // userId de quien reportó
  assignedToId    String?     // userId de operario
  category        String      // agua, electricidad, seguridad, etc.
  title           String
  description     String
  status          String      @default("OPEN") // OPEN, IN_PROGRESS, RESOLVED, CLOSED, REOPENED
  priority        String      @default("NORMAL") // LOW, NORMAL, HIGH, CRITICAL
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  resolvedAt      DateTime?

  // Relations
  tenant          Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  building        Building    @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  createdBy       User        @relation("TicketCreatedBy", fields: [createdById], references: [id])
  assignedTo      User?       @relation("TicketAssignedTo", fields: [assignedToId], references: [id])
  comments        Comment[]
  evidence        Evidence[]

  @@unique([tenantId, id])
  @@index([tenantId])
  @@index([buildingId])
  @@index([status])
}

// Communicados/Avisos
model Communication {
  id              String      @id @default(cuid())
  tenantId        String
  buildingId      String
  createdById     String      // userId de quien creó
  title           String
  body            String
  segmentation    String      @default("ALL") // ALL o JSON array de unitIds
  channels        String[]    @default(["EMAIL"]) // EMAIL, SMS, PUSH, WHATSAPP
  status          String      @default("DRAFT") // DRAFT, SENT
  sentAt          DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  // Relations
  tenant          Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  building        Building    @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  createdBy       User        @relation(fields: [createdById], references: [id])
  confirmations   CommunicationConfirmation[]

  @@unique([tenantId, id])
  @@index([tenantId])
  @@index([buildingId])
  @@index([status])
}

// Proveedores
model Provider {
  id              String      @id @default(cuid())
  tenantId        String
  buildingId      String?     // null = tenant-wide, value = building-specific
  name            String
  email           String?
  phone           String?
  category        String      // plomería, electricidad, seguridad, etc.
  status          String      @default("ACTIVE") // ACTIVE, INACTIVE
  notes           String?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  // Relations
  tenant          Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  building        Building?   @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  quotes          Quote[]

  @@unique([tenantId, id])
  @@index([tenantId])
  @@index([buildingId])
  @@index([category])
}

// Documentos
model Document {
  id              String      @id @default(cuid())
  tenantId        String
  buildingId      String
  uploadedById    String      // userId de quien subió
  filename        String
  fileUrl         String      // S3/MinIO URL
  category        String      // reglamento, acta, presupuesto, etc.
  version         Int         @default(1)
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  expiresAt       DateTime?   // para links compartidos

  // Relations
  tenant          Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  building        Building    @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  uploadedBy      User        @relation(fields: [uploadedById], references: [id])

  @@unique([tenantId, id])
  @@index([tenantId])
  @@index([buildingId])
  @@index([category])
}

// Expensas (Ledger de gastos/ingresos)
model ExpenseEntry {
  id              String      @id @default(cuid())
  tenantId        String
  buildingId      String
  type            String      // CHARGE, PAYMENT, ADJUSTMENT, REVERSAL
  description     String
  amount          Decimal     @db.Decimal(12, 2)
  dueDate         DateTime?
  paidAt          DateTime?
  status          String      @default("PENDING") // PENDING, PAID, OVERDUE, CANCELLED
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  // Relations
  tenant          Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  building        Building    @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  unitExpenses    UnitExpense[]

  @@unique([tenantId, id])
  @@index([tenantId])
  @@index([buildingId])
  @@index([status])
}

// Unit-Expense junction (un gasto aplica a múltiples unidades)
model UnitExpense {
  id              String      @id @default(cuid())
  unitId          String
  expenseId       String
  amount          Decimal     @db.Decimal(12, 2)
  paidAt          DateTime?

  unit            Unit        @relation(fields: [unitId], references: [id], onDelete: Cascade)
  expense         ExpenseEntry @relation(fields: [expenseId], references: [id], onDelete: Cascade)

  @@unique([unitId, expenseId])
}

// Amenities (optional)
model Amenity {
  id              String      @id @default(cuid())
  buildingId      String
  name            String      // Salón de eventos, Cancha, etc.
  capacity        Int?
  pricePerHour    Decimal?    @db.Decimal(10, 2)
  createdAt       DateTime    @default(now())

  building        Building    @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  reservations    Amenity Reservation[]
}

model AmenityReservation {
  id              String      @id @default(cuid())
  amenityId       String
  unitId          String
  startTime       DateTime
  endTime         DateTime
  status          String      @default("CONFIRMED") // CONFIRMED, CANCELLED
  createdAt       DateTime    @default(now())

  amenity         Amenity     @relation(fields: [amenityId], references: [id], onDelete: Cascade)
  unit            Unit        @relation(fields: [unitId], references: [id], onDelete: Cascade)
}
```

### Updates to Existing Models

**Building**
```prisma
model Building {
  id              String      @id @default(cuid())
  tenantId        String
  name            String
  address         String
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  // New fields
  zipCode         String?
  yearBuilt       Int?
  floors          Int?
  timezone        String      @default("America/Caracas")
  currency        String      @default("VES")
  locale          String      @default("es-VE")

  // Relations
  tenant          Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  units           Unit[]
  tickets         Ticket[]
  communications  Communication[]
  providers       Provider[]
  documents       Document[]
  expenses        ExpenseEntry[]
  amenities       Amenity[]

  @@unique([tenantId, id])
  @@index([tenantId])
}

model Unit {
  id              String      @id @default(cuid())
  tenantId        String
  buildingId      String
  label           String      // "101", "A-05", etc.
  unitCode        String?     // "APT_001"
  unitType        String      @default("APARTMENT") // APARTMENT, HOUSE, OFFICE, STORAGE, PARKING
  occupancyStatus String      @default("UNKNOWN") // UNKNOWN, VACANT, OCCUPIED
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  // Relations
  tenant          Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  building        Building    @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  residents       UnitResident[]
  unitExpenses    UnitExpense[]
  amenityReservations AmenityReservation[]

  @@unique([buildingId, label])
  @@unique([buildingId, unitCode])
  @@index([tenantId])
  @@index([buildingId])
}

// Tenant: add field para soportar multi-tenant scope
model Tenant {
  id              String      @id @default(cuid())
  name            String      @unique
  type            TenantType  @default(ADMINISTRADORA)
  status          String      @default("ACTIVE") // ACTIVE, TRIAL, SUSPENDED
  plan            String      @default("BASIC") // FREE, BASIC, PRO, ENTERPRISE
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  // Relations
  memberships     Membership[]
  buildings       Building[]
  tickets         Ticket[]
  communications  Communication[]
  providers       Provider[]
  documents       Document[]
  expenses        ExpenseEntry[]
  units           Unit[]

  @@index([status])
  @@index([plan])
}

// User: add buildingScope
model User {
  id              String      @id @default(cuid())
  email           String      @unique
  name            String
  passwordHash    String
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  // Relations
  memberships     Membership[]
  ticketsCreated  Ticket[]    @relation("TicketCreatedBy")
  ticketsAssigned Ticket[]    @relation("TicketAssignedTo")
  communicationsCreated Communication[]
  documentsUploaded Document[]
  unitResidents   UnitResident[]
  amenityReservations AmenityReservation[]
}

model Membership {
  id              String      @id @default(cuid())
  userId          String
  tenantId        String
  buildingScope   String?     // null = all buildings, cuid = specific building
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  user            User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant          Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  roles           MembershipRole[]

  @@unique([userId, tenantId])
  @@index([tenantId])
}
```

---

## 8. API Endpoints Roadmap

### Phase 1: Core (Already done + immediate)
```
POST   /auth/signup
POST   /auth/login
GET    /auth/me
GET    /tenants
GET    /tenants/:tenantId/health
```

### Phase 2: Tenant Management & Buildings
```
GET    /tenants/:tenantId/buildings
POST   /tenants/:tenantId/buildings
GET    /tenants/:tenantId/buildings/:buildingId
PUT    /tenants/:tenantId/buildings/:buildingId
DELETE /tenants/:tenantId/buildings/:buildingId

GET    /tenants/:tenantId/buildings/:buildingId/units
POST   /tenants/:tenantId/buildings/:buildingId/units
GET    /tenants/:tenantId/buildings/:buildingId/units/:unitId
PUT    /tenants/:tenantId/buildings/:buildingId/units/:unitId
DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId

GET    /tenants/:tenantId/users
POST   /tenants/:tenantId/users
PUT    /tenants/:tenantId/users/:userId
DELETE /tenants/:tenantId/users/:userId
```

### Phase 3: Tickets
```
GET    /tenants/:tenantId/buildings/:buildingId/tickets
POST   /tenants/:tenantId/buildings/:buildingId/tickets
GET    /tenants/:tenantId/buildings/:buildingId/tickets/:ticketId
PUT    /tenants/:tenantId/buildings/:buildingId/tickets/:ticketId
DELETE /tenants/:tenantId/buildings/:buildingId/tickets/:ticketId

POST   /tenants/:tenantId/buildings/:buildingId/tickets/:ticketId/comments
GET    /tenants/:tenantId/buildings/:buildingId/tickets/:ticketId/comments

POST   /tenants/:tenantId/buildings/:buildingId/tickets/:ticketId/evidence
GET    /tenants/:tenantId/buildings/:buildingId/tickets/:ticketId/evidence
DELETE /tenants/:tenantId/buildings/:buildingId/tickets/:ticketId/evidence/:evidenceId
```

### Phase 4: Communications
```
GET    /tenants/:tenantId/buildings/:buildingId/communications
POST   /tenants/:tenantId/buildings/:buildingId/communications
PUT    /tenants/:tenantId/buildings/:buildingId/communications/:communicationId
DELETE /tenants/:tenantId/buildings/:buildingId/communications/:communicationId

POST   /tenants/:tenantId/buildings/:buildingId/communications/:communicationId/send
GET    /tenants/:tenantId/buildings/:buildingId/communications/:communicationId/confirmations
```

### Phase 5: Finance/Ledger
```
GET    /tenants/:tenantId/buildings/:buildingId/expenses
POST   /tenants/:tenantId/buildings/:buildingId/expenses
GET    /tenants/:tenantId/buildings/:buildingId/expenses/:expenseId

GET    /tenants/:tenantId/buildings/:buildingId/units/:unitId/account-current
GET    /tenants/:tenantId/buildings/:buildingId/units/:unitId/payments
POST   /tenants/:tenantId/buildings/:buildingId/units/:unitId/payments
```

### Phase 6: Providers & Documents
```
GET    /tenants/:tenantId/providers
POST   /tenants/:tenantId/providers
PUT    /tenants/:tenantId/providers/:providerId
DELETE /tenants/:tenantId/providers/:providerId

GET    /tenants/:tenantId/buildings/:buildingId/documents
POST   /tenants/:tenantId/buildings/:buildingId/documents
DELETE /tenants/:tenantId/buildings/:buildingId/documents/:documentId

POST   /tenants/:tenantId/buildings/:buildingId/documents/:documentId/share
GET    /share/:shareToken  (public endpoint, expires)
```

### Phase 7: Assistant (IA)
```
POST   /assistant/chat
```

---

## 9. Component Structure & Directory Organization

```
apps/web/
  features/
    auth/                    (existing: login, signup, session, hooks)
    rbac/                    (existing: permission checks)
    tenancy/                 (existing: tenant context)
    tenants/                 (existing: client API)
    super-admin/             (existing: dashboard)
      pages/                 (existing)
      components/            (existing)
      hooks/                 (new: useTenantStats, useTenantBilling, etc.)

    # NEW FEATURES
    buildings/
      components/
        BuildingSelector.tsx
        BuildingCard.tsx
        BuildingForm.tsx
      hooks/
        useBuildings.ts
        useBuildingDetails.ts
      pages/
        overview.tsx
        [buildingId]/index.tsx
        [buildingId]/tickets.tsx
        [buildingId]/communications.tsx
        [buildingId]/units.tsx
        [buildingId]/residents.tsx
        [buildingId]/providers.tsx
        [buildingId]/documents.tsx
        [buildingId]/finances.tsx
        [buildingId]/settings.tsx

    tickets/
      components/
        TicketTable.tsx
        TicketForm.tsx
        TicketDetail.tsx
        TicketComments.tsx
        TicketEvidence.tsx
      hooks/
        useTickets.ts
        useTicketDetail.ts
      storage/
        tickets.storage.ts
        tickets.schema.ts

    communications/
      components/
        CommunicationList.tsx
        CommunicationForm.tsx
        SegmentationBuilder.tsx
        ChannelSelector.tsx
        ConfirmationTracker.tsx
      hooks/
        useCommunications.ts
      storage/
        communications.storage.ts

    units/ (refactor existing)
      components/
        UnitsTable.tsx
        UnitForm.tsx
        ResidentAssignmentModal.tsx
        UnitDetailCard.tsx
      hooks/
        useUnits.ts
        useUnitResidents.ts
      storage/
        units.storage.ts
        buildings.storage.ts
        unitResidents.storage.ts
        users.storage.ts

    residents/
      components/
        ResidentTable.tsx
        ResidentForm.tsx
        ResidentDetail.tsx
      hooks/
        useResidents.ts

    providers/
      components/
        ProviderTable.tsx
        ProviderForm.tsx
      hooks/
        useProviders.ts
      storage/
        providers.storage.ts

    documents/
      components/
        DocumentList.tsx
        DocumentUpload.tsx
        DocumentShare.tsx
      hooks/
        useDocuments.ts
      storage/
        documents.storage.ts

    finances/
      components/
        ExpenseList.tsx
        ExpenseForm.tsx
        AccountCurrentCard.tsx
        MorosityTable.tsx
        LedgerExport.tsx
      hooks/
        useExpenses.ts
        useAccountCurrent.ts
        useMorosity.ts
      storage/
        expenses.storage.ts

    amenities/ (optional)
      components/
        AmenityReservationForm.tsx
        ReservationCalendar.tsx
      hooks/
        useAmenities.ts
      storage/
        amenities.storage.ts

    assistant/
      components/
        AssistantWidget.tsx
        AssistantChat.tsx
      hooks/
        useAssistant.ts
      types/
        assistant.types.ts

  shared/
    components/
      ui/                    (existing: Button, Card, Badge, Input, Select, Table)
      layout/                (existing: AppShell, Sidebar, Topbar)
      context/
        ContextBreadcrumbs.tsx     (new: muestra tenant / building / unit activos)
        RoleSelector.tsx           (new: selector de rol para multi-role users)
    hooks/
      useContextAware.ts     (new: returns { tenantId, buildingId, unitId, activeRole })
      useAssistantContext.ts (new: returns context para assistant widget)
```

---

## 10. Phase-Based Implementation Roadmap

### Phase 1: Foundation & Navigation (1-2 weeks)
- [ ] Update Prisma schema con nuevos modelos (Ticket, Communication, Provider, Document, Expense, Amenity)
- [ ] Create migration
- [ ] Update auth/JWT para incluir `buildingScope` en claims
- [ ] Create `useContextAware()` hook para capturar tenantId/buildingId/unitId de URL
- [ ] Create context breadcrumbs component
- [ ] Implement building selector en tenant dashboard
- [ ] Create building dashboard layout + subnav
- [ ] Create unit dashboard layout

### Phase 2: Tickets/Reclamos (1-2 weeks)
- [ ] Build Ticket storage layer (localStorage → API ready)
- [ ] Build Ticket UI (table, form, detail, comments, evidence)
- [ ] Building dashboard → tickets page
- [ ] Unit dashboard → crear/seguir reclamos

### Phase 3: Communications (1 week)
- [ ] Build Communication storage layer
- [ ] Build Communication UI (list, create, segmentation builder, channel selector)
- [ ] Building dashboard → communications page
- [ ] Unit dashboard → comunicados

### Phase 4: Finance/Ledger (1-2 weeks)
- [ ] Build Expense storage layer
- [ ] Build Finance UI (expenses, account current, morosity table)
- [ ] Building dashboard → finances page
- [ ] Integrate con existing payments feature

### Phase 5: Providers, Documents, Residents (1 week)
- [ ] Build Provider/Document storage layers
- [ ] Build UIs
- [ ] Building dashboard → providers, documents pages

### Phase 6: API Endpoints (Parallel with UI)
- [ ] Phase 2 API: buildings, units, users CRUD
- [ ] Phase 3 API: tickets CRUD + comments + evidence
- [ ] Phase 4 API: communications CRUD + send + confirmations
- [ ] Phase 5 API: expenses, providers, documents CRUD

### Phase 7: Advanced Features & Polish (2+ weeks)
- [ ] Multi-role support (role selector UI)
- [ ] Amenities + reservations (optional)
- [ ] Assistant IA widget (placeholder API)
- [ ] Advanced reporting (charts, exports)
- [ ] Performance optimization
- [ ] Mobile responsiveness
- [ ] Accessibility (a11y)

### Phase 8: SUPER_ADMIN Expansions
- [ ] Monitoring dashboard
- [ ] Billing SaaS module
- [ ] Support/tickets for platform issues
- [ ] Auditing & security logs
- [ ] Config global (integraciones, catálogos, etc.)

---

## 11. Storage vs API Migration Strategy

### Current State
- Auth: **API** (real)
- Tenants, Buildings, Units, Users, Payments, Banking, Properties: **localStorage** (MVP)

### Migration Path
1. **Keep localStorage** as a fallback/offline layer during development
2. **Build API endpoints** for each feature
3. **Gradually migrate** UI hooks to use API + React Query (or SWR)
4. **Remove localStorage** once API is production-ready

### Example (for reference)
```typescript
// Before: localStorage only
const useUnits = () => {
  const units = listUnits(tenantId); // from storage
  return { units };
};

// After: API-first with localStorage fallback
const useUnits = () => {
  const { data: units } = useQuery(
    ['units', tenantId],
    () => fetch(`/tenants/${tenantId}/units`).then(r => r.json()),
    { fallbackData: listUnits(tenantId) } // fallback to localStorage
  );
  return { units };
};

// Final: API only
// (remove localStorage)
```

---

## 12. Success Criteria

By end of Phase 7, the app should have:

- ✅ 4 hierarchical dashboards (Super-Admin, Tenant, Building, Unit)
- ✅ 20+ API endpoints covering core business flows
- ✅ CRUD for: Buildings, Units, Tickets, Communications, Providers, Documents, Expenses
- ✅ Multi-role support in UI (role selector)
- ✅ Multi-tenant isolation at DB + API + UI level
- ✅ Finance tracking (expenses, ledger, account current, morosity)
- ✅ Asistente IA widget (contextual, at least basic integration)
- ✅ Mobile responsive
- ✅ Accessibility WCAG 2.1 AA
- ✅ Test coverage for core workflows
- ✅ Comprehensive documentation (this architecture doc)

---

## 13. Known Constraints & Decisions

1. **Tenant scope**: A building always belongs to 1 tenant. A user can have multiple roles, but always scoped to memberships + optional building scope.
2. **Soft deletes**: UnitResident uses `endAt` for history. Consider same pattern for other entities (Ticket, Communication, User).
3. **Notifications**: Not yet scoped. Will need webhook/event system later (BullMQ ready in Redis).
4. **Audit logs**: Must log every mutation (user, action, entity, timestamp, tenantId, buildingId).
5. **Offline support**: localStorage-first strategy enables offline-first PWA later.
6. **Assistant IA**: Placeholder API. Integrate LLM (OpenAI, Claude, etc.) in Phase 7.

