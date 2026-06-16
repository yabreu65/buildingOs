# Email Delivery Specification

## Purpose

Provider-agnostic email delivery with retry, delivery tracking, and graceful degradation to no-op when no provider is configured.

## Requirements

### Requirement: Email Provider Interface

The system SHALL define an `EmailProvider` interface with methods for sending emails, checking delivery status, and handling bounces. Each adapter (Resend, SMTP, SES, NoOp) SHALL implement this interface.

#### Scenario: Provider adapter implements interface

- GIVEN an `EmailProvider` interface with `send`, `getDeliveryStatus`, and `handleBounce` methods
- WHEN a Resend adapter is instantiated
- THEN it implements all interface methods using the Resend SDK

#### Scenario: Provider selection via env var

- GIVEN `MAIL_PROVIDER=resend`
- WHEN the email module initializes
- THEN the Resend adapter is registered as the active provider

### Requirement: Graceful Degradation

The system SHALL support `MAIL_PROVIDER=none` which registers a no-op provider. All email send calls SHALL succeed without sending when no-op is active.

#### Scenario: No-op provider sends email

- GIVEN `MAIL_PROVIDER=none`
- WHEN `emailService.send()` is called with an invitation email
- THEN the call returns success without making any network request

#### Scenario: No-op provider tracks delivery

- GIVEN `MAIL_PROVIDER=none`
- WHEN `emailService.getDeliveryStatus(id)` is called
- THEN it returns a "skipped" status without error

### Requirement: Email Sending with Retry

The system SHALL retry failed email sends up to 3 times with exponential backoff. Permanent failures (invalid recipient, blocked domain) SHALL NOT be retried.

#### Scenario: Transient failure retried

- GIVEN the email provider returns a 5xx error
- WHEN `emailService.send()` is called
- THEN the system retries up to 3 times with exponential backoff

#### Scenario: Permanent failure not retried

- GIVEN the email provider returns a 4xx error (invalid recipient)
- WHEN `emailService.send()` is called
- THEN no retry is attempted and the error is returned immediately

### Requirement: Email Templates and Use Cases

The system SHALL support sending invitation emails, password reset emails, and payment notification emails. Each template SHALL be renderable with tenant-specific branding.

#### Scenario: Invitation email sent

- GIVEN a new user is invited to a tenant
- WHEN the invitation is created
- THEN an email is sent with the tenant's branding and a unique invite link

#### Scenario: Password reset email sent

- GIVEN a user requests password reset
- WHEN the request is validated
- THEN an email is sent with a time-limited reset token

#### Scenario: Payment notification email sent

- GIVEN a charge transitions to `PAID`
- WHEN the status change is confirmed
- THEN an email is sent to the payer with receipt details

### Requirement: Delivery Tracking

The system SHALL track email delivery status per message: `queued`, `sent`, `delivered`, `bounced`, `failed`. Status SHALL be queryable by message ID.

#### Scenario: Delivery status queried

- GIVEN an email was sent with tracking ID `msg-123`
- WHEN `emailService.getDeliveryStatus("msg-123")` is called
- THEN the current delivery status is returned

### Requirement: Bounce Handling and Deliverability

The system SHALL process bounce notifications and mark affected emails as `bounced`. The system SHALL be configured with SPF/DKIM/DMARC-aware sending domains.

#### Scenario: Bounce notification processed

- GIVEN a bounce webhook arrives for a previously sent email
- WHEN the bounce handler processes it
- THEN the email status is updated to `bounced` and the user is flagged

#### Scenario: SPF/DKIM configuration awareness

- GIVEN the email provider supports custom domains
- WHEN the system sends emails
- THEN emails are sent from the tenant's verified domain with proper headers
