# Propuesta: Semantica del flujo de pagos

## Intent

Eliminar la ambiguedad del flujo de pagos: las unidades pagan a la administracion, la administracion emite facturas, confirma pagos, y la unidad ve el pago confirmado. El objetivo es que la UI y la documentacion reflejen esa direccion sin contradicciones.

## Scope

### In Scope
- Actualizar textos, labels y estados en UI para roles unidad/administracion
- Alinear pantallas de facturas y pagos con el flujo: admin emite, admin confirma, unidad verifica
- Ajustar reportes y mensajes para reflejar ingresos (admin) y egresos (unidad)
- Documentar el flujo correcto y ejemplos de estados

### Out of Scope
- Cambios al modelo de datos o reglas de negocio existentes
- Automatizacion de conciliacion o integraciones externas
- Redisenos visuales mayores no relacionados con semantica

## Approach

Inventariar puntos de contacto del flujo de pagos, normalizar terminologia por rol, y actualizar estados/mensajes para que la secuencia factura → pago → confirmacion sea coherente en toda la aplicacion.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/(modules)/payments/` | Modificado | Vistas de pagos y estados visibles para unidad |
| `src/app/(modules)/billing/` | Modificado | Emision de facturas por administracion |
| `src/app/(modules)/admin/` | Modificado | Confirmacion de pagos y paneles de ingresos |
| `src/app/(modules)/finance/reports/` | Modificado | Reportes de ingresos/egresos consistentes |
| `docs/financial-flows.md` | Nuevo/Agregado | Documentacion del flujo y roles |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Confusion residual por habitos previos | Medio | Mensajes claros, tooltips puntuales y comunicacion in-app |
| Terminologia inconsistente entre modulos | Medio | Relevamiento exhaustivo y glosario base |

## Rollback Plan

Revertir textos/estados y documentacion a la version anterior, y validar que no queden referencias a la nueva semantica en UI y reportes.

## Dependencies

- Ninguna dependencia externa requerida

## Success Criteria

- [ ] La administracion puede emitir facturas desde la UI
- [ ] La administracion confirma pagos y ese estado es visible para la unidad
- [ ] La unidad ve el pago confirmado asociado a su factura
- [ ] La UI muestra consistentemente unidades → administracion en todo el sistema
