# BuildingOS Product Exceptions

## Proposito

Registrar excepciones locales temporales a doctrina global, con control estricto.

## Estado actual

No hay excepciones activas al 2026-04-23.

## Formato obligatorio para nuevas excepciones

| ID | Excepcion | Motivo | Owner | ADR | Expira | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| BLD-EXC-XXXX | <descripcion puntual> | <razon tecnica/negocio> | <rol/persona> | <ADR-ID> | <YYYY-MM-DD> | proposed/active/expired |

## Reglas

- Toda excepcion requiere ADR.
- Toda excepcion tiene fecha de expiracion obligatoria.
- Excepcion sin owner o sin expiracion = invalida.
- Excepcion vencida debe cerrarse o renovarse con nueva ADR.

## Criterio de uso

Una excepcion solo aplica si:
1. existe conflicto real entre doctrina y restriccion local no evitable,
2. hay plan de salida,
3. el riesgo esta explicitamente aceptado.

## Politica de limpieza

Revision mensual:
- remover excepciones expiradas,
- verificar que no se transformen en doctrina local permanente.
