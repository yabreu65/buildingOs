# ADR-003: AI observability `resolvedPath` governance

Fecha: 2026-05-01 (America/Argentina/Buenos_Aires)
Estado: PROPOSED
Autores: Architecture / AI Platform
Relacionado: `docs/architecture/ai-architecture-review.md`, `docs/architecture/local-decisions.md`, `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/assistant-turn-metadata.ts`

---

## Contexto

BuildingOS integra el assistant operativo con `yoryi-ai-core`.

- BuildingOS actúa como bridge/app/API/UI/Ops.
- `yoryi-ai-core` actúa como engine de orquestación, Intent Library, matcher y tools.
- La precedencia operativa sigue siendo:

```text
Prechecks → Intent Library → P0 → P1 → P2B → P2 → P3(flag) → fallbacks → HITL
```

Durante la consolidación de arquitectura apareció `resolvedPath` como campo útil para observabilidad porque permite distinguir rutas de resolución más explícitas que `resolvedLevel` y `fallbackPath` por separado.

El estado real del código al momento de este ADR es:

- `resolvedPath` existe técnicamente en `yoryi-ai-core` como enum de observabilidad en `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/observability/enums.ts`.
- `resolvedPath` **no** forma parte del type estable `AssistantTurnCompletedMetadata` en `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/assistant-turn-metadata.ts`.
- BuildingOS no expone `resolvedPath` en la metadata principal del bridge en `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/yoryi-bridge.mapper.ts`.
- Los tests de contrato actuales verifican que `resolvedPath`, `matchedUtterance` y `topCandidates` no estén en metadata estable:
  - `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/__tests__/assistant-turn-metadata.contract.spec.ts`
  - `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/yoryi-bridge.mapper.spec.ts`

Promover `resolvedPath` a contrato estable sin ADR aceptado generaría drift cross-repo: BuildingOS y `yoryi-ai-core` podrían interpretar distinto valores como `intent_library`, `p0`, `p1`, `p2b`, `p2`, `p3`, `fallback`, `bridge_blocked` o `hitl`.

## Decisión propuesta

Aceptar este ADR **no** convierte `resolvedPath` en contrato estable inmediato.

La decisión propuesta es:

1. `resolvedPath` queda reconocido como concepto canónico de observabilidad AI, pero **bloqueado fuera del contrato estable** hasta completar rollout versionado.
2. Mientras este ADR esté en `PROPOSED`, `resolvedPath` no debe ser requerido, publicado ni consumido como metadata estable por BuildingOS, UI, Ops o clientes externos.
3. Si `resolvedPath` se emite antes del rollout final, debe vivir sólo en metadata experimental/debug/canary y no en el type principal.
4. La derivación canónica de `resolvedPath`, cuando se habilite, debe vivir en `yoryi-ai-core`; BuildingOS sólo debe mapear/consumir el valor y no duplicar lógica de decisión.
5. `matchedUtterance` y `topCandidates` quedan fuera del contrato principal de forma permanente; sólo pueden existir como debug/canary.
6. La promoción de `resolvedPath` a campo estable requiere PR separado, tests cross-repo y versión explícita de contrato.

## Stable contract metadata

Estos campos sí pertenecen al contrato estable cross-repo actual, según `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/assistant-turn-metadata.ts` y el mapper de BuildingOS en `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/yoryi-bridge.mapper.ts`:

- `traceId`
- `timestamp`
- `tenantId`
- `userId`
- `role`
- `buildingId`
- `unitId`
- `resolvedLevel`
- `resolvedIntentCode`
- `toolName`
- `fallbackPath`
- `gatewayOutcome`
- `latencyMsTotal`
- `latencyMsRouting`
- `latencyMsGateway`
- `p0EnforcementEnabled`
- `p3Enabled`
- `intentLibraryMatched`
- `intentLibraryConfidence`
- `intentLibraryIntentCode`
- `clarificationAsked`
- `missingEntities`
- `defaultsApplied`
- `familyChosen`

Notas de compatibilidad:

- Algunos campos son opcionales por tipo o por disponibilidad runtime; su presencia depende del path real de resolución.
- `familyChosen` sí es metadata estable porque forma parte del contrato de familias/matcher.
- `resolvedPath` no está en esta lista y no debe agregarse al contrato estable por este ADR sin rollout separado.

