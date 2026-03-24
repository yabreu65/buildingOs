# Payment Flow Specification

## Purpose

Definir la semantica del flujo de pagos: la administracion emite facturas, la unidad paga via transferencia y envia comprobante, la administracion confirma o rechaza, y la unidad ve el estado confirmado. La UI, reportes y documentacion deben reflejar esa direccion.

## Requirements

### Requirement: Admin issues invoices

The system MUST allow the admin role to issue invoices to units and MUST show the issuer as administracion. Units MUST see issued invoices in status "pendiente de pago".

#### Scenario: Admin issues invoice (happy path)

- GIVEN an admin user is authenticated
- WHEN the admin issues an invoice for a unit
- THEN the unit sees the invoice with status "pendiente de pago"
- AND the issuer is labeled as administracion

#### Scenario: Non-admin attempts to issue invoice (edge case)

- GIVEN a non-admin user is authenticated
- WHEN the user attempts to issue an invoice
- THEN the system MUST deny the action
- AND no invoice is created

### Requirement: Unit submits payment proof

The system MUST allow a unit to register a payment for an invoice via transfer and attach proof. Submitted payments MUST be in status "pendiente de confirmacion" for admin review.

#### Scenario: Unit submits transfer proof (happy path)

- GIVEN a unit has an invoice in status "pendiente de pago"
- WHEN the unit submits a transfer proof for that invoice
- THEN the payment appears as "pendiente de confirmacion"
- AND the invoice reflects that pending confirmation state

#### Scenario: Unit submits without proof (edge case)

- GIVEN a unit has an invoice in status "pendiente de pago"
- WHEN the unit submits a payment without proof
- THEN the system MUST reject the submission
- AND the invoice remains "pendiente de pago"

### Requirement: Admin confirms or rejects payment

The system MUST allow the admin role to confirm or reject a submitted payment, and the unit MUST see the resulting status on its invoice.

#### Scenario: Admin confirms payment (happy path)

- GIVEN a payment is "pendiente de confirmacion"
- WHEN the admin confirms the payment
- THEN the unit sees status "pago confirmado"
- AND the invoice is marked as paid

#### Scenario: Admin rejects payment (edge case)

- GIVEN a payment is "pendiente de confirmacion"
- WHEN the admin rejects the payment
- THEN the unit sees status "pago rechazado"
- AND the payment is not marked as confirmed

### Requirement: Reporting and terminology consistency

The system MUST present confirmed payments as ingresos for administracion and egresos for unidad, and MUST keep labels consistent with the direction unidad -> administracion across UI and reports.

#### Scenario: Reports show role-based semantics (happy path)

- GIVEN confirmed payments exist
- WHEN an admin views reports
- THEN entries are labeled as ingresos
- AND when a unit views reports, the same entries are labeled as egresos

#### Scenario: Pending or rejected payments are not confirmed (edge case)

- GIVEN payments are in status "pendiente de confirmacion" or "pago rechazado"
- WHEN users view lists or reports
- THEN those entries are labeled with their status
- AND they are not shown as confirmed

### Requirement: Documentation aligned with UI semantics

The system SHOULD document the flow in `docs/financial-flows.md` with steps and role responsibilities and MUST align terminology with UI labels.

#### Scenario: Documentation describes the flow (happy path)

- GIVEN the documentation is updated
- WHEN a user reads the payment flow section
- THEN the steps invoice -> payment -> confirmation are described
- AND admin and unit responsibilities are explicit

#### Scenario: Terminology alignment (edge case)

- GIVEN the documentation contains outdated terms
- WHEN the documentation is updated
- THEN terms are replaced to match current UI labels
