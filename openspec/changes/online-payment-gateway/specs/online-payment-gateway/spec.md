# Online Payment Gateway Specification

## Purpose

Enable residents to pay building charges online via credit/debit card through a hosted checkout flow provided by an external payment gateway (MercadoPago primary, Stripe fallback). The system creates checkout sessions, redirects residents to the gateway, and processes payments without handling card data directly.

## Requirements

### Requirement: Gateway Adapter Abstraction

The system MUST provide a `PaymentGatewayAdapter` interface that abstracts provider-specific operations. The system SHALL support at least two adapter implementations: `MercadoPagoAdapter` and `StripeAdapter`. Each adapter MUST implement `createCheckoutSession`, `verifyWebhookSignature`, and `getPaymentStatus` operations.

#### Scenario: Create checkout session with MercadoPago

- GIVEN a tenant has configured MercadoPago as their gateway provider with valid credentials
- WHEN a resident initiates an online payment for a valid amount
- THEN the system creates a Payment record with status `SUBMITTED` and method `ONLINE`
- AND returns a redirect URL to the MercadoPago hosted checkout page
- AND stores the `gatewayPaymentId` on the Payment record

#### Scenario: Create checkout session with Stripe

- GIVEN a tenant has configured Stripe as their gateway provider with valid credentials
- WHEN a resident initiates an online payment
- THEN the system creates a Stripe checkout session and returns the redirect URL
- AND stores the Stripe session ID as `gatewayPaymentId`

#### Scenario: Gateway provider not configured

- GIVEN a tenant has NOT configured any gateway provider
- WHEN a resident attempts to pay with method `ONLINE` or `CARD`
- THEN the system MUST reject the request with HTTP 400 and a descriptive error message

### Requirement: Checkout Session Creation

The system MUST create a gateway checkout session when a resident selects `ONLINE` or `CARD` as payment method. The checkout session MUST include the payment amount, currency, tenant identifier, and a success/failure redirect URL. The system MUST persist the `gatewayPaymentId` and `gatewayProvider` on the Payment record before returning the redirect URL.

#### Scenario: Successful checkout session creation

- GIVEN a resident with at least one pending charge
- WHEN the resident submits a payment with method `ONLINE` and a valid amount
- THEN the system creates a Payment record with `status=SUBMITTED`, `method=ONLINE`, `gatewayProvider=MERCADOPAGO` (or tenant-configured provider)
- AND returns `{ paymentId, redirectUrl, gatewayPaymentId }`

#### Scenario: Amount exceeds pending charges total

- GIVEN a resident with pending charges totaling 50000 cents
- WHEN the resident submits a payment with amount 60000 cents
- THEN the system MUST reject the request with HTTP 422 indicating amount exceeds pending balance

#### Scenario: Invalid currency for gateway

- GIVEN a tenant with currency `ARS` and Stripe as gateway (Stripe may not support ARS)
- WHEN a resident attempts to pay online
- THEN the system MUST reject with HTTP 400 indicating unsupported currency for the configured provider

### Requirement: Automatic Payment Approval on Gateway Confirmation

The system MUST automatically approve a payment when the gateway confirms successful payment via webhook. The system SHALL set `Payment.status` to `APPROVED`, set `paidAt` to the gateway-reported timestamp, and set `approvedByUserId` to a system identifier. Manual admin approval MUST NOT be required for gateway-confirmed payments.

#### Scenario: Gateway confirms payment

- GIVEN a Payment record exists with `gatewayPaymentId` and `status=SUBMITTED`
- WHEN the gateway sends a `payment.completed` webhook event matching the `gatewayPaymentId`
- THEN the system updates `Payment.status` to `APPROVED`
- AND sets `paidAt` to the gateway-reported payment date
- AND sets `gatewayStatus` to `COMPLETED`
- AND triggers automatic allocation to oldest pending charges

#### Scenario: Gateway reports payment failure

- GIVEN a Payment record exists with `gatewayPaymentId` and `status=SUBMITTED`
- WHEN the gateway sends a `payment.failed` webhook event
- THEN the system updates `Payment.status` to `REJECTED`
- AND sets `gatewayStatus` to `FAILED`
- AND stores the failure reason in `gatewayRawResponse`

### Requirement: Automatic Allocation After Gateway Approval

The system MUST automatically allocate a gateway-approved payment to the resident's oldest pending charges. Allocation MUST follow the existing `PaymentAllocation` model and update `Charge.status` accordingly (PENDING → PARTIAL → PAID).

#### Scenario: Full allocation to single charge

- GIVEN a gateway-approved payment of 10000 cents and one pending charge of 10000 cents
- WHEN automatic allocation runs
- THEN one `PaymentAllocation` record is created for the full amount
- AND the charge status changes to `PAID`

#### Scenario: Partial allocation across multiple charges

- GIVEN a gateway-approved payment of 15000 cents and two pending charges: 8000 (oldest) and 10000
- WHEN automatic allocation runs
- THEN two `PaymentAllocation` records are created: 8000 for the oldest, 7000 for the next
- AND the oldest charge status changes to `PAID`
- AND the next charge status changes to `PARTIAL`

#### Scenario: Payment exceeds all pending charges

- GIVEN a gateway-approved payment of 20000 cents and total pending charges of 15000 cents
- WHEN automatic allocation runs
- THEN all charges are fully allocated and marked `PAID`
- AND the remaining 5000 cents remains as unallocated payment balance

### Requirement: Multi-Tenant Isolation for Gateway Operations

All gateway operations MUST be scoped to `tenantId`. The system MUST NOT allow cross-tenant access to gateway configurations, checkout sessions, or webhook processing. Webhook payloads MUST be validated against the tenant's configured credentials.

#### Scenario: Webhook for different tenant

- GIVEN two tenants with different gateway credentials
- WHEN a webhook arrives with a `gatewayPaymentId` belonging to Tenant A
- THEN the system MUST process it using Tenant A's credentials only
- AND MUST NOT expose any Tenant B data

### Requirement: Payment Status Polling

The system MUST expose an endpoint for residents to poll the status of their online payment after redirect. The endpoint MUST return the current `Payment.status`, `gatewayStatus`, and any allocation details.

#### Scenario: Resident polls pending payment

- GIVEN a resident has an in-progress online payment (resident completed checkout but webhook not yet received)
- WHEN the resident polls `GET /finanzas/buildings/:buildingId/payments/:paymentId`
- THEN the system returns the payment with `status=SUBMITTED` and `gatewayStatus=PENDING`

#### Scenario: Resident polls confirmed payment

- GIVEN a webhook has confirmed the payment
- WHEN the resident polls the payment endpoint
- THEN the system returns `status=APPROVED`, `paidAt`, and allocation details
