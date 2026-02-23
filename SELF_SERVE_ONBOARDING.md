# ✅ SELF-SERVE ONBOARDING - Cliente Nuevo Sin Intervención

**Status**: 🟢 **COMPLETAMENTE AUTÓNOMO**
**Verificado**: Feb 23, 2026
**Intervención Manual Requerida**: 0%

---

## Executive Summary

Un cliente NUEVO puede:
1. ✅ Registrarse completamente solo
2. ✅ Crear su organización (tenant) automático
3. ✅ Crear edificios + unidades sin permisos especiales
4. ✅ Invitar residentes automáticamente (con emails)
5. ✅ Residentes loguean y acceden su dashboard

**TODO sin que vos toques base de datos o código.**

---

## Flujo Completo (30 minutos, 100% autónomo)

### PASO 1: Cliente Registra (5 min)

**Acción**: Cliente visita `https://app.buildingos.com/signup`

**Formulario**:
```
Nombre: Juan Perez
Email: juan@mycompany.com
Password: SecurePassword123!
Nombre de Organización: Condominio Central
Tipo: EDIFICIO_AUTOGESTION  [dropdown]
```

**Backend - Lo que pasa automático**:
```
POST /auth/signup
{
  "name": "Juan Perez",
  "email": "juan@mycompany.com",
  "password": "SecurePassword123!",
  "tenantName": "Condominio Central",
  "tenantType": "EDIFICIO_AUTOGESTION"
}

RESPUESTA:
201 Created
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-uuid-12345",
    "email": "juan@mycompany.com",
    "name": "Juan Perez"
  },
  "memberships": [{
    "tenantId": "tenant-uuid-abc123",
    "roles": ["TENANT_OWNER", "TENANT_ADMIN"]
  }]
}
```

**Lo que se creó automático**:
- ✅ User: juan@mycompany.com (password hasheado)
- ✅ Tenant: "Condominio Central" (nuevo registro)
- ✅ Membership: Link usuario ↔ tenant
- ✅ MembershipRoles: TENANT_OWNER + TENANT_ADMIN (full permisos)
- ✅ JWT Token: Válido por 24h

**Estado**: 🟢 Cliente registrado, con roles completos, listo para next step

---

### PASO 2: Cliente Crea Su Primer Edificio (3 min)

**Acción**: Cliente rellena formulario en UI

**Datos Ingresados**:
```
Nombre del Edificio: Torre Centro
Dirección: Av. Principal 123, Piso 5
```

**Backend - Lo que pasa automático**:
```
POST /buildings
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Tenant-Id: tenant-uuid-abc123
{
  "name": "Torre Centro",
  "address": "Av. Principal 123, Piso 5"
}

RESPUESTA:
201 Created
{
  "id": "building-uuid-xyz789",
  "tenantId": "tenant-uuid-abc123",
  "name": "Torre Centro",
  "address": "Av. Principal 123, Piso 5",
  "createdAt": "2026-02-23T15:30:00Z"
}
```

**Validaciones Automáticas**:
- ✅ JWT token válido? Sí
- ✅ Tenant existe? Sí (del JWT)
- ✅ User es propietario del tenant? Sí (TENANT_OWNER role)
- ✅ Límite de edificios no excedido? Sí (plan TRIAL permite 1+)

**Audit Trail**:
- ✅ `BUILDING_CREATE` logged automáticamente

**Estado**: 🟢 Edificio creado, cliente tiene 1 building

---

### PASO 3: Cliente Crea 5 Unidades (5 min)

**Acción**: Cliente rellena formulario por cada unidad (o bulk upload)

**Unidades a crear**:
```
Unidad 1: Depto 101 (código: 101, tipo: APARTMENT)
Unidad 2: Depto 102 (código: 102, tipo: APARTMENT)
Unidad 3: Depto 103 (código: 103, tipo: APARTMENT)
Unidad 4: Depto 104 (código: 104, tipo: APARTMENT)
Unidad 5: Depto 105 (código: 105, tipo: APARTMENT)
```

