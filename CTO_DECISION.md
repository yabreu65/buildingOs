# CTO DECISION — BuildingOS STAGING READINESS
**Fecha**: Feb 14, 2026 | **Completeness**: 35-37% | **Status**: CONDITIONAL GO (con hardening)

---

## 1️⃣ DECISIÓN: ¿STAGING O NO?

### Veredicto: ✅ **GO TO STAGING** (con restricciones críticas)

**Razones para GO:**
- ✅ Auth (JWT + session restore) funciona sin mocks
- ✅ Multi-tenant enforcement es **tight** (TenantAccessGuard en todos endpoints)
- ✅ Endpoints tenancy (stats/billing/audit-logs) pasan 21/21 tests
- ✅ Super-admin control plane está parcialmente funcional (CRUD tenants + audit)
- ✅ Builds sin errores TypeScript
- ✅ Prisma migrations completas

**Restricciones críticas:**
- ❌ **NO usar con usuarios reales hasta pasar hardening checklist**
- ❌ **NO exponer públicamente sin WAF + rate limiting**
- ❌ **NO aceptar pagos (billing es read-only, sin Stripe/PayPal)**
- ❌ **NO onboard production tenants hasta validar auditoría global**

**Ventana de staging**: 2-3 semanas para hardening + QA interno

---

## 2️⃣ RIESGOS CRÍTICOS IDENTIFICADOS

### 🔴 RIESGO 1: Falta validación de tenantId en responses
**Gravedad**: HIGH
**Descripción**: Los endpoints devuelven datos per-tenant, pero no hay garantía de que los datos pertenezcan al tenant en el JWT.
**Ejemplo de ataque**: Un usuario podría modificar `tenantId` en URL params (aunque TenantAccessGuard lo bloquea), pero no hay validación de que los datos *retornados* sean realmente del tenant solicitado.
**Mitigación**:
```typescript
// Antes de retornar cualquier dato:
if (data.tenantId !== tenantId) {
  throw new ForbiddenException('Data mismatch');
}
```

### 🔴 RIESGO 2: SuperAdminGuard puede ser bypasseable
**Gravedad**: CRITICAL
**Descripción**: Necesito revisar que SuperAdminGuard extrae el flag `isSuperAdmin` únicamente del JWT, no de claims inyectables.
**Mitigación**: Verificar que JWT payload es firmado y no puede ser modificado en cliente.

### 🔴 RIESGO 3: Audit logs sin actor name validation
**Gravedad**: MEDIUM
**Descripción**: En `tenancy-stats.service.ts` línea 277, se usa `log.actor?.name` sin verificar si el user aún existe (soft delete podría causar nulls).
**Mitigación**: Usar `COALESCE(actor.name, 'Deleted User')` en query Prisma.

### 🔴 RIESGO 4: Falta validación de X-Tenant-Id header
**Gravedad**: MEDIUM
**Descripción**: El frontend puede enviar `X-Tenant-Id` en requests, pero los endpoints de tenancy no lo usan (están en URL params). Si algún endpoint futuro usa header, podría causar confusión.
**Mitigación**: Documentar que `tenantId` SIEMPRE viene de URL params o JWT, nunca de headers.

### 🟡 RIESGO 5: Billing endpoint devuelve plan con precio (monthlyPrice)
**Gravedad**: LOW
**Descripción**: El precio se expone al frontend. No es crítico, pero expone data sensible.
**Mitigación**: Opcional (para MVP está OK).

---

## 3️⃣ PRÓXIMO SPRINT (2 SEMANAS)

### Objetivo
Completar OPCIÓN A (Super Admin Control Plane) + hardening security para staging.

### Tareas (Prioridad: Critical → High → Medium)

#### 🔴 CRITICAL (Bloquean staging)
1. **SECURITY: Validar tenantId en responses** (4h)
   - Audit todos los endpoints que retornan datos
   - Validar `data.tenantId === requestTenantId` antes de retornar
   - Tests para validar escenario de data mismatch

2. **SECURITY: Hardear SuperAdminGuard** (3h)
   - Revisar que `isSuperAdmin` flag viene SOLO del JWT (inmutable)
   - Implementar validación de firma JWT
   - Tests para intentar inyectar `isSuperAdmin=true`

