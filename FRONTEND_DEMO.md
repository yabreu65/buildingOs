# 🎨 BuildingOS Frontend — DEMO GUIDE

**Frontend está LIVE en**: http://localhost:3000

---

## 📋 CREDENCIALES DE PRUEBA

### Super Admin
```
Email:    superadmin@demo.com
Password: SuperAdmin123!

Permisos:
- Gestión global de tenants
- Auditoría global
- Estadísticas globales
```

### Tenant Admin
```
Email:    admin@demo.com
Password: Admin123!

Permisos:
- Gestión de buildings
- Gestión de units
- Ver estadísticas del tenant
- Ver auditoría del tenant
```

### Operator
```
Email:    operator@demo.com
Password: Operator123!

Permisos:
- Ver buildings (no crear)
- Ver units (no crear)
- Lectura de datos
```

### Resident
```
Email:    resident@demo.com
Password: Resident123!

Permisos:
- Ver su unit
- Acceso limitado a datos
```

---

## 🗺️ RUTAS DISPONIBLES (18 páginas)

### 🔐 Públicas (Sin login)
```
GET  /login              → Formulario de login con JWT
GET  /signup             → Registro de nuevo usuario
GET  /health            → Health check
```

### 👨‍💼 Tenant Admin Routes (Después de login)
```
GET  /:tenantId/dashboard                    → Dashboard del tenant
├─    Tarjetas de estadísticas
├─    Quick links (Buildings, Units)
└─    Información de suscripción

GET  /:tenantId/buildings                    → Lista de buildings
├─    Grid view con cards
├─    Create button → Modal
├─    Edit inline
└─    Delete with confirmation

GET  /:tenantId/buildings/:buildingId        → Detalles de building
├─    Información + edición
├─    Estadísticas (units, occupied, vacant)
└─    Lista de units

GET  /:tenantId/buildings/:buildingId/units  → Lista de units en building
├─    Tabla con CRUD actions
├─    Create unit form
└─    Unit details

GET  /:tenantId/properties                   → Gestión de propiedades
GET  /:tenantId/payments                     → Pagos (en desarrollo)
GET  /:tenantId/payments/review              → Review pagos (en desarrollo)
GET  /:tenantId/units                        → Units globales (en desarrollo)
GET  /:tenantId/settings/banking             → Configuración bancaria (en desarrollo)
```

### 👑 Super Admin Routes
```
GET  /super-admin/overview                   → Dashboard super admin
├─    KPI cards (total tenants, users, etc.)
├─    Métricas globales
└─    Acceso rápido a tenants

GET  /super-admin/tenants                    → Gestión de tenants
├─    Tabla con tenant CRUD
├─    Create tenant wizard (3 pasos)
├─    Edit tenant modal
├─    Delete with confirmation
└─    Search/filter/sort

GET  /super-admin/tenants/create             → Wizard para crear tenant
└─    Paso a paso: Información > Plan > Confirmación

GET  /super-admin/users                      → Gestión de usuarios (🚧 PENDIENTE)
├─    Tabla de usuarios
├─    Create user form
├─    Role assignment
└─    Delete user

GET  /super-admin/billing                    → Dashboard de billing (🚧 PENDIENTE)
├─    KPI: MRR, ARR, Churn
├─    Subscriptions by plan
└─    Upgrade tenant plan

GET  /super-admin/audit-logs                 → Auditoría global (🚧 PENDIENTE)
├─    Tabla de events
├─    Filtros: tenant, user, action, date
└─    Paginación
```

---

## 🎯 QUÉ PUEDES VER AHORA (MVP)

### ✅ TOTALMENTE FUNCIONAL

#### 1. **LOGIN & AUTH**
```
Página: http://localhost:3000/login

Features:
✅ Email/password form
✅ JWT token handling
✅ Session restore (si cierras browser)
✅ Error handling (invalid credentials)
✅ Link to signup
✅ Demo credentials hint
```

**Demo**:
- Entra con `admin@demo.com` / `Admin123!`
- Cierra browser, reabre → sesión se restaura
- Logout → token se limpia

---

