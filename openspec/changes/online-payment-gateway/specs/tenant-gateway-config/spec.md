# Tenant Gateway Configuration Specification

## Purpose

Allow tenant administrators to configure which payment gateway provider to use and store the provider-specific credentials (API keys, webhook secrets) needed to process online payments. Configuration is tenant-scoped and credentials are encrypted at rest.

## Requirements

### Requirement: Gateway Provider Selection

The system MUST allow a tenant administrator to select a gateway provider (`MERCADOPAGO` or `STRIPE`) for their tenant. Only one provider SHALL be active at a time. The system MUST reject provider selection if the user lacks `TENANT_ADMIN` or `TENANT_OWNER` role.

#### Scenario: Admin selects MercadoPago

- GIVEN a tenant admin is authenticated
- WHEN they set the gateway provider to `MERCADOPAGO`
- THEN the system stores the provider selection in `GatewayConfig`
- AND the tenant's online payments will use MercadoPago

#### Scenario: Non-admin attempts provider selection

- GIVEN a user with `RESIDENT` or `OPERATOR` role
- WHEN they attempt to set the gateway provider
- THEN the system MUST reject with HTTP 403 Forbidden

### Requirement: Credential Storage and Encryption

The system MUST store gateway credentials (API public key, API secret key, webhook secret) encrypted using AES-256 encryption at rest. Credentials MUST NOT appear in logs, API responses, or error messages. The system MUST support updating credentials without downtime.

#### Scenario: Admin stores MercadoPago credentials

- GIVEN a tenant admin with provider set to `MERCADOPAGO`
- WHEN they submit `{ publicKey, accessToken, webhookSecret }`
- THEN the system encrypts all credential fields with AES-256
- AND stores them in `GatewayConfig`
- AND returns a success response with credentials masked (e.g., `accessToken: "****...abc"`)

#### Scenario: Admin stores Stripe credentials

- GIVEN a tenant admin with provider set to `STRIPE`
- WHEN they submit `{ publishableKey, secretKey, webhookSecret }`
- THEN the system encrypts and stores them
- AND the API response never includes plaintext secrets

#### Scenario: Credential retrieval masks secrets

- GIVEN stored gateway credentials exist for a tenant
- WHEN an admin requests `GET /billing/gateway-config`
- THEN the response includes provider name and masked credentials (last 4 chars only)

### Requirement: Gateway Configuration CRUD

The system MUST provide CRUD endpoints for gateway configuration scoped to `tenantId`. Only `TENANT_ADMIN` and `TENANT_OWNER` roles MAY create, update, or delete gateway configuration. The system MUST validate that credentials are functional before activating (test API call to provider).

#### Scenario: Create gateway configuration

- GIVEN a tenant has no existing gateway config
- WHEN admin submits valid provider + credentials
- THEN the system creates a `GatewayConfig` record
- AND validates credentials via a test API call to the provider
- AND returns the config with masked credentials

#### Scenario: Update gateway credentials

- GIVEN a tenant has an existing `GatewayConfig` with MercadoPago
- WHEN admin updates the `accessToken`
- THEN the system re-encrypts the new credential
- AND validates the new credential via test API call
- AND preserves the provider selection

#### Scenario: Delete gateway configuration

- GIVEN a tenant has an active `GatewayConfig`
- WHEN admin deletes the configuration
- THEN the system soft-deletes the `GatewayConfig` (sets `deletedAt`)
- AND online payment options become unavailable for the tenant's residents

#### Scenario: Invalid credentials rejected

- GIVEN a tenant admin submits credentials that fail the provider test API call
- WHEN the system attempts to validate
- THEN the system MUST reject with HTTP 422 and message "Gateway credentials are invalid"
- AND MUST NOT store the invalid credentials

### Requirement: GatewayConfig Data Model

The system MUST persist gateway configuration in a `GatewayConfig` Prisma model with the following fields: `id` (cuid), `tenantId` (FK, unique), `provider` (enum: MERCADOPAGO, STRIPE), `encryptedPublicKey`, `encryptedSecretKey`, `encryptedWebhookSecret`, `isActive` (boolean), `createdAt`, `updatedAt`, `deletedAt` (soft delete). The model MUST enforce one active config per tenant via `@@unique([tenantId])` where `deletedAt IS NULL`.

#### Scenario: One active config per tenant

- GIVEN a tenant already has an active `GatewayConfig`
- WHEN admin attempts to create a second config
- THEN the system MUST reject with HTTP 409 Conflict

### Requirement: Tenant Relation on GatewayConfig

The `GatewayConfig` model MUST have a relation to the `Tenant` model. The `Tenant` model MUST include a `gatewayConfig` relation field. Cascade delete MUST apply when the tenant is deleted.

#### Scenario: Tenant deletion cascades gateway config

- GIVEN a tenant with an active `GatewayConfig`
- WHEN the tenant is deleted
- THEN the `GatewayConfig` is cascade-deleted
