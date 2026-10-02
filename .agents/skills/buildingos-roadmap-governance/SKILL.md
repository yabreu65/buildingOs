# Skill: BuildingOS Roadmap Governance

## Trigger

Usar esta skill cuando se vaya a:

- iniciar una nueva fase;
- cerrar una fase;
- decidir qué viene después;
- abrir un bloque funcional importante;
- crear una épica;
- proponer un cambio de prioridad;
- decidir si una idea pertenece al roadmap actual;
- evaluar si debe comenzarse WSAP, Multi-Property, Mall, IA, RAG, MCP o Voice.

---

## Objetivo

Actuar como PM técnico y guardián del roadmap de BuildingOS.

Evitar:

- saltar fases;
- duplicar funcionalidades;
- abrir frentes prematuramente;
- perder decisiones tomadas previamente;
- construir funcionalidades fuera de orden;
- romper la regla local-first;
- convertir una conversación temporal en cambio permanente sin actualizar el plan maestro.

---

## Fuente canónica

Antes de decidir o implementar, leer:

```text
docs/BUILDINGOS_MASTER_DEVELOPMENT_PLAN.md
```

También cargar:

- `AGENTS.md`
- el `AGENTS.md` específico del dominio afectado.

---

# Regla crítica

La revisión del roadmap es OBLIGATORIA:

1. **al iniciar una nueva fase**;
2. **al finalizar una fase**.

No basta con revisarlo una sola vez durante la vida del proyecto.

---

# Modo START_PHASE

Cuando se inicia una fase:

## 1. Leer estado actual

Extraer del plan maestro:

- CURRENT_PHASE;
- CURRENT_ORDER;
- NEXT_PHASE;
- outcome;
- scope;
- dependencies;
- entry gates;
- exit gates.

## 2. Verificar la fase anterior

No asumir que está cerrada.

Buscar evidencia:

- tests;
- CI;
- PRs;
- commits;
- staging;
- producción;
- PM verdict.

Si no hay evidencia suficiente:

```text
PREVIOUS_PHASE = NOT_PROVEN_CLOSED
```

No declarar la siguiente formalmente iniciada.

## 3. Verificar alineación

Clasificar el trabajo solicitado como:

```text
IN_PHASE
NEXT_PHASE
FUTURE_PHASE
OUT_OF_ROADMAP
```

## 4. Diseñar el primer slice

Debe ser:

- local-first;
- pequeño;
- verificable;
- reversible;
- con tests;
- sin staging como entorno de desarrollo.

## 5. Salida obligatoria

```text
ROADMAP_REVIEW

current_phase:
previous_phase_closed:
requested_work_alignment:

entry_gates:
dependencies:
risks:

approved_first_slice:
out_of_scope:

next_phase_if_successful:
```

---

# Modo CLOSE_PHASE

Cuando se intenta cerrar una fase:

## 1. Releer el plan maestro

No cerrar desde memoria.

## 2. Recopilar evidencia

Obtener:

- commits;
- PRs;
- local tests;
- build;
- CI;
- E2E;
- staging;
- producción;
- seguridad;
- tenant isolation;
- invariantes financieras cuando aplique.

## 3. Comparar con el gate de salida

Clasificar:

```text
CLOSED
PARTIAL
BLOCKED
```

Nunca usar `CLOSED` por intuición.

## 4. Registrar pendientes

Separar:

```text
BLOCKING
NON_BLOCKING
DEFERRED
TECH_DEBT
```

## 5. Definir la siguiente fase

Solo después del cierre.

No implementar automáticamente la siguiente fase.

## 6. Actualizar el plan maestro

Proponer o aplicar, según autorización:

- estado de la fase;
- evidencia;
- SHA;
- fecha;
- pendientes;
- siguiente fase;
- cambios de prioridad.

## 7. Salida obligatoria

```text
PHASE_CLOSE_REVIEW

phase:
verdict:

delivered:
not_delivered:
deferred:

local_validation:
ci:
staging:
production:

security:
tenant_isolation:
financial_invariants:

remaining_risks:

next_phase:
roadmap_update_required:
```

---

# Criterios de PM

Priorizar trabajo que mejore:

1. seguridad;
2. estabilidad productiva;
3. finanzas;
4. experiencia administrativa;
5. experiencia residente;
6. reducción de trabajo manual;
7. diferenciación competitiva;
8. capacidad Multi-Property;
9. escalabilidad SaaS;
10. IA segura.

No priorizar funciones llamativas por encima de una dependencia crítica.

---

# Estrategia de producto

BuildingOS debe diferenciarse en:

- Financial Core LATAM;
- Multi-Property;
- BuildingOS Mall;
- Maintenance / Operations Core;
- WSAP omnicanal;
- Portfolio Intelligence;
- Secure Agent Kernel.

---

# Reglas arquitectónicas

- WSAP no duplica lógica de negocio.
- La IA no accede directamente a Prisma/PostgreSQL.
- La IA no decide permisos.
- Tenant y scopes vienen de contexto autenticado.
- PostgreSQL es source of truth.
- El core residencial no debe romperse al introducir nuevas verticales.
- PropertyType pertenece a la propiedad, no al tenant.
- Preferir adapters e integraciones a fabricar hardware.
- Reutilizar módulos existentes antes de crear sistemas paralelos.

---

# Metodología

Usar ODD.

Para cada fase/slice definir primero:

```text
OUTCOME
EVIDENCE
CONSTRAINTS
DEPENDENCIES
GATES
```

y después implementación.

No introducir SDD/OpenSpec como metodología de planificación salvo instrucción explícita del propietario.

---

# Regla de escalamiento

Si el propietario solicita algo que contradice el orden del plan:

1. no rechazar automáticamente;
2. explicar qué fase afecta;
3. identificar qué dependencia se estaría saltando;
4. proponer cómo incorporarlo;
5. si el propietario confirma el cambio, actualizar el plan maestro.

---

# Definition of Done de la skill

La skill se considera aplicada correctamente cuando:

- se leyó el plan maestro;
- se identificó la fase actual;
- se comprobó el gate correspondiente;
- se evitó saltar fases accidentalmente;
- se dejó claro qué viene después;
- el roadmap quedó actualizado cuando una fase se cerró o cambió.