#### 2. **TENANT DASHBOARD**
```
Página: http://localhost:3000/[tenantId]/dashboard

Features:
✅ Welcome card con tenant name
✅ Stats cards:
   - Total buildings (1)
   - Total units (1)
   - Occupied units (0)
   - Vacant units (0)
✅ Quick action buttons
✅ Subscription info
✅ Sidebar navigation
```

**Demo**: Login → verás stats en tiempo real

---

#### 3. **BUILDINGS MANAGEMENT** (Full CRUD)
```
Página: http://localhost:3000/[tenantId]/buildings

Features:
✅ Grid de buildings con cards
✅ CREATE: Modal con form (name, address)
✅ READ: Click card → detail page
✅ UPDATE: Edit inline o modal
✅ DELETE: Confirmation dialog
✅ Loading skeletons
✅ Empty state (si no hay buildings)
✅ Error handling
✅ Toast notifications
```

**Demo**:
1. Click "Create Building" → modal form
2. Entra "Test Building" + "123 Main St"
3. Click "Create" → toast "Building created"
4. Click card creado → detail page
5. Edit → "Updated name" → toast "Building updated"
6. Back → click delete → confirmation → toast "Deleted"

---

#### 4. **UNITS MANAGEMENT** (Full CRUD)
```
Página: http://localhost:3000/[tenantId]/buildings/[buildingId]/units

Features:
✅ Tabla con units
✅ Columnas:
   - Label (Apt 101, etc.)
   - Unit Code (101)
   - Type (Apartment, Studio, etc.)
   - Occupancy status (Occupied, Vacant, Unknown)
   - Actions (Edit, Delete)
✅ CREATE: Form modal
✅ UPDATE: Inline edit
✅ DELETE: Confirmation
✅ Loading states
✅ Pagination (si hay muchas)
✅ Sorting/filtering
```

**Demo**:
1. Entra a building → Units tab
2. Click "Create Unit" → modal
3. Entra "Apt 102" + "102" + "Apartment" + "Vacant"
4. Ver unit creado en tabla
5. Click edit → cambiar occupancy → guardar

---

#### 5. **SUPER ADMIN DASHBOARD**
```
Página: http://localhost:3000/super-admin/overview

Features:
✅ KPI cards:
   - Total tenants
   - Total users
   - Active subscriptions
   - Trial subscriptions
✅ Tenant breakdown by type
✅ Recent tenants list
✅ Quick links
```

**Demo**: Login con superadmin@demo.com → ver estadísticas globales

---

#### 6. **SUPER ADMIN - TENANT MANAGEMENT**
```
Página: http://localhost:3000/super-admin/tenants

Features:
✅ Tabla de tenants con:
   - Name
   - Type (ADMINISTRADORA, EDIFICIO_AUTOGESTION)
   - Plan (FREE, BASIC, PRO, ENTERPRISE)
   - Status (ACTIVE, TRIAL, SUSPENDED)
   - Created date
   - Actions (Edit, Delete, View)

✅ CREATE: 3-step wizard
   - Step 1: Name + Type
   - Step 2: Plan selection
   - Step 3: Confirmación

✅ UPDATE: Modal edit form

✅ DELETE: Soft delete confirmation

✅ Search: Filter by name

✅ Sort: Click headers para sort

✅ Error handling: Duplicate prevention (409)
```

**Demo**:
1. Click "Create Tenant"
2. Step 1: Enter name "Test Corp" + type "ADMINISTRADORA"
3. Step 2: Select plan "PRO"
4. Step 3: Confirm
5. Ver nuevo tenant en tabla
6. Edit: Click edit → cambiar nombre → save
7. Delete: Click delete → confirm → removed from list

---

#### 7. **TENANT DETAIL PAGE**
```
Página: http://localhost:3000/super-admin/tenants/[tenantId]

Features:
✅ Tenant information card
✅ Edit form:
   - Name
   - Type
   - Plan
   - Status
✅ Statistics:
   - Buildings count
   - Units count
   - Users count
✅ Save/Cancel buttons
✅ Delete button
```

---

### 🚧 PARCIALMENTE FUNCIONAL (con API pero sin UI completa)