## Debug-only metadata

Estos campos no pertenecen al contrato estable ni deben vivir en el type principal:

- `matchedUtterance`
- `topCandidates`

Reglas:

- Sólo pueden exponerse bajo un contenedor de debug/canary, por ejemplo `debug`.
- No deben ser requeridos por BuildingOS, UI, Ops ni tests de contrato estable.
- No deben usarse para decisiones funcionales de negocio.
- Pueden usarse para diagnóstico, QA controlado y análisis de matcher.

## Pending ADR / pending rollout

`resolvedPath` queda en estado pendiente de rollout contractual.

Reglas hasta que exista implementación aprobada:

- Puede existir como enum técnico en `yoryi-ai-core`; eso **no** lo convierte en contrato estable.
- No puede ser obligatorio en `AssistantTurnCompletedMetadata`.
- No puede ser obligatorio en el mapper de BuildingOS.
- No puede ser requerido por dashboards/ops productivos.
- No puede modificar el comportamiento visible del assistant.

Para consolidarlo como contrato estable se requiere:

1. Definición final del enum y semántica de cada valor.
2. PR en `yoryi-ai-core` agregándolo primero como opcional/versionado.
3. PR en BuildingOS consumiéndolo sin romper compatibilidad.
4. Tests de contrato cross-repo con y sin `resolvedPath`.
5. Actualización de documentación de arquitectura/local decisions.
6. Promoción a requerido sólo en una versión explícita de contrato.

## Alternativas consideradas

### Alternativa A — Promover `resolvedPath` ahora como obligatorio

Pros:

- Mejora observabilidad inmediatamente.
- Simplifica dashboards con una dimensión única de ruta.

Contras:

- Congela un enum cross-repo sin rollout versionado.
- Obliga a BuildingOS y `yoryi-ai-core` a coordinar semántica y compatibilidad antes de cerrar gobierno.
- Puede romper consumidores si se agregan valores sin versión de contrato.

Decisión: rechazada.

### Alternativa B — No usar `resolvedPath` nunca

Pros:

- Menos superficie contractual.
- `resolvedLevel` + `fallbackPath` ya cubren el contrato estable actual.

Contras:

- Observabilidad operacional queda más difícil de consultar.
- HITL/bridge/fallback requieren lógica derivada repetida si se necesita una dimensión única.

Decisión: rechazada.

### Alternativa C — Reconocer `resolvedPath`, pero mantenerlo fuera del contrato estable hasta rollout versionado

Pros:

- Evita mentir en el contrato.
- Mantiene runtime actual compatible.
- Permite estabilizar families/defaults/QA sin mezclar un cambio contractual de observabilidad.
- Define un camino claro para convertirlo en estable después.

Contras:

- Dashboards no pueden depender todavía de `resolvedPath`.
- Hay que seguir usando `resolvedLevel`, `fallbackPath` y `gatewayOutcome` por ahora.

Decisión: seleccionada.

## Alcance cross-repo

### BuildingOS

No se requieren cambios runtime para aprobar este ADR en estado `PROPOSED`.

Paths de referencia:

- `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/yoryi-bridge.mapper.ts`
- `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/yoryi-bridge.mapper.spec.ts`
- `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/assistant.service.ts`
- `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/ops/metrics/*`
- `/Users/yoryiabreu/proyectos/buildingos/docs/architecture/local-decisions.md`

Reglas:

- BuildingOS no debe exigir `resolvedPath` antes del rollout versionado.
- El bridge debe seguir funcionando con `resolvedLevel`, `resolvedIntentCode`, `familyChosen`, `fallbackPath`, `gatewayOutcome`, `missingEntities` y `defaultsApplied`.
- UI/Ops no deben inventar ni derivar `resolvedPath` localmente.
- Si en el futuro se consume `resolvedPath`, BuildingOS debe aceptar ausencia del campo durante la ventana de compatibilidad.

### yoryi-ai-core

No se requieren cambios runtime para aprobar este ADR en estado `PROPOSED`.

Paths de referencia:

