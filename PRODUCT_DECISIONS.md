# BuildingOS – Resumen de decisiones y respuestas (conversación)

Fecha: 2026-02-08 (America/Argentina/Buenos_Aires)

> Este archivo consolida **las respuestas y decisiones** tomadas en la conversación para que lo puedas dejar en la **raíz del repo** (por ejemplo: `./PRODUCT_DECISIONS.md`).

---

## 1) Objetivo del producto

### ¿Qué estás construyendo?
Un **único SaaS multi-tenant** para **administración de edificios/condominios** que soporte:

- **Tenant tipo ADMINISTRADORA**: empresa que gestiona muchos edificios/condominios.
- **Tenant tipo EDIFICIO_AUTOGESTION**: un edificio/condominio que se administra a sí mismo.
- Módulos core: estructura (propiedades/unidades/personas), expensas/cobranzas, gastos/proveedores, reclamos/mantenimiento, comunicaciones/documentos, y luego add-ons (reservas, accesos, BI, integraciones).

### Definición unificada (sin duplicar lógica)
- Un **edificio/condominio** se modela como una sola entidad: `Property`.
- Diferencias de operación se resuelven con **configuración + permisos**, no con ramas de código.

---

## 2) Stack recomendado (Front / Back / BD)

### Frontend (Web)
- **Next.js + React + TypeScript**
- **Tailwind CSS + shadcn/ui**
- **TanStack Query**
- **React Hook Form + Zod**
- **Recharts** (dashboards)

### Backend (API)
- **NestJS + TypeScript**
- **Prisma** (ORM + migraciones)
- **OpenAPI/Swagger**
- **Redis + BullMQ** (jobs/colas)
- Storage **S3-compatible** (MinIO local; S3/R2 en prod)

### Base de datos
- **PostgreSQL**
- Multi-tenant recomendado: **un schema**, todas las tablas con `tenant_id` (y `property_id` cuando aplique).
- Opcional futuro: **Postgres RLS**.

---

## 3) Estructura de archivos recomendada (Front y Back)

### Repo (monorepo)
Estructura “de batalla” para SaaS modular:

```
buildingos/
  apps/
    web/              # Next.js
    api/              # NestJS
    worker/           # opcional (colas/cron), o dentro de api
  packages/
    contracts/        # DTOs/types/schemas Zod/enums compartidos
    permissions/      # matriz permisos + helpers
    ui/               # design system (opcional)
    config/           # tsconfig/eslint/env schema
  infra/
    docker/           # postgres, redis, minio
  docs/
    adr/              # decisiones de arquitectura
```

**Regla clave:** lo “compartible” (DTOs/enums/schemas) vive en `packages/contracts` para evitar desalineación front/back.

### Front (Next.js) – Feature-first (por dominio)
```
apps/web/src/
  app/
    (public)/login/
    (tenant)/[tenantId]/
      dashboard/
      properties/
      units/
      expenses/
      payments/
      tickets/
      communications/
      settings/
  features/
    auth/
    tenancy/
    rbac/
    properties/
    units/
    expenses/
    payments/
    tickets/
    communications/
  shared/
    lib/http/
    components/
    styles/
  middleware.ts
```

### Back (NestJS) – Módulos por dominio + capas
```
apps/api/src/
  modules/
    auth/
    tenancy/
    rbac/
    properties/
    units/
    expenses/
    payments/
    tickets/
    communications/
  common/
    decorators/
    guards/
    interceptors/
    filters/
    pipes/
    errors/
  infra/
    db/
    cache/
    queue/
    storage/
    mail/
    integrations/
```

**Regla multi-tenant:** ningún repository/service debe consultar sin filtrar por `tenant_id`.

---

## 4) “¿Cómo se llama esta estructura?” (feature + capas)
La estructura como:

- `products/ components/ services/ adapters/`
- `cart/ components/ services/ adapters/`

Se conoce como:
- **Arquitectura Feature-based / Feature-first** (organización por módulo/dominio),
- con inspiración **Clean Architecture / Hexagonal (Ports & Adapters)** en frontend (ligera):
  - `components` = UI
  - `services` = acceso a datos / casos de uso
  - `adapters` = mapeo DTO ↔ ViewModel

---

