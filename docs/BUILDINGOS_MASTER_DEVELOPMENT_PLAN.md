# BuildingOS — Master Development Plan

> **Fuente canónica del roadmap de producto y desarrollo de BuildingOS**
>
> Este documento define qué estamos construyendo, en qué orden, qué condiciones deben cumplirse antes de avanzar y qué viene después.
>
> **Metodología principal:** ODD (Outcome-Driven Development).
> **No usar SDD/OpenSpec como metodología de planificación de este roadmap salvo instrucción explícita del propietario del proyecto.**

---

## 0. Regla obligatoria de revisión

Este documento DEBE revisarse en dos momentos:

### Al INICIAR una nueva fase
Antes de escribir código, crear una rama o abrir una implementación importante:

1. Leer este documento completo o, como mínimo, las secciones: Estado actual, Fase actual, Gate de entrada, Outcome, Dependencias y Fase siguiente.
2. Confirmar que la fase anterior está formalmente cerrada.
3. Confirmar que el trabajo solicitado pertenece a la fase autorizada.
4. Detectar dependencias o bloqueos.
5. Definir el slice local más pequeño que produzca un resultado verificable.
6. Trabajar primero en LOCAL. Staging y producción nunca son entornos de desarrollo.

### Al FINALIZAR una fase
Antes de declarar una fase cerrada:

1. Releer este documento.
2. Registrar qué se implementó, qué pruebas/gates pasaron, qué quedó fuera del alcance, riesgos/deuda técnica, PR/commit principal y estado de staging/producción si aplica.
3. Marcar la fase como `CLOSED` solo con evidencia.
4. Actualizar Estado actual.
5. Confirmar explícitamente cuál es la siguiente fase.
6. No comenzar automáticamente la siguiente fase sin revisión del PM.

> **Regla:** ninguna fase se considera cerrada solamente porque “el código está hecho”.

---

# 1. Propósito

Evitar que BuildingOS se fragmente entre chats, ramas, agentes, PRs o prioridades temporales.

Este archivo debe responder siempre:

- ¿Dónde estamos?
- ¿Qué estamos cerrando?
- ¿Qué falta para cerrar?
- ¿Qué viene inmediatamente después?
- ¿Por qué ese orden?
- ¿Qué no debemos hacer todavía?

El roadmap es vivo, pero sus cambios deben ser deliberados y trazables.

---

# 2. Visión de producto

> **BuildingOS — Property Operations Platform for LATAM**

Una sola plataforma multi-tenant capaz de administrar:

- edificios residenciales;
- condominios;
- urbanizaciones;
- centros comerciales;
- torres de oficinas;
- complejos de uso mixto.

Con un core compartido de:

- finanzas;
- identidad;
- RBAC;
- residentes / ocupantes / locatarios;
- proveedores;
- órdenes de trabajo;
- documentos;
- comunicaciones;
- mantenimiento;
- contratos;
- acceso;
- gobierno;
- auditoría;
- analítica;
- WSAP;
- email;
- IA segura;
- APIs e integraciones.

---

# 3. Estrategia competitiva

BuildingOS no debe competir copiando módulos. Debe diferenciarse mediante cinco defensas principales.

## 3.1 Financial Core LATAM

BuildingOS debe ser especialmente fuerte en:

- multimoneda real;
- moneda funcional por administración;
- monedas transaccionales;
- snapshots históricos de tipo de cambio;
- USD / VES / COP / ARS / CLP y extensible;
- cargos;
- pagos;
- pagos parciales;
- allocations;
- conciliación;
- recibos;
- gastos;
- ingresos;
- fondos;
- morosidad;
- reportes;
- auditoría financiera.

**Regla:** la verdad financiera viene de servicios determinísticos de dominio + PostgreSQL. La IA puede interpretar, resumir y explicar; nunca inventa saldos ni sustituye invariantes financieras.

## 3.2 Multi-Property

Tipos objetivo:

```text
RESIDENTIAL
URBANIZATION
COMMERCIAL_CENTER
OFFICE
MIXED_USE
```

El `propertyType` pertenece a la propiedad/building, no al tenant.

```text
Administradora / Tenant
├── Edificio Residencial A
├── Edificio Residencial B
├── Centro Comercial C
├── Torre de Oficinas D
└── Complejo Mixto E
```

No crear aplicaciones separadas por vertical.

## 3.3 Omnicanalidad real

Todos los canales deben operar sobre el mismo BuildingOS Core:

```text
WEB
WSAP
EMAIL
VOICE
API
```

No crear un “BuildingOS WhatsApp” separado.

## 3.4 Operations Core

BuildingOS debe evolucionar de tickets aislados a operación completa:

```text
Asset
↕
Ticket
↕
WorkOrder
↕
Vendor
↕
Quote
↕
Contract
↕
Expense
```

## 3.5 Secure AI

La IA nunca es la autoridad del sistema.

> **El modelo interpreta. El agente conversa y planifica. El runtime coordina. BuildingOS autoriza. Los servicios de dominio ejecutan. PostgreSQL conserva la verdad.**

---

# 4. Estado actual

Última revisión del roadmap: **2026-10-02**

Repositorio: `yabreu65/buildingOs`

`main` revisado al crear este documento:

```text
9a27de7a8152d9a12df4373401abb167a75d6d15
```

## Bases ya existentes

### Core
- Multi-tenant
- JWT
- RBAC
- scopes TENANT / BUILDING / UNIT
- auditoría
- PostgreSQL / Prisma
- Redis
- MinIO/S3
- observabilidad

### Finanzas
- cargos
- pagos
- allocations
- recibos
- gastos
- ingresos
- fondos
- reconciliation tooling
- multimoneda
- exchange rates
- snapshots
- morosidad
- reportes

### Operación
- tickets
- comentarios
- proveedores
- cotizaciones
- órdenes de trabajo
- documentos
- comunicaciones
- notificaciones
- push

### Producto
- portal administración
- portal residente
- SuperAdmin
- onboarding
- onboarding import con parser/normalizer/preview/confirmation

### IA
- AssistantModule
- Intent Engine
- planner
- executor
- entity resolver
- policy enforcer
- tools allowlist
- Redis conversation context
- Gemini/OpenAI/Ollama/OpenCode adapters
- budgets
- analytics
- AI audit

## Brechas competitivas principales

- WSAP productivo
- correo oficial BuildingOS completamente operacional
- realtime/event bus más fuerte
- reservas / amenities
- gobierno / asambleas / votaciones
- portería / visitantes / paquetes
- activos físicos
- mantenimiento preventivo
- contratos como entidad de negocio
- Multi-Property
- BuildingOS Mall
- renta fija / variable
- ventas de locatarios / POS
- Portfolio Intelligence
- Secure Agent Kernel completo
- Risk Engine
- Approval Engine
- idempotencia agentic
- RAG
- voz
- API pública / MCP

---

# 5. MASTER ROADMAP

## FASE 0 — Cierre del producto base residencial
**Estado: EN CURSO**

### Outcome
Tener BuildingOS residencial operando de forma estable y confiable antes de expandir superficie funcional.

### Orden
1. Finanzas a producción.
2. Validación y estabilización de Finanzas.
3. Revisión completa del SuperAdmin.
4. Revisión completa del portal Administración.
5. Revisión completa del portal Residente.
6. Correo oficial BuildingOS.
7. Notificaciones / realtime / eventos.
8. Auditoría general de lo que falta en el producto base.
9. Cierre formal de FASE 0.

### Gate de salida
No cerrar esta fase hasta tener:

- finanzas críticas verificadas;
- producción estable;
- tenant isolation validado;
- backups y restore validados;
- flujos administrativos críticos funcionales;
- portal residente crítico funcional;
- correo operacional;
- notificaciones principales funcionales;
- lista documentada de deuda no bloqueante.

### NO hacer todavía
- autonomía financiera con IA;
- refactor grande del agente;
- centro comercial completo;
- voz;
- MCP como dependencia del producto.

### Siguiente fase
**FASE 1 — WSAP + Paridad competitiva residencial**

---

## FASE 1 — WSAP + Paridad competitiva residencial
**Estado: PENDIENTE**

### Outcome
Permitir que residentes y administradores usen BuildingOS por WSAP sin duplicar la lógica de negocio.

### Orden
1. WSAP Gateway multi-tenant.
2. Identidad teléfono ↔ usuario ↔ tenant.
3. Resident WSAP READ.
4. Tickets por WSAP.
5. Reportar/comunicar pagos.
6. Notificaciones por WSAP.
7. Admin WSAP READ.
8. Handoff a humano / Unified Inbox.
9. Reservas / Amenities.
10. Gobierno / votaciones.
11. Portería / visitas / paquetería básica.

### Principio
```text
WSAP → BuildingOS Core → Domain Service → PostgreSQL
```

### Gate de salida
- tenant isolation por canal;
- identidad inequívoca;
- auditoría de cada operación;
- fallback humano;
- no duplicación de reglas financieras;
- pruebas con usuarios reales.

### Siguiente fase
**FASE 2 — Operations Core**

---

## FASE 2 — Operations Core
**Estado: PENDIENTE**

### Outcome
Convertir BuildingOS de gestor de tickets a sistema operacional de propiedades.

