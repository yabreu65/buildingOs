# PILOT READY - Checklist de Lanzamiento

**Objetivo**: Verificación de 6 criterios mínimos para salir a producción con 1 cliente.

**Versión**: 1.0
**Fecha**: Feb 23, 2026
**Máximo tiempo de verificación**: 30 minutos por cliente

---

## 1. Build Monorepo + CI/CD ✅

### Criterio
Build sin errores TypeScript + CI workflow activo

### Verificación (5 min)

```bash
# 1.1 Build del monorepo
npm run build

# Esperado: 0 TypeScript errors en API y Web
# ✅ Si ves:
# - apps/api compiled successfully
# - apps/web compiled successfully
# - @buildingos/contracts build (ts-only)
# - @buildingos/permissions build (ts-only)
```

**Checklist**:
- [ ] `npm run build` finaliza sin errores
- [ ] API: 40+ routes compiled
- [ ] Web: 39+ routes compiled
- [ ] Zero TypeScript errors

### CI Workflow

```bash
# 1.2 Verificar que CI.yml está configurado
cat .github/workflows/ci.yml | head -30

# Esperado: GitHub Actions con steps:
# - Checkout
# - Install dependencies
# - Run build
# - Run tests
# - Run E2E tests (on postgres)
```

**Checklist**:
- [ ] `.github/workflows/ci.yml` existe
- [ ] Triggers: on push to main
- [ ] PostgreSQL service container configurado
- [ ] Tests ejecutados antes de merge

---

## 2. Seed Demo Tenants ✅

### Criterio
Datos de demostración listos para usar sin tocar base de datos

### Verificación (3 min)

```bash
# 2.1 Ejecutar seed
cd apps/api
npx prisma db seed

# Esperado: 2+ demo tenants creados
# ✅ Si ves:
# Created tenant: ADMINISTRADORA (id: xxx)
# Created tenant: EDIFICIO_AUTOGESTION (id: xxx)
# Seeding completed successfully
```

**Demo Tenants Created**:

| Tenant | Type | Buildings | Units | Users | Purpose |
|--------|------|-----------|-------|-------|---------|
| ADMINISTRADORA | ADMINISTRADORA | 1 | 5 | 3 | Full-featured company building |
| EDIFICIO_AUTOGESTION | EDIFICIO_AUTOGESTION | 1 | 3 | 2 | Self-managed residential building |

### Credenciales Seed

**Tenant 1: ADMINISTRADORA**
```
Email: admin@administradora.com
Password: TestPassword123!
Role: TENANT_OWNER
Building: "Torre Central" (5 units)
```

**Tenant 2: EDIFICIO_AUTOGESTION**
```
Email: admin@edificio.com
Password: TestPassword123!
Role: TENANT_OWNER
Building: "Residencial Flores" (3 units)
```

**Super Admin (para testing)**
```
Email: superadmin@buildingos.com
Password: SuperAdminPass123!
Role: SUPER_ADMIN
Access: All tenants via /super-admin
```

**Checklist**:
- [ ] Seed data populates successfully
- [ ] 2 demo tenants visible in database
- [ ] All users can login with demo credentials
- [ ] Buildings and units pre-populated
- [ ] Seed is idempotent (can run multiple times)

### Verificación de Datos

```bash
# 2.2 Conectar a DB y verificar datos
npx prisma studio

# Esperado: Vista de:
# - 2 tenants
# - 2 buildings
# - 8 units total
# - 8 users
# - Relationships completas (occupants, etc.)
```

---

## 3. Onboarding Completo (Sin Tocar DB) ✅

### Criterio
Cliente nuevo puede crear:
1. Tenant (organización)
2. Edificio (primera propiedad)
3. Unidades (departamentos)
4. Usuario residente (ocupante)

### Flujo de Onboarding (15 min max)

#### Paso 1: Registro de Cliente

```bash
# 3.1 POST /auth/signup
curl -X POST http://localhost:4000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newclient@example.com",
    "name": "Juan Cliente",
    "password": "SecurePassword123!",
    "tenantName": "Mi Condominio",
    "tenantType": "EDIFICIO_AUTOGESTION"
  }'

# Esperado: 201 Created
# {
#   "accessToken": "eyJhbGciOiJIUzI1NiIs...",
#   "user": {
#     "id": "user-uuid",
#     "email": "newclient@example.com",
#     "name": "Juan Cliente"
#   },
#   "memberships": [{
#     "tenantId": "tenant-uuid",
#     "roles": ["TENANT_OWNER"]
#   }]
# }
```

