# Testing: No Flicker + Valid API Requests
**Date**: 15 Feb 2026
**Purpose**: Verify auth loading state, UI guard, and API validation
**Status**: 🟢 READY FOR EXECUTION

---

## 🎯 Objetivos de Testing

```
✅ No UI flicker durante auth loading
✅ No API requests sin tenantId válido
✅ useAuth.status funciona correctamente
✅ Neutral layout durante loading
✅ Redirects limpios sin race conditions
```

---

## 📋 Setup

### Prerequisitos
```bash
1. Terminal 1: npm run start --prefix apps/api
2. Terminal 2: npm run dev --prefix apps/web
3. Browser: Open http://localhost:3000
4. DevTools: F12 → Console + Network tabs
```

### Limpieza Inicial
```bash
1. Clear LocalStorage:
   - F12 → Application → LocalStorage → Clear All
2. Close ALL tabs except this one
3. Refresh page (Ctrl+R)
```

---

## 🧪 Test Cases

### Test 1: Loading State During First Load

**Objetivo**: Verificar que useAuth.status = 'loading' durante restauración de sesión

**Pasos**:
```
1. Abre DevTools Console (F12 → Console)
2. Copia y pega:

   // Monitor auth state changes
   const originalLog = console.log;
   window.authLogs = [];
   console.log = function(...args) {
     if (args[0]?.includes?.('auth') || args[0]?.status) {
       window.authLogs.push(args);
     }
     originalLog.apply(console, args);
   };
3. Refresh página (F5)
4. Espera 2 segundos
5. Ejecuta en console:

   console.table(window.authLogs)
```

**Esperado**:
```
status progresión: loading → authenticated (o unauthenticated)
sin saltos de estado
```

**Resultado**:
- [ ] ✅ PASS - Status progresa correctamente
- [ ] ❌ FAIL - Estado incorrecto
- Notas: _____________________

---

### Test 2: No Flicker During Login

**Objetivo**: Verificar que no hay flicker de UI equivocada al hacer login

**Pasos**:
```
1. Asegúrate que LocalStorage esté limpio (Test 1 step 2)
2. Abre DevTools Network (F12 → Network)
3. Filter: "doc" (para ver page loads)
4. En otra ventana: http://localhost:3000/login
5. Espera a que cargue
6. Observa visualmente:
   - ¿Ves algún flash de tenant dashboard?
   - ¿Ves algún flash de sidebar?
   - ¿O solo ves login form?
7. Haz login como TENANT_ADMIN
8. Observa:
   - ¿Transición suave a /{tenantId}/dashboard?
   - ¿Sin flicker?
9. En Console:

   // Verifica que status fue 'loading' durante transición
   fetch('http://localhost:3000/api/debug/auth-status').catch(() => {})
```

**Esperado**:
```
✅ Solo ves login form (sin tenant UI flash)
✅ Transición suave a dashboard
✅ Sin flicker de contenido equivocado
```

**Resultado**:
- [ ] ✅ PASS - Sin flicker visible
- [ ] ❌ FAIL - Viste flicker
- Notas: _____________________

---

### Test 3: No API Requests During Loading

**Objetivo**: Verificar que NO hay requests a endpoints de tenant durante loading

**Pasos**:
```
1. Clear LocalStorage
2. Open DevTools Network tab (F12 → Network)
3. Filter by XHR (para ver API calls)
4. Navega a: http://localhost:3000/login
5. Login como TENANT_ADMIN
6. Observa Network tab:

   Busca requests a:
   - /tenants/*/buildings ❌ (no debería haber)
   - /tenants/*/units ❌ (no debería haber)
   - /auth/me ✅ (debería haber)

   El flujo debería ser:
   1. POST /auth/login
   2. GET /auth/me (restaurar sesión)
   3. Redirect a /{tenantId}/dashboard
   4. [Ahora sí] GET /tenants/{id}/buildings
```

**Esperado**:
```
Durante loading:
✅ Solo /auth/me call
❌ Sin /tenants/*/buildings
❌ Sin /tenants/*/units

Después de loading:
✅ /tenants/{id}/buildings (si la página lo necesita)
```

**Resultado**:
- [ ] ✅ PASS - Requests correctas
- [ ] ❌ FAIL - Requests equivocadas durante loading
- Requests inesperadas encontradas: _____________________

---

### Test 4: Refresh Dashboard (No Lost Context)

**Objetivo**: Refresh en /{tenantId}/dashboard NO pierde tenantId

**Pasos**:
```
1. Estás en: http://localhost:3000/{tenantId}/dashboard
2. DevTools Console:

   // Antes de refresh, log estado
   const beforeRefresh = {
     url: window.location.href,
     tenantId: new URLSearchParams(window.location.search).get('tenantId')
   };
   console.log('Before refresh:', beforeRefresh);
3. Presiona F5 (refresh)
4. Espera a que cargue completamente
5. Console:

   const afterRefresh = {
     url: window.location.href,
     hasSession: !!localStorage.getItem('bo_auth_session'),
     tenantId: new URLSearchParams(window.location.search).get('tenantId')
   };
   console.log('After refresh:', afterRefresh);
```

**Esperado**:
```
✅ URL igual antes y después
✅ tenantId mantenido
✅ Session presente
✅ Data cargada desde API (no localStorage)
```

**Resultado**:
- [ ] ✅ PASS - Context mantenido
- [ ] ❌ FAIL - Context perdido
- Notas: _____________________

