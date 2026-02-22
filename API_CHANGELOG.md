# API Changelog

## 2026-02-22

### AI Caps/Overrides Endpoint Normalization

- Canonical route (new standard):
  - `GET /super-admin/tenants/:tenantId/ai/caps`
  - `PATCH /super-admin/tenants/:tenantId/ai/caps`
- Legacy alias kept temporarily for compatibility:
  - `GET /super-admin/tenants/:tenantId/ai-overrides`
  - `PATCH /super-admin/tenants/:tenantId/ai-overrides`

#### Deprecation policy (legacy alias)
- `Deprecation: true`
- `Sunset: 2026-03-24`
- `Link: </super-admin/tenants/:tenantId/ai/caps>; rel="successor-version"`

Notes:
- Both canonical and alias routes use the same backend logic (`AiCapsService`).
- Frontend should use only canonical route from this release onward.