**Verificación**:
- [ ] Status 201 (Created)
- [ ] accessToken presente y válido
- [ ] Tenant creado con ID único
- [ ] User asignado como TENANT_OWNER
- [ ] Token válido para requests posteriores

#### Paso 2: Crear Edificio

```bash
# 3.2 POST /buildings (con token del paso 1)
TOKEN="eyJhbGciOiJIUzI1NiIs..."
TENANT_ID="tenant-uuid-from-step-1"

curl -X POST http://localhost:4000/buildings \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Edificio Principal",
    "address": "Av. Principal 123"
  }'

# Esperado: 201 Created
# {
#   "id": "building-uuid",
#   "tenantId": "tenant-uuid",
#   "name": "Edificio Principal",
#   "address": "Av. Principal 123",
#   "createdAt": "2026-02-23T..."
# }
```

**Verificación**:
- [ ] Status 201
- [ ] Building asignado a tenant correcto (tenantId matches)
- [ ] Nombre y dirección guardados
- [ ] buildingId retornado para paso siguiente

#### Paso 3: Crear Unidades

```bash
# 3.3 POST /buildings/:buildingId/units (con token)
BUILDING_ID="building-uuid-from-step-2"

curl -X POST http://localhost:4000/buildings/$BUILDING_ID/units \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Depto 101",
    "code": "101",
    "unitType": "APARTMENT",
    "occupancyStatus": "UNKNOWN"
  }'

# Repetir 3 veces para crear 3 unidades (101, 102, 103)
```

**Verificación**:
- [ ] Status 201 para cada unit
- [ ] Código único por edificio (101 no duplicado)
- [ ] UnitType y occupancyStatus guardados
- [ ] buildingId correcto en cada unit

#### Paso 4: Asignar Residente

```bash
# 3.4 POST /units/:unitId/occupants (con token)
UNIT_ID="unit-uuid-from-step-3"

curl -X POST http://localhost:4000/units/$UNIT_ID/occupants \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "resident-uuid",  # Si user existe
    "role": "RESIDENT"
  }'

# O invitar nuevo residente:
# POST /tenants/:tenantId/invitations
curl -X POST http://localhost:4000/tenants/$TENANT_ID/invitations \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "residente@example.com",
    "roles": ["RESIDENT"],
    "unitId": "'$UNIT_ID'"
  }'

# Esperado: 201 Created
# Residente recibe email con link de invitación
```

**Verificación**:
- [ ] Status 201
- [ ] Occupant/Invitation creado
- [ ] Email enviado (si nuevo residente)
- [ ] Link válido por 7 días

### E2E Onboarding Test

**Comando para ejecutar flujo completo**:

```bash
# Ejecutar test de onboarding end-to-end
cd apps/api
npm run test:e2e -- --testNamePattern="onboarding|signup"

# O específicamente:
npm run test:e2e -- tenant-isolation.e2e-spec.ts

# Esperado: ✅ All tests pass
```

**Checklist Onboarding**:
- [ ] Cliente puede registrarse (signup)
- [ ] Cliente puede crear edificio
- [ ] Cliente puede crear 3+ unidades
- [ ] Cliente puede invitar residente (o asignar)
- [ ] Residente recibe invitación válida
- [ ] Todo sin acceso a base de datos

---

## 4. Multi-Tenancy: Anti-Fuga E2E ✅

### Criterio
Verificación que Tenant A NO puede ver datos de Tenant B

### E2E Tests Existentes

```bash
# 4.1 Ejecutar tests de tenant isolation
cd apps/api
npm run test:e2e -- tenant-isolation.e2e-spec.ts

# Esperado: 9+ test cases pass
# ✅ Si ves:
# ✓ User from TenantA cannot access TenantB buildings (404)
# ✓ User from TenantA cannot list TenantB units (404)
# ✓ Cross-tenant charge access returns 404
# ... (all pass)
```

### Escenarios Verificados

