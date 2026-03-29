# Migration Guide Skill

**Trigger**: Creating Prisma migrations in BuildingOS

## Purpose
Follow correct migration workflow to avoid breaking production.

## Local Development Workflow

### 1. Update Schema
Edit `apps/api/prisma/schema.prisma` with new models/fields.

### 2. Create Migration (Development)
```bash
cd apps/api
npx prisma migrate dev --name descriptive_name
```

This creates a migration and applies it to local database.

### 3. Generate Client
```bash
npx prisma generate
```

### 4. Test Locally
- Run API and verify new functionality
- Run E2E tests if applicable

### 5. Reset Local DB (if needed)
```bash
npx prisma migrate reset
```

## Production Deployment

### NEVER use migrate dev in production
Use `migrate deploy` for production.

### Migration Files Location
```
apps/api/prisma/migrations/
├── 20260101120000_initial/
│   └── migration.sql
└── 20260101120001_add_feature/
    └── migration.sql
```

### Manual Migration (if needed)
```bash
npx prisma migrate deploy
```

## Rollback

### Local Rollback
```bash
npx prisma migrate rollback
```

### Production Rollback
Create a new migration that reverts the change:
```sql
-- Revert migration
ALTER TABLE "table" DROP COLUMN "new_column";
```

## Best Practices

1. **Never edit migration files** after commit
2. **Always test migrations locally first**
3. **Keep migrations small and focused**
4. **Use descriptive names**: `add_xxx_field`, `create_xxx_table`
5. **Add comments** for complex migrations

## Common Patterns

### Add Field
```bash
npx prisma migrate dev --name add_status_to_xxx
```

### Rename Field
```prisma
// schema.prisma
fieldName String @map("field_name") @oldMap("old_field_name")
```

### Create Relation
```prisma
model Xxx {
  // ... fields
  building Building @relation(fields: [buildingId], references: [id])
  buildingId String
}
```

### Add Index
```prisma
model Xxx {
  // ... fields
  @@index([tenantId])
  @@index([status])
}
```

## Troubleshooting

### Migration Failed
```bash
# Check database state
npx prisma migrate status

# Reset (dev only)
npx prisma migrate reset
```

### Prisma Client Outdated
```bash
npx prisma generate
```

### Schema Drift
```bash
# Compare local with database
npx prisma db pull
# OR
npx prisma migrate diff
```

## Validation Checklist

Before completing:
- [ ] Migration runs locally without errors
- [ ] Prisma client generated
- [ ] API works with new schema
- [ ] Migration name is descriptive
- [ ] No manual SQL edits after creation

## CI/CD

In production deployments:
```bash
npx prisma migrate deploy
```

Make sure DATABASE_URL points to production database.