---

### Test 5: SUPER_ADMIN → /super-admin (No Tenant Flicker)

**Objetivo**: SUPER_ADMIN nunca ve flicker de tenant UI

**Pasos**:
```
1. Clear localStorage
2. Open: http://localhost:3000/login
3. Login como SUPER_ADMIN (si existe)
   O fuerza una sesión SUPER_ADMIN en console:

   // Hack para testing (solo testing!)
   const mockSession = {
     user: { id: 'su1', email: 'sa@test.com', name: 'Admin' },
     memberships: [
       { tenantId: 'test-tenant', roles: ['SUPER_ADMIN'] }
     ],
     activeTenantId: 'test-tenant'
   };
   localStorage.setItem('bo_auth_session', JSON.stringify(mockSession));
   location.reload();
4. Observa visualmente mientras carga:
   - ¿Ves building/units UI?
   - ¿Ves tenant sidebar?
   - ¿O solo neutral loader?
5. Espera a que cargue /super-admin
6. Verifica URL: debe estar en /super-admin
```

**Esperado**:
```
✅ Durante loading: neutral background (no tenant UI)
✅ No flicker de buildings/units
✅ Final URL: /super-admin
✅ Ves control plane UI
```

**Resultado**:
- [ ] ✅ PASS - Sin flicker tenant UI
- [ ] ❌ FAIL - Viste flicker de tenant content
- Notas: _____________________

---

### Test 6: API Validation (Missing TenantId)

**Objetivo**: Verificar que API throws error si falta tenantId

**Pasos**:
```
1. Estás autenticado en /{tenantId}/buildings
2. Console:

   // Importa el API service
   const { fetchBuildings } = await import(
     '@/features/buildings/services/buildings.api'
   );

   // Intenta sin tenantId
   try {
     await fetchBuildings('');
   } catch (err) {
     console.error('Expected error:', err.message);
   }

   // Intenta con tenantId válido
   try {
     await fetchBuildings('valid-tenant-id');
     console.log('Success!');
   } catch (err) {
     console.error('Unexpected error:', err.message);
   }
```

**Esperado**:
```
✅ fetchBuildings('') → Error: "Missing tenantId"
✅ fetchBuildings('valid-id') → Request made (or API error 403, but request made)
```

**Resultado**:
- [ ] ✅ PASS - Validation funciona
- [ ] ❌ FAIL - Sin validación o validación incorrecta
- Notas: _____________________

---

### Test 7: Deep Link Refresh (buildings/{buildingId}/units)

**Objetivo**: Refresh en ruta profunda mantiene todo

**Pasos**:
```
1. Navega a: http://localhost:3000/{tenantId}/buildings/{buildingId}/units
2. Observa que carga correctamente (units visibles)
3. DevTools Network: Verifica que se hace:
   - GET /tenants/{tenantId}/buildings/{buildingId}/units
4. Presiona F5 (refresh)
5. Espera a que cargue
6. Verifica:
   - URL igual
   - Data reloaded from API
   - No errors en console
```

**Esperado**:
```
✅ URL mantenida
✅ Data reloaded (no localStorage)
✅ Units visible después de refresh
✅ No errors
```

**Resultado**:
- [ ] ✅ PASS - Deep link refresh funciona
- [ ] ❌ FAIL - Problemas con deep link
- Notas: _____________________

---

### Test 8: Console Clean (No Errors)

**Objetivo**: Verificar que no hay errors relacionados a tenantId

**Pasos**:
```
1. Ejecuta todas las pruebas anteriores
2. Al final, abre Console (F12)
3. Busca:
   - ❌ "Missing tenantId"
   - ❌ "Cannot read property of undefined"
   - ❌ "tenantId is required"
   - ✅ Solo logs normales
```

**Esperado**:
```
Console limpia
No errors relacionados a auth/tenantId
```

**Resultado**:
- [ ] ✅ PASS - Console limpia
- [ ] ❌ FAIL - Errores encontrados
- Errores: _____________________

---

## 📊 Summary Checklist

| Test | Objetivo | Resultado |
|------|----------|-----------|
| 1 | Loading state progresa | [ ] ✅ / [ ] ❌ |
| 2 | Sin flicker durante login | [ ] ✅ / [ ] ❌ |
| 3 | No requests durante loading | [ ] ✅ / [ ] ❌ |
| 4 | Refresh dashboard OK | [ ] ✅ / [ ] ❌ |
| 5 | SA no ve tenant flicker | [ ] ✅ / [ ] ❌ |
| 6 | API valida tenantId | [ ] ✅ / [ ] ❌ |
| 7 | Deep link refresh funciona | [ ] ✅ / [ ] ❌ |
| 8 | Console limpia | [ ] ✅ / [ ] ❌ |

**Total**: ___/8 PASS

---

## 🎯 Acceptance Criteria

✅ **PASS SI**:
- [ ] Todos 8 tests PASS
- [ ] Sin flicker visible
- [ ] No API calls durante loading
- [ ] Console limpia

❌ **FAIL SI**:
- [ ] Algún test FAIL
- [ ] Flicker visible
- [ ] API calls sin tenantId
- [ ] Errores en console

---

## 📝 Final Notes

```
Flicker observado: ___________________________________
Requests inesperadas: ___________________________________
Errores de console: ___________________________________
Recomendaciones: ___________________________________
```

---

**Status**: [ ] ALL PASS → Ready for Phase 2 / [ ] SOME FAIL → Document issues

