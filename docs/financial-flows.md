# Flujo Financiero: Facturas y Pagos

## Proposito
Este documento define la semantica del flujo financiero entre unidades y administracion:
la administracion emite facturas, la unidad reporta el pago con comprobante, y la
administracion confirma o rechaza. La UI debe reflejar esta direccion sin ambiguedad.

## Flujo principal
1. Administracion emite factura a la unidad.
2. Unidad recibe la factura con estado "pendiente de pago".
3. Unidad reporta el pago por transferencia y adjunta comprobante.
4. Administracion revisa el pago y lo confirma o rechaza.
5. Unidad ve el estado final: "pago confirmado" o "pago rechazado".

## Estados y etiquetas (UI)
| Estado interno | Unidad | Administracion |
| --- | --- | --- |
| PENDING | En revision | Pendiente de confirmacion |
| APPROVED | Pago confirmado | Confirmado |
| REJECTED | Pago rechazado | Rechazado |

## Responsabilidades por rol

### Administracion
- Emite facturas y define montos.
- Valida comprobantes y confirma/rechaza pagos.
- Visualiza los pagos confirmados como ingresos.

### Unidad
- Recibe facturas y registra pagos.
- Adjunta comprobantes o referencias de transferencia.
- Visualiza pagos confirmados como egresos.

## Glosario
- Factura: cargo emitido por administracion para una unidad.
- Pago reportado: pago informado por la unidad con comprobante.
- Pago confirmado: pago validado por administracion.
- Pago rechazado: pago no validado por administracion.
