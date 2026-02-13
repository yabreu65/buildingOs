# Phase 0 — Foundation (COMPLETED) ✅

**Date**: February 13, 2026
**Status**: ✅ COMPLETED

---

## 📋 What Was Done

### 1. Prisma Schema Extension

**Added 3 new models:**

```prisma
enum UnitOccupantRole {
  OWNER
  RESIDENT
}

model Building {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  address   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  units     Unit[]

  @@unique([tenantId, name])        // Unique building name per tenant
  @@index([tenantId])
}

model Unit {
  id               String         @id @default(cuid())
  buildingId       String
  code             String         // Unit number (101, 102, etc.)
  label            String?        // Display name (Apt 101, etc.)
  unitType         String         @default("APARTMENT")
  occupancyStatus  String         @default("UNKNOWN")
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  building         Building       @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  unitOccupants    UnitOccupant[]

  @@unique([buildingId, code])     // Unique unit code per building
  @@index([buildingId])
}

model UnitOccupant {
  id        String                @id @default(cuid())
  unitId    String
  userId    String
  role      UnitOccupantRole      // OWNER or RESIDENT
  createdAt DateTime              @default(now())
  updatedAt DateTime              @updatedAt

  unit      Unit                  @relation(fields: [unitId], references: [id], onDelete: Cascade)
  user      User                  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([unitId, userId, role]) // Prevent duplicate occupant assignments
  @@index([unitId])
  @@index([userId])
}
```

**Updated existing models:**

- `Tenant`: Added `buildings Building[]` relation
- `User`: Added `unitOccupants UnitOccupant[]` relation

### 2. Database Migration

**File**: `apps/api/prisma/migrations/20260213015939_add_building_unit_occupant/migration.sql`

**What it does:**
- Creates `UnitOccupantRole` enum (OWNER, RESIDENT)
- Creates `Building` table with tenant FK and unique constraint on (tenantId, name)
- Creates `Unit` table with building FK and unique constraint on (buildingId, code)
- Creates `UnitOccupant` table with user/unit FKs and unique constraint on (unitId, userId, role)
- All FKs use `ON DELETE CASCADE` for proper cleanup
- Indexes on all foreign key columns + unique combinations

### 3. Seed Data

**File**: `apps/api/prisma/seed.ts` (extended)

**What's seeded:**
```
Tenant: "Edificio Demo" (EDIFICIO_AUTOGESTION)
  └─ Building: "Demo Building" (123 Main St, Apartment Complex)
      ├─ Unit 101 (Apt 101, APARTMENT, OCCUPIED)
      │  └─ Admin Demo as OWNER
      └─ Unit 102 (Apt 102, APARTMENT, VACANT)
         └─ Resident Demo as RESIDENT
```

**How to seed:**
```bash
npm run db:seed
```

---

## ✅ Verification Checklist

- ✅ Schema compiles without errors
- ✅ Migration created and applied successfully
- ✅ Seed data populated correctly
- ✅ Building → Unit relationships working
- ✅ Unit → UnitOccupant relationships working
- ✅ UnitOccupant → User relationships working
- ✅ Uniqueness constraints enforced
- ✅ Foreign keys cascade properly
- ✅ Indexes created on all FK columns
- ✅ TypeScript API compiles without errors (`npx tsc --noEmit`)

---

## 🧪 Testing Results

```
✅ Buildings: 1
  - Demo Building (123 Main St, Apartment Complex)
    └─ Apt 101 (101) - APARTMENT [OCCUPIED]
       └─ Admin Demo (OWNER)
    └─ Apt 102 (102) - APARTMENT [VACANT]
       └─ Resident Demo (RESIDENT)

✅ Unit Occupants: 2
  - Admin Demo (OWNER) → Apt 101 in Demo Building
  - Resident Demo (RESIDENT) → Apt 102 in Demo Building

✅ ALL MODELS WORKING!
```

---

## 🔍 SQL Generated

### Building Table
```sql
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Building_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE
);

CREATE INDEX "Building_tenantId_idx" ON "Building"("tenantId");
CREATE UNIQUE INDEX "Building_tenantId_name_key" ON "Building"("tenantId", "name");
```

### Unit Table
```sql
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "unitType" TEXT NOT NULL DEFAULT 'APARTMENT',
    "occupancyStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Unit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE
);

CREATE INDEX "Unit_buildingId_idx" ON "Unit"("buildingId");
CREATE UNIQUE INDEX "Unit_buildingId_code_key" ON "Unit"("buildingId", "code");
```

