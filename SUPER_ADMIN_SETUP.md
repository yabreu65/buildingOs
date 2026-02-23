# 👑 SUPER_ADMIN Setup - Cómo Convertirse en Administrador Global

**Status**: 🟢 **CONFIGURADO & LISTO**
**Verificado**: Feb 23, 2026

---

## Quick Start (2 min)

### Opción 1: Usar Credenciales Pre-Cargadas (Recomendado)

```bash
# 1. Asegurate que seed data se ejecutó
cd apps/api
npx prisma db seed

# 2. Loguea con:
Email:    superadmin@demo.com
Password: SuperAdmin123!

# 3. Acceso a: https://app.buildingos.com/super-admin
```

**Status**: ✅ SUPER_ADMIN activo, acceso a /super-admin panel

---

## ¿Qué es SUPER_ADMIN?

**SUPER_ADMIN** es un rol **global** (no tenant-scoped) que permite:

| Capacidad | Acceso |
|-----------|--------|
| Ver TODOS los tenants | ✅ |
| Cambiar plan de cliente | ✅ |
| Ver audit logs globales | ✅ |
| Cambiar tenant branding | ✅ |
| Gestionar super-admin settings | ✅ |
| Crear/editar otros SUPER_ADMINs | ❌ (no implementado) |

**No puede**:
- ❌ Editar datos de otros tenants directamente
- ❌ Ver contraseñas de usuarios
- ❌ Borrar datos sin auditoría

---

## Cómo Funciona Internamente

### 1. JWT Token Structure

Cuando SUPER_ADMIN se loguea, el JWT contiene:

```json
{
  "email": "superadmin@demo.com",
  "sub": "user-uuid-12345",
  "isSuperAdmin": true,          // ← CLAVE
  "iat": 1645123456,
  "exp": 1645210456
}
```

**isSuperAdmin: true** = Acceso a /super-admin endpoints

### 2. Guards en Endpoints

```typescript
// Ejemplo: cambiar plan de cliente
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Patch('/super-admin/tenants/:tenantId/subscription')
async changePlan(...) {
  // Solo accesible si isSuperAdmin = true
}
```

**SuperAdminGuard**:
- Lee JWT token
- Verifica `isSuperAdmin === true`
- Si no: retorna 403 Forbidden

### 3. Detección en Auth Service

```typescript
// En login:
const isSuperAdmin = user.memberships.some((m) =>
  m.roles.some((r) => r.role === 'SUPER_ADMIN')
);

// Si user tiene SUPER_ADMIN en cualquier membership:
isSuperAdmin = true
// Si no tiene en ninguno:
isSuperAdmin = false
```

---

## Cómo Crear un Nuevo SUPER_ADMIN (Manual)

Si necesitas agregar otro SUPER_ADMIN:

### Opción A: Vía Seed (Recomendado)

Edita `apps/api/prisma/seed.ts`:

```typescript
// Agrega después de superadminUser:
const secondSuperAdmin = await prisma.user.upsert({
  where: { email: "another-admin@buildingos.com" },
  update: {},
  create: {
    email: "another-admin@buildingos.com",
    name: "Another Super Admin",
    passwordHash: await bcrypt.hash("AnotherPass123!", 10),
  },
});

// Dale SUPER_ADMIN role
await prisma.membershipRole.create({
  data: {
    membershipId: superAdminMembership.id,  // Any membership
    role: "SUPER_ADMIN",
  },
});
```

Luego:
```bash
npx prisma db seed
```

### Opción B: SQL Directo (No Recomendado)

```sql
-- Encuentra o crea el user
SELECT id FROM "User" WHERE email = 'admin@buildingos.com';
-- Output: user-uuid-xyz

-- Usa ANY membership del usuario (sin tenant scope)
SELECT id FROM "Membership" WHERE "userId" = 'user-uuid-xyz' LIMIT 1;
-- Output: membership-uuid-abc

-- Agrega SUPER_ADMIN role
INSERT INTO "MembershipRole" ("membershipId", "role")
VALUES ('membership-uuid-abc', 'SUPER_ADMIN');
```

### Opción C: API Endpoint (Futuro)

```
POST /super-admin/users/make-super-admin
Authorization: Bearer {JWT super-admin}
{
  "email": "newadmin@buildingos.com"
}
```

