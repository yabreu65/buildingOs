# AI Support Playbook

Version: 1.0  
Last updated: 2026-02-19  
Owner: Soporte + Operaciones + Billing

## 0) Objetivo y alcance
Este playbook estandariza la operación de soporte de IA para BuildingOS en cuatro frentes:
- resolver tickets rápido,
- decidir override temporal vs upgrade de plan,
- controlar costo y abuso,
- mantener auditoría y trazabilidad.

Aplica a casos de límites de IA, upgrade de plan, degradación de performance y errores de provider.

## 1) Definiciones
### 1.1 AI Budget (cents/mes)
Límite monetario mensual estimado de consumo IA por tenant, expresado en centavos. Cuando se supera, se activa protección de gasto (`AI_BUDGET_EXCEEDED`).

### 1.2 AI Calls limit (calls/mes)
Cantidad máxima mensual de llamadas IA permitidas por tenant. Cuando se supera, se activa límite de volumen (`AI_CALLS_LIMIT_EXCEEDED`).

### 1.3 Soft degrade vs hard stop
- Soft degrade: se permite continuar con restricciones (modelo pequeño, menor `maxTokens`, cache forzado, respuestas más cortas).
- Hard stop: se bloquea la ejecución IA para evitar sobrecosto o abuso.

### 1.4 Small vs Big model
- Small model: menor costo por request, menor latencia, menor calidad contextual.
- Big model: mayor costo por request, mejor razonamiento/contexto en escenarios complejos.

### 1.5 Cache hit rate
Porcentaje de requests IA resueltas desde cache. Mayor `cacheHitRate` implica menor costo y menor latencia.

### 1.6 AI caps efectivos (plan + overrides)
Límites que realmente aplica enforcement:
- base del plan (`planCaps`),
- más override activo de tenant (`tenantOverrides`) si no venció,
- resultado final (`effectiveCaps`).

## 2) Flujos de soporte (runbooks)

## A) Tenant llegó al límite IA
### Diagnóstico
1. Consultar estado del tenant:
   - `GET /super-admin/ai/tenants/:tenantId?month=YYYY-MM` (si está habilitado en tu entorno), o
   - `GET /super-admin/tenants/:tenantId/ai/caps` para plan/override/efectivo.
2. Revisar métricas del mes:
   - `percentUsed`
   - `calls`
   - `estimatedCost`
   - `bigCallRate`
   - `cacheHitRate`
3. Validar si hay override activo y fecha de expiración.

### Decisión
1. Si `percentUsed < 100%`:
   - no corresponde bloqueo por límite,
   - tratar como bug/permisos/scope,
   - escalar a troubleshooting técnico.
2. Si `percentUsed >= 100%` y plan `PRO` o superior:
   - ofrecer override temporal hasta fin de mes,
   - default: `+20%` budget o `+200` calls,
   - si ocurre 2 meses consecutivos: recomendar upgrade obligatorio.
3. Si plan `BASIC`:
   - priorizar upgrade a `PRO`,
   - no otorgar override salvo excepción aprobada (cliente estratégico/incidente previo imputable a plataforma).
4. Si plan `FREE`:
   - IA fuera de alcance comercial,
   - ofrecer upgrade.

### Acción
1. Override temporal (si aplica):
   - `PATCH /super-admin/tenants/:tenantId/ai/caps`
   - body sugerido:
```json
{
  "monthlyBudgetCents": 120000,
  "monthlyCallsLimit": 1200,
  "allowBigModelOverride": true,
  "overrideReason": "Support overage exception: +20% until month end",
  "overrideExpiresAt": "2026-02-29T23:59:59.999Z"
}
```
2. Reset a plan (si se corrige o fue error):
   - `POST /super-admin/tenants/:tenantId/ai/caps/reset`
3. Si corresponde monetización:
   - crear o guiar `PlanChangeRequest` desde tenant.

### Auditoría esperada
- `AI_TENANT_OVERRIDE_UPDATED`
- `AI_TENANT_OVERRIDE_RESET` (si se vuelve a plan)
- `PLAN_CHANGE_REQUESTED` (si tenant solicita upgrade)

## B) Tenant pide upgrade
### Confirmación mínima
1. Plan actual y plan solicitado.
2. Motivo principal:
   - caps IA,
   - edificios,
   - usuarios,
   - exportables/reporting.
3. Validar impacto esperado y urgencia (operación detenida vs mejora incremental).

### Acción
1. Aprobar `PlanChangeRequest` cuando hay justificación operativa/comercial.
2. Si el flujo requiere pago por transferencia:
   - enviar instrucciones de pago,
   - definir fecha efectiva de cambio,
   - dejar evidencia en ticket.

### Auditoría
- `PLAN_CHANGE_APPROVED`
- `SubscriptionEvent: PLAN_CHANGED_MANUAL`

## C) Consumo anormal / abuso
### Señales
- `bigCallRate` alto fuera de patrón del tenant.
- volumen de calls concentrado en un solo usuario.
- prompts repetitivos con bajo `cacheHitRate`.
- crecimiento abrupto de costo sin crecimiento proporcional de valor.