3. **SECURITY: Validar actor en audit logs** (2h)
   - Usar `COALESCE` en queries Prisma para actor names
   - Tests para user deletions en audit logs

4. **Super Admin: User Management endpoints** (8h)
   - POST /api/super-admin/users (create user, assign roles)
   - GET /api/super-admin/users (list all users, paginated)
   - PATCH /api/super-admin/users/:userId (update roles)
   - DELETE /api/super-admin/users/:userId (soft delete)
   - Tests: 401/403/409 cases

5. **Super Admin: Billing endpoints** (10h)
   - GET /api/super-admin/billing (global revenue, subscription status)
   - PATCH /api/super-admin/tenants/:tenantId/subscription (upgrade plan)
   - GET /api/super-admin/tenants/:tenantId/invoices (payment history)
   - Tests: upgrade workflow, downgrade constraints

#### 🟠 HIGH (Necesarios para MVP)
6. **Frontend: Super Admin User Management page** (6h)
   - List users in table (email, role, tenant, created_at)
   - Create user wizard (email, password, role, assign tenant)
   - Role updater modal
   - Tests: localStorage mutations + API calls

7. **Frontend: Super Admin Billing page** (5h)
   - Revenue dashboard (MRR, ARR, churn)
   - Tenant subscription cards (plan, expiry, usage)
   - Plan upgrade flow
   - Tests: billing data display

8. **API: Rate limiting + request logging** (4h)
   - Add `@nestjs/throttle` package
   - Configure: 100 req/min general, 10 req/min for login
   - Log all requests to audit table
   - Tests: verify throttle responses (429)

9. **API: Input validation hardening** (3h)
   - Audit all DTOs (CreateTenantDto, UpdateTenantDto, etc.)
   - Add regex patterns, length limits, sanitization
   - Test with SQL injection, XSS payloads
   - Add `helmet` middleware

10. **API: CORS + CSRF protections** (2h)
    - Verify CORS is limited to known origins (no `*`)
    - Add CSRF token validation if needed
    - Tests: verify origin rejection

#### 🟡 MEDIUM (Mejoran confianza pero no bloquean)
11. **API: Comprehensive logging** (3h)
    - Add structured logging (Winston)
    - Log: all API requests, auth attempts, role changes, data mutations
    - Retention policy: 90 days in DB, 7 days in CloudWatch
    - No PII in logs

12. **Documentation: API security guide** (2h)
    - Multi-tenant enforcement (how tenantId flows)
    - Auth flow diagram (login → JWT → claims validation)
    - Guard chaining explanation
    - Examples of what to avoid

