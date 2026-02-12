# AGENT — Repo Root (BuildingOS)

## Propósito
Este repositorio contiene **BuildingOS**, un único SaaS multi-tenant para gestión de edificios/condominios/comunidades.
Este archivo define las **reglas globales** del producto y del desarrollo que aplican a TODO el repo.

> Fuente de verdad de negocio: `product_decision/`
> Fuente de verdad operativa por módulo: `<carpeta>/AGENT.md`

---

## Arquitectura por capas (orden obligatorio)
Implementamos y validamos **de arriba hacia abajo**:

1) **SUPER_ADMIN** (SaaS Owner)
2) **TENANT_OWNER / TENANT_ADMIN** (Backoffice del tenant)
3) **OPERATOR** (Operativo)
4) **RESIDENT** (Portal/App del residente)

**Regla:** No se baja a la siguiente capa hasta cerrar la anterior con:
- reglas definidas en `product_decision/`
- MVP funcional
- QA checklist PASS

---

## Multi-tenancy (regla crítica)
- Un **Tenant** representa una organización cliente del SaaS.
- Tipos de tenant:
  - `ADMINISTRADORA`
  - `EDIFICIO_AUTOGESTION`
- Aislamiento: **todos los datos están aislados por tenant** (usuarios, edificios, unidades, pagos, reclamos, comunicaciones).
- Nunca permitir cross-tenant access.

---

## Roles del sistema (global)
- `SUPER_ADMIN`: dueño del SaaS (control total)
- `TENANT_OWNER`: responsable máximo del tenant
- `TENANT_ADMIN`: administra edificios dentro del tenant
- `OPERATOR`: usuario operativo
- `RESIDENT`: usuario final asociado a una unidad

Un usuario puede tener múltiples roles dentro de su tenant.

---

## Principios de diseño (obligatorios)
- No duplicar lógica por tipo de tenant.
- No hardcode por tamaño del cliente.
- Resolver con configuración + permisos, no con ramas especiales.
- El sistema debe escalar: edificio chico → administradora con cientos de edificios.

---

## Contratos de dominio (globales)
### Entities mínimas (conceptual)
- Tenant → Buildings → Units → UnitResidents → Users
- **Unit no guarda `residentName`** (texto libre está prohibido).
- Asignación residente se hace vía relación histórica:
  - `UnitResident` con `startAt` y `endAt` (historial).

### Unicidad (global)
- `Unit.label` único por `buildingId` (normalizado `trim + lowercase`).
- `Unit.unitCode` único por `buildingId` si existe.

---

## Estructura del repo (esperada)
- `frontend/` → UI Web (ver `frontend/AGENT.md`)
- `api/` → Backend (ver `api/AGENT.md`)
- `infra/` → CI/CD + envs (ver `infra/AGENT.md`)
- `product_decision/` → decisiones de producto y reglas de negocio (source of truth)

*(Si la estructura difiere, actualizar esta sección.)*

---

## Documentación y fuentes de verdad
- Reglas de negocio y decisiones: `product_decision/`
- Reglas operativas por módulo: `*/AGENT.md`
- Checklist QA de features: dentro de cada feature o en `product_decision/qa/`

**Regla:** si cambia una regla de negocio:
1) actualizar `product_decision/`
2) actualizar el `AGENT.md` relevante
3) recién después cambiar código

---

## Checklist global de PR (Definition of Done)
- [ ] Respeta multi-tenancy (scoping por tenant)
- [ ] Respeta roles/permisos (RBAC)
- [ ] No introduce lógica duplicada por tipo de tenant
- [ ] No agrega strings libres donde van relaciones (ej. residentName)
- [ ] Incluye evidencia QA (según checklist)
- [ ] Documentación actualizada si cambia reglas/contratos

---

## Owners / Review
- Product Owner: PM (BuildingOS)
- Tech Lead: (definir)
- Owners por carpeta: ver `frontend/AGENT.md`, `api/AGENT.md`, `infra/AGENT.md`

---

## Nota
Este archivo es la “constitución” del repo.
Cualquier excepción debe ser explícita y registrada en `product_decision/`.

