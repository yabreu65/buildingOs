# Informe SDD: Integración de Pasarela de Pagos Online (MercadoPago/Stripe)

**Proyecto**: BuildingOS  
**Fecha**: 2026-05-31  
**Cambio**: `online-payment-gateway`  
**Estado del flujo SDD**: Explore → Propose → Spec → Design → Tasks ✅ COMPLETADO  
**Implementación de código**: No ejecutada (solo planificación)  

---

## Resumen Ejecutivo

Este informe documenta el ciclo completo de planificación SDD (Spec-Driven Development) para integrar una pasarela de pagos online (MercadoPago/Stripe) en BuildingOS. El objetivo es permitir que los residentes paguen expensas online con tarjeta de crédito/débito, reemplazando el flujo actual de transferencia manual + subida de comprobante.

**Estado actual del producto**:  
- `PaymentMethod` incluye `ONLINE` y `CARD` en el enum pero no hay gateway integrado.  
- Todos los pagos son transferencia manual + subida de comprobante a MinIO.  
- El admin aprueba/rechaza manualmente cada pago.  
- No hay procesamiento automático de pagos online.  

**Valor del cambio**:  
- Reduce fricción para los residentes (pagan inmediatamente sin salir de la plataforma).  
- Elimina carga operativa del admin (aprobación automática vía webhooks).  
- Habilita monetización real del SaaS (cobro online de expensas).  

---

## 1. Fase: Exploración (Explore)

### 1.1 Contexto del Proyecto

BuildingOS es un SaaS multi-tenant para administración de edificios y condominios con:

- **Backend**: NestJS 10 + Prisma 5.22 + PostgreSQL 16 + Redis 7 + MinIO  
- **Frontend**: Next.js 16 + React 19 + Tailwind 4 + Zod 4  
- **Arquitectura**: Multi-tenant con aislamiento estricto por `tenantId`  
- **RBAC**: SUPER_ADMIN → TENANT_OWNER → TENANT_ADMIN → OPERATOR → RESIDENT  
- **~60 modelos** en Prisma, schema de 2,158 líneas  

### 1.2 Hallazgos Clave

| Hallazgo | Impacto |
|----------|---------|
| Enum `PaymentMethod` ya tiene `ONLINE` y `CARD` | El modelo de datos anticipó este cambio |
| Motor financiero completo con `Charge`, `Payment`, `PaymentAllocation` | Se puede reutilizar la lógica de imputación existente |
| MinIO para almacenamiento de archivos | Los comprobantes actuales se guardan ahí; online no necesita comprobante |
| Guards multi-tenant (`TenantAccessGuard`, `BuildingAccessGuard`) | Aseguran aislamiento para las nuevas rutas |
| `FinanzasModule` con servicios de pagos y liquidaciones | Es el módulo natural para extender con gateway |

### 1.3 Estado de Producción

**Backend: 8/10** — Muy maduro, guards, auditoría, motor financiero completo  
**Frontend: 6.5/10** — Funcional, pero falta pulido end-to-end  
**Infra: 5/10** — Docker local OK, falta producción cloud  
**Integraciones: 4/10** — No hay gateway de pago, email transaccional, ni push notifications reales  

**Veredicto**: Está en un 80-85% de completitud del MVP técnico, pero en un 50-60% de readiness para producción comercial real.

---

## 2. Fase: Propuesta (Proposal)

### 2.1 Intent

Integrar MercadoPago/Stripe para que los residentes paguen expensas online con tarjeta; reemplazar transferencia manual + aprobación admin con confirmación automática vía webhooks e imputación automática.

### 2.2 Alcance (In Scope)

- Adapter abstraction para gateway (MercadoPago primario, Stripe fallback)
- Configuración de gateway por tenant (credenciales, selección de provider)
- Creación de checkout session y manejo de webhooks
- Aprobación automática de pagos e imputación automática
- Frontend para inicio de pago online y manejo de resultado
- Extensiones al schema Prisma (`gatewayPaymentId`, `gatewayProvider`, `gatewayRawResponse`)
- Aislamiento multi-tenant para todas las operaciones de gateway

### 2.3 Fuera de Alcance (Out of Scope)

- Billing de suscripción SaaS (flujo `PaymentVerification` separado)
- Pagos recurrentes automáticos / pagos programados
- Pagos divididos entre múltiples tarjetas
- Criptomonedas u otros métodos de pago alternativos
- UI de gestión de contracargos (chargebacks)