### Construir

#### Assets
- equipos;
- instalaciones;
- ubicación;
- fabricante;
- modelo;
- serial;
- garantía;
- documentos;
- historial.

#### Maintenance
- preventivo;
- correctivo;
- inspecciones;
- periodicidad;
- checklist;
- SLA;
- calendario.

#### Contracts
- proveedor;
- propiedad;
- servicio;
- inicio;
- vencimiento;
- renovación;
- monto;
- moneda;
- SLA;
- documentos;
- alertas.

### Integración
```text
Asset ↔ Ticket ↔ WorkOrder ↔ Vendor ↔ Quote ↔ Contract ↔ Expense
```

### Gate de salida
Poder reconstruir el ciclo de vida de un activo, sus mantenimientos y su costo.

### Siguiente fase
**FASE 3 — Multi-Property Architecture**

---

## FASE 3 — Multi-Property Architecture
**Estado: PENDIENTE**

### Outcome
Representar distintos tipos de propiedad sin romper Residential.

### Tipos iniciales
```text
RESIDENTIAL
URBANIZATION
COMMERCIAL_CENTER
OFFICE
MIXED_USE
```

### Principios
- `propertyType` en la propiedad/building.
- Un tenant puede contener distintos tipos.
- Capabilities explícitas por tipo.
- Core financiero compartido.
- Core de identidad compartido.
- Core documental compartido.
- Core de comunicación compartido.
- Terminología configurable sin duplicar modelo.

### Gate de salida
Residential sigue funcionando sin regresión y existe al menos una segunda vertical representable.

### Siguiente fase
**FASE 4 — BuildingOS Mall V1**

---

## FASE 4 — BuildingOS Mall V1
**Estado: PENDIENTE**

### Outcome
Gestionar operativamente un centro comercial real.

### Alcance V1
- zonas;
- unidades locativas;
- locales;
- kioscos;
- propietarios;
- locatarios;
- contratos de arrendamiento;
- cargos/gastos comunes;
- fondos;
- cobro;
- morosidad;
- proveedores;
- tickets;
- activos;
- mantenimiento;
- documentos;
- dashboard comercial básico.

### Gate de salida
Un centro comercial piloto puede operar su ciclo administrativo y financiero básico.

### Siguiente fase
**FASE 5 — BuildingOS Mall V2**

---

## FASE 5 — BuildingOS Mall V2
**Estado: PENDIENTE**

### Outcome
Cubrir operación comercial avanzada.

### Alcance
- renta fija;
- renta variable;
- declaraciones de ventas;
- importación de ventas;
- POS/API;
- marketing fund;
- occupancy;
- tenant mix;
- métricas por m²;
- vencimientos comerciales;
- analítica comercial.

### Siguiente fase
**FASE 6 — Portfolio Operations Center**

---

## FASE 6 — Portfolio Operations Center
**Estado: PENDIENTE**

### Outcome
Permitir a una administradora operar decenas o cientos de propiedades desde una visión consolidada.

### Métricas
- recaudación;
- morosidad;
- gastos;
- cash position;
- tickets;
- SLA;
- mantenimiento;
- contratos;
- riesgos;
- adopción;
- health score.

### Pregunta objetivo
> “¿Qué propiedades necesitan atención hoy y por qué?”

### Siguiente fase
**FASE 7 — BuildingOS Secure Agent Kernel**

---

## FASE 7 — BuildingOS Secure Agent Kernel
**Estado: PENDIENTE**

### Decisión
No reconstruir IA desde cero. Evolucionar `apps/api/src/assistant`.

### Conservar/evolucionar
- TenantAccessGuard
- AuthorizeService
- PolicyEnforcer
- Intent Engine
- Planner/Executor
- Tool allowlist
- Redis conversation context
- provider abstraction
- AI audit
- budget / rate limits

### Agregar
- AgentExecutionContext
- AgentRuntime
- AI SDK runtime
- AdminAgent
- ResidentAgent
- Risk Engine
- Approval Engine
- idempotencia agentic
- transaction policies
- WRITE tools
- evals de seguridad
- tool audit ampliado

### Riesgo objetivo
```text
R0 READ
R1 ANALYZE
R2 DRAFT
R3 WRITE
R4 SENSITIVE
R5 FINANCIAL
R6 DESTRUCTIVE
```

No habilitar financial WRITE sin autorización, confirmación, idempotencia, transacción, auditoría, tenant-isolation tests y evals.

### Siguiente fase
**FASE 8 — Context / RAG / Voice / MCP**

---

## FASE 8 — Context / RAG / Voice / MCP
**Estado: PENDIENTE**