- `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/assistant-turn-metadata.ts`
- `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/observability/enums.ts`
- `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos.adapter.ts`
- `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/__tests__/assistant-turn-metadata.contract.spec.ts`

Reglas:

- `yoryi-ai-core` mantiene la autoridad semántica de rutas de resolución.
- El enum técnico puede existir, pero no debe publicarse como required en metadata estable antes del rollout.
- Cualquier emisión experimental debe quedar separada del contrato principal.

## Compatibilidad

- El estado actual es backward compatible porque `resolvedPath` no es requerido.
- Consumidores existentes siguen usando `resolvedLevel`, `resolvedIntentCode`, `familyChosen`, `fallbackPath`, `gatewayOutcome`, `missingEntities` y `defaultsApplied`.
- La ausencia de `resolvedPath` debe ser considerada válida.
- Si se agrega después, debe empezar como opcional y no debe cambiar respuestas visibles del assistant.
- La promoción a requerido sólo puede ocurrir con versión explícita de contrato y ventana de migración.

## Rollout

1. Aprobar este ADR como decisión de gobernanza: `resolvedPath` reconocido, pero no estable todavía.
2. Mantener el runtime actual sin cambios funcionales.
3. Mantener tests que prueben compatibilidad sin `resolvedPath`.
4. Definir semántica final del enum y mapping canónico en `yoryi-ai-core`.
5. Implementar PR separado en `yoryi-ai-core` agregando `resolvedPath` como opcional/versionado.
6. Implementar PR separado en BuildingOS para mapearlo de forma tolerante a ausencia.
7. Actualizar tests cross-repo.
8. Actualizar `docs/architecture/local-decisions.md` y documentación de contrato.
9. Promoverlo a requerido sólo en una versión de contrato explícita y con rollback documentado.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Dashboards/ops empiezan a depender de `resolvedPath` experimental | Drift operativo y falsos negativos en monitoreo | Mantenerlo fuera de metadata estable hasta rollout versionado |
| BuildingOS duplica lógica de derivación | Divergencia semántica entre bridge y engine | La derivación canónica vive en `yoryi-ai-core`; BuildingOS sólo consume |
| Confusión entre `resolvedLevel` y `resolvedPath` | Métricas inconsistentes | Documentar `resolvedLevel` como nivel de decisión y `resolvedPath` como ruta operacional futura |
| Promoción implícita por existir enum técnico | Contrato de facto sin governance | Tests y ADR declaran que enum técnico no equivale a contrato estable |
| Consumidores rompen por ausencia del campo | Error de compatibilidad | `resolvedPath` debe ser opcional primero y requerido sólo con versión explícita |

## Criterios de aceptación

Este ADR queda listo para pasar a `ACCEPTED` cuando se valide que:

- La decisión no amplía el contrato estable actual con `resolvedPath`.
- La lista de stable metadata está documentada explícitamente.
- `matchedUtterance` y `topCandidates` están documentados como debug-only y fuera del type principal.
- El ADR reconoce que `RESOLVED_PATHS` puede existir como enum técnico sin ser contrato estable.
- El rollout exige PR separado, tests cross-repo y versionado antes de cualquier promoción estable.
- BuildingOS y `yoryi-ai-core` mantienen compatibilidad cuando `resolvedPath` está ausente.

## Rollback / Plan B

Si la futura promoción de `resolvedPath` genera drift:

- Mantener `resolvedLevel`, `resolvedIntentCode`, `familyChosen`, `fallbackPath` y `gatewayOutcome` como fuente estable.
- Remover `resolvedPath` del mapper estable o dejarlo sólo como opcional/debug.
- Mantener cualquier emisión experimental sólo en debug/canary.
- Revertir dashboards a dimensiones estables existentes.

## Referencias

- `/Users/yoryiabreu/proyectos/yoryi-core-architecture/constitution/architecture-principles.md`
- `/Users/yoryiabreu/proyectos/yoryi-core-architecture/constitution/decision-policy.md`
- `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/ai/runtime/ai-ops-observability.md`
- `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/ai/agents/tool-contracts.md`
- `/Users/yoryiabreu/proyectos/buildingos/docs/architecture/current-state.md`
- `/Users/yoryiabreu/proyectos/buildingos/docs/architecture/constraints.md`
