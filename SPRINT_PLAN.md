# SPRINT PLAN — BuildingOS Staging (Feb 14-28, 2026)

**Objetivo**: Completar OPCIÓN A (Super Admin) + hardening para staging
**Deadline**: 14 días (2 semanas)
**Commits esperados**: 25-30

---

## 📋 TASK LIST (15 tareas atómicas)

### TIER 1: CRITICAL (Bloquean staging) — 5 tareas

#### TASK-01 | SECURITY: Validar tenantId en responses
**Priority**: CRITICAL | **Owner**: Backend | **Est**: 4h | **Deps**: None
**Description**:
Auditar todos endpoints que retornan datos scoped a tenant:
- Verificar que `data.tenantId === paramTenantId` ANTES de retornar
- Endpoints: buildings, units, occupants, tenants (scoped), stats, billing, audit-logs
- Agregar explicit checks en service layer

**Acceptance Criteria**:
- ✅ All 31 endpoints validated
- ✅ No data leakage in responses (tenantId mismatch throws 403)
- ✅ 10+ test cases for tenantId validation
- ✅ Code review complete

**Files to modify**:
```
apps/api/src/buildings/buildings.service.ts
apps/api/src/units/units.service.ts
apps/api/src/occupants/occupants.service.ts
apps/api/src/tenancy/tenancy-stats.service.ts
apps/api/src/super-admin/super-admin.service.ts (partial)
```

**Testing**:
```bash
# Test: Tenant A can't see data of Tenant B
TOKEN_A="<jwt_for_tenant_a>"
TENANT_B_ID="<other_tenant>"
curl http://localhost:4000/tenants/$TENANT_B_ID/stats -H "Authorization: Bearer $TOKEN_A"
# Expected: 403 Forbidden
```

---

#### TASK-02 | SECURITY: Hardear SuperAdminGuard
**Priority**: CRITICAL | **Owner**: Backend | **Est**: 3h | **Deps**: None
**Description**:
Verificar que SuperAdminGuard valida `isSuperAdmin` flag ÚNICAMENTE del JWT (inmutable).
- Revisar: apps/api/src/auth/super-admin.guard.ts
- Verificar que JWT es validado por JwtAuthGuard (firma criptográfica)
- Tests para intentar inyectar `isSuperAdmin=true` en claims

**Acceptance Criteria**:
- ✅ SuperAdminGuard only reads from verified JWT payload
- ✅ No way to bypass (no query param injection, no header tricks)
- ✅ 5+ tests for bypass attempts
- ✅ Code review + security team sign-off

**Testing**:
```bash
# Test 1: Tamper JWT claims (must fail)
# Decode token, modify isSuperAdmin, re-encode
# Expected: 403 Forbidden (invalid signature)

# Test 2: Inject isSuperAdmin in URL/body
curl -X POST http://localhost:4000/api/super-admin/tenants \
  -H "Authorization: Bearer <RESIDENT_TOKEN>" \
  -d '{"isSuperAdmin":true,"name":"Test",...}'
# Expected: 403 Forbidden
```

---

#### TASK-03 | SECURITY: Validar actor en audit logs
**Priority**: CRITICAL | **Owner**: Backend | **Est**: 2h | **Deps**: None
**Description**:
Audit logs devuelven `actorName` sin validar si el user aún existe.
- Usar `COALESCE(actor.name, 'System')` en queries Prisma
- Archivos: tenancy-stats.service.ts (línea 262), super-admin.service.ts (línea 327)
- Tests para user deletion scenarios

**Acceptance Criteria**:
- ✅ No null actor names en responses
- ✅ Deleted users shown as 'System' or '[Deleted]'
- ✅ Tests for user deletion + audit log query
- ✅ DB migration para audit data cleanup (si necesario)

**Code change**:
```typescript
// Antes:
const logs = await this.prisma.auditLog.findMany({
  include: { actor: { select: { name: true } } },
  ...
});

// Después:
const logs = await this.prisma.auditLog.findMany({
  include: {
    actor: {
      select: {
        name: true
      }
    }
  },
  ...
});
// En mapping: actorName: (log.actor?.name ?? '[Deleted]')
```