| Escenario | Test | Resultado |
|-----------|------|-----------|
| TenantA accede building de TenantB | GET /buildings/:id | 404 Not Found |
| TenantA lista units de TenantB | GET /buildings/:id/units | 404 Not Found |
| TenantA crea charge en unit de TenantB | POST /charges | 403 Forbidden |
| RESIDENT accede unit no asignada | GET /units/:id | 404 Access Denied |
| RESIDENT intenta list units de otro tenant | GET /buildings/:id/units | 0 results |
| Cambiar X-Tenant-Id no otorga acceso | API call con header falso | 401 Unauthorized |

### Verificación Manual

```bash
# 4.2 Prueba manual: Cross-tenant access attempt
TOKEN_TENANT_A="..."
TOKEN_TENANT_B="..."
BUILDING_ID_B="..."

# Desde TenantA con token válido pero X-Tenant-Id falso
curl -H "Authorization: Bearer $TOKEN_TENANT_A" \
     -H "X-Tenant-Id: $BUILDING_ID_B" \
     http://localhost:4000/buildings/$BUILDING_ID_B

# Esperado: 404 Not Found (no diferencia entre "not found" e "unauthorized")
```

**Checklist Multi-Tenancy**:
- [ ] E2E tests tenant-isolation pasan (9/9)
- [ ] Cross-tenant requests retornan 404
- [ ] No diferencia entre "not found" y "forbidden" (info leak prevention)
- [ ] X-Tenant-Id header validado en cada request
- [ ] Database queries filtran siempre por tenantId

---

## 5. Observability Mínima ✅

### Criterio
Health checks + Request tracing + Logs estructurados

### 5.1 Health Checks

```bash
# 5.1a Liveness probe (¿está vivo?)
curl http://localhost:4000/health

# Esperado: 200 OK
# {
#   "status": "ok",
#   "timestamp": "2026-02-23T...",
#   "uptime": 123.45
# }

# 5.1b Readiness probe (¿listo para requests?)
curl http://localhost:4000/readyz

# Esperado: 200 OK (si todo OK) o 503 (si DB no accesible)
# {
#   "status": "ready",
#   "database": "ok",
#   "cache": "ok",
#   "email": "ok"
# }
```

**Checklist**:
- [ ] GET /health responde 200
- [ ] GET /readyz responde 200 (si ready) o 503 (si not)
- [ ] Ambos endpoints sin autenticación
- [ ] Response < 100ms

### 5.2 Request ID Tracing

```bash
# 5.2a Hacer request y verificar request ID
curl -i http://localhost:4000/health

# Esperado: Header X-Request-Id presente
# HTTP/1.1 200 OK
# X-Request-Id: f47ac10b-58cc-4372-a567-0e02b2c3d479
# Content-Type: application/json
```

**Verificación**:
- [ ] X-Request-Id presente en todas las responses
- [ ] ID único por request
- [ ] Request ID en logs para trazabilidad

### 5.3 Structured Logs

```bash
# 5.3a Ver logs (si ejecutas en foreground)
npm run start:api

# Esperado: Logs JSON con estructura:
# {
#   "level": "info",
#   "timestamp": "2026-02-23T12:34:56.789Z",
#   "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
#   "method": "GET",
#   "path": "/health",
#   "statusCode": 200,
#   "durationMs": 5,
#   "message": "Request completed"
# }
```

**Verificación**:
- [ ] Logs son JSON estructurado (producción)
- [ ] Logs incluyen requestId
- [ ] Logs incluyen durationMs
- [ ] Logs incluyen tenantId (si aplica)
- [ ] Passwords y tokens NO aparecen en logs

### 5.4 Error Tracking (Sentry)

```bash
# 5.4a Verificar que Sentry está configurado (opcional para MVP)
echo $SENTRY_DSN  # Si no es vacío, Sentry está configurado

# Esperado: https://xxx@sentry.io/zzz (o vacío para MVP)
```

**Checklist Observability**:
- [ ] /health endpoint responds 200
- [ ] /readyz endpoint responds 200 or 503
- [ ] X-Request-Id header presente
- [ ] Logs estructurados (JSON)
- [ ] Request ID en logs
- [ ] Zero sensitive data in logs
- [ ] Sentry DSN configurado (opcional)

---

## 6. Deploy a Staging: Checklist & Comandos 📋

### Criterio
Procedimiento documentado y repetible para deploy a staging

### Pre-Deploy (5 min)

```bash
# 6.1 Verificar todas las pruebas pasan
npm run test:e2e

# Esperado: ✅ All tests pass

# 6.2 Verificar build sin errores
npm run build

# Esperado: 0 TypeScript errors
```

