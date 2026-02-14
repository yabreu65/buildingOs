# ✅ STAGING HARDENING CHECKLIST

**Pre-deployment verification**: Ejecuta cada sección antes de ir a staging.
**Status**: Use checkboxes `- [x]` para marcar completado.

---

## 1️⃣ SECURITY VALIDATION

### 1.1 No secrets en código
```bash
# Ejecutar:
rg "password|token|api_key|secret|DATABASE_URL" apps/api/src \
  --type rust --type typescript \
  -i | grep -v node_modules | grep -v "\.git"

# ✅ ESPERADO: 0 resultados
# ❌ SI FALLA: Remove hardcoded secrets, use .env
```

**Status**: ☐ Passing

### 1.2 JWT signature validation
```bash
# 1. Levanta API
npm run start --prefix apps/api &
sleep 5

# 2. Obtén JWT válido
VALID_TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"Admin123!"}' | jq -r '.accessToken')

# 3. Tamper el token (cambiar payload)
TAMPERED_TOKEN=$(echo $VALID_TOKEN | cut -d'.' -f1,2).invalid_signature

# 4. Intenta usar token falso
curl -i http://localhost:4000/tenants/cmlhe1zy60000143er2fl3irs/stats \
  -H "Authorization: Bearer $TAMPERED_TOKEN"

# ✅ ESPERADO: 401 Unauthorized
# ❌ SI FALLA: JWT signature verification no funciona
```

**Status**: ☐ Passing

### 1.3 Multi-tenant enforcement
```bash
# Usuarios de distintos tenants NO pueden verse datos

# 1. Obtén tokens para 2 tenants diferentes
TOKEN_A="<jwt_for_tenant_a>"
TOKEN_B="<jwt_for_tenant_b>"
TENANT_A_ID="<tenant_a_id>"
TENANT_B_ID="<tenant_b_id>"

# 2. User A intenta leer stats de Tenant B
curl -i http://localhost:4000/tenants/$TENANT_B_ID/stats \
  -H "Authorization: Bearer $TOKEN_A"

# ✅ ESPERADO: 403 Forbidden + "No tiene acceso al tenant"
# ❌ SI FALLA: Multi-tenant enforcement is broken

# 3. User A PUEDE leer su propio tenant
curl -i http://localhost:4000/tenants/$TENANT_A_ID/stats \
  -H "Authorization: Bearer $TOKEN_A"

# ✅ ESPERADO: 200 OK con datos
```

**Status**: ☐ Passing

### 1.4 Role-based access control
```bash
# Roles bajos NO pueden acceder a super-admin endpoints

# 1. Obtén JWT de RESIDENT
RESIDENT_TOKEN="<jwt_with_RESIDENT_role>"

# 2. Intenta crear tenant (super-admin only)
curl -i -X POST http://localhost:4000/api/super-admin/tenants \
  -H "Authorization: Bearer $RESIDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"AttackTenant","type":"ADMINISTRADORA"}'

# ✅ ESPERADO: 403 Forbidden
# ❌ SI FALLA: SuperAdminGuard bypassed

# 3. RESIDENT PUEDE leer su stats
curl -i http://localhost:4000/tenants/<their_tenant>/stats \
  -H "Authorization: Bearer $RESIDENT_TOKEN"

# ✅ ESPERADO: 200 OK
```

**Status**: ☐ Passing

### 1.5 Input validation
```bash
# Intenta payloads maliciosos (SQL injection, XSS)

# SQL Injection attempt
curl -i -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com\"; DROP TABLE users; --","password":"test"}'

# ✅ ESPERADO: 400 Bad Request (email validation fails)

# XSS attempt
curl -i -X POST http://localhost:4000/api/super-admin/tenants \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"<script>alert(1)</script>","type":"ADMINISTRADORA"}'

# ✅ ESPERADO: 400 Bad Request or sanitized
```

**Status**: ☐ Passing

### 1.6 Authentication required
```bash
# Sin token → 401 para todos endpoints

curl -i http://localhost:4000/tenants/any-id/stats
# ✅ ESPERADO: 401 Unauthorized

curl -i -X POST http://localhost:4000/api/super-admin/tenants \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","type":"ADMINISTRADORA"}'
# ✅ ESPERADO: 401 Unauthorized
```

**Status**: ☐ Passing

---

## 2️⃣ API ENDPOINT VALIDATION

### 2.1 All 31 endpoints respond
```bash
# Verifica que TODOS los endpoints devuelven respuesta válida (no 500)

npm run test:e2e --prefix apps/api 2>&1 | grep -E "PASS|FAIL"

# ✅ ESPERADO: All test suites PASS
# Salida esperada:
# PASS test/tenant-stats.e2e-spec.ts (21/21)
# PASS test/super-admin.e2e-spec.ts (26/26)
# Total: 47/47 passing
```

**Status**: ☐ Passing

