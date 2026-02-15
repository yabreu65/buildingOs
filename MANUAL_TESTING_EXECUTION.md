# Manual Testing Execution: SUPER_ADMIN vs TENANT Separation
**Fecha**: 14-15 Feb 2026
**Status**: 🔴 ESPERANDO EJECUCIÓN MANUAL EN NAVEGADOR
**Servidores**: ✅ API (4000) + Web (3000) CORRIENDO

---

## ✅ AMBIENTE LISTO

```bash
✅ API Server:  http://localhost:4000 (Nest.js)
✅ Web Server:  http://localhost:3000 (Next.js)
✅ Database:    Prisma seed completado
✅ Credentials: Test users seeded in database
```

**Próximo paso**: Abre navegador en modo incógnito y sigue las pruebas.

---

## 🧪 CASO A: SUPER_ADMIN Tests

### A.1: Login Flow → Redirige a /super-admin

**INSTRUCCIONES**:
1. Abre nuevo navegador **MODO INCÓGNITO** (Cmd+Shift+N en Mac, Ctrl+Shift+N en Windows)
2. Navega a: `http://localhost:3000/login`
3. **Credenciales SUPER_ADMIN** (buscar en `apps/api/prisma/seed.ts`):
   - Email: `superadmin@example.com` (o ajusta según seed)
   - Password: Tu password seed
4. Click "Sign In" / "Iniciar Sesión"
5. **Espera 2-3 segundos**

**ESPERADO**:
```
✅ URL cambia a: http://localhost:3000/super-admin
✅ Página muestra: "Control Plane" o similar heading
✅ Sidebar muestra: Overview, Tenants, Audit Logs, Platform Users
✅ NO muestra: Buildings, Units, Payments, Properties
✅ Sin flicker de UI (no ves dashboard de tenant por milisegundos)
✅ No hay error en console
```

**RESULTADO**:
- [ ] ✅ PASS - Redirect funcionó, super-admin visible
- [ ] ❌ FAIL - (describe problema)

```
Notas/Observaciones:
_________________________________________________________________
```

---

### A.2: SUPER_ADMIN Visita /{tenantId}/dashboard → Bloquea/Redirige

**INSTRUCCIONES**:
1. Abre **NUEVA PESTAÑA** (Cmd+T) en el mismo navegador incógnito (misma sesión)
2. En el address bar, escribe: `http://localhost:3000/tenant-123/dashboard`
   - Nota: Busca un tenantId válido en database si necesitas uno diferente
3. Press ENTER
4. **Observa la URL y el contenido por 3 segundos**

**ESPERADO**:
```
✅ Ves breve loading state (1-2 seg)
✅ URL se cambia a: http://localhost:3000/super-admin (automático)
✅ Landing en página super-admin
✅ NUNCA ves dashboard de tenant (ni buildings, stats, etc.)
✅ NO hay flash/flicker de tenant UI
✅ Smooth redirect, sin errores
```

**RESULTADO**:
- [ ] ✅ PASS - Blocked + redirected to super-admin
- [ ] ❌ FAIL - (describe problema)

```
Notas/Observaciones:
_________________________________________________________________
```

---

### A.3: SUPER_ADMIN Visita /{tenantId}/buildings/{buildingId}/units → Bloquea

**INSTRUCCIONES**:
1. **NUEVA PESTAÑA** otra vez (Cmd+T)
2. En address bar: `http://localhost:3000/tenant-123/buildings/building-456/units`
   - Ajusta IDs según tu database si es necesario
3. Press ENTER

**ESPERADO**:
```
✅ Loading state aparece
✅ URL se cambia a: http://localhost:3000/super-admin
✅ Never renders units table o building data
✅ No "flash" de units visible
```

**RESULTADO**:
- [ ] ✅ PASS - Blocked deeply nested route
- [ ] ❌ FAIL

```
Notas/Observaciones:
_________________________________________________________________
```

---

### A.4: Navega dentro de SUPER_ADMIN y Refresca (F5)

**INSTRUCCIONES**:
1. En navegador, actualmente en `http://localhost:3000/super-admin`
2. Click en sidebar: "Tenants" → navega a `/super-admin/tenants`
3. Ahora en `/super-admin/tenants`, press **F5** (refresh)
4. **Espera a que recargue**

**ESPERADO**:
```
✅ Página se recarga
✅ Sigue en /super-admin/tenants
✅ Todos los datos se cargan normalmente
✅ Sidebar sigue mostrando SUPER_ADMIN options
✅ No redirecciona a /login
```