#### 8. **TENANT STATS** (API working, minimal UI)
```
Endpoint: GET /tenants/:tenantId/stats
Status: ✅ Data is fetched, displayed in dashboard

Data:
- totalBuildings: 1
- totalUnits: 1
- occupiedUnits: 0
- vacantUnits: 0
- unknownUnits: 1
- totalResidents: 0
```

---

#### 9. **TENANT BILLING** (API working, minimal UI)
```
Endpoint: GET /tenants/:tenantId/billing
Status: ✅ Data is fetched, displayed in dashboard

Data:
- Subscription status
- Plan details (limits, features)
- Current usage (buildings, units, residents)
```

---

#### 10. **TENANT AUDIT LOGS** (API working, minimal UI)
```
Endpoint: GET /tenants/:tenantId/audit-logs
Status: ✅ Data is fetched

Data:
- Action (TENANT_CREATE, BUILDING_UPDATE, etc.)
- Entity (Building, Unit, User)
- Actor (who did it)
- Timestamp
```

---

### ❌ PENDIENTES (Rutas existen pero sin implementación UI)

```
❌ /:tenantId/properties          → Gestión de propiedades
❌ /:tenantId/payments            → Pagos
❌ /:tenantId/payments/review     → Review de pagos
❌ /:tenantId/units               → Units globales
❌ /:tenantId/settings/banking    → Configuración
❌ /super-admin/users             → User management UI
❌ /super-admin/billing           → Billing dashboard UI
❌ /super-admin/audit-logs        → Audit logs UI
```

---

## 🎨 COMPONENTES UI IMPLEMENTADOS

### Shared Components
```
✅ Layout
   - Sidebar (navigation)
   - Header (tenant selector, logout)
   - Responsive layout

✅ Toast Notifications
   - Success (green)
   - Error (red)
   - Info (blue)
   - Auto-dismiss (3 sec)

✅ Modals
   - Create forms
   - Edit forms
   - Delete confirmation
   - 3-step wizard (tenant creation)

✅ Loading States
   - Skeleton loaders (animated gray boxes)
   - Loading spinners
   - Lazy loading for images

✅ Error States
   - Error message card
   - "Try Again" button
   - Fallback UI

✅ Empty States
   - "No buildings yet" with CTA
   - "No units yet" with CTA
   - Create buttons

✅ Tables
   - Sortable columns
   - Pagination
   - Inline editing
   - Row actions (Edit, Delete)

✅ Forms
   - Input validation (client + server)
   - Error display below fields
   - Submit/Cancel buttons
   - Loading state on submit
```

### Building Components
```
✅ Building Card
   - Name, address
   - Stats (units, occupied, vacant)
   - Edit button
   - Delete button

✅ Building Form
   - Name field (required)
   - Address field (required)
   - Submit/Cancel

✅ Building Detail Page
   - Full building info
   - Edit form
   - Stats section
   - Units list
```

### Unit Components
```
✅ Unit Table
   - Label, Code, Type, Status columns
   - Edit/Delete actions
   - Loading skeleton
   - Pagination

✅ Unit Form Modal
   - Label field
   - Code field
   - Unit type dropdown
   - Occupancy status dropdown
   - Submit/Cancel

✅ Unit Detail
   - Full unit info
   - Resident assignment (PENDIENTE)
```

---

## 🔐 AUTENTICACIÓN & SEGURIDAD

### Implementado
```
✅ JWT login (email + password)
✅ Session restore (localStorage)
✅ Session clear on logout
✅ 401 → redirect to /login
✅ 403 → show error (not authorized)
✅ Token sent in Authorization header
✅ Role-based routing (super-admin routes protected)
```

### Demo
```
1. Login con admin@demo.com
2. Cierra la pestaña (no logout)
3. Reabre http://localhost:3000
4. ✅ Sesión se restaura automáticamente
5. Puedes navegar sin re-login
6. Click Logout → token se limpia
7. Intenta acceder a /super-admin
8. ❌ Redirect a /login (no tienes role)
```

---

## 📊 DATA FLOW (Example: Create Building)