### 2.4 Riesgos y Mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Fallas en entrega de webhooks | Med | Guardar payload raw, retry exponencial, endpoint de replay admin |
| Procesamiento duplicado de pagos | Med | Idempotencia via `gatewayPaymentId` UNIQUE + transiciones de estado idempotentes |
| Filtración de credenciales | Baja | AES-256 en rest, no loggear secretos, solo environment |
| Cambios en API de gateway | Baja | Adapter pattern aísla lógica específica del provider |
| Confusión del residente en redirect | Med | UX clara con estados de carga, manejo de timeout, polling de estado |

### 2.5 Criterios de Éxito

- [ ] Residente puede seleccionar "Pagar online" y completar pago con tarjeta via checkout hosteado
- [ ] Webhook confirma automáticamente `Payment.status` a `APPROVED` y setea `paidAt`
- [ ] Auto-imputación crea registros `PaymentAllocation` para cargos pendientes más antiguos
- [ ] Admin puede configurar provider y credenciales por tenant
- [ ] Webhook handler es idempotente: mismo `gatewayPaymentId` procesado solo una vez
- [ ] Todos los datos permanecen scopeados a `tenantId`; sin leakage cross-tenant
- [ ] Tests unitarios y e2e pasan para checkout flow, webhook, y lógica de imputación

---

## 3. Fase: Especificaciones (Spec)

### 3.1 Requerimientos Funcionales

#### 3.1.1 Gateway Adapter Abstraction

- El sistema DEBE proveer una interfaz `PaymentGatewayAdapter` que abstracte operaciones específicas del provider.
- DEBE soportar al menos dos implementaciones: `MercadoPagoAdapter` y `StripeAdapter`.
- Cada adapter DEBE implementar `createCheckoutSession`, `verifyWebhookSignature`, y `mapProviderStatusToPaymentStatus`.

#### 3.1.2 Checkout Session Creation

- El sistema DEBE crear una checkout session del gateway cuando un residente selecciona `ONLINE` o `CARD`.
- La checkout session DEBE incluir monto, moneda, identificador de tenant, y URLs de redirect success/failure.
- El sistema DEBE persistir `gatewayPaymentId` y `gatewayProvider` en el registro `Payment` antes de retornar la URL de redirect.

#### 3.1.3 Aprobación Automática vía Webhook

- Cuando el gateway confirma pago exitoso via webhook, el sistema DEBE automáticamente aprobar el pago.
- El sistema DEBE setear `Payment.status` a `APPROVED`, `paidAt` al timestamp reportado por el gateway, y `approvedByUserId` a un identificador de sistema.
- La aprobación manual por admin NO DEBE ser requerida para pagos confirmados por gateway.

#### 3.1.4 Auto-Imputación

- El sistema DEBE automáticamente imputar un pago aprobado por gateway a los cargos pendientes más antiguos del residente.
- La imputación DEBE seguir el modelo `PaymentAllocation` existente y actualizar `Charge.status` correspondientemente (PENDING → PARTIAL → PAID).

#### 3.1.5 Configuración de Gateway por Tenant

- El sistema DEBE permitir a un admin de tenant seleccionar provider (`MERCADOPAGO` o `STRIPE`).
- Solo un provider DEBE estar activo a la vez por tenant.
- Las credenciales DEBEN almacenarse encriptadas (AES-256) y NO deben aparecer en logs ni respuestas API.
- El sistema DEBE validar credenciales via test API call antes de activar.

#### 3.1.6 Manejo de Webhooks

- El sistema DEBE exponer endpoint `POST /webhooks/payments/:provider` (público, sin JWT).
- El endpoint DEBE validar firma del provider antes de procesar.
- El endpoint DEBE retornar HTTP 200 dentro de 5 segundos para evitar reintentos del provider.
- El procesamiento DEBE ser idempotente via `gatewayPaymentId` UNIQUE.
- Si `gatewayPaymentId` no existe, retornar HTTP 200 (para evitar reintentos por eventos huérfanos).
- Si falla la DB, retornar HTTP 500 (para trigger reintento del provider).

### 3.2 Escenarios Cubiertos

**Happy Paths**:
- Creación de checkout con MercadoPago
- Creación de checkout con Stripe
- Webhook confirma pago → aprobación automática → imputación automática
- Admin configura gateway provider y credenciales

**Edge Cases**:
- Webhook duplicado (mismo `gatewayPaymentId`)
- Monto excede cargos pendientes
- Provider no configurado para el tenant
- Credenciales inválidas (rechazado en test API call)
- Concurrent webhook processing (optimistic locking/UNIQUE constraint)