### 2.2 Error handling (401, 403, 404, 409)
```bash
# Verificar que todos los códigos de error se devuelven correctamente

# 401: No token
curl -i http://localhost:4000/tenants/any/stats | grep "401"

# 403: Unauthorized tenant
curl -i http://localhost:4000/tenants/wrong-tenant/stats \
  -H "Authorization: Bearer $TOKEN" | grep "403"

# 404: Not found
curl -i http://localhost:4000/api/super-admin/tenants/invalid-id \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" | grep "404"

# 409: Conflict (duplicate)
curl -i -X POST http://localhost:4000/api/super-admin/tenants \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"name":"Admin Demo","type":"ADMINISTRADORA"}' | grep "409"

# ✅ ESPERADO: All codes present
```

**Status**: ☐ Passing

### 2.3 Data response validation
```bash
# Verifica estructura y tipos de respuestas

# Stats endpoint
STATS=$(curl -s http://localhost:4000/tenants/$TENANT_ID/stats \
  -H "Authorization: Bearer $TOKEN")

echo $STATS | jq '.totalBuildings | type'
# ✅ ESPERADO: "number"

echo $STATS | jq 'keys' | grep -E "occupiedUnits|vacantUnits|totalResidents"
# ✅ ESPERADO: All keys present

# Billing endpoint
BILLING=$(curl -s http://localhost:4000/tenants/$TENANT_ID/billing \
  -H "Authorization: Bearer $TOKEN")

echo $BILLING | jq '.subscription.status'
# ✅ ESPERADO: "ACTIVE" or "TRIAL" or "SUSPENDED"

echo $BILLING | jq '.plan | keys' | grep -E "maxBuildings|maxUnits|supportLevel"
# ✅ ESPERADO: All entitlements present
```

**Status**: ☐ Passing

---

## 3️⃣ DATABASE INTEGRITY

### 3.1 Foreign key constraints
```bash
# Verifica que constraints están habilitadas

psql $DATABASE_URL -c "
  SELECT table_name FROM information_schema.table_constraints
  WHERE constraint_type='FOREIGN KEY' AND table_schema='public'
  ORDER BY table_name;
"

# ✅ ESPERADO: At least 15+ foreign keys:
# - tenant → billingPlan
# - subscription → tenant, billingPlan
# - building → tenant
# - unit → building
# - unitOccupant → unit, user
# - membership → user, tenant
# - auditLog → tenant (optional), user (optional)
```

**Status**: ☐ Passing

### 3.2 Unique constraints
```bash
# Verifica unique constraints para evitar duplicados

psql $DATABASE_URL -c "
  SELECT constraint_name, table_name
  FROM information_schema.table_constraints
  WHERE constraint_type='UNIQUE' AND table_schema='public';
"

# ✅ ESPERADO:
# - tenant(name)
# - user(email)
# - building(name, tenantId)
# - unit(code, buildingId)
```

**Status**: ☐ Passing

### 3.3 Indexes for performance
```bash
# Verifica que índices existen para queries frecuentes

psql $DATABASE_URL -c "
  SELECT indexname, tablename FROM pg_indexes
  WHERE schemaname='public'
  ORDER BY tablename;
"

# ✅ ESPERADO: Índices en:
# - tenantId (building, unit, auditLog, subscription)
# - email (user)
# - createdAt (auditLog, tenant)
```

**Status**: ☐ Passing

### 3.4 Data consistency
```bash
# Verifica que no hay datos huérfanos

# Buildings sin tenant válido
psql $DATABASE_URL -c "
  SELECT count(*) FROM building
  WHERE tenantId NOT IN (SELECT id FROM tenant);
"
# ✅ ESPERADO: 0

# Audit logs sin tenant (si tenantId es required)
psql $DATABASE_URL -c "
  SELECT count(*) FROM auditLog
  WHERE tenantId IS NULL AND action != 'SYSTEM_ACTION';
"
# ✅ ESPERADO: 0 (o documentado)
```

**Status**: ☐ Passing

---

## 4️⃣ PERFORMANCE BASELINE

### 4.1 Response time
```bash
# Mide p95 response time para endpoints críticos

# Single request timing
time curl -s http://localhost:4000/tenants/$TENANT_ID/stats \
  -H "Authorization: Bearer $TOKEN" > /dev/null

# ✅ ESPERADO: real < 500ms

# Paged audit logs (worst case)
time curl -s "http://localhost:4000/tenants/$TENANT_ID/audit-logs?skip=0&take=100" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

# ✅ ESPERADO: real < 1000ms
```

**Status**: ☐ Passing

### 4.2 Concurrent load (10 users)
```bash
# Load test: 10 concurrent users, 30 sec

# Instala apache bench si no lo tienes
# brew install httpd (macOS) o apt-get install apache2-utils (Linux)

ab -n 100 -c 10 -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/tenants/$TENANT_ID/stats

# ✅ ESPERADO:
# Requests per second: > 20
# Failed requests: 0
# Longest: < 1000ms
```