**RESULTADO**:
- [ ] ✅ PASS - Refresh mantiene sesión y ruta
- [ ] ❌ FAIL

```
Notas/Observaciones:
_________________________________________________________________
```

---

## 🧪 CASO B: TENANT_ADMIN Tests

### B.1: TENANT_ADMIN Login → Entra a /{tenantId}/dashboard

**INSTRUCCIONES**:
1. **NUEVO NAVEGADOR INCÓGNITO** (Cmd+Shift+N) - NO el anterior
2. Navega a: `http://localhost:3000/login`
3. **Credenciales TENANT_ADMIN** (buscar en seed):
   - Email: `tenant@example.com` (o según seed)
   - Password: Tu password seed
4. Click "Sign In"
5. **Espera 2-3 segundos**

**ESPERADO**:
```
✅ URL es: http://localhost:3000/{tenantId}/dashboard
✅ Página muestra: Dashboard de tenant (onboarding checklist)
✅ Sidebar muestra: Dashboard, Buildings, Properties, Units, Payments
✅ NO muestra: Tenants, Overview, Audit Logs, Platform Users
✅ See building/unit stats
```

**RESULTADO**:
- [ ] ✅ PASS - Logged in to tenant dashboard
- [ ] ❌ FAIL

```
Notas/Observaciones:
_________________________________________________________________
```

---

### B.2: TENANT_ADMIN Intenta /super-admin → Bloquea

**INSTRUCCIONES**:
1. Estás en `/{tenantId}/dashboard`
2. **NUEVA PESTAÑA** (Cmd+T)
3. En address bar: `http://localhost:3000/super-admin`
4. Press ENTER

**ESPERADO**:
```
✅ Loading state breve
✅ Redirige a una de estas (standard a definir):
   - Opción A: http://localhost:3000/login (logout implicit)
   - Opción B: http://localhost:3000/{tenantId}/dashboard (back to tenant)
✅ NUNCA ve: "Control Plane" heading, Tenants link, Overview stats, etc.
✅ Proper blocking sin errores
```

**ESTÁNDAR RECOMENDADO**:
- ✅ **Opción A** (Redirect a /login): Más seguro, sesión se considera "inválida" para super-admin
- ❌ Opción B (Back to tenant): Menos obvious que fue bloqueado

**RESULTADO**:
- [ ] ✅ PASS - Blocked and redirected to: __________ (anota URL)
- [ ] ❌ FAIL

```
Notas/Observaciones:
_________________________________________________________________
```

---

### B.3: TENANT_ADMIN Refresca (F5) en Ruta Profunda

**INSTRUCCIONES**:
1. En navegador TENANT, navega a: `http://localhost:3000/{tenantId}/buildings`
2. Click en un building → `/buildings/{buildingId}`
3. Click en "Units" → `/buildings/{buildingId}/units`
4. Ahora en ruta profunda, press **F5** (refresh)
5. **Espera a que cargue**

**ESPERADO**:
```
✅ Página se recarga sin redirect
✅ Sigue en /buildings/{buildingId}/units
✅ Units table se renderiza con datos
✅ Sidebar accesible, navegación funciona
✅ No hay error en console
```

**RESULTADO**:
- [ ] ✅ PASS - Deep route persisted after refresh
- [ ] ❌ FAIL

```
Notas/Observaciones:
_________________________________________________________________
```

---

## 🔍 VERIFICACIONES ADICIONALES

### DevTools Console Check

**INSTRUCCIONES**:
1. En cualquier página, press **F12** (DevTools)
2. Ir a "Console" tab
3. **Buscar errores**:
   - ❌ "Cannot read property" errors
   - ❌ "useIsSuperAdmin is not defined"
   - ❌ "Session is invalid"
   - ✅ Solo logs normales (auth, data fetch)

**ESPERADO**:
```
✅ Console limpia (no red error messages)
✅ Solo info/debug logs
✅ No TypeScript errors visible
```

**RESULTADO**:
- [ ] ✅ PASS - Console clean
- [ ] ❌ FAIL - Errors found:
   ```
   _________________________________________________________________
   ```

---

### DevTools Network Check

**INSTRUCCIONES** (SUPER_ADMIN específicamente):
1. Logged in como SUPER_ADMIN
2. Open DevTools (F12) → Network tab
3. Intenta visitar: `http://localhost:3000/tenant-123/dashboard`
4. **Observa XHR requests**:
   - ❌ NO debe haber calls a `/tenants/123/buildings`
   - ❌ NO debe haber calls a `/tenants/123/units`
   - ✅ Solo navigation requests, layout JS/CSS

