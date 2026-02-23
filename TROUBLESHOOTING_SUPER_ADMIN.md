# Troubleshooting: SUPER_ADMIN Access Errors

## Error: "Usuario no encontrado" on /super-admin/leads

### Symptoms
- Endpoint `/super-admin/leads` returns `UnauthorizedException: Usuario no encontrado`
- User is logged in but cannot access any SUPER_ADMIN endpoints
- Error occurs in JWT validation phase (before SuperAdminGuard)

### Root Cause Analysis

The error "Usuario no encontrado" comes from `jwt.strategy.ts:101`:

```typescript
const user = await this.prisma.user.findUnique({
  where: { id: payload.sub },
});

if (!user) {
  throw new UnauthorizedException('Usuario no encontrado'); // ← This error
}
```

This can happen for several reasons:

1. **Database not migrated** - Migrations failed, schema doesn't exist
2. **Seed data not applied** - SUPER_ADMIN user doesn't exist in DB
3. **Token has invalid user.id** - JWT sub claim doesn't match any user

### Solution: Quick Fix

#### Step 1: Check Database Health

```bash
# Check if migrations applied successfully
npm run -w apps/api -- prisma migrate status

# If migrations failed:
npm run -w apps/api -- prisma migrate resolve --rolled-back <migration_name>
```

#### Step 2: Sync Schema and Seed Data (Development Only)

```bash
# Force reset and sync schema
npm run -w apps/api -- prisma db push --skip-generate --force-reset

# Apply seed data
npm run -w apps/api -- npm run seed
```

#### Step 3: Verify SUPER_ADMIN User Exists

```bash
# Query the database directly (if using psql)
psql -U postgres -d buildingos -c "SELECT id, email, name FROM \"User\" WHERE email='superadmin@demo.com';"

# Credentials from seed:
# Email: superadmin@demo.com
# Password: SuperAdmin123!
```

#### Step 4: Test Login

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@demo.com",
    "password": "SuperAdmin123!"
  }'

# Should return:
# {
#   "accessToken": "eyJ...",
#   "user": { "id": "...", "email": "superadmin@demo.com", "name": "Super Admin" },
#   "memberships": [
#     {
#       "tenantId": "...",
#       "roles": ["SUPER_ADMIN"],
#       "scopedRoles": [{ "role": "SUPER_ADMIN", "scopeType": "TENANT" }]
#     }
#   ]
# }
```

#### Step 5: Test SUPER_ADMIN Endpoint

```bash
TOKEN="<accessToken from login response>"

curl -X GET http://localhost:4000/leads/admin \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Should return:
# { "data": [], "total": 0, "page": 0 }
```

---

## Understanding SUPER_ADMIN Authentication Flow

### JWT Generation (`auth.service.ts`)

When SUPER_ADMIN logs in:

```typescript
const isSuperAdmin = user.memberships.some((m) =>
  m.roles.some((r) => r.role === 'SUPER_ADMIN'),
);

const payload = {
  email: user.email,
  sub: user.id,                    // ← User must exist in DB!
  isSuperAdmin,                    // ← Flag for quick checks
};

return {
  accessToken: this.jwtService.sign(payload),
  memberships,
};
```

### JWT Validation (`jwt.strategy.ts`)

When SUPER_ADMIN makes a request:

```typescript
async validate(payload: JwtPayload): Promise<ValidatedUser> {
  // 1. Check if token is impersonating
  if (payload.isImpersonating) { /* ... */ }

  // 2. CRITICAL: Find user in DB
  const user = await this.prisma.user.findUnique({
    where: { id: payload.sub },
  });

  if (!user) {
    throw new UnauthorizedException('Usuario no encontrado');
  }

  // 3. Get memberships
  const memberships = await this.tenancyService.getMembershipsForUser(user.id);

  // 4. Verify isSuperAdmin status
  const isSuperAdmin = payload.isSuperAdmin ||
    memberships.some((m) => m.roles.includes('SUPER_ADMIN'));

  return { ...user, isSuperAdmin, memberships };
}
```

### Authorization (`super-admin.guard.ts`)

After validation, the guard checks role:

```typescript
const isSuperAdmin = user.isSuperAdmin === true ||
  (user.memberships &&
   user.memberships.some((m) => m.roles.includes('SUPER_ADMIN')));

if (!isSuperAdmin) {
  throw new ForbiddenException('SUPER_ADMIN role required');
}
```

---

## Key Points

| Component | Role | Can Be Cached | Requirement |
|-----------|------|---------------|-------------|
| **User** | Identity | No | Must exist in DB |
| **Membership** | Authorization scope | Yes (45s default) | Must have SUPER_ADMIN role |
| **JWT Flag** | Fast check | Yes (JWT validity) | Must match DB state OR isSuperAdmin in payload |
| **Guard** | Gate | No | Validates flag OR membership presence |

---

## Prevention

1. **Always run migrations before seeding:**
   ```bash
   npm run -w apps/api -- prisma migrate deploy
   npm run -w apps/api -- npm run seed
   ```

2. **Verify migrations are timestamped correctly:**
   - Files should be in `apps/api/prisma/migrations/`
   - Timestamp format: `YYYYMMDDHHMMSS_description`
   - Migrations execute in timestamp order
   - Dependencies must go AFTER their referenced tables

3. **Keep seed data idempotent (upsert patterns):**
   ```typescript
   const user = await prisma.user.upsert({
     where: { email: 'superadmin@demo.com' },
     update: { /* minimal updates */ },
     create: { /* full record */ },
   });
   ```

4. **Test SUPER_ADMIN access after deployments:**
   ```bash
   # Add to CI/CD pipeline
   npm run test:e2e -- --testNamePattern="SUPER_ADMIN"
   ```

---

## Emergency Recovery (Production)

If SUPER_ADMIN access is completely broken in production:

1. **Do NOT reset database** - Use migrations only
2. **Create new migration** to insert SUPER_ADMIN user:
   ```sql
   INSERT INTO "User" (id, email, name, "passwordHash", "createdAt", "updatedAt")
   VALUES ('prod-super-admin-id', 'superadmin@prod.com', 'Super Admin', '...', NOW(), NOW())
   ON CONFLICT DO NOTHING;
   ```
3. **Create membership** and role assignments
4. **Issue new JWT** manually via token generation service
5. **Test access** before notifying users

---

## Related Files

- `apps/api/src/auth/jwt.strategy.ts` - Token validation logic
- `apps/api/src/auth/super-admin.guard.ts` - Authorization guard
- `apps/api/src/auth/auth.service.ts` - Login and token generation
- `apps/api/prisma/seed.ts` - Seed data creation
- `apps/api/prisma/schema.prisma` - Database schema

---

## Questions?

- For JWT issues: Check `jwt.strategy.ts` and token claims
- For auth failures: Check `validateUser()` in `auth.service.ts`
- For migrations: Check `prisma migrate status`
- For seed data: Check `prisma/seed.ts` and verify SQL conditions
