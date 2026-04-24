# ADR-002: Runtime P0 Enforcement for Assistant Operational Queries

- Status: Accepted
- Date: 2026-04-24
- Owners: BuildingOS Backend + AI Integration

## Context

BuildingOS currently supports mixed assistant strategies (strict operational, yoryi bridge, local provider fallback). P0 requires deterministic behavior for operational admin/operator queries.

## Decision

1. `yoryi-ai-core` is primary for P0 operational runtime when bridge flag is enabled.
2. `answerSource=knowledge` responses from yoryi are rejected in P0.
3. Local fallback is only allowed when yoryi is disabled/unavailable.
4. Internal tools endpoint (`/assistant/tools/:toolName`) is enabled with allowlist and tenant/RBAC enforcement.
5. Response schema is unified and versioned (`2026-04-p0-response-v1`).

## Rationale

- Prevent non-deterministic doctrinal responses in operational flows.
- Maintain tenant isolation and auditable role-based access for tool execution.
- Preserve resilience with controlled fallback on availability events.

## Consequences

Positive:

- Stronger runtime governance and safer answers for administrative workflows.
- Better observability via audit of `intent/tool/result` per tenant.

Negative:

- More clarification responses when context is ambiguous.
- Additional maintenance for contracts and fallback parity.

## References

- `docs/architecture/constraints.md`
- `docs/overlays/core-overlay.md`
- `../yoryi-ai-core/docs/ai-assistant/05-governance-brain-guard.md`