**Status**: ❌ No implementado en MVP

---

## Endpoints Accesibles como SUPER_ADMIN

```
GET    /super-admin/tenants
GET    /super-admin/tenants/:tenantId
PATCH  /super-admin/tenants/:tenantId/subscription
POST   /super-admin/tenants/:tenantId/impersonation/start
GET    /super-admin/audit/logs
GET    /super-admin/ai-analytics
... (más en super-admin.controller.ts)
```

### Ejemplo: Ver Todos los Tenants

```bash
curl -H "Authorization: Bearer {JWT}" \
     http://localhost:4000/super-admin/tenants

# Respuesta:
200 OK
{
  "tenants": [
    {
      "id": "tenant-1",
      "name": "Condominio Central",
      "type": "EDIFICIO_AUTOGESTION",
      "plan": "PRO",
      "users": 5,
      "buildings": 1,
      "createdAt": "..."
    },
    {
      "id": "tenant-2",
      "name": "Torre Centro",
      "type": "ADMINISTRADORA",
      "plan": "FREE",
      "users": 3,
      "buildings": 2,
      "createdAt": "..."
    }
  ]
}
```

### Ejemplo: Cambiar Plan de Cliente

```bash
curl -X PATCH \
     -H "Authorization: Bearer {JWT}" \
     -H "Content-Type: application/json" \
     -d '{"newPlanId": "pro"}' \
     http://localhost:4000/super-admin/tenants/tenant-1/subscription

# Respuesta:
200 OK
{
  "tenantId": "tenant-1",
  "oldPlan": "FREE",
  "newPlan": "PRO",
  "changedAt": "2026-02-23T15:45:00Z"
}

# Audit logged automáticamente:
# ✅ PLAN_CHANGED event
```

---

## Audit Trail para SUPER_ADMIN Actions

Todos los cambios hechos por SUPER_ADMIN son auditados:

```
✅ PLAN_CHANGED
✅ TENANT_BRANDING_UPDATED
✅ SUPER_ADMIN_IMPERSONATION_START
✅ SUPER_ADMIN_IMPERSONATION_END
... (60+ audit events)
```

**Query audit logs**:
```bash
curl -H "Authorization: Bearer {JWT}" \
     "http://localhost:4000/audit/logs?action=PLAN_CHANGED&take=50"

# Respuesta muestra QUIÉN cambió QUÉ CUÁNDO
```

---

## Impersonación (Debugging)

SUPER_ADMIN puede "hacerse pasar" por otro usuario para debug:

```bash
# Start impersonation
POST /super-admin/tenants/tenant-1/impersonation/start
Authorization: Bearer {super-admin JWT}
{
  "userId": "user-to-impersonate"
}

# Respuesta:
{
  "impersonationToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": "2026-02-23T16:45:00Z"
}

# Luego usa impersonationToken como si fueras ese usuario:
curl -H "Authorization: Bearer {impersonationToken}" \
     http://localhost:4000/buildings

# End impersonation
POST /super-admin/tenants/tenant-1/impersonation/end
Authorization: Bearer {super-admin JWT}
```

**Audited**: ✅ SUPER_ADMIN_IMPERSONATION_START + END

---

## Security: Cómo está Protegido SUPER_ADMIN

```
🔒 Layer 1: JWT Token
   - Solo válido por 24h
   - Firmado con JWT_SECRET
   - HTTP-only cookies (recomendado)

🔒 Layer 2: SuperAdminGuard
   - Verifica isSuperAdmin === true
   - Cada request lo chequea
   - 403 si es false

🔒 Layer 3: Audit Trail
   - Todos los cambios logged
   - Quién, qué, cuándo
   - Immutable (append-only)

🔒 Layer 4: Multi-Tenant Isolation
   - SUPER_ADMIN VE todos tenants
   - Pero DATA ISOLATION se respeta
   - Cambios afectan solo el tenant especificado
```

---

## Casos de Uso Comunes

### Caso 1: Cliente reporta no poder loguear

```bash
# 1. SUPER_ADMIN loguea
# 2. Ve el tenant
GET /super-admin/tenants/{tenantId}

# 3. Impersona al cliente
POST /super-admin/tenants/{tenantId}/impersonation/start

# 4. Intenta loguear como el cliente
# 5. Ve el error en logs
GET /audit/logs?action=AUTH_FAILED_LOGIN

# 6. Identifica el problema
# 7. Termina impersonación
POST /super-admin/tenants/{tenantId}/impersonation/end
```