---

#### TASK-04 | API: Super Admin User Management endpoints
**Priority**: CRITICAL | **Owner**: Backend | **Est**: 8h | **Deps**: TASK-01, TASK-02
**Description**:
Implementar endpoints para gestión de usuarios (OPCIÓN A).

**Endpoints**:
```
POST   /api/super-admin/users                [Create user + assign roles]
GET    /api/super-admin/users?page=1&size=20 [List users, paginated]
GET    /api/super-admin/users/:userId         [Get user details]
PATCH  /api/super-admin/users/:userId         [Update roles/tenant]
DELETE /api/super-admin/users/:userId         [Soft delete]
```

**DTO structures**:
```typescript
// CreateUserDto
{ email: string, password: string, name: string, roles: Role[], tenantId?: string }

// UpdateUserDto
{ name?: string, roles?: Role[], tenantId?: string }

// UserResponseDto
{ id, email, name, createdAt, memberships: [{tenantId, roles}] }
```

**Acceptance Criteria**:
- ✅ All 5 endpoints implemented + tested
- ✅ Password hashed with bcrypt
- ✅ 401/403/409 error cases covered
- ✅ Audit logs for user create/update/delete
- ✅ 10+ e2e tests

**Testing**:
```bash
# Create user
curl -X POST http://localhost:4000/api/super-admin/users \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"email":"user@test.com","password":"Pass123!","roles":["TENANT_ADMIN"]}'
# Expected: 201 Created

# Duplicate email
# Expected: 409 Conflict

# List users
curl http://localhost:4000/api/super-admin/users \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN"
# Expected: 200 with paginated array
```

---

#### TASK-05 | API: Super Admin Billing endpoints
**Priority**: CRITICAL | **Owner**: Backend | **Est**: 10h | **Deps**: TASK-01, TASK-04
**Description**:
Implementar endpoints para billing management (lectura + upgrade).

**Endpoints**:
```
GET    /api/super-admin/billing                        [Global revenue metrics]
GET    /api/super-admin/tenants/:tenantId/subscription [Current subscription]
PATCH  /api/super-admin/tenants/:tenantId/subscription [Upgrade/downgrade plan]
GET    /api/super-admin/tenants/:tenantId/invoices     [Payment history]
```

**Response structures**:
```typescript
// GET /api/super-admin/billing
{
  totalRevenue: number,      // MRR
  annualRevenue: number,     // ARR (estimated)
  activeSubscriptions: number,
  trialSubscriptions: number,
  churnRate: number,         // % of churned tenants last 30 days
  tenantsByPlan: { FREE: n, BASIC: n, PRO: n, ENTERPRISE: n }
}

// PATCH subscription
{
  tenantId: string,
  planId: string,
  startDate: ISO8601,
  endDate: ISO8601 | null
}
```

**Acceptance Criteria**:
- ✅ All 4 endpoints working
- ✅ Billing calculations correct (MRR, ARR, churn)
- ✅ Plan upgrade/downgrade workflow tested
- ✅ Downgrade constraints (usage > new plan limits)
- ✅ Audit logs for subscription changes
- ✅ 15+ e2e tests

---

### TIER 2: HIGH (Necesarios para MVP) — 2 tareas

#### TASK-06 | Frontend: Super Admin User Management page
**Priority**: HIGH | **Owner**: Frontend | **Est**: 6h | **Deps**: TASK-04
**Description**:
Crear página `/super-admin/users` con CRUD UI.

**Components**:
- User list table (email, name, role, tenant, created_at)
- Create user button → 3-step wizard (email/password, roles, tenant)
- Row actions: Edit roles modal, Delete with confirmation
- Search/filter by email, role, tenant
- Pagination (20 per page)

**Features**:
- ✅ Add new user (form validation + API call)
- ✅ Update roles (multi-select dropdown)
- ✅ Delete user (soft delete confirmation)
- ✅ Error handling (409 duplicate, 403 unauthorized)
- ✅ Toast notifications (success/error)

