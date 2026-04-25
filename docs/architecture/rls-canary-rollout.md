# RLS Canary Rollout

Guia operativa para endurecer RLS en modo gradual sin cortar entrega funcional.

## Objetivo

Activar RLS en `strict` por canary y validar que no exista acceso cross-tenant.

## Estado base

- RLS policies habilitadas para tablas piloto (`Ticket`, `Charge`, `Payment`, `PaymentAllocation`).
- Modo por defecto: `permissive`.
- Toggle disponible via `app.rls_mode` (`permissive` / `strict`).

## Secuencia recomendada

1. Verificar que tenant context app-side este centralizado en el modulo a canarizar.
2. Ejecutar smoke tests de negocio del modulo en `permissive`.
3. Ejecutar canary en `strict` (solo tenant/scope controlado).
4. Revisar errores de permisos, consultas vacias inesperadas y latencia.
5. Si hay incidentes, volver a `permissive` y corregir query-path.

## Comandos SQL de referencia

```sql
-- activar strict en sesion actual
SELECT set_config('app.rls_mode', 'strict', true);

-- fijar tenant para sesion actual
SELECT set_config('app.tenant_id', '<tenant-id>', true);

-- confirmar valores actuales
SELECT current_setting('app.rls_mode', true), current_setting('app.tenant_id', true);
```

## Criterios de salida de canary

- 0 hallazgos de cross-tenant en pruebas de integracion.
- 0 regresiones criticas de negocio en flujos principales.
- Error rate estable sin incremento material por `strict`.
- Runbook de rollback probado.

## Rollback

```sql
SELECT set_config('app.rls_mode', 'permissive', true);
```
