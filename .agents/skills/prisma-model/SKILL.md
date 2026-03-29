# Prisma Model Skill

**Trigger**: Creating new Prisma models, relations, or migrations in BuildingOS

## Purpose
Generate Prisma schema following BuildingOS conventions and patterns.

## Conventions

### File Location
```
apps/api/prisma/schema.prisma
```

### Model Structure
```prisma
model Xxx {
  id            String   @id @default(cuid())
  tenantId      String   @map("tenant_id")
  name          String?
  
  // Relations
  building      Building @relation(fields: [buildingId], references: [id])
  buildingId    String   @map("building_id")
  
  // Audit
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  
  // Multi-tenancy
  deletedAt     DateTime? @map("deleted_at")
  
  @@map("xxx")
  @@index([tenantId])
  @@index([buildingId])
}
```

### Naming Conventions
- Model: PascalCase singular (e.g., `Building`, `Unit`, `TenantMember`)
- Table: snake_case plural (e.g., `buildings`, `units`, `tenant_members`)
- Fields: snake_case
- Relations: `{entity}Id` format

### Required Fields
Every model MUST have:
- `id` - CUID primary key
- `tenantId` - Multi-tenant isolation
- `createdAt` - Creation timestamp
- `updatedAt` - Update timestamp

### Soft Deletes
```prisma
deletedAt DateTime? @map("deleted_at")

// In service queries:
where: { tenantId, deletedAt: null }
```

### Enums
```prisma
enum XxxStatus {
  DRAFT
  PENDING
  ACTIVE
  DISABLED
}
```

### Relations
```prisma
// Many-to-one
building Building @relation(fields: [buildingId], references: [id], onDelete: Cascade)

// One-to-many
units Unit[]

// Many-to-many
members Member[]
```

### Indexes
Always add indexes for:
- `tenantId` (multi-tenant queries)
- Foreign keys
- Frequently filtered fields

## Migration Workflow

1. **Edit schema.prisma** - Add/modify models
2. **Generate migration**:
   ```bash
   cd apps/api
   npx prisma migrate dev --name descriptive_name
   ```
3. **Apply to database** (local only)
4. **DO NOT commit migrations** - use `migrate:deploy` in CI

## Multi-tenancy Rules
- Every model MUST have `tenantId` field
- All queries MUST filter by `tenantId`
- Cross-tenant = return 404 (never expose 403)

## Usage

When creating a new model:

1. Add model to schema.prisma
2. Add required fields (id, tenantId, createdAt, updatedAt)
3. Define relations
4. Add indexes for tenantId and foreign keys
5. Run `npx prisma generate`
6. Use in service with Prisma client

## Validation Checklist

Before completing:
- [ ] Model has tenantId
- [ ] Soft delete (deletedAt) for tenant-scoped entities
- [ ] Indexes on tenantId and foreign keys
- [ ] Relations defined with proper cascade
- [ ] Migration runs successfully
- [ ] Prisma client generated

## Common Patterns

### Tenant-scoped
```prisma
model Expense {
  id        String  @id @default(cuid())
  tenantId  String
  // ... fields
}
```

### Building-scoped
```prisma
model Unit {
  id         String  @id @default(cuid())
  buildingId String
  tenantId   String  // Denormalized for tenant queries
  // ... fields
}
```

### Global (super-admin)
```prisma
model Tenant {
  id        String  @id @default(cuid())
  // No tenantId - global entity
}
```
