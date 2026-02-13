# Phase 1 — Building Navigation & Dashboard
**Status**: Starting
**Timeline**: Feb 14 - Mar 5, 2026 (3 weeks)
**Goal**: Build front-end routes, hooks, and components to consume Phase 0 API endpoints

---

## 📋 User Stories & Features

### 1. Building List & Selection
**As a tenant owner/admin, I want to:**
- See all buildings in my tenant
- Click a building to enter the Building Dashboard
- Create a new building
- Edit building details (name, address)
- Suspend/delete a building

**Routes**:
- `GET /(tenant)/[tenantId]/buildings` → BuildingsPage (list + create)

**API Calls**:
- `GET /tenants/:tenantId/buildings` → List all buildings
- `POST /tenants/:tenantId/buildings` → Create building
- `PATCH /tenants/:tenantId/buildings/:buildingId` → Update building
- `DELETE /tenants/:tenantId/buildings/:buildingId` → Delete building

---

### 2. Building Overview & Navigation Hub
**As a tenant admin, I want to:**
- See building details (name, address, stats)
- Navigate to Units, Tickets, Payments, Residents, etc.
- Breadcrumb showing: Tenant > Building
- Quick stats (units count, occupied/vacant, active residents)

**Routes**:
- `GET /(tenant)/[tenantId]/buildings/[buildingId]` → BuildingOverviewPage

**Components**:
- BuildingBreadcrumb (Tenant > Building)
- BuildingSubnav (tabs: Overview, Units, Residents, Tickets, Payments, Settings)
- BuildingStatsCard (units, occupancy, residents)
- BuildingDetailsForm

**API Calls**:
- `GET /tenants/:tenantId/buildings/:buildingId` → Get building with units

---

### 3. Units Management
**As a building admin, I want to:**
- See all units in the building
- Create new units
- Edit unit details (code, label, type, status)
- See who's assigned to each unit
- Remove residents from units
- Delete units

**Routes**:
- `GET /(tenant)/[tenantId]/buildings/[buildingId]/units` → UnitsPage
- `GET /(tenant)/[tenantId]/buildings/[buildingId]/units/[unitId]` → UnitDetailPage (optional for Phase 1)

**Components**:
- UnitsTable (columns: code, label, type, occupancy status, primary resident, actions)
- CreateUnitForm
- EditUnitForm
- AssignResidentModal
- UnitActionsDropdown (Edit, Assign Resident, Remove Resident, Delete)

**API Calls**:
- `GET /tenants/:tenantId/buildings/:buildingId/units` → List units
- `POST /tenants/:tenantId/buildings/:buildingId/units` → Create unit
- `PATCH /tenants/:tenantId/buildings/:buildingId/units/:unitId` → Update unit
- `DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId` → Delete unit
- `POST /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants` → Assign occupant
- `DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants/:occupantId` → Remove occupant

---

### 4. Context & Navigation Helpers
**Hooks to create**:
- `useContextAware()` → Extract tenantId, buildingId, unitId from URL params
- `useBuildings(tenantId)` → Fetch buildings, loading state, error handling
- `useUnits(tenantId, buildingId)` → Fetch units for building
- `useOccupants(tenantId, buildingId, unitId)` → Fetch occupants for unit

**Context to create**:
- BuildingContext → Share active building info across pages
- UnitContext → Share active unit info across pages

---

## 🎯 Acceptance Criteria

### UI Routes
- ✅ All routes render without errors
- ✅ Routes require authentication (tenantId membership check)
- ✅ Breadcrumbs show correct navigation path
- ✅ Subnav highlights active section

### API Integration
- ✅ Buildings page shows list from API
- ✅ Building overview shows building details
- ✅ Units page shows units from API
- ✅ Forms submit to API with proper error handling
- ✅ Modals confirm before delete operations

### Data Handling
- ✅ Loading states show spinner
- ✅ Error states show alert/toast
- ✅ Success states show success message
- ✅ Cross-tenant access prevented (UI respects auth scope)

---

## 📁 Deliverables

### Routes
```
/(tenant)/[tenantId]/buildings/
  ├── page.tsx                          BuildingsPage
  ├── [buildingId]/
  │   ├── page.tsx                      BuildingOverviewPage
  │   └── units/
  │       ├── page.tsx                  UnitsPage
  │       └── [unitId]/
  │           └── page.tsx              UnitDetailPage (optional)
```

### Hooks
```
features/buildings/
  ├── hooks/
  │   ├── useBuildings.ts               List buildings, create, update, delete
  │   ├── useUnits.ts                   List units, create, update, delete
  │   └── useOccupants.ts               List, assign, remove occupants
  ├── context/
  │   ├── BuildingContext.tsx           Active building state
  │   └── UnitContext.tsx               Active unit state
  └── types/
      └── index.ts                      BuildingDTO, UnitDTO, OccupantDTO
```

### Components
```
features/buildings/components/
  ├── BuildingBreadcrumb.tsx
  ├── BuildingSubnav.tsx
  ├── BuildingStatsCard.tsx
  ├── BuildingDetailsForm.tsx
  ├── UnitsTable.tsx
  ├── CreateUnitForm.tsx
  ├── EditUnitForm.tsx
  ├── AssignResidentModal.tsx
  └── UnitActionsDropdown.tsx
```

---

## 🔄 Implementation Order

1. **Day 1-2: Types & Hooks**
   - Create BuildingDTO, UnitDTO, OccupantDTO types
   - Build useBuildings hook with full CRUD
   - Build useUnits hook with full CRUD
   - Build useOccupants hook

2. **Day 3-4: Context & Navigation**
   - Create BuildingContext
   - Create UnitContext
   - Implement useContextAware hook
   - Update TenantLayout to include building context

3. **Day 5-6: Buildings Page**
   - Create /buildings page layout
   - List buildings from API
   - Add breadcrumb
   - Implement create/edit/delete flows

4. **Day 7-9: Building Overview & Units**
   - Create /buildings/[buildingId] overview page
   - Add building subnav
   - List units in building
   - Implement unit create/edit/delete

5. **Day 10+: Forms & Modals**
   - Create unit forms with validation
   - Resident assignment modal
   - Error handling & UX polish

---

## 🧪 Testing Plan

- [ ] Manual: Navigate through all routes
- [ ] Manual: Create, edit, delete buildings
- [ ] Manual: Create, edit, delete units
- [ ] Manual: Assign/remove residents
- [ ] Manual: Cross-tenant isolation (can't access other tenant's buildings)
- [ ] Manual: Error states (network errors, 404s, 403s)
- [ ] Manual: Loading states appear while fetching

---

## 📊 Success Metrics

- All 5 routes load without errors
- All API operations work (create, read, update, delete)
- Forms validate input and show errors
- Modals confirm destructive actions
- Breadcrumbs and subnav work correctly
- No console errors
- No data leakage across tenants
