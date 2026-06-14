# Payment Flow Specification (Delta)

## Purpose

Extend the existing payment submission flow to support `ONLINE` and `CARD` payment methods via the gateway checkout flow. Gateway-confirmed payments bypass manual admin approval. Existing `TRANSFER` and `CASH` flows remain unchanged.

## ADDED Requirements

### Requirement: Online Payment Submission

When a resident submits a payment with method `ONLINE` or `CARD`, the system MUST create a gateway checkout session instead of requiring a proof file upload. The `SubmitPaymentDto` MUST accept `ONLINE` and `CARD` as valid method values. When method is `ONLINE` or `CARD`, the `proofFileId` field MUST be optional (not required).

#### Scenario: Submit online payment

- GIVEN a resident is authenticated and has pending charges
- WHEN they submit `POST /finanzas/buildings/:buildingId/payments` with `{ amount: 10000, method: "ONLINE" }`
- THEN the system creates a Payment record with `method=ONLINE`, `status=SUBMITTED`
- AND creates a gateway checkout session via the tenant's configured adapter
- AND returns `{ paymentId, redirectUrl, gatewayPaymentId }` in the response

#### Scenario: Submit card payment

- GIVEN a resident submits with `method: "CARD"`
- WHEN the tenant has Stripe configured
- THEN the system creates a Stripe checkout session
- AND returns the Stripe redirect URL

#### Scenario: Online payment without gateway configured

- GIVEN a tenant has no active `GatewayConfig`
- WHEN a resident submits a payment with `method: "ONLINE"`
- THEN the system MUST reject with HTTP 400 and message "Online payments are not configured for this tenant"

#### Scenario: Transfer payment unchanged

- GIVEN a resident submits with `method: "TRANSFER"` and a `proofFileId`
- WHEN the payment is submitted
- THEN the existing flow applies: Payment created with `status=SUBMITTED`, awaiting admin approval

### Requirement: Gateway Payment Fields on Payment Model

The Payment model MUST include the following new fields for gateway tracking:
- `gatewayPaymentId` (String, optional, UNIQUE) — the external gateway's payment/session ID
- `gatewayProvider` (String, optional) — `MERCADOPAGO` or `STRIPE`
- `gatewayStatus` (String, optional) — provider-reported status: `PENDING`, `COMPLETED`, `FAILED`, `EXPIRED`
- `gatewayRawResponse` (JSON, optional) — raw webhook payload for audit

All fields MUST be nullable to maintain backward compatibility with existing `TRANSFER` and `CASH` payments.

#### Scenario: Transfer payment has null gateway fields

- GIVEN an existing transfer payment
- WHEN queried
- THEN `gatewayPaymentId`, `gatewayProvider`, `gatewayStatus`, and `gatewayRawResponse` are all null

#### Scenario: Online payment has gateway fields populated

- GIVEN a payment created via online checkout
- WHEN queried
- THEN `gatewayPaymentId` contains the gateway session ID
- AND `gatewayProvider` contains the provider name
- AND `gatewayStatus` is `PENDING` initially

### Requirement: Bypass Manual Approval for Gateway Payments

When a payment is confirmed via gateway webhook (status transitions to `APPROVED` with `gatewayStatus=COMPLETED`), the system MUST NOT require manual admin approval. The `reviewedByMembershipId` and `approvedByUserId` fields MUST be set to a system identifier (e.g., `system:webhook`) for audit trail purposes.

#### Scenario: Gateway-confirmed payment skips admin review

- GIVEN a payment with `method=ONLINE` confirmed by webhook
- WHEN the webhook handler approves the payment
- THEN `approvedByUserId` is set to `system:webhook`
- AND `reviewedByMembershipId` remains null
- AND the payment does NOT appear in the admin's pending review queue

#### Scenario: Transfer payment still requires admin review

- GIVEN a payment with `method=TRANSFER` and `status=SUBMITTED`
- WHEN queried by admin
- THEN it appears in the pending review queue as before

### Requirement: Payment Response Includes Gateway Fields

The `PaymentDetailDto` response MUST include the new gateway fields when present. Frontend consumers MUST be able to determine if a payment was processed via gateway and its current gateway status.

#### Scenario: Payment detail includes gateway info

- GIVEN an online payment with gateway fields populated
- WHEN `GET /finanzas/buildings/:buildingId/payments/:paymentId` is called
- THEN the response includes `gatewayPaymentId`, `gatewayProvider`, `gatewayStatus`

### Requirement: Audit Log for Gateway Payment Events

The system MUST create `PaymentAuditLog` entries for gateway-specific events: `GATEWAY_CHECKOUT_CREATED`, `GATEWAY_PAYMENT_CONFIRMED`, `GATEWAY_PAYMENT_FAILED`, `GATEWAY_WEBHOOK_DUPLICATE`. These entries MUST include the `gatewayPaymentId` and relevant metadata.

#### Scenario: Audit log on checkout creation

- GIVEN a resident initiates an online payment
- WHEN the checkout session is created
- THEN a `PaymentAuditLog` entry is created with action `GATEWAY_CHECKOUT_CREATED`

#### Scenario: Audit log on webhook confirmation

- GIVEN a webhook confirms a payment
- WHEN the payment is approved
- THEN a `PaymentAuditLog` entry is created with action `GATEWAY_PAYMENT_CONFIRMED`