**Backend - Para cada unidad**:
```
POST /buildings/building-uuid-xyz789/units
Authorization: Bearer {JWT token}
X-Tenant-Id: tenant-uuid-abc123
{
  "label": "Depto 101",
  "code": "101",
  "unitType": "APARTMENT",
  "occupancyStatus": "UNKNOWN"
}

RESPUESTA:
201 Created
{
  "id": "unit-uuid-1",
  "buildingId": "building-uuid-xyz789",
  "label": "Depto 101",
  "code": "101",
  "unitType": "APARTMENT",
  "occupancyStatus": "UNKNOWN",
  "createdAt": "2026-02-23T15:32:00Z"
}
```

**Validaciones Automáticas** (por cada unidad):
- ✅ JWT válido? Sí
- ✅ Building pertenece al tenant del usuario? Sí (validado)
- ✅ Código único por building? Sí (validation)
- ✅ Plan permite más units? Sí (TRIAL = 10 units)

**Resultado**:
- ✅ 5 units creadas
- ✅ 5 `UNIT_CREATE` audited automáticamente

**Estado**: 🟢 Edificio tiene 5 unidades, listo para residentes

---

### PASO 4: Cliente Invita Residentes (10 min)

**Acción**: Cliente carga lista de residentes (CSV o formulario)

**Residentes a invitar**:
```
1. Ana García - ana@email.com - Depto 101
2. Carlos López - carlos@email.com - Depto 102
3. María Martínez - maria@email.com - Depto 103
4. Roberto Díaz - roberto@email.com - Depto 104
5. Sofia Ruiz - sofia@email.com - Depto 105
```

**Backend - Para cada residente**:
```
POST /tenants/tenant-uuid-abc123/invitations
Authorization: Bearer {JWT token}
X-Tenant-Id: tenant-uuid-abc123
{
  "email": "ana@email.com",
  "roles": ["RESIDENT"],
  "unitId": "unit-uuid-1"
}

RESPUESTA:
201 Created
{
  "id": "invitation-uuid-1",
  "email": "ana@email.com",
  "token": "sha256_hash_of_random_token",  (hidden from response)
  "expiresAt": "2026-03-02T15:34:00Z",  (7 días)
  "roles": ["RESIDENT"],
  "unitId": "unit-uuid-1",
  "status": "PENDING"
}
```

**Automático en Backend**:
1. ✅ Genera token SHA-256 (criptográfico, único)
2. ✅ Set expiration a 7 días
3. ✅ Envía email (fire-and-forget, no bloquea):
   ```
   De: noreply@buildingos.com
   Para: ana@email.com
   Asunto: Invitación a Condominio Central

   Cuerpo:
   Hola Ana,

   Fuiste invitada a Condominio Central como residente de Depto 101.

   Click aquí para aceptar: https://buildingos.com/invite?token=abc123...

   Link válido por 7 días.
   ```
4. ✅ Audit logged: `INVITATION_CREATED`

**Resultado**:
- ✅ 5 invitations creadas
- ✅ 5 emails enviados automáticamente
- ✅ 5 audit records logged

**Estado**: 🟢 Residentes invitados, esperando aceptación

---

### PASO 5: Residente Recibe Email y Se Registra (5 min)

**Acción**: Ana recibe email, click en link

**URL en email**:
```
https://app.buildingos.com/invite?token=abc123xyz789...
```

**Frontend**: UI muestra:
```
Invitación Recibida
Condominio Central - Depto 101

Formulario:
- Email: ana@email.com (pre-filled, read-only)
- Nombre Completo: [input]
- Contraseña: [password]
- Confirmar Contraseña: [password]

[Aceptar] [Cancelar]
```

**Backend - POST /invitations/accept**:
```
POST /invitations/accept
{
  "token": "abc123xyz789...",
  "fullName": "Ana García",
  "password": "ResidentPass123!"
}

RESPUESTA:
200 OK
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-uuid-ana",
    "email": "ana@email.com",
    "name": "Ana García"
  },
  "membership": {
    "tenantId": "tenant-uuid-abc123",
    "roles": ["RESIDENT"]
  }
}
```