**Error States**:
- Firma de webhook inválida → HTTP 401
- Provider desconocido → HTTP 404
- Falla de base de datos → HTTP 500 (trigger retry)
- Moneda no soportada por provider → HTTP 400

### 3.3 Extensiones al Modelo de Datos

```prisma
// Nuevo modelo
model GatewayConfig {
  id                    String    @id @default(cuid())
  tenantId              String
  provider              GatewayProvider // MERCADOPAGO | STRIPE
  encryptedPublicKey    String
  encryptedSecretKey    String
  encryptedWebhookSecret String
  isActive              Boolean   @default(true)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  deletedAt             DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  
  @@unique([tenantId])
}

// Campos agregados a Payment existente
model Payment {
  // ... campos existentes ...
  gatewayPaymentId   String?   @unique
  gatewayProvider    String?
  gatewayStatus      String?
  gatewayRawResponse Json?
}

// Nuevo enum
enum GatewayProvider {
  MERCADOPAGO
  STRIPE
}
```

---

## 4. Fase: Diseño (Design)

### 4.1 Decisiones de Arquitectura

#### 4.1.1 Adapter Pattern sobre Llamadas Directas al SDK

**Elección**: Abstract provider interactions behind `PaymentGatewayAdapter`.  
**Alternativas**: Llamadas directas al SDK de MP esparcidas en servicios.  
**Rationale**: Aísla código específico del provider; permite agregar Stripe/Modo sin tocar lógica de checkout/webhook.

#### 4.1.2 Encrypted Credential Storage (AES-256-GCM)

**Elección**: Almacenar API keys encriptadas en `TenantGatewayConfig` usando `GATEWAY_ENCRYPTION_KEY`.  
**Alternativas**: Environment variables por tenant (no escala), plaintext en DB (riesgo de seguridad).  
**Rationale**: Requerimiento de SaaS multi-tenant; credenciales deben sobrevivir backups sin exposición.

#### 4.1.3 Webhooks como Endpoints Públicos Stateless

**Elección**: Exponer `POST /webhooks/payments/:provider` sin JWT, validando via firma del provider.  
**Alternativas**: Webhooks autenticados (imposible para providers externos), polling (latencia, costo).  
**Rationale**: Restricción de arquitectura del provider. Validación de firma + idempotencia previene replay attacks.

#### 4.1.4 Idempotencia via External Payment ID

**Elección**: Usar el ID de pago externo del provider como clave de idempotencia.  
**Alternativas**: UUID propio (pierde trazabilidad), composite keys (complejo).  
**Rationale**: Simple, nativo del provider, sobrevive reintentos y replays.

### 4.2 Flujo de Datos

#### Checkout Flow

```
Resident/Browser
    │
    ▼
POST /tenants/:tenantId/buildings/:buildingId/finanzas/checkout
    │ (JWT + TenantAccessGuard + BuildingAccessGuard)
    ▼
CheckoutService
    │
    ├──► TenantGatewayConfigService (get config for tenant)
    │         │
    │         ▼
    │    Decrypt credentials
    │         │
    │         ▼
    ├──► PaymentGatewayAdapter (MercadoPagoAdapter)
    │         │
    │         ▼
    │    POST /v1/payment_intents (or preference)
    │         │
    │         ▼
    │    Return checkoutUrl + externalPaymentId
    │
    ▼
Prisma: Create Payment (status=PENDING, method=ONLINE)
    │
    ▼
Return { checkoutUrl, paymentId }
```

#### Webhook Flow

```
MercadoPago
    │
    ▼
POST /webhooks/payments/mercadopago
    │ (No JWT — SignatureGuard)
    ▼
WebhookController
    │
    ▼
WebhookService
    │
    ├──► Verify signature (HMAC/MP-specific)
    │
    ├──► Extract externalPaymentId
    │
    ├──► Lookup Payment by externalPaymentId
    │
    ├──► Idempotency check (skip if already processed)
    │
    ├──► Map provider status → PaymentStatus
    │
    ├──► Update Payment.status (+ timestamps)
    │
    ├──► If APPROVED → trigger allocation (reuse existing logic)
    │
    └──► Audit log entry
```