### Variables de Entorno Staging

```bash
# 6.3 Crear .env.staging con variables:
NODE_ENV=staging
PORT=4000
DATABASE_URL=postgresql://user:pass@staging-db:5432/buildingos_staging

# JWT
JWT_SECRET=<64+ caracteres aleatorios>
JWT_EXPIRATION=86400

# CORS
WEB_ORIGIN=https://staging-app.buildingos.com

# Email
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<sendgrid-api-key>
MAIL_FROM=noreply@buildingos.com
SALES_TEAM_EMAIL=sales@buildingos.com

# Observability (Sentry)
SENTRY_DSN=https://xxx@sentry.io/zzz
SENTRY_ENVIRONMENT=staging

# Optional: MinIO/S3
MINIO_ENDPOINT=minio.staging.buildingos.com
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=documents
```

### Deploy Steps

#### Opción A: Docker Compose (Local/Docker Host)

```bash
# 6.4a Build Docker image
docker build -t buildingos-api:staging -f apps/api/Dockerfile .
docker build -t buildingos-web:staging -f apps/web/Dockerfile .

# 6.4b Run with docker-compose
docker-compose -f docker-compose.yml up -d

# 6.4c Verify services running
docker ps | grep buildingos
docker-compose logs -f api  # Watch logs

# 6.4d Test endpoints
curl http://localhost:4000/health
curl http://localhost:3000  # Web app
```

#### Opción B: Heroku Deploy

```bash
# 6.4b Heroku setup (primero una sola vez)
heroku login
heroku create buildingos-staging --region us
heroku addons:create heroku-postgresql:standard-0 --app buildingos-staging
heroku addons:create heroku-redis:premium-0 --app buildingos-staging

# 6.4c Configurar variables
heroku config:set NODE_ENV=staging \
  JWT_SECRET="<64-char-random>" \
  WEB_ORIGIN="https://buildingos-staging.herokuapp.com" \
  --app buildingos-staging

# 6.4d Deploy
git push heroku main

# 6.4e Check logs
heroku logs --tail --app buildingos-staging
```

#### Opción C: AWS ECS Deploy

```bash
# 6.4c ECR push
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker tag buildingos-api:staging <account-id>.dkr.ecr.us-east-1.amazonaws.com/buildingos:staging
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/buildingos:staging

# 6.4d Update ECS service
aws ecs update-service \
  --cluster buildingos-staging \
  --service api-service \
  --force-new-deployment
```

### Post-Deploy (5 min)

```bash
# 6.5 Health check
curl https://staging-app.buildingos.com/health

# Esperado: 200 OK

# 6.6 Database migration
npm run prisma:migrate:deploy --database-url=$STAGING_DATABASE_URL

# 6.7 Seed data (solo primera vez)
npm run prisma:seed

# 6.8 Run E2E tests against staging
npm run test:e2e -- --baseUrl=https://staging-app.buildingos.com

# Esperado: ✅ All tests pass
```

### Rollback (If Needed)

```bash
# 6.9 Rollback a versión anterior
# Docker Compose: git revert, rebuild, redeploy
# Heroku: heroku releases -> heroku rollback v<N>
# ECS: aws ecs update-service --force-new-deployment con imagen anterior

# Verificar rollback exitoso
curl https://staging-app.buildingos.com/health
```

**Checklist Deploy**:
- [ ] All tests pass (npm run test:e2e)
- [ ] Build successful (npm run build)
- [ ] .env.staging file created with all vars
- [ ] Database migration run
- [ ] Seed data executed (primera vez)
- [ ] /health endpoint responds 200
- [ ] /readyz endpoint responds 200
- [ ] E2E tests pass against staging
- [ ] Logs visible and structured
- [ ] X-Request-Id header present
- [ ] Zero sensitive data in logs

---

## 📋 Master Checklist: PILOT READY

Use esta checklist para verificación final antes de lanzar a cliente:

### ✅ Antes de Deploy (Day -1)

- [ ] **Build**: `npm run build` sin errores
- [ ] **Tests**: `npm run test:e2e` passes 9/9
- [ ] **CI**: GitHub Actions workflow activo
- [ ] **Seed**: `npx prisma db seed` completa exitosamente
- [ ] **Env**: Variables .env.staging completas

### ✅ Crear Nuevo Tenant (Cliente)