- Context Engine;
- PostgreSQL + pgvector;
- RAG con ACL tenant/building;
- voz;
- MCP;
- API pública;
- webhooks;
- integraciones empresariales.

**Regla:** RAG nunca reemplaza la fuente transaccional.

---

## FASE 9 — Autonomía progresiva
**Estado: PENDIENTE**

### Orden
1. IA proactiva READ.
2. mantenimiento asistido.
3. cobranza asistida.
4. comunicaciones asistidas.
5. conciliación asistida.
6. automatizaciones aprobadas.
7. autonomía acotada y reversible.

### Nunca
Autonomía financiera irrestricta.

---

# 6. Backlog estratégico transversal

## Resident Experience
- multiunidad;
- estado de cuenta;
- recibos;
- documentos;
- tickets;
- comunicaciones;
- reservas;
- gobierno;
- WSAP.

## SuperAdmin Operations Center
- tenants;
- usuarios;
- planes;
- MRR/ARR;
- IA usage/cost;
- WSAP usage;
- storage;
- errores;
- backups;
- jobs fallidos;
- integraciones;
- adopción;
- health score.

## Onboarding
- Excel/CSV;
- preview;
- validación;
- confirmación;
- migración desde otros SaaS;
- PDF/IA futuro.

## Country Packs
- Venezuela;
- Colombia;
- Argentina;
- Chile;
- monedas;
- terminología;
- integraciones;
- configuración regulatoria parametrizable.

## Access
- visitantes;
- vehículos;
- parking;
- paquetes;
- mudanzas;
- contratistas;
- QR/API adapters;
- hardware mediante integraciones.

---

# 7. Protocolo START_PHASE

Al iniciar una fase registrar:

```text
PHASE:
STATUS: STARTED
DATE:
BASELINE_MAIN_SHA:

OUTCOME:
IN_SCOPE:
OUT_OF_SCOPE:

DEPENDENCIES:
ENTRY_GATES:

LOCAL_FIRST: YES
FIRST_SLICE:
TEST_STRATEGY:

NEXT_PHASE_IF_CLOSED:
```

---

# 8. Protocolo CLOSE_PHASE

Antes de cerrar:

```text
PHASE:
STATUS: CLOSED | PARTIAL | BLOCKED
DATE:
FINAL_MAIN_SHA:

DELIVERED:
NOT_DELIVERED:
DEFERRED:

LOCAL_TESTS:
CI:
STAGING:
PRODUCTION:

SECURITY:
TENANT_ISOLATION:
FINANCIAL_INVARIANTS:

KNOWN_RISKS:
TECH_DEBT:

NEXT_APPROVED_PHASE:
```

`CLOSED` solo cuando los gates de salida estén satisfechos.

---

# 9. Reglas permanentes

1. Local primero.
2. Tests locales antes de staging.
3. Staging no es entorno de desarrollo.
4. Producción requiere autorización explícita.
5. No hacer merge sin gates verdes.
6. Preservar invariantes financieras.
7. Tenant isolation obligatorio.
8. No duplicar lógica de dominio por canal.
9. No crear verticales como aplicaciones independientes.
10. La IA nunca bypassa permisos.
11. Preferir evolución incremental.
12. Mantener compatibilidad con el producto residencial.
13. Revisar este roadmap al INICIO y al FINAL de cada fase.

---

# 10. Estado resumido

```text
CURRENT_PHASE:
FASE 0 — Cierre del producto base residencial

CURRENT_ORDER:
1. Finanzas a producción
2. Estabilizar Finanzas
3. Revisar SuperAdmin
4. Revisar Administración
5. Revisar Residente
6. Correo oficial BuildingOS
7. Notificaciones / realtime
8. Auditoría de faltantes
9. Cerrar FASE 0

NEXT_PHASE:
FASE 1 — WSAP + Paridad competitiva residencial
```

---

# 11. Regla de autoridad

En caso de conflicto entre una conversación temporal y este documento:

1. La instrucción explícita más reciente del propietario del proyecto tiene prioridad.
2. Esa decisión debe actualizar este documento.
3. Hasta que se actualice, no asumir que el roadmap cambió permanentemente.

---

# 12. Historial de decisiones

## 2026-10-02
- ODD como metodología principal.
- BuildingOS evoluciona a Property Operations Platform for LATAM.
- Multi-Property confirmado.
- Centros comerciales confirmados.
- WSAP será canal del mismo BuildingOS Core.
- Portal residente se mantiene.
- Administración: Web principal + WSAP complementario.
- `AssistantModule` evolucionará a Secure Agent Kernel.
- Revisión obligatoria del roadmap al INICIO y al FINAL de cada fase.