### 4.3 Archivos Afectados

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `prisma/schema.prisma` | Modificar | Agregar `GatewayConfig` model; agregar `gatewayPaymentId`, `gatewayResponse` a `Payment` |
| `src/gateway/gateway.module.ts` | Crear | Nuevo módulo registrando adapter y servicios |
| `src/gateway/gateway.service.ts` | Crear | Orquesta creación de checkout, delega a adapter |
| `src/gateway/gateway.adapter.ts` | Crear | Interfaz `PaymentGatewayAdapter` |
| `src/gateway/mercadopago.adapter.ts` | Crear | Integración con SDK de MercadoPago |
| `src/gateway/gateway.config.service.ts` | Crear | CRUD de configs de tenant con encrypt/decrypt |
| `src/gateway/gateway.controller.ts` | Crear | Endpoint `POST /checkout` |
| `src/gateway/webhook.controller.ts` | Crear | Endpoint `POST /webhooks/payments/:provider` |
| `src/gateway/webhook.service.ts` | Crear | Validación de firma, idempotencia, mapeo de estado |
| `src/gateway/gateway.dto.ts` | Crear | DTOs para checkout request/response, config CRUD |
| `src/gateway/gateway.guard.ts` | Crear | `WebhookSignatureGuard` para validación HMAC |
| `src/finanzas/finanzas.module.ts` | Modificar | Importar `GatewayModule` |
| `src/finanzas/finanzas.controller.ts` | Modificar | Agregar ruta `POST /checkout` |
| `src/app.module.ts` | Modificar | Importar `GatewayModule` |
| `test/gateway/gateway.service.spec.ts` | Crear | Tests unitarios para checkout orchestration |
| `test/gateway/mercadopago.adapter.spec.ts` | Crear | Tests con SDK de MP mockeado |
| `test/gateway/webhook.service.spec.ts` | Crear | Tests para validación de firma + idempotencia |

### 4.4 Contratos / Interfaces

```typescript
// PaymentGatewayAdapter
export interface PaymentGatewayAdapter {
  readonly provider: string;

  createCheckoutSession(params: {
    amount: number;
    currency: string;
    description: string;
    externalReference: string;
    credentials: DecryptedCredentials;
  }): Promise<{ checkoutUrl: string; externalPaymentId: string }>;

  verifyWebhookSignature(
    payload: unknown,
    signature: string,
    secret: string,
  ): boolean;

  mapProviderStatusToPaymentStatus(providerStatus: string): PaymentStatus;
}

// Checkout Response DTO
export class CheckoutResponseDto {
  paymentId!: string;
  checkoutUrl!: string;
  externalPaymentId!: string;
  expiresAt?: string;
}
```

### 4.5 Estrategia de Testing

| Capa | Qué Testear | Enfoque |
|------|-------------|---------|
| Unit | Adapter methods | Mock MP SDK; test URL generation, signature verification, status mapping |
| Unit | GatewayService | Mock adapter + Prisma; test checkout flow, error handling |
| Unit | WebhookService | Mock adapter; test idempotency, signature failure, status transitions |
| Integration | Schema changes | Migration dry-run; verify new fields and constraints |
| E2E | Full checkout + webhook | Use MP sandbox/test credentials; assert PENDING → APPROVED transition |

### 4.6 Migración / Rollout

1. **Schema Migration**: Prisma migration agregando `TenantGatewayConfig` tabla y columnas a `Payment`. Zero-downtime (nuevas columnas nullable).
2. **Feature Flag**: `GATEWAY_CHECKOUT_ENABLED` env var. Si false, checkout endpoint retorna `501 Not Implemented`.
3. **Credential Seeding**: Backfill `TenantGatewayConfig` para tenants pilot vía script admin.
4. **Webhook DNS**: Asegurar que `https://api.buildingos.com/webhooks/payments/mercadopago` esté registrado en dashboard de MP antes de go-live.

### 4.7 Preguntas Abiertas

- [ ] **MercadoPago Product Choice**: Confirmar si usar MP **Payment Intent** (moderno, redirect) o **Preference API** (legacy, más simple).
- [ ] **Encryption Key Rotation**: Definir estrategia de rotación de `GATEWAY_ENCRYPTION_KEY` sin invalidar credenciales almacenadas.
- [ ] **Idempotency Scope**: ¿Debe idempotencia cubrir también creación de checkout (evitar URLs duplicadas para mismo cargo), o solo procesamiento de webhook?
- [ ] **Allocation Trigger**: ¿Reusar `FinanzasService.approvePayment()` o crear nuevo helper `autoAllocateOnlinePayment()`? `approvePayment` actual espera contexto de aprobación manual.

---

## 5. Fase: Tareas (Tasks)