13. **Tests: Multi-tenant isolation matrix** (4h)
    - Test all 31 endpoints for 403 when accessing other tenant
    - Test all endpoints for 401 without token
    - Test role-based access (RESIDENT can't call super-admin)
    - Generate coverage report

14. **Database: Backup + restore procedures** (2h)
    - Document full backup strategy (pg_dump)
    - Test restore on staging
    - Automated daily backups

15. **Deployment: Staging environment setup** (3h)
    - Document Dockerfile improvements
    - Environment variable checklist
    - Health check endpoints
    - Rollback procedure

---

## 4️⃣ CHECKLIST DE HARDENING (Pre-STAGING)

### Security Validation
```bash
# 1. Verificar no hay secrets en código
rg "password|token|api_key|secret" apps/api/src --type-list | grep -v node_modules
# Debe retornar: NADA

# 2. Verificar JWT verification
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"wrong"}'
# Debe retornar: 401 Unauthorized (no devuelve JWT)

# 3. Verificar tenantId enforcement
TOKEN="<valid_jwt_for_tenant_A>"
TENANT_B_ID="<other_tenant_id>"
curl http://localhost:4000/tenants/$TENANT_B_ID/stats \
  -H "Authorization: Bearer $TOKEN"
# Debe retornar: 403 Forbidden

# 4. Verificar role-based access
RESIDENT_TOKEN="<jwt_with_RESIDENT_role>"
curl -X POST http://localhost:4000/api/super-admin/tenants \
  -H "Authorization: Bearer $RESIDENT_TOKEN" \
  -d '{"name":"Test",...}'
# Debe retornar: 403 Forbidden (SuperAdminGuard blocks)

# 5. Verificar SQL injection protection (Prisma safe)
curl http://localhost:4000/tenants/'; DROP TABLE users; --/stats \
  -H "Authorization: Bearer $TOKEN"
# Debe retornar: 400 Bad Request (invalid UUID format)

# 6. Verificar audit logging
curl http://localhost:4000/api/super-admin/tenants -X POST \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"name":"AuditTest",...}'
# Verificar en DB: INSERT into auditLog with action=TENANT_CREATE
```

### Performance Baseline
```bash
# Load test: 100 concurrent users, 30 sec duration
npm run test:load --prefix apps/api
# Debe mantener: <500ms p95 response time, <1% error rate
```

### Database Validation
```bash
# Verificar constraints
psql $DATABASE_URL -c "\d+ tenant" | grep "CHECK\|UNIQUE\|FOREIGN"
# Debe tener: unique(name), fk to billingPlan, fk to subscription

# Verificar indexes
psql $DATABASE_URL -c "SELECT * FROM pg_indexes WHERE tablename='tenant';"
# Debe tener: idx on tenantId, name, createdAt
```

### Deployment Readiness
```bash
# 1. Build en limpio
rm -rf apps/api/dist && npm run build --prefix apps/api
# Resultado: dist/ con 0 TypeScript errors

# 2. Run e2e tests en prod config
NODE_ENV=production npm run test:e2e --prefix apps/api
# Resultado: 21/21 passing (tenant-stats), 47/47 (total)

# 3. Health checks
curl http://localhost:4000/health
# Resultado: { status: 'ok' }
```

---

## 5️⃣ FEATURES A CONGELAR (NO CONSTRUIR AÚN)

### ❌ Do NOT build yet
1. **Multi-role UI selector** → Esperar a Phase 2 (role dashboards)
2. **Building/Unit settings** → Esperar a Phase 1 full build
3. **Amenities/Reservations** → Phase 7
4. **Advanced reporting** → Phase 7
5. **AI Assistant** → Phase 6
6. **Document management** → Phase 5
7. **Provider management** → Phase 5
8. **Webhooks/Integrations** → Phase 8
9. **Real payment processing** → Phase A (billing only read-only now)
10. **SMS/Email notifications** → Phase 3 (communications)

### ✅ FOCUS: Complete & freeze these ONLY
1. Super-admin control plane (user mgmt + billing read)
2. Role dashboards (stats/billing/audit per role)
3. Auth hardening (JWT + session)
4. Multi-tenant enforcement (guards + validation)

---

## 6️⃣ RUTA DE EJECUCIÓN: MAIN BRANCH → STAGING

```
MAIN (current)
  ↓
  [Sprint: 2 weeks]
  ├─ Critical hardening (5 tasks)
  ├─ Super-admin completion (5 tasks)
  ├─ Frontend build (2 tasks)
  └─ Testing + hardening checklist (3 tasks)
  ↓
STAGING-v0.1 (commit)
  ↓
  [QA Phase: 1 week]
  ├─ Manual testing (role dashboards)
  ├─ Security scan (OWASP)
  ├─ Load testing (100 concurrent users)
  └─ Backup/restore validation
  ↓
PRODUCTION-v0.1 (release)
  ├─ Internal users only (no external tenants)
  ├─ 24/7 monitoring + alerts
  ├─ Auto-rollback on errors
  └─ Weekly security audits
  ↓
Phase 2 (Tenant dashboards, tickets, communications)
```

---

## 7️⃣ DECISIÓN FINAL

| Pregunta | Respuesta | Acción |
|----------|-----------|--------|
| **¿Staging?** | ✅ SÍ (con restricciones) | GO con hardening checklist |
| **¿Cuándo?** | 2 semanas | Sprint inicia mañana |
| **¿QA?** | Interna solo | Internal users + load test |
| **¿Pagos?** | NO aún | Billing es read-only |
| **¿Tenants?** | Demo solo | No producción external |
| **¿Monitoreo?** | CRÍTICO | DataDog + alerts 24/7 |

**Owner**: CTO
**Comunicar a**: Product, QA, DevOps
**Next checkpoint**: Viernes (hardening checklist 50%)

---
