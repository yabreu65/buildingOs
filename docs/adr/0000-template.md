# ADR-0000: <Título corto de la decisión>

Fecha: YYYY-MM-DD (America/Argentina/Buenos_Aires)  
Estado: PROPOSED | ACCEPTED | DEPRECATED | SUPERSEDED  
Autores: <Tu nombre / Equipo>  
Relacionado: PRODUCT_DECISIONS.md, ROADMAP.md, STATUS.md

---

## Contexto
Describir el problema/decisión y por qué importa (1–2 párrafos).
- Qué necesidad del negocio o restricción técnica lo genera
- Qué módulos impacta (auth, payments, tickets, etc.)
- Qué riesgos o costos evita

## Decisión
Escribir la decisión final en bullets claros y no ambiguos.
- Qué se hace
- Qué no se hace
- Qué queda fuera del alcance

## Opciones consideradas
### Opción A (seleccionada o no)
- Descripción
- Pros
- Contras
- Riesgos

### Opción B
- Descripción
- Pros
- Contras
- Riesgos

### Opción C (si aplica)

## Justificación
Por qué esta decisión es la mejor para BuildingOS (multi-tenant, escalable, monetizable, LATAM).
- Impacto en time-to-market
- Impacto en mantenimiento
- Impacto en seguridad / aislamiento

## Reglas de negocio (no negociables)
Lista de reglas concretas que dev debe implementar tal cual.
Ejemplos:
- Todo dato de dominio lleva tenant_id
- Resident solo accede por unit_memberships
- PaymentSubmission no baja deuda hasta APPROVED

## Implicaciones técnicas
Qué cambia en:
- Base de datos (tablas/índices/RLS)
- API (endpoints/guards/permisos)
- Front (rutas/estado/feature flags)
- Infra (jobs, storage, emails)

## Plan de implementación
Pasos accionables (máx 5–10):
1)
2)
3)

## Criterios de aceptación (DoD)
Cómo sabemos que está “listo”.
- Tests mínimos
- Flujos manuales
- Métricas o logs

## Rollback / Plan B
Qué hacemos si sale mal.
- Cómo revertir
- Qué se rompe
- Cómo mitigamos

## Referencias
- Links internos (PRs, docs)
- Notas/decisiones previas