**Lo que pasa automático**:
1. ✅ Valida token (no expirado, no usado)
2. ✅ Crea User: ana@email.com
3. ✅ Crea Membership + RESIDENT role
4. ✅ Asigna UnitOccupant (Ana → Depto 101)
5. ✅ Marca invitation como ACCEPTED
6. ✅ Genera JWT token para Ana
7. ✅ Audit logged: `INVITATION_ACCEPTED`

**Estado**: 🟢 Residente registrado, tiene acceso a su Depto

---

### PASO 6: Residente Loguea y Accede Dashboard (2 min)

**Acción**: Ana loguea con email + password

**URL**: `https://app.buildingos.com/login`

**Formulario**:
```
Email: ana@email.com
Password: ResidentPass123!

[Ingresar]
```

**Backend - POST /auth/login**:
```
POST /auth/login
{
  "email": "ana@email.com",
  "password": "ResidentPass123!"
}

RESPUESTA:
200 OK
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... },
  "memberships": [{
    "tenantId": "tenant-uuid-abc123",
    "roles": ["RESIDENT"]
  }]
}
```

**Frontend - Dashboard**:
```
✅ Bienvenida Ana García
✅ Tu Unidad: Depto 101
✅ Edificio: Condominio Central
✅ Dirección: Av. Principal 123, Piso 5

Acciones disponibles:
- Ver mis pagos pendientes
- Enviar ticket de mantenimiento
- Ver comunicados del administrador
- Descargar documentos
- Ver perfil
```

**Permisos de Ana** (RESIDENT role):
```
✅ Ver su unidad (Depto 101)
✅ Ver sus pagos
✅ Crear tickets
✅ Ver comunicados
❌ NO puede ver otros deptos
❌ NO puede ver otros residentes
❌ NO puede cambiar configuración
```

**Audit Trail**:
- ✅ `AUTH_LOGIN` logged

**Estado**: 🟢 RESIDENTE ONBOARDED COMPLETO

---

## Timeline Completo (30 minutos)

```
Minuto 0:   Cliente abre signup
Minuto 5:   Cliente registrado + Tenant creado
Minuto 8:   Primer edificio creado
Minuto 13:  5 unidades creadas
Minuto 23:  5 residentes invitados + emails enviados
Minuto 28:  Primer residente acepta invitación
Minuto 30:  Residente loguea y accede dashboard

Total: 30 minutos, 100% autónomo
```

---

## ¿Qué NO Requiere Intervención Manual?

| Tarea | Automático? | Quién Hace |
|-------|-------------|-----------|
| Crear usuario | ✅ | Sistema |
| Crear tenant | ✅ | Sistema |
| Asignar roles | ✅ | Sistema |
| Generar JWT | ✅ | Sistema |
| Crear edificio | ✅ | Cliente (UI) |
| Crear unidades | ✅ | Cliente (UI) |
| Generar token invitación | ✅ | Sistema |
| Enviar emails | ✅ | Sistema |
| Aceptar invitación | ✅ | Residente (UI) |
| Crear UnitOccupant | ✅ | Sistema |
| Generar JWT para residente | ✅ | Sistema |

**Intervención manual requerida**: 0%

---

## Seguridad: Multi-Tenancy Verificada

**Verificaciones automáticas en CADA request**:

```
✅ Paso 1 (Signup):
   - Email único (no duplicado)
   - Tenant creado sin referencias cruzadas

✅ Paso 2 (Create Building):
   - X-Tenant-Id validado del JWT
   - Solo el tenant del usuario puede crear
   - Building asignado a tenant correcto

✅ Paso 3 (Create Units):
   - Building pertenece al tenant del usuario (validado)
   - Building + Units en el mismo tenant

✅ Paso 4 (Invite):
   - Tenant validado
   - Unit pertenece al tenant (validado)
   - Invitation tied a tenant correcto

✅ Paso 5 (Accept):
   - Token validado (no expirado)
   - Unit pertenece a tenant correcto
   - Residente asignado a unit correcto

✅ Paso 6 (Login):
   - Contraseña verificada
   - Residente ve SOLO su unit (validado)
   - Otros residentes NO visibles
```