## 5) Países objetivo
- **Venezuela**
- **Argentina**
- **Colombia**

---

## 6) Pagos: decisión de MVP (transferencia/deposito + comprobante)

### Decisión propuesta y aceptada como MVP
El cliente (residente) realiza el pago **por transferencia o depósito** y luego:
- **sube el comprobante al SaaS**
- la administración lo recibe
- **aprueba/rechaza**
- al aprobar, el sistema **imputa** el pago a la deuda de la unidad (cuenta corriente).

### Por qué es lo más conveniente para VE/AR/CO
- Reduce complejidad y riesgos de integraciones al inicio.
- Funciona con múltiples bancos/realidades locales.
- Mantiene trazabilidad/auditoría.

### Flujo
1. Configuración por `property_id`: cuentas bancarias + instrucciones + política de validación.
2. Residente crea `PaymentSubmission` con monto/fecha/unidad/periodo + adjunto.
3. Administración valida: `APPROVED` o `REJECTED` (con motivo).
4. Al aprobar: se crea `Payment` + `LedgerEntry` y baja la deuda.

### Estados sugeridos
- `PENDING`
- `APPROVED`
- `REJECTED`
- `CANCELLED`

### Reglas clave
- Un submission **no reduce deuda** hasta ser aprobado.
- Pagos aprobados no se editan: solo **reversal** (contraasiento) con auditoría.
- Detección de duplicados (monto/fecha/unidad en ventana configurable).
- Imputación recomendada: **punitorios/intereses primero**, luego deuda más antigua (FIFO).

### Notificaciones MVP
- In-app + email (WhatsApp/push después).

---

## 7) Aclaraciones sobre preguntas 4 y 5 (del set de 5 definiciones)

### (4) “Portal de residentes en MVP sí/no”
Significa si en la primera versión los residentes podrán:
- ver deuda/expensas,
- descargar comprobantes,
- reportar pagos,
- crear reclamos.

Recomendación: **Sí**, al menos básico, especialmente si hay pagos (aunque sean offline con comprobante).

### (5) “Cuenta corriente por unidad sí/no”
Significa tener un **ledger** por unidad:
- cargos (expensas, punitorios, ajustes)
- pagos
- saldo final

Recomendación: **Sí** desde el inicio (simple), para soportar pagos parciales, mora y ajustes.

---

## 8) Principios de diseño acordados (constantes)
- **Un solo SaaS**, no múltiples apps.
- **Multi-tenant** con aislamiento total por `tenant_id`.
- No duplicar lógica por tipo de cliente: resolver con **configuración y permisos**.
- Roles base: `SUPER_ADMIN`, `TENANT_OWNER`, `TENANT_ADMIN`, `OPERATOR`, `RESIDENT`.
- Permisos granulares con scopes: `property_id` y (cuando aplica) `unit_id`.

---

## 9) Próximos pasos recomendados
1. Definir prorrateo por propiedad: coeficiente/m²/fijo/mixto (configurable).
2. Definir políticas de mora (intereses/punitorios) por propiedad/tenant.
3. Implementar módulo pagos MVP (PaymentSubmission + validación + ledger).
4. Implementar módulo expensas v1 (liquidación mensual + recibo).
5. Implementar tickets/reclamos + comunicaciones.

---

## 10) Registro de preguntas del usuario (hasta ahora)
1. “quiero que siempres recuerdes mi preguntas para luego hacerun archivo .md”
2. “quiero hacer un saas … administracion de edificios … y que tambien desde alli pueda tambien administrar condomios”
3. “ok que me recomiendas para el fronted, backend y bd, dime”
4. “ahora como vamos a hacer la estructura de los archivos en el front y el back, que me recomiendas”
5. “y este tipo como se llama … (estructura por modules: products/cart/checkout con components/services/adapters)”
6. “tu quiero que sea mi project manager”
7. “perfecto, pero lo hablamos despues quiero la estructura mas recomendada para lo que quiero?”
8. “te pido lo mas recomendado … es lo mejor para el proyecto”
9. “que otra pregunta me haria falta”
10. “1) venezuela, argentina y colombia … 2) depende del condominio … 3) pagos online si …”
11. “te propongo algo en cuanto pagos … transferencia o deposito y que se suba el pago a la saas …”

---