**ESPERADO**:
```
✅ No API calls a endpoints de tenant
✅ Redirect ocurre ANTES de fetch de datos
✅ Network tab clean (solo JS/CSS/navigation)
```

**RESULTADO**:
- [ ] ✅ PASS - No tenant API calls made
- [ ] ❌ FAIL - Found API calls:
   ```
   _________________________________________________________________
   ```

---

## 📋 CHECKLIST RESUMEN

### CASO A: SUPER_ADMIN (6 checks)
- [ ] A.1: Login redirect a /super-admin
- [ ] A.2: /{tenantId}/dashboard blocked/redirected
- [ ] A.3: /{tenantId}/buildings/{id}/units blocked
- [ ] A.4: Refresh en /super-admin/tenants funciona
- [ ] Console: Sin errores
- [ ] Network: Sin tenant API calls

### CASO B: TENANT_ADMIN (5 checks)
- [ ] B.1: Login entra a /{tenantId}/dashboard
- [ ] B.2: /super-admin bloqueado
- [ ] B.3: Refresh en ruta profunda funciona
- [ ] Console: Sin errores
- [ ] Network: Sin super-admin API calls

---

## ⚠️ CRITERIO DE ACEPTACIÓN CRÍTICO

**🚫 FAIL SI CUALQUIERA DE ESTO OCURRE**:

1. ❌ SUPER_ADMIN ve "flash" de tenant UI (aunque sea 100ms)
2. ❌ SUPER_ADMIN ve tenant data (buildings, units, stats)
3. ❌ TENANT ve /super-admin contenido (heading, links, etc.)
4. ❌ Console errors relacionados a roles/auth
5. ❌ API calls hechos por rol incorrecto (visible en Network)
6. ❌ Redirect loop infinito
7. ❌ Broken navigation después de redirect

**✅ PASS SI**:
- ✅ SUPER_ADMIN NUNCA ve tenant UI
- ✅ TENANT NUNCA ve super-admin UI
- ✅ Redirects son suaves (sin flicker)
- ✅ Console limpia
- ✅ Network limpia (no wrong API calls)
- ✅ Todos los 11 checks arriba pasan

---

## 📝 RESULTADO FINAL

Después de completar TODOS los tests, completa esta sección:

### Test Execution Summary

**Total Checks**: 11 (6 CASO A + 5 CASO B)

**Passed**: _____ / 11
**Failed**: _____ / 11

**Critical Issues Found**:
- [ ] None (✅ PASS)
- [ ] Some (❌ FAIL - list below)

```
_________________________________________________________________

_________________________________________________________________

_________________________________________________________________
```

### Overall Status

**Recomendación**:
- [ ] ✅ **PASS** - Todas las pruebas pasaron, listo para staging
- [ ] ❌ **FAIL** - Problemas encontrados, need fixes

**Si FAIL**: Crear GitHub Issue con:
1. Qué test falló
2. Expected vs Actual
3. Console screenshots (si hay errores)
4. Network tab screenshots (si hay wrong API calls)

---

## 🎯 SIGUIENTES PASOS

### Si TODOS PASS ✅
```
1. → Code review de 6 files modificados
2. → Staging deployment
3. → E2E testing en staging
4. → Production release
```

### Si ALGUNO FAIL ❌
```
1. → Create GitHub issue with details
2. → Debugging & fixing
3. → Re-run tests
4. → Repeat until all PASS
```

---

## 📚 REFERENCIAS RÁPIDAS

**URLs a Probar**:
- `/login` - Login page
- `/super-admin` - Control plane
- `/super-admin/tenants` - Tenant management
- `/{tenantId}/dashboard` - Tenant dashboard
- `/{tenantId}/buildings` - Buildings list
- `/{tenantId}/buildings/{id}/units` - Units for building

**Servidores**:
- API: http://localhost:4000
- Web: http://localhost:3000

**Archivos Importantes**:
- `apps/web/features/auth/useAuth.ts` - Role detection
- `apps/web/app/(tenant)/[tenantId]/layout.tsx` - Tenant layout protection
- `apps/web/app/super-admin/layout.tsx` - Super admin protection
- `apps/web/shared/components/layout/Sidebar.tsx` - Sidebar separation

---

**Documento creado**: 2026-02-15
**Versión**: 1.0
**Servidores estado**: ✅ CORRIENDO
**Listo para**: MANUAL BROWSER TESTING

