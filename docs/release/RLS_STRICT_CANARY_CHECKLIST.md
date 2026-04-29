# RLS Strict Canary Checklist

Checklist operativo para activar `app.rls_mode = strict` en canary (staging -> piloto) sin frenar el SaaS.

## 1) Pre-checks (antes de activar)

- [ ] Migraciones RLS aplicadas en entorno objetivo.
- [ ] `arch:check-tenant-header` en verde.
- [ ] `resolveTenantId` aplicado en los módulos a canarizar.
- [ ] Smoke tests funcionales del dominio en verde (tickets/reportes/finanzas).
- [ ] Dashboard de errores/latencia monitoreando endpoints canary.

## 2) Staging canary

- [ ] Seleccionar un tenant de staging para prueba estricta.
- [ ] Ejecutar consultas de verificación:

```sql
SELECT set_config('app.rls_mode', 'strict', true);
SELECT set_config('app.tenant_id', '<tenant-id>', true);
SELECT current_setting('app.rls_mode', true), current_setting('app.tenant_id', true);
```

- [ ] Confirmar que strict sin `app.tenant_id` no devuelve datos tenant-scoped.
- [ ] Confirmar que strict con `app.tenant_id` devuelve solo rows del tenant.
- [ ] Correr smoke e2e sobre rutas críticas del tenant.

## 3) Pilot production (tenant controlado)

- [ ] Definir owner de guardia para ventana de activación.
- [ ] Activar strict solo para tenant piloto.
- [ ] Observar durante 24h:
  - [ ] 4xx/5xx por endpoint crítico
  - [ ] latencia p95
  - [ ] reportes de acceso denegado inesperado
- [ ] Confirmar 0 incidentes cross-tenant y 0 degradación material.

## 4) Rollback rápido

Si hay regresión, ejecutar:

```sql
SELECT set_config('app.rls_mode', 'permissive', true);
```

- [ ] Restaurar servicio.
- [ ] Abrir incidente técnico con query-path afectado y acción correctiva.

## 5) Criterio de promoción

- [ ] 2 ciclos canary exitosos sin incidentes críticos.
- [ ] Tests de seguridad RLS en CI en verde.
- [ ] Aprobación de arquitectura para ampliar alcance.
