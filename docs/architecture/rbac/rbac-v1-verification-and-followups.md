# RBAC v1 Verification and Follow-ups

## What was achieved in phases 0-6
- Inventoried Prisma, API, shared, and web RBAC layers
- Defined canonical RBAC v1 based on active API runtime behavior
- Aligned shared contracts and shared role-permission mapping to API runtime vocabulary
- Migrated API RBAC compatibility layer to consume shared contracts/packages
- Migrated web RBAC permission checks to consume shared contracts/packages
- Improved auth/request typing toward canonical shared roles

## Verified wins
1. Shared packages no longer advertise the old `properties.*`, `expenses.*`, `tickets.create`, `communications.*` vocabulary in their RBAC contract source
2. API runtime RBAC now points to shared packages instead of keeping a competing permission matrix
3. Web RBAC checks now point to shared packages instead of keeping a separate local matrix
4. Canonical roles remain aligned to Prisma enum values

## Remaining follow-ups before declaring RBAC fully finished
### A. Residual string[] role typing outside the core contract
Still present in multiple auth/controller/service surfaces and should be tightened incrementally to `Role[]` where appropriate.

### B. Non-core permission vocabularies still exist in other domains
Examples still present in app code/comments:
- communications.read / communications.publish
- assistant template permission references
- frontend property-oriented checks in product features
These must be handled as an explicit domain-permission consolidation follow-up, not silently folded into core RBAC.

### C. Temporary API compatibility wrapper remains
- `/apps/api/src/rbac/permissions.ts`
This is acceptable for migration safety, but it is still a wrapper layer.

## Recommended next step after this 7-phase pass
Run a dedicated "RBAC domain permission consolidation" slice for:
- communications permissions
n- property/building naming alignment in product features
- remaining `Role[]` typing propagation across auth/session/request DTOs

## Production-safety assessment
This pass was intentionally runtime-conservative:
- it preserved the API runtime permission vocabulary
- it avoided redesigning assistant tool permissions
- it avoided reinterpreting permission hierarchy semantics

That makes it a safe architectural consolidation step, not a semantic authorization rewrite.
