# Payment Gateway Specification

## Purpose

Provider-agnostic payment processing with webhook-driven charge confirmation, idempotency, and graceful degradation to manual approval.

## Requirements

### Requirement: Payment Provider Interface

The system SHALL define a `PaymentProvider` interface with methods for creating payment preferences, processing webhooks, and querying charge status. Each provider adapter (MercadoPago, Stripe) SHALL implement this interface.

#### Scenario: Provider adapter implements interface

- GIVEN a `PaymentProvider` interface with `createPreference`, `handleWebhook`, and `getChargeStatus` methods
- WHEN a MercadoPago adapter is instantiated
- THEN it implements all interface methods with MercadoPago SDK calls

#### Scenario: Provider selection at runtime

- GIVEN `PAYMENT_PROVIDER` env var is set to `mercadopago`
- WHEN the payment module initializes
- THEN the MercadoPago adapter is registered as the active provider

### Requirement: Webhook Endpoint Security

The system SHALL expose a webhook endpoint that verifies provider signatures before processing any event. Requests with invalid signatures SHALL be rejected with HTTP 401.

#### Scenario: Valid webhook signature

- GIVEN a webhook request with a valid MercadoPago signature header
- WHEN the endpoint receives the request
- THEN signature verification passes and the event is processed

#### Scenario: Invalid webhook signature

- GIVEN a webhook request with a forged or missing signature
- WHEN the endpoint receives the request
- THEN the request is rejected with HTTP 401 and logged

#### Scenario: Webhook disabled via env var

- GIVEN `ENABLE_PAYMENT_WEBHOOKS=false`
- WHEN a webhook request arrives
- THEN the endpoint returns HTTP 503 and does not process the event

### Requirement: Idempotency and Double-Charge Protection

The system SHALL use idempotency keys to prevent duplicate charge processing. Duplicate webhook deliveries with the same event ID SHALL be acknowledged without side effects.

#### Scenario: First webhook delivery

- GIVEN a new webhook event ID not seen before
- WHEN the webhook handler processes it
- THEN the charge status is updated and the event ID is recorded

#### Scenario: Duplicate webhook delivery

- GIVEN a webhook event ID already recorded in the database
- WHEN the same event is delivered again
- THEN the handler returns HTTP 200 without re-processing the charge

### Requirement: Charge Status Transitions

The system SHALL support charge status transitions: `PENDING` → `PAID` on successful webhook, `PENDING` → `REJECTED` on failed payment. Manual approval SHALL remain available as a parallel path.

#### Scenario: Webhook confirms payment

- GIVEN a charge in `PENDING` status
- WHEN a webhook arrives with `payment.status = approved`
- THEN the charge transitions to `PAID` and the tenant is notified

#### Scenario: Webhook rejects payment

- GIVEN a charge in `PENDING` status
- WHEN a webhook arrives with `payment.status = rejected`
- THEN the charge transitions to `REJECTED` and the user is notified to retry

#### Scenario: Manual approval still works

- GIVEN webhooks are disabled
- WHEN an admin manually approves a charge
- THEN the charge transitions to `PAID` regardless of webhook state

### Requirement: Tenant Payment Configuration

The system SHALL allow each tenant to configure their payment provider credentials independently. Credentials SHALL be encrypted at rest.

#### Scenario: Tenant configures provider credentials

- GIVEN a tenant admin accesses payment settings
- WHEN they save MercadoPago access tokens
- THEN credentials are encrypted and stored scoped to that tenant

#### Scenario: Tenant without payment config

- GIVEN a tenant has not configured payment credentials
- WHEN a user attempts to create a payment preference
- THEN the system returns HTTP 400 with a configuration-required message