- [ ] Cliente accede `/auth/signup`
- [ ] Cliente registra email, password, nombre, organización
- [ ] Token JWT generado y válido
- [ ] Cliente redirigido a dashboard

### ✅ Edificio + Unidades

- [ ] Cliente crea primer edificio vía API o UI
- [ ] Cliente crea 3+ unidades en edificio
- [ ] Todas las unidades visibles en dashboard
- [ ] Códigos únicos por edificio

### ✅ Usuarios + Residentes

- [ ] Cliente invita residente vía email
- [ ] Residente recibe link válido (7 días)
- [ ] Residente acepta invitación y crea password
- [ ] Residente puede loguear y acceder su unidad
- [ ] Residente NO ve unidades de otros

### ✅ Observability

- [ ] `curl http://localhost:4000/health` → 200
- [ ] `curl http://localhost:4000/readyz` → 200
- [ ] Todos los requests tienen `X-Request-Id`
- [ ] Logs incluyen requestId y durationMs
- [ ] Zero passwords/tokens en logs

### ✅ Multi-Tenancy (Anti-Fuga)

- [ ] Client A con Client B's tenant ID → 404
- [ ] Client A cannot list Client B's buildings
- [ ] RESIDENT cannot see other units
- [ ] Audit log shows all access attempts

### ✅ Deploy Staging

- [ ] Staging URL accesible y responde
- [ ] Database migrations ejecutadas
- [ ] Seed data cargado
- [ ] Health checks responden
- [ ] E2E tests pasan contra staging URL
- [ ] Logs visibles y estructurados

### ✅ Documentation

- [ ] Todas las credenciales documentadas
- [ ] Instrucciones de onboarding claras
- [ ] Troubleshooting guide disponible
- [ ] Support contact info presente

---

## 🚀 Comandos Rápidos (Copy-Paste)

### Para Verificación Rápida (5 min)

```bash
#!/bin/bash
# run-pilot-ready-check.sh

echo "=== BUILD ==="
npm run build || exit 1

echo "=== TESTS ==="
npm run test:e2e -- tenant-isolation.e2e-spec.ts || exit 1

echo "=== SEED ==="
cd apps/api && npx prisma db seed || exit 1

echo "=== HEALTH ==="
curl http://localhost:4000/health || exit 1
curl http://localhost:4000/readyz || exit 1

echo "=== ✅ PILOT READY ==="
```

### Para Deploy a Staging (15 min)

```bash
#!/bin/bash
# deploy-staging.sh

set -e

echo "Building..."
npm run build

echo "Testing..."
npm run test:e2e

echo "Deploying to staging..."
docker-compose -f docker-compose.yml down || true
docker-compose -f docker-compose.yml up -d

echo "Running migrations..."
npx prisma migrate deploy

echo "Seeding data..."
npx prisma db seed

echo "Health checks..."
sleep 5
curl http://localhost:4000/health || exit 1

echo "✅ Staging deployed!"
```

---

## Tiempos Esperados

| Tarea | Tiempo |
|-------|--------|
| Build + Tests | 5 min |
| Seed data | 2 min |
| Nuevo tenant (onboarding) | 8 min |
| Deploy a staging | 10 min |
| E2E verification | 5 min |
| **TOTAL** | **~30 min** |

---

## Troubleshooting

### Build falla
```bash
# Limpia caché y reinicia
rm -rf node_modules dist
npm install
npm run build
```

### Tests fallan
```bash
# Revisa que PostgreSQL está corriendo
docker ps | grep postgres

# Si no, inicia:
docker-compose up -d db

# Luego reintenta tests
npm run test:e2e
```

### Seed data falla
```bash
# Revisa conexión DB
npx prisma db push  # Aplica schema

# Luego seed
npx prisma db seed
```

### Health endpoint no responde
```bash
# Verifica API running
ps aux | grep "node.*main.ts"

# O inicia:
npm run start:api
```

---

## Siguiente Paso

Una vez TODOS los checkboxes están verdes ✅:

1. **Comunicar a cliente**: "Sistema listo para onboarding"
2. **Proporcionar credenciales**: Link de signup + demo tenants
3. **Comenzar Sprint 1**: Implementar features adicionales basadas en feedback
4. **Monitorear Sentry**: Errores en tiempo real
5. **Revisar logs**: Performance y usuarios

---

**Versión**: 1.0
**Última actualización**: Feb 23, 2026
**Mantenido por**: Engineering Team
