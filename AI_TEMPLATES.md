# AI Templates (MVP)

## Seed policy
- Seed is idempotent via `upsert` by `key`.
- Running seed multiple times does not create duplicates.
- Existing templates are never deleted by seed.
- Seed updates mutable fields (`name`, `description`, prompts, category, permissions, etc.).

## Seeded templates
- `INBOX_PRIORITIZE`
- `TICKET_REPLY_DRAFT`
- `COMMUNICATION_DRAFT_GENERAL`
- `COMMUNICATION_PAYMENT_REMINDER`
- `FINANCE_EXPLAIN_BALANCE`

## Runtime
- Templates are global (`tenantId = null`) and active by default.
- API endpoint to list available templates:
  - `GET /assistant/templates`
- API endpoint to execute template:
  - `POST /assistant/template-run`