```
Frontend Form
      ↓ (onSubmit)
useBuildings hook
      ↓ (API call)
POST /tenants/:tenantId/buildings
      ↓ (with Authorization header)
Backend: TenantAccessGuard (validates membership)
      ↓
Backend: BuildingsService.create()
      ↓ (save to DB)
Database: INSERT building
      ↓ (return response)
Frontend receives 201 Created
      ↓
Update local state
      ↓
Toast: "Building created" ✅
      ↓
Reload buildings list
```

---

## 🧪 TESTING FRONTEND

### Login Test
```bash
1. Go to http://localhost:3000/login
2. Enter: admin@demo.com / Admin123!
3. Click "Login"
4. Expected: Redirect to /:tenantId/dashboard
5. See: Buildings grid, Stats cards
```

### Create Building Test
```bash
1. In dashboard, click "Create Building"
2. Modal opens
3. Enter name: "Test Building"
4. Enter address: "123 Main St"
5. Click "Create"
6. Expected: Toast "Building created" + new card in grid
7. Verify: Card shows name + address
```

### Edit Building Test
```bash
1. Click on building card
2. Click "Edit"
3. Change name to "Updated Name"
4. Click "Save"
5. Expected: Toast "Building updated" + UI reflects change
```

### Delete Building Test
```bash
1. Click on building card
2. Click "Delete"
3. Confirmation modal appears
4. Click "Delete" in modal
5. Expected: Toast "Building deleted" + card removed from list
```

### Unit CRUD Test
```bash
1. Open a building → Units tab
2. Click "Create Unit"
3. Enter: Label "Apt 102", Code "102", Type "Apartment", Status "Vacant"
4. Click "Create"
5. Expected: Unit appears in table
6. Click edit icon
7. Change label to "Apt 102A"
8. Save
9. Expected: Table updates
10. Click delete
11. Confirm delete
12. Expected: Unit removed from table
```

### Super Admin Test
```bash
1. Logout
2. Login with: superadmin@demo.com / SuperAdmin123!
3. Go to /super-admin/tenants
4. Click "Create Tenant"
5. Enter: Name "Test Corp", Type "ADMINISTRADORA"
6. Select Plan "PRO"
7. Confirm
8. Expected: Tenant appears in table
```

---

## 🐛 KNOWN ISSUES (MVP)

| Issue | Status | Impact |
|-------|--------|--------|
| User management UI missing | 🚧 TASK-06 | Can't create users via UI (only API) |
| Billing dashboard missing | 🚧 TASK-07 | Can't see revenue metrics |
| Payments page empty | ⏳ Phase 2 | No payment processing |
| Properties page empty | ⏳ Phase 2 | No property management |
| Resident assignment form | ⏳ Phase 2 | Can't assign residents to units |

---

## 📈 NEXT FEATURES (After Feb 28)

```
TASK-06: User Management Page
├─ List users table
├─ Create user form
├─ Update roles modal
└─ Delete user confirmation

TASK-07: Billing Dashboard
├─ MRR / ARR cards
├─ Subscriptions pie chart
├─ Tenant subscription table
└─ Plan upgrade modal
```

---

## 🚀 QUICK START

### Option 1: Fresh Test
```bash
# Terminal 1: API
npm run start --prefix apps/api

# Terminal 2: Frontend
npm run dev --prefix apps/web

# Browser: http://localhost:3000
```

### Option 2: Use Existing
```
✅ API already running: http://localhost:4000
✅ Frontend already running: http://localhost:3000

Just open browser → http://localhost:3000
```

### First Thing to Try
```
1. Go to http://localhost:3000/login
2. Login with: admin@demo.com / Admin123!
3. Click "Buildings" in sidebar
4. Click "Create Building"
5. Enter name + address
6. Click "Create"
7. See building card appear!
```

---

## 📋 TECH STACK

```
Frontend:
- Next.js 14 (App Router)
- React 18
- TypeScript
- TailwindCSS (styling)
- React Hook Form (forms)
- Zod (validation)
- Custom hooks (useBuildings, useAuth, etc.)

API:
- NestJS
- PostgreSQL
- Prisma ORM
- JWT (authentication)

Testing:
- Jest
- Supertest (e2e)
```

---

**Last Updated**: Feb 14, 2026
**Tested**: ✅ All features working
**Ready to**: ✅ Demo to product/stakeholders