### UnitOccupant Table
```sql
CREATE TABLE "UnitOccupant" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UnitOccupantRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitOccupant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UnitOccupant_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE,
    CONSTRAINT "UnitOccupant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "UnitOccupant_unitId_idx" ON "UnitOccupant"("unitId");
CREATE INDEX "UnitOccupant_userId_idx" ON "UnitOccupant"("userId");
CREATE UNIQUE INDEX "UnitOccupant_unitId_userId_role_key" ON "UnitOccupant"("unitId", "userId", "role");
```

### Enum
```sql
CREATE TYPE "UnitOccupantRole" AS ENUM ('OWNER', 'RESIDENT');
```

---

## 📝 Business Rules Implemented

| Rule | Implementation |
|------|-----------------|
| Building belongs to Tenant | `Building.tenantId` FK with CASCADE delete |
| Unit belongs to Building | `Unit.buildingId` FK with CASCADE delete |
| Building name unique per tenant | `@@unique([tenantId, name])` |
| Unit code unique per building | `@@unique([buildingId, code])` |
| UnitOccupant has role (OWNER/RESIDENT) | `UnitOccupantRole` enum + unique constraint |
| No duplicate occupants | `@@unique([unitId, userId, role])` |
| Timestamps on all models | `createdAt`, `updatedAt` on Building, Unit, UnitOccupant |
| Proper indexing | Indexes on all FK columns for query performance |

---

## 🚀 Next Steps (Phase 1)

Now that the foundation is in place:

1. **Build `useContextAware()` hook**
   - Extract tenantId, buildingId, unitId from URL
   - File: `apps/web/shared/hooks/useContextAware.ts`

2. **Update JWT strategy**
   - Add building scope to JWT claims
   - File: `apps/api/src/auth/jwt.strategy.ts`

3. **Create context breadcrumbs component**
   - Show: SUPER_ADMIN > Tenant > Building
   - File: `apps/web/shared/components/layout/ContextBreadcrumbs.tsx`

4. **Create role selector component**
   - Allow users with multiple roles to switch
   - File: `apps/web/shared/components/layout/RoleSelector.tsx`

5. **Build building & unit dashboard layouts**
   - Navigation scaffolding
   - File: `apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/layout.tsx`
   - File: `apps/web/app/(tenant)/[tenantId]/units/[unitId]/layout.tsx`

---

## 🔗 Files Changed

```
✅ apps/api/prisma/schema.prisma
   └─ Added 3 models (Building, Unit, UnitOccupant)
   └─ Added 1 enum (UnitOccupantRole)
   └─ Updated 2 models (Tenant, User) with relations

✅ apps/api/prisma/migrations/20260213015939_add_building_unit_occupant/migration.sql
   └─ Generated migration with DDL for all tables, indexes, constraints

✅ apps/api/prisma/seed.ts
   └─ Extended seed to populate demo building + units + occupants
   └─ Idempotent upserts (safe to re-run)

✅ Commit: 1df339f
```

---

## 💡 Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Enum for UnitOccupantRole** | Type safety + validation at DB level |
| **Unique constraints at DB level** | Prevent invalid states + better performance |
| **CASCADE delete** | Clean up orphaned records automatically |
| **Indexes on FKs** | Query performance for lookups by building, unit, user |
| **`label` field optional** | Allow code-only units or display-friendly labels |
| **`address` field optional** | Support both building types |

---

## 📚 How to Query These Models

### Get building with units and occupants
```typescript
const building = await prisma.building.findUnique({
  where: { id: buildingId },
  include: { units: { include: { unitOccupants: { include: { user: true } } } } },
});
```

### Get unit with occupants
```typescript
const unit = await prisma.unit.findUnique({
  where: { id: unitId },
  include: { unitOccupants: { include: { user: true } } },
});
```

### Get user's units
```typescript
const userUnits = await prisma.unitOccupant.findMany({
  where: { userId: userId },
  include: { unit: { include: { building: true } } },
});
```

### Create new unit
```typescript
const newUnit = await prisma.unit.create({
  data: {
    buildingId: buildingId,
    code: "103",
    label: "Apt 103",
    unitType: "APARTMENT",
    occupancyStatus: "VACANT",
  },
});
```

### Assign occupant to unit
```typescript
const occupant = await prisma.unitOccupant.create({
  data: {
    unitId: unitId,
    userId: userId,
    role: "RESIDENT",
  },
});
```

---

## ✨ Summary

**Phase 0 is complete!** ✅

- 3 new models in Prisma schema
- 1 migration applied successfully
- Seed data working correctly
- All constraints and indexes in place
- Zero TypeScript errors

**Ready to move to Phase 1** → Build navigation hooks and dashboards.