### 5.1 Forecast de Carga de Revisión

| Campo | Valor |
|-------|-------|
| Líneas estimadas cambiadas | ~1200-1400 (13 nuevos archivos, 3 modificados, 3 test files) |
| Riesgo de presupuesto 400 líneas | **Alto** |
| PRs encadenados recomendados | **Sí** |
| Split sugerido | PR 1: Schema + Adapter Interface + Encryption → PR 2: Checkout Flow + MP Adapter → PR 3: Webhooks + Auto-Allocation → PR 4: Wiring + Tests |
| Estrategia de delivery | ask-on-risk |
| Estrategia de cadena | stacked-to-main |

### 5.2 Desglose de Tareas

#### Phase 1: Schema + Foundation (PR 1) — ~200 líneas

- [ ] **1.1** Agregar `TenantGatewayConfig` model a `prisma/schema.prisma`
- [ ] **1.2** Agregar campos `gatewayPaymentId`, `gatewayProvider`, `gatewayStatus`, `gatewayRawResponse` a `Payment`
- [ ] **1.3** Correr `npx prisma migrate dev` para generar y aplicar migración
- [ ] **1.4** Crear `PaymentGatewayAdapter` interface en `gateway.adapter.ts`
- [ ] **1.5** Crear `GatewayCryptoService` con AES-256-GCM encrypt/decrypt
- [ ] **1.6** Crear `GatewayModule` registrando crypto service
- [ ] **1.7** Tests unitarios para `GatewayCryptoService`

#### Phase 2: Tenant Config + Checkout Flow (PR 2) — ~400 líneas

- [ ] **2.1** Crear DTOs (`CreateGatewayConfigDto`, `UpdateGatewayConfigDto`, `CheckoutRequestDto`, `CheckoutResponseDto`)
- [ ] **2.2** Crear `GatewayConfigService` con CRUD encriptado y validación de credenciales
- [ ] **2.3** Crear `GatewayConfigController` con endpoints CRUD
- [ ] **2.4** Crear `MercadoPagoAdapter` implementando `PaymentGatewayAdapter`
- [ ] **2.5** Crear `GatewayService` orquestando checkout
- [ ] **2.6** Crear `GatewayController` con endpoint `POST /checkout`
- [ ] **2.7** Tests unitarios para `GatewayConfigService`
- [ ] **2.8** Tests unitarios para `MercadoPagoAdapter`

#### Phase 3: Webhooks + Auto-Allocation (PR 3) — ~400 líneas

- [ ] **3.1** Crear `WebhookSignatureGuard` para validación HMAC
- [ ] **3.2** Crear `WebhookService` con procesamiento idempotente
- [ ] **3.3** Crear `WebhookController` con endpoint `POST /webhooks/payments/:provider`
- [ ] **3.4** Agregar trigger de auto-imputación en `WebhookService`
- [ ] **3.5** Agregar feature flag `GATEWAY_CHECKOUT_ENABLED`
- [ ] **3.6** Tests unitarios para `WebhookService`
- [ ] **3.7** Tests unitarios para `GatewayService` (orquestación de checkout)

#### Phase 4: Wiring + Integration (PR 4) — ~300 líneas

- [ ] **4.1** Modificar `FinanzasModule` para importar `GatewayModule`
- [ ] **4.2** Modificar `AppModule` para importar `GatewayModule`
- [ ] **4.3** Agregar campos gateway a `PaymentDetailDto`
- [ ] **4.4** Agregar endpoint de polling `GET /payments/:paymentId/status`
- [ ] **4.5** Tests E2E para flujo completo checkout → webhook → imputación
- [ ] **4.6** Verificar tests unitarios pasan
- [ ] **4.7** Verificar type-checking pasa

---

## 6. Riesgos Técnicos y Mitigaciones

| Riesgo | Nivel | Mitigación |
|--------|-------|------------|
| Webhook delivery failures | Medio | Guardar payload raw, retry exponencial, endpoint admin replay |
| Duplicate payment processing | Medio | Idempotencia via `gatewayPaymentId` UNIQUE |
| Credential leakage | Bajo | AES-256 encryption, no logging de secretos |
| Gateway API changes | Bajo | Adapter pattern aísla lógica específica |
| Resident confusion during redirect | Medio | UX clara con estados de carga, timeout, polling |
| Cross-tenant data leakage | Alto | `tenantId` en toda query, webhook lookup por `gatewayPaymentId` + tenant validation |
| Framework bleeding-edge | Medio | Next.js 16 y React 19 pueden tener bugs; testear exhaustivamente |