**Conclusión**: ✅ Multi-tenancy segura end-to-end

---

## Códigos HTTP Esperados

| Acción | Endpoint | Status | Significado |
|--------|----------|--------|-------------|
| Signup exitoso | POST /auth/signup | 201 | Creado |
| Email duplicado | POST /auth/signup | 409 | Conflicto |
| Create building | POST /buildings | 201 | Creado |
| Sin JWT | POST /buildings | 401 | No autorizado |
| Invite residente | POST /tenants/:id/invitations | 201 | Creado |
| Token expirado | POST /invitations/accept | 400 | Inválido |
| Login exitoso | POST /auth/login | 200 | OK |
| Credenciales malas | POST /auth/login | 401 | No autorizado |

---

## Flujo Alternativo: Cliente Existente

Si cliente EXISTENTE trae residentes de otro sistema:

```
1. Cliente loguea con su tenant
2. Bulk-import de residentes (CSV)
3. Sistema genera invitations automáticas
4. Residentes reciben emails
5. Residentes aceptan + se registran

TODO SIN INTERVENCIÓN
```

---

## Casos Especiales (Que el sistema Maneja Automático)

### Caso 1: Residente Acepta Invitación pero se Registra Dos Veces
```
✅ Primer link: Acepta + crea user → OK (ACCEPTED)
❌ Segundo link: Token ya usado → Error "Invitation already accepted"
```

### Caso 2: Invitación Expira
```
✅ 0-7 días: Link válido
❌ >7 días: Token expirado → Error "Invitation expired"
   Solución: Cliente invita de nuevo
```

### Caso 3: Residente Trata de Ver Otro Depto
```
❌ GET /units/:other_unit_id
   Header: X-Tenant-Id: tenant-abc123
   Role: RESIDENT

Resultado: 404 Not Found (no info leak)
```

### Caso 4: Residente Intenta Crear Edificio
```
❌ POST /buildings
   Role: RESIDENT

Resultado: 403 Forbidden (no permisos)
```

---

## Documentación para Cliente

**Lo que cliente VE en la UI**:

### Step 1: Sign Up Page
```
🏢 BuildingOS

Ingresá tus datos para empezar:

Nombre Completo: [                    ]
Email:           [                    ]
Contraseña:      [                    ]
Org. Name:       [                    ]
Tipo:            [EDIFICIO_AUTOGESTION ▼]

[Crear Cuenta]

¿Ya tienes cuenta? Ingresar aquí
```

### Step 2: Create Building
```
✅ Bienvenida, Juan

Tu Primer Edificio

Nombre:     [Torre Centro           ]
Dirección:  [Av. Principal 123      ]

[Guardar] [Cancelar]
```

### Step 3: Add Units
```
Agregar Unidades a Torre Centro

Depto 101 | código: 101   | Tipo: APARTMENT [Guardar]
Depto 102 | código: 102   | Tipo: APARTMENT [Guardar]
Depto 103 | código: 103   | Tipo: APARTMENT [Guardar]

[+ Agregar otra] [Continuar]
```

### Step 4: Invite Residents
```
Invitar Residentes

Email              Depto
ana@email.com      Depto 101    [Quitar]
carlos@email.com   Depto 102    [Quitar]
maria@email.com    Depto 103    [Quitar]

[+ Agregar más]

[Enviar invitaciones]
```

---

## Conclusión

🟢 **SELF-SERVE ONBOARDING: 100% OPERACIONAL**

Un cliente nuevo puede:
- ✅ Registrarse solo
- ✅ Crear su organización (tenant) automático
- ✅ Crear edificios + unidades
- ✅ Invitar residentes (emails automáticos)
- ✅ Residentes se registran solos
- ✅ Residentes acceden su dashboard

**Intervención manual de admin**: NINGUNA

**Tiempo para cliente**: 30 minutos
**Confianza en multi-tenancy**: ✅ ALTA (verificada)

---

**Status**: 🟢 LISTO PARA PRIMER CLIENTE