**Testing**:
- ✅ Create user flow (form validation → API → list update)
- ✅ Edit roles (modal open → select → save → list update)
- ✅ Delete confirmation (modal → API call → removal from list)
- ✅ Pagination (navigate pages, verify data)

---

#### TASK-07 | Frontend: Super Admin Billing page
**Priority**: HIGH | **Owner**: Frontend | **Est**: 5h | **Deps**: TASK-05
**Description**:
Crear página `/super-admin/billing` con visualización de ingresos y suscripciones.

**Components**:
- KPI cards: MRR, ARR, Active subs, Trial subs, Churn rate
- Chart: Subscriptions by plan (pie chart)
- Table: Tenants with subscription status
  - Columns: Name, Plan, Status, Current period end, Usage %
  - Actions: Upgrade plan (modal), View invoices
- Upgrade modal: Select new plan, confirm
- Invoice history modal (paginated)

**Features**:
- ✅ Display KPIs (fetch from /api/super-admin/billing)
- ✅ Real-time subscription data
- ✅ Plan upgrade workflow
- ✅ Invoice list view (pagination)
- ✅ Error states + loading skeletons

---

### TIER 3: INFRASTRUCTURE (Bloquean production) — 5 tareas

#### TASK-08 | API: Rate limiting + request logging
**Priority**: HIGH | **Owner**: Backend | **Est**: 4h | **Deps**: None
**Description**:
Agregar `@nestjs/throttle` para rate limiting y structured logging.

**Config**:
- General endpoints: 100 req/min
- Auth endpoints: 10 req/min
- Super-admin endpoints: 50 req/min
- All requests logged to AuditLog table

**Implementation**:
```typescript
// app.module.ts
imports: [
  ThrottlerModule.forRoot([
    {
      ttl: 60000,
      limit: 100, // default
    },
    {
      ttl: 60000,
      limit: 10,
      skipIf: (req) => req.path.includes('auth'),
    },
  ]),
],
```

**Acceptance Criteria**:
- ✅ Rate limiting working (429 responses)
- ✅ All API requests logged (method, path, status, duration)
- ✅ No PII in logs
- ✅ Tests for throttle behavior

---

#### TASK-09 | API: Input validation hardening
**Priority**: HIGH | **Owner**: Backend | **Est**: 3h | **Deps**: None
**Description**:
Audit and harden all DTOs (input validation).

**Checklist**:
- ✅ CreateTenantDto: name length (3-100), type enum
- ✅ CreateUserDto: email format, password strength (min 8 chars, 1 uppercase, 1 number)
- ✅ UpdateTenantDto: same as create (partial)
- ✅ CreateBuildingDto: name length, address validation
- ✅ All DTOs: whitelist properties, forbid unknown

**Testing**:
- ✅ SQL injection payloads (should reject)
- ✅ XSS payloads in text fields (should sanitize)
- ✅ Invalid emails (should 400)
- ✅ Weak passwords (should 400)

---

#### TASK-10 | API: CORS + security headers
**Priority**: HIGH | **Owner**: Backend | **Est**: 2h | **Deps**: None
**Description**:
Add Helmet middleware + CORS hardening.

**Changes**:
```typescript
// main.ts
app.use(helmet());

// app.module.ts
app.enableCors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
```

**Acceptance Criteria**:
- ✅ No CORS `*` in production
- ✅ Helmet headers present (X-Frame-Options, X-Content-Type-Options, etc.)
- ✅ Tests for origin rejection (403 for wrong origin)
- ✅ ENV vars documented

---

#### TASK-11 | API: Comprehensive logging
**Priority**: MEDIUM | **Owner**: Backend | **Est**: 3h | **Deps**: None
**Description**:
Add structured logging with Winston + NestJS Logger.

**Events to log**:
- All API requests (method, path, status, duration, userId, tenantId)
- Auth attempts (success/failure)
- Role changes (user_id, old_roles, new_roles)
- Data mutations (create/update/delete with metadata)
- Errors (stack traces)