**Status**: ☐ Passing

---

## 5️⃣ AUDIT & LOGGING

### 5.1 Audit logs created
```bash
# Verifica que acciones generan audit logs

# 1. Crear tenant
curl -X POST http://localhost:4000/api/super-admin/tenants \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"name":"AuditTest'$(date +%s)'","type":"ADMINISTRADORA"}'

# 2. Verificar que se creó log
psql $DATABASE_URL -c "
  SELECT action, entity, metadata FROM auditLog
  WHERE action='TENANT_CREATE'
  ORDER BY createdAt DESC LIMIT 1;
"

# ✅ ESPERADO:
# action | TENANT_CREATE
# entity | Tenant
# metadata | {"name":"AuditTest...","type":"ADMINISTRADORA"}
```

**Status**: ☐ Passing

### 5.2 Actor tracking
```bash
# Verifica que actor (user) se registra correctamente

psql $DATABASE_URL -c "
  SELECT
    al.id,
    al.action,
    u.email as actor_email,
    al.createdAt
  FROM auditLog al
  LEFT JOIN \"user\" u ON al.actorUserId = u.id
  WHERE al.action='TENANT_CREATE'
  LIMIT 1;
"

# ✅ ESPERADO: actor_email no es NULL
```

**Status**: ☐ Passing

### 5.3 Request logging
```bash
# Verifica que logs contienen request info

# Realiza una request
curl -X GET http://localhost:4000/tenants/$TENANT_ID/stats \
  -H "Authorization: Bearer $TOKEN"

# Revisa logs (si están en DB)
psql $DATABASE_URL -c "
  SELECT * FROM auditLog
  WHERE action LIKE 'HTTP_%' OR entity='Request'
  ORDER BY createdAt DESC LIMIT 5;
"

# Si está en archivo:
tail -50 apps/api/logs/app.log | grep GET | grep stats

# ✅ ESPERADO: Mínimo log con method, path, status, duration
```

**Status**: ☐ Passing

---

## 6️⃣ DEPLOYMENT READINESS

### 6.1 Fresh build
```bash
# Elimina dist/ y rebuild
rm -rf apps/api/dist apps/web/.next

npm run build --prefix apps/api
npm run build --prefix apps/web

# ✅ ESPERADO:
# - Zero TypeScript errors
# - All files compiled successfully
```

**Status**: ☐ Passing

### 6.2 Environment variables
```bash
# Verifica que .env contiene todas las variables necesarias

required_vars=(
  "DATABASE_URL"
  "JWT_SECRET"
  "JWT_EXPIRATION"
  "REDIS_URL"
  "NODE_ENV"
  "PORT"
  "ALLOWED_ORIGINS"
)

for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ Missing: $var"
  else
    echo "✅ Found: $var"
  fi
done

# ✅ ESPERADO: All variables set
```

**Status**: ☐ Passing

### 6.3 Docker build
```bash
# Si usas Docker, verifica que construye sin errores

docker-compose -f docker-compose.prod.yml build --no-cache

# ✅ ESPERADO: Build successful, image tagged
```

**Status**: ☐ Passing

### 6.4 Health checks
```bash
# Verifica que endpoints de health responden

curl -i http://localhost:4000/health
# ✅ ESPERADO: 200 OK

curl -i http://localhost:3000/api/health
# ✅ ESPERADO: 200 OK (frontend if applicable)
```

**Status**: ☐ Passing

---

## 7️⃣ FINAL SIGN-OFF

### Completitud
- [ ] Todos los checkboxes de seguridad (1.1-1.6)
- [ ] Todos los endpoints validados (2.1-2.3)
- [ ] Database integrity (3.1-3.4)
- [ ] Performance baseline (4.1-4.2)
- [ ] Audit & logging (5.1-5.3)
- [ ] Deployment ready (6.1-6.4)

### Firma de aprobación
```
Aprobado por CTO:     ________________  Fecha: ________
Aprobado por QA:      ________________  Fecha: ________
Aprobado por DevOps:  ________________  Fecha: ________
```

### Notas / Issues encontrados
```
[Agregar aquí cualquier issue o caveat]
```

---

## 📋 COMANDO DE VALIDACIÓN RÁPIDA

Ejecuta esto para correr todos los tests de una vez:

```bash
#!/bin/bash

echo "=== BUILDING ==="
npm run build --prefix apps/api && npm run build --prefix apps/web

echo "=== E2E TESTS ==="
npm run test:e2e --prefix apps/api

echo "=== SECURITY CHECKS ==="
rg "password|token|secret|DATABASE_URL" apps/api/src --type typescript

echo "=== DATABASE ==="
psql $DATABASE_URL -c "SELECT count(*) FROM public.tenant;"

echo "=== HEALTH CHECK ==="
curl http://localhost:4000/health

echo "✅ STAGING CHECKLIST COMPLETE"
```

---