---

## 7. Roadmap Recomendado

### Fase 1: Producción Core (2-3 meses)
**Objetivo**: Hacer que el primer tenant pague y use la plataforma sin fricción.

- Integrar gateway de pago (MercadoPago/Stripe) para cobro de expensas online.
- Generación y envío de recibos/expensas en PDF por email.
- Push notifications reales (FCM) para pagos aprobados y comunicados.
- MFA para TENANT_OWNER y SUPER_ADMIN.
- Tests E2E críticos: login → crear edificio → generar liquidación → pagar → aprobar.

### Fase 2: Escalamiento y Operación (3-4 meses)
**Objetivo**: Permitir que administradoras con múltiples edificios operen a escala.

- WhatsApp Business API para recordatorios de pago.
- Automatización de gastos recurrentes (cron jobs productivos).
- Importación masiva de unidades y ocupantes desde Excel.
- App móvil (o PWA completa) para residentes.
- Mejoras de performance: caching agresivo en Redis, paginación en todas las listas.
- Reportes avanzados con gráficos interactivos.

### Fase 3: Diferenciación y Enterprise (6+ meses)
**Objetivo**: Convertirse en el ERP de la administración de edificios.

- Integraciones contables (QuickBooks, SIIGO, etc.).
- Reservas de amenities y control de accesos.
- Contratos digitales con firma electrónica.
- Marketplace de proveedores (calificaciones, historial).
- White-label avanzado (dominios propios por tenant).
- API pública para integraciones de terceros.

---

## 8. Conclusión y Dictamen

### Estado del Cambio

| Fase SDD | Estado | Artefacto |
|----------|--------|-----------|
| Explore | ✅ Completo | Análisis read-only del proyecto |
| Propose | ✅ Completo | `openspec/changes/online-payment-gateway/proposal.md` |
| Spec | ✅ Completo | 4 specs detallados en `openspec/changes/online-payment-gateway/specs/` |
| Design | ✅ Completo | `openspec/changes/online-payment-gateway/design.md` |
| Tasks | ✅ Completo | `openspec/changes/online-payment-gateway/tasks.md` |
| Apply | ⏳ Pendiente | Implementación de código (no ejecutada) |
| Verify | ⏳ Pendiente | Verificación post-implementación |
| Archive | ⏳ Pendiente | Archivado del cambio |

### Dictamen

**BuildingOS es un proyecto excepcionalmente avanzado para su etapa.** No es un simple CRUD; es una plataforma empresarial con arquitectura multi-tenant, motor financiero, asistente de IA, billing SaaS, y auditoría completa. El backend demuestra madurez de arquitectura que muchas startups no alcanzan en años.

**Veredicto**: Está en un **80-85% de completitud del MVP técnico**, pero en un **50-60% de readiness para producción comercial** real. La base está sólida, pero le faltan las integraciones con el mundo exterior (pagos, email, push, infra cloud) que son las que permiten cobrarle a un cliente real y entregar valor completo.

**Recomendación inmediata**: Congelar nuevas features "nice-to-have" (como más IA o reportes exóticos) y enfocar los próximos 2-3 meses en:
1. Integración de cobro online (este cambio).
2. Envío de recibos/expensas por email.
3. Infra productiva estable.
4. Tests E2E del flujo financiero crítico.

El proyecto tiene un potencial enorme. La base técnica no es el problema; el desafío ahora es **salir del "backend perfecto" y conectar con los sistemas reales de los clientes**.

---

## 9. Artefactos Generados

```
openspec/changes/online-payment-gateway/
├── proposal.md                                    ← Propuesta de cambio
├── design.md                                      ← Diseño técnico
├── tasks.md                                        ← Desglose de tareas
└── specs/
    ├── online-payment-gateway/spec.md             ← Spec: Gateway adapter, checkout, auto-approval
    ├── tenant-gateway-config/spec.md              ← Spec: Config de tenant
    ├── webhook-payment-confirmation/spec.md       ← Spec: Webhook handler
    └── payment-flow/spec.md                       ← Spec: Delta en flujo de pagos
```

**Este informe**: `openspec/changes/online-payment-gateway/INFORME_SDD_COMPLETO.md`

---

*Generado por SDD Orchestrator — BuildingOS — 2026-05-31*  
*Modo: OpenSpec (archivos en repo) | Ritmo: Interactivo | Presupuesto de revisión: 400 líneas*