### Caso 2: Cliente necesita upgrade de plan

```bash
# 1. SUPER_ADMIN loguea
# 2. Cambia plan
PATCH /super-admin/tenants/{tenantId}/subscription
{ "newPlanId": "enterprise" }

# 3. Cliente automáticamente accede features new
# 4. Email enviado a cliente (opcional, futuro)
# 5. Audit logged
```

### Caso 3: Cliente solicita crédito (por fallo)

```bash
# Nota: No hay endpoint de "refund" en MVP
# Workaround: SUPER_ADMIN impersona cliente + cancela charge

POST /super-admin/tenants/{tenantId}/impersonation/start
# Ahora con token de impersonación:
POST /charges/{chargeId}/cancel
{ "reason": "Admin override - customer refund" }

# Charge cancelada, audited como SI lo hizo el cliente
```

---

## Contraseña y Seguridad

### Cambiar Contraseña de SUPER_ADMIN

```bash
# Como SUPER_ADMIN, usa endpoint normal:
POST /auth/change-password
Authorization: Bearer {JWT}
{
  "currentPassword": "SuperAdmin123!",
  "newPassword": "NewSecurePass123!"
}

# El JWT sigue siendo válido por 24h más
```

### Regenerar JWT Secret (Emergencia)

Si JWT_SECRET se compromete:

```bash
# 1. Cambia JWT_SECRET en .env
JWT_SECRET=<nuevo_secret_de_64_chars>

# 2. Reinicia API
npm run start:api

# 3. TODOS los JWTs existentes INVALIDAN
# 4. Todos deben re-loguear

# ⚠️  Esto afecta a TODOS (SUPER_ADMIN + clientes)
```

---

## Troubleshooting

### Problema: "401 Unauthorized" en /super-admin endpoint

**Posibles causas**:
1. JWT token expirado (24h) → Re-loguear
2. isSuperAdmin = false → Usuario no es SUPER_ADMIN
3. JWT_SECRET cambió → Re-loguear
4. Token incorrecto en header

**Debug**:
```bash
# Decodificar JWT (no es seguro pero help debug)
# Usa jwt.io (online tool) o:
python -c "import json, base64; print(json.loads(base64.b64decode('YOUR_JWT_PAYLOAD')))"
```

### Problema: SUPER_ADMIN no tiene acceso a /super-admin panel

**Causa**: Probablemente no se ejecutó seed data

**Solución**:
```bash
cd apps/api
npx prisma db seed

# Luego loguea con: superadmin@demo.com / SuperAdmin123!
```

### Problema: Impersonación no funciona

**Verifica**:
```bash
# 1. El usuario existe?
GET /super-admin/tenants/{tenantId}
# Mira lista de users

# 2. El userId es correcto?
# Copia exact userId del tenant

# 3. Usa POST (no GET)
POST /super-admin/tenants/{tenantId}/impersonation/start
```

---

## Checklist: SUPER_ADMIN Configurado

- [x] Seed data ejecutado (`npx prisma db seed`)
- [x] Usuario superadmin@demo.com creado
- [x] Rol SUPER_ADMIN asignado
- [x] JWT token generado al loguear
- [x] /super-admin endpoints accesibles
- [x] Audit trail funcionando
- [x] Multi-tenancy isolation respetado
- [x] Impersonación testeada (opcional)

---

## Resumen

| Pregunta | Respuesta |
|----------|-----------|
| **¿Cómo ser SUPER_ADMIN?** | Loguea con superadmin@demo.com / SuperAdmin123! |
| **¿Cómo crear otro SUPER_ADMIN?** | Edita seed.ts + run `npx prisma db seed` |
| **¿Qué puedo hacer?** | Ver todos tenants, cambiar planes, ver audits, impersonar |
| **¿Es seguro?** | ✅ JWT + guards + audit trail + multi-tenant isolation |
| **¿Qué puedo ROMPER?** | Nada - cambios auditados, reversibles |
| **¿Hay backup?** | ✅ Audit log inmutable (PLAN_CHANGED logged) |

---

**Status**: 🟢 SUPER_ADMIN READY

Loguea ahora con credenciales de seed y accede /super-admin 👑