**Config**:
- Console output (dev)
- File + DB (prod)
- 90-day retention in DB, 7-day in CloudWatch

---

### TIER 4: QUALITY (Mejoran confianza) — 3 tareas

#### TASK-12 | Tests: Multi-tenant isolation matrix
**Priority**: MEDIUM | **Owner**: QA/Backend | **Est**: 4h | **Deps**: All endpoints
**Description**:
Comprehensive test suite validating multi-tenant enforcement.

**Matrix**:
```
For EACH endpoint (31 total):
  - Without token: 401
  - With wrong tenant: 403
  - With correct tenant: 200

Roles validation:
  - RESIDENT can't access super-admin endpoints: 403
  - OPERATOR can't modify buildings: 403
  - TENANT_ADMIN can't see other tenants: 403
```

**Outcome**: Spreadsheet with 31×3 = 93 test cases, all passing

---

#### TASK-13 | Documentation: API security guide
**Priority**: MEDIUM | **Owner**: Tech Writer | **Est**: 2h | **Deps**: All
**Description**:
Create `/docs/SECURITY.md` with:
- Multi-tenant enforcement flow diagram
- JWT validation process
- Guard chain explanation
- Common attacks & mitigations
- Rate limiting policy

---

#### TASK-14 | Database: Backup + restore procedures
**Priority**: MEDIUM | **Owner**: DevOps | **Est**: 2h | **Deps**: None
**Description**:
Document and test full backup/restore.

**Procedures**:
```bash
# Backup
pg_dump $DATABASE_URL > backup.sql

# Restore
psql $DATABASE_URL < backup.sql

# Automated: Cron job for daily backups
0 2 * * * pg_dump $DATABASE_URL > /backups/buildingos-$(date +\%Y\%m\%d).sql
```

---

#### TASK-15 | Deployment: Staging environment setup
**Priority**: MEDIUM | **Owner**: DevOps | **Est**: 3h | **Deps**: None
**Description**:
Setup staging environment with:
- Docker Compose for staging (separate from dev)
- Environment variables (.env.staging)
- Health check endpoints
- Rollback procedure documentation

---

## 🎯 DEPENDENCY GRAPH

```
TASK-01 (tenantId validation)
  ├─ TASK-04 (user mgmt endpoints)
  ├─ TASK-05 (billing endpoints)
  └─ TASK-12 (isolation matrix)

TASK-02 (SuperAdminGuard hardening)
  └─ TASK-04, TASK-05

TASK-03 (audit logs cleanup)
  └─ Independent

TASK-04 (user mgmt endpoints)
  ├─ TASK-06 (user mgmt UI)
  └─ TASK-12

TASK-05 (billing endpoints)
  ├─ TASK-07 (billing UI)
  └─ TASK-12

TASK-08-15 (infrastructure)
  └─ All can run in parallel
```

## 📅 TIMELINE (Ideal)

```
Week 1 (Mon-Fri):
  Day 1-2: TASK-01, TASK-02, TASK-03 (security foundations)
  Day 2-3: TASK-04 (user mgmt endpoints)
  Day 4-5: TASK-05 (billing endpoints)
  Day 5: TASK-08, TASK-09, TASK-10 (infrastructure)

Week 2 (Mon-Fri):
  Day 1-2: TASK-06 (user mgmt UI)
  Day 2-3: TASK-07 (billing UI)
  Day 3-4: TASK-11, TASK-12, TASK-13 (logging + tests + docs)
  Day 4-5: TASK-14, TASK-15 (ops + staging setup)
  Day 5: Final hardening checklist + code review

Fri EOD: Ready for staging deployment
```

## ✅ DONE CRITERIA

```
- 15 tasks completed and merged to main
- All hardening checklist items passing
- 21/21 tenancy tests passing
- 47/47 super-admin tests passing
- 93/93 isolation matrix tests passing
- Zero TypeScript errors
- Code review approved by CTO
- Security audit complete
- Staging environment ready
```

---
