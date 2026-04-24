# BuildingOS Local Decisions

Registro de decisiones locales activas para Fase 1.

| ID | Fecha | Decision | Estado | Motivo | Impacto |
| --- | --- | --- | --- | --- | --- |
| BLD-DEC-001 | 2026-04-23 | BuildingOS consume un core doctrinal unico en ruta canonica fija | active | Evitar duplicacion y deriva doctrinal | Repositorio local depende de referencias al core |
| BLD-DEC-002 | 2026-04-23 | Contrato de agentes unico: `AGENTS.md` como fuente operativa local | active | Evitar conflicto entre contratos | Flujo de OpenCode se vuelve determinista |
| BLD-DEC-003 | 2026-04-23 | Carga contextual minima y ordenada (core -> local architecture -> overlays -> dominio) | active | Reducir context explosion | Menos ruido y menos alucinaciones |
| BLD-DEC-004 | 2026-04-23 | Reglas anti-alucinacion obligatorias (`path evidence`, `GAP`, score gate) | active | Mejorar planning/review | Mayor trazabilidad y menor invencion |
| BLD-DEC-005 | 2026-04-23 | Alcance limitado a Fase 1; Fases 2-4 no se ejecutan aun | active | Control incremental y validacion piloto | Evita sobreingenieria temprana |
| BLD-DEC-006 | 2026-04-23 | Resolver tenant context via util central (`resolveTenantId`) en modulos criticos | active | Reducir inconsistencia de autorizacion multi-tenant | Menor riesgo de leakage por extraccion heterogenea |
| BLD-DEC-007 | 2026-04-23 | Introducir RLS piloto gradual en tablas sensibles con modo inicial permisivo | active | Agregar defensa en profundidad sin cortar desarrollo funcional | Base para endurecer aislamiento DB por tandas |
| BLD-DEC-008 | 2026-04-23 | Habilitar modo RLS con toggle (`permissive`/`strict`) para rollout canary | active | Endurecer aislamiento por etapas y con rollback rapido | Permite activar strict sin migracion big-bang |
| BLD-DEC-009 | 2026-04-24 | Cronjobs operativos quedan deshabilitados por defecto (opt-in por flags/env y trigger manual solo admin) | active | Evitar decisiones automáticas no aprobadas por administración del condominio | Reduce envíos no deseados y obliga activación explícita de automatizaciones |
| BLD-DEC-010 | 2026-04-24 | Enforcement runtime P0 del assistant: yoryi primario, bloqueo de knowledge fallback y tools internos con schema versionado | active | Garantizar respuestas operativas deterministas, tenant-safe y auditables | Menos deriva de respuestas y mayor control de fallback por disponibilidad |

## Decisiones pendientes (open)

| ID | Tema | Estado | Responsable |
| --- | --- | --- | --- |
| BLD-OPEN-001 | Ruta canonica final en todos los entornos (usuario/path) | open | Architecture |
| BLD-OPEN-002 | Consolidacion de mapa de bounded contexts local | open | Backend Architecture |

## Regla de mantenimiento

- Toda decision nueva D1/D2 local se agrega aqui.
- Si afecta politica global, elevar ADR segun `decision-policy` del core.
