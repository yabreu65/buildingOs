# Webhook Payment Confirmation Specification

## Purpose

Process asynchronous payment confirmation events from external gateways (MercadoPago, Stripe) via webhooks. The webhook handler MUST be idempotent, validate provider signatures, and reliably update payment status and trigger automatic allocation.

## Requirements

### Requirement: Webhook Endpoint

The system MUST expose a webhook endpoint at `POST /webhooks/payments/:provider` where `:provider` is `mercadopago` or `stripe`. The endpoint MUST be publicly accessible (no JWT authentication) but MUST validate the request using the provider's signature verification mechanism. The endpoint MUST return HTTP 200 within 5 seconds to prevent provider retries.

#### Scenario: Valid MercadoPago webhook

- GIVEN MercadoPago sends a `payment` event with valid signature headers (`x-signature`, `x-request-id`)
- WHEN the webhook endpoint receives the request
- THEN the system validates the signature using the tenant's stored `webhookSecret`
- AND processes the event asynchronously
- AND returns HTTP 200 immediately

#### Scenario: Valid Stripe webhook

- GIVEN Stripe sends a `checkout.session.completed` event with valid `Stripe-Signature` header
- WHEN the webhook endpoint receives the request
- THEN the system validates the signature using the stored webhook signing secret
- AND processes the event
- AND returns HTTP 200

#### Scenario: Invalid signature rejected

- GIVEN a request arrives at the webhook endpoint with an invalid or missing signature
- WHEN the system attempts signature verification
- THEN the system MUST return HTTP 401 Unauthorized
- AND MUST NOT process the event
- AND MUST log the rejected attempt for security monitoring

#### Scenario: Unknown provider rejected

- GIVEN a request arrives at `/webhooks/payments/unknown-provider`
- WHEN the system receives the request
- THEN the system MUST return HTTP 404 Not Found

### Requirement: Idempotent Event Processing

The system MUST process each gateway payment event exactly once. Idempotency MUST be enforced via the `gatewayPaymentId` UNIQUE constraint on the Payment model. If a webhook is received for an already-processed `gatewayPaymentId`, the system MUST return HTTP 200 without re-processing.

#### Scenario: Duplicate webhook delivery

- GIVEN a payment with `gatewayPaymentId=mp_123` has already been approved
- WHEN MercadoPago re-delivers the same `payment.completed` event
- THEN the system detects the payment is already in `APPROVED` status
- AND returns HTTP 200 without modifying any data
- AND logs the duplicate delivery

#### Scenario: First-time webhook processing

- GIVEN a payment with `gatewayPaymentId=mp_456` is in `SUBMITTED` status
- WHEN the gateway sends `payment.completed`
- THEN the system updates the payment to `APPROVED`
- AND sets `paidAt`, `gatewayStatus=COMPLETED`
- AND triggers auto-allocation

### Requirement: Tenant Resolution from Webhook Payload

The system MUST resolve the correct tenant from the webhook payload. The `gatewayPaymentId` stored on the Payment record MUST be used to look up the associated `tenantId`. All subsequent processing (credential decryption, status update, allocation) MUST use the resolved tenant context.

#### Scenario: Resolve tenant from gatewayPaymentId

- GIVEN a webhook payload containing `gatewayPaymentId=mp_789`
- WHEN the system processes the webhook
- THEN it queries `Payment` by `gatewayPaymentId` to find the associated `tenantId`
- AND uses that tenant's `GatewayConfig` for signature verification

#### Scenario: gatewayPaymentId not found

- GIVEN a webhook payload with a `gatewayPaymentId` that does not match any Payment record
- WHEN the system processes the webhook
- THEN the system MUST log the unrecognized event
- AND return HTTP 200 (to prevent provider retries for unknown events)
- AND MUST NOT throw an error or retry

### Requirement: Raw Webhook Payload Storage

The system MUST store the raw webhook payload in `Payment.gatewayRawResponse` (JSON field) for audit and debugging purposes. The raw payload MUST be stored regardless of processing outcome (success, failure, duplicate).

#### Scenario: Store raw payload on success

- GIVEN a valid webhook event is processed successfully
- WHEN the payment status is updated
- THEN `gatewayRawResponse` is set to the full raw JSON payload from the provider

#### Scenario: Store raw payload on failure

- GIVEN a webhook event indicates payment failure
- WHEN the system processes the event
- THEN `gatewayRawResponse` includes the failure details from the provider

### Requirement: Webhook Processing Error Handling

The system MUST handle processing errors gracefully. If the database update fails after signature validation, the system MUST return HTTP 500 to trigger provider retry. The system MUST NOT return HTTP 200 if the payment status was not successfully persisted.

#### Scenario: Database failure during processing

- GIVEN a valid webhook with correct signature
- WHEN the database update fails (e.g., connection timeout)
- THEN the system MUST return HTTP 500
- AND the provider will retry the webhook delivery

#### Scenario: Concurrent webhook processing

- GIVEN two identical webhooks arrive simultaneously for the same `gatewayPaymentId`
- WHEN both attempt to update the payment status
- THEN only one succeeds (due to UNIQUE constraint or optimistic locking)
- AND the other returns HTTP 200 as a duplicate without side effects

### Requirement: Webhook Event Type Handling

The system MUST handle the following event types from each provider:

| Provider | Event Type | Action |
|----------|-----------|--------|
| MercadoPago | `payment` with `status=approved` | Approve payment, trigger allocation |
| MercadoPago | `payment` with `status=rejected` | Reject payment |
| Stripe | `checkout.session.completed` with `payment_status=paid` | Approve payment, trigger allocation |
| Stripe | `checkout.session.expired` | Mark payment as expired/rejected |

Unknown event types MUST be logged and ignored (return HTTP 200).

#### Scenario: MercadoPago approved payment

- GIVEN a MercadoPago webhook with event type `payment` and `data.status=approved`
- WHEN processed
- THEN the payment is approved and auto-allocated

#### Scenario: Stripe expired session

- GIVEN a Stripe webhook with event type `checkout.session.expired`
- WHEN processed
- THEN the payment status is set to `REJECTED` with `gatewayStatus=EXPIRED`

#### Scenario: Unknown event type

- GIVEN a webhook with an unrecognized event type
- WHEN processed
- THEN the system logs the event type and returns HTTP 200
