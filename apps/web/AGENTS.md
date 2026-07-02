# Frontend — Domain Instructions (BuildingOS)

> This file supplements ../../AGENTS.md. Load it when working in apps/web.

## Scope
- Next.js routes, layouts, pages, components, forms, tables, modals, guards, tenant context, resident/admin UX, API integration, and frontend state.

## Mandatory Frontend Rules
- Always operate under `activeTenantId` when working with tenant data.
- Do not create screens that access tenant data without tenant context.
- Respect route context such as `tenantId`, `buildingId`, and `unitId`.
- Frontend validation is UX only; backend validation remains the source of truth.
- Do not hardcode tenant, building, unit, resident, role, or financial data.
- Do not hide backend errors from the user.
- Do not expose admin-only actions to residents.
- Role-based UI must not replace backend authorization.

## Next.js Patterns
- Follow the existing App Router structure.
- Keep route components focused.
- Use loading, empty, error, and success states.
- Avoid unnecessary client components.
- Use server/client boundaries intentionally.
- Do not use `window`, `document`, or `localStorage` inside Server Components.
- Keep tenant/building/unit route params explicit and validated before use.

## React Patterns
- Use functional components and named exports.
- Keep hooks predictable and dependency arrays correct.
- Avoid unnecessary re-renders in large tables and forms.
- Keep component props typed and explicit.
- Reuse existing components, hooks, and UI patterns before creating new ones.

## API Integration
- Use existing API clients, services, or hooks when available.
- Handle loading, error, empty, and success states.
- Do not assume API calls always succeed.
- Show useful error messages from backend responses when safe.
- Do not duplicate critical business rules only in frontend.
- Do not perform financial mutations optimistically unless explicitly approved.
- After financial mutations, refresh or invalidate affected data instead of showing stale totals.
- Do not store sensitive tokens, secrets, or privileged tenant data in localStorage/sessionStorage unless it matches the existing auth pattern.

## Forms
- Prefer React Hook Form + Zod when matching existing patterns.
- Trim text inputs before submit.
- Convert empty optional fields consistently.
- Show server validation errors near the affected field when possible.
- Avoid free-text fields where entity relations are required.
- Confirm destructive or financial actions before submitting.

## Tenant / Navigation Guards
- `activeTenantId` must be respected.
- Tenant, building, and unit navigation must remain layered: tenant → building → unit.
- Do not create loose screens that bypass the tenant/building/unit hierarchy.
- Resident views must only expose allowed resident/unit data.
- Admin views must not leak SuperAdmin-only functionality.

## UI / UX
- Keep copy clear for non-technical building admins and residents.
- Distinguish “gasto”, “liquidación”, “cargo/deuda”, and “pago”.
- Use consistent currency and date formatting.
- Use responsive layouts.
- Preserve accessibility basics: labels, keyboard navigation, readable states.
- Do not hide destructive or financial actions behind ambiguous buttons.
- Financial screens must make clear whether data comes from expenses, liquidations, charges, or payments.

## Testing
- Add focused tests for critical forms, guards, and financial UI flows when applicable.
- Test loading, empty, error, and success states.
- Test error states, not only happy paths.
- Document skipped tests or validations.

## PR Checklist
- [ ] `activeTenantId` respected.
- [ ] Tenant/building/unit route context respected.
- [ ] Loading, error, empty, and success states handled.
- [ ] Forms clean and validate inputs.
- [ ] Backend errors surfaced.
- [ ] Financial wording is consistent.
- [ ] No unauthorized actions exposed in UI.
- [ ] No optimistic financial mutation unless explicitly approved.