### Acciones
1. Contención inmediata:
   - `allowBigModelOverride=false`
   - reducir `maxTokens`
   - aplicar soft degrade.
2. Optimización guiada:
   - recomendar templates/prompts reutilizables,
   - sugerir respuestas más cortas y foco en tareas acotadas.
3. Escalamiento de policy:
   - si persiste abuso: suspensión temporal IA (hard stop) y revisión comercial.

## 3) Políticas de overrides
1. Todo override es temporal y expira fin de mes por defecto.
2. No otorgar overrides ilimitados sin cambio de plan.
3. Reglas recomendadas:
   - 1er mes excedido: override de `20%` + recomendaciones de optimización.
   - 2do mes consecutivo: exigir propuesta de upgrade.
   - Enterprise: override permitido con ajuste comercial/contractual.
4. Todo override debe incluir `overrideReason` claro y trazable.
5. Toda excepción fuera de regla debe quedar documentada en ticket + evento de auditoría.

## 4) Plantillas de respuesta (copy/paste)

## 4.1 Límite alcanzado
"Detectamos que alcanzaste el límite mensual de IA de tu plan. Para evitar interrupciones, podemos ayudarte con dos caminos: optimizar consumo ahora mismo o gestionar un upgrade de plan para ampliar capacidad estable."

## 4.2 Override aplicado
"Aplicamos un aumento temporal de cupo de IA vigente hasta fin de mes. Ya podés continuar operando con los nuevos límites efectivos. Este ajuste queda auditado como excepción temporal."

## 4.3 Recomendación de upgrade
"Vemos que tu consumo supera de forma recurrente los límites del plan actual. Para evitar bloqueos futuros y sostener continuidad operativa, te recomendamos pasar al plan superior. Si querés, iniciamos el cambio ahora."

## 4.4 Cómo reducir consumo
"Para bajar costo y mejorar rendimiento, te recomendamos: usar templates repetibles, pedir respuestas más cortas y concentrar consultas en prompts más específicos para maximizar cache y reducir llamadas redundantes."

## 4.5 Fallo de provider
"Estamos detectando un incidente temporal del proveedor de IA (latencia/timeout). Ya iniciamos mitigación y reintento controlado. Te avisamos cuando la estabilidad quede restablecida."

## 5) Troubleshooting técnico para soporte

## 5.1 Errores frecuentes y acción inicial
1. `AI_BUDGET_EXCEEDED`
   - verificar budget efectivo del mes,
   - validar override vigente,
   - revisar consumo estimado y comportamiento de big model.
2. `AI_CALLS_LIMIT_EXCEEDED`
   - verificar límite de calls efectivo,
   - validar explosión de requests por usuario/automatización.
3. `AI_RATE_LIMITED`
   - revisar throttling local y límites de provider,
   - sugerir retry con backoff.
4. `FEATURE_NOT_AVAILABLE`
   - confirmar plan/scope/feature flag,
   - validar permisos del rol.
5. `Provider error / timeout`
   - verificar estado provider,
   - usar fallback o soft degrade,
   - registrar incidente si supera umbral SLO.

## 5.2 Checklist obligatorio
1. Capturar `requestId`.
2. Revisar `AiInteractionLog` del request y del usuario.
3. Validar caps efectivos (`planCaps` + override vigente).
4. Confirmar permisos, scope y rol.
5. Correlacionar con latencia/error rate del provider en la misma ventana temporal.

## 6) KPI internos para monitoreo
1. Costo estimado total del mes.
2. Top 10 tenants por costo IA.
3. Cache hit rate promedio global y por tenant.
4. Distribución `% small` vs `% big`.
5. Templates más usados.
6. Conversiones `warning -> upgrade request`.
7. Overrides emitidos por mes (conteo y costo incremental estimado).

## 7) Scripts operativos de soporte

## 7.1 Script de diagnóstico rápido (5 minutos)
1. Identificar tenant y mes actual (`YYYY-MM`).
2. Consultar caps y consumo.
3. Clasificar: límite real, bug de permisos o incidente provider.
4. Decidir: override temporal, upgrade o troubleshooting técnico.
5. Ejecutar acción y registrar auditoría/ticket.

## 7.2 Script de decisión comercial
1. Si es primer exceso en PRO+: ofrecer override temporal + educación de consumo.
2. Si es segundo exceso consecutivo: promover upgrade como vía principal.
3. Si es BASIC/FREE: upgrade primero, excepción solo con aprobación explícita.
4. Si es Enterprise: continuidad operativa primero, ajuste contractual después.

## 7.3 Script de cierre de ticket
1. Confirmar que el tenant puede operar sin bloqueo.
2. Enviar resumen de acción aplicada + fecha de expiración (si override).
3. Dejar próximos pasos concretos (optimización o upgrade).
4. Validar que existe evento de auditoría asociado.

## 8) Criterios de decisión (resumen ejecutivo)
- Override: continuidad inmediata y temporal (soporte operativo).
- Upgrade: necesidad recurrente o crecimiento estructural (monetización sostenible).
- Control de abuso: proteger costo y estabilidad antes de ampliar capacidad.
- Trazabilidad: toda acción debe ser auditable y con razón explícita.
