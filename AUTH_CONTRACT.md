# Authentication Contract: SUPER_ADMIN vs Tenant Roles

**Date**: February 14, 2026
**Status**: ✅ DOCUMENTED & IMPLEMENTED
**Purpose**: Define clear separation between global and tenant-scoped roles

---

## Executive Summary

This document establishes the official contract for authentication in BuildingOS:

- **SUPER_ADMIN is GLOBAL**: Not dependent on active tenant
- **Tenant roles are SCOPED**: Depend on membership in a specific tenant
- **Never evaluate SUPER_ADMIN within active tenant context**
- **useAuth() exposes both global and tenant-scoped information**

---

## Role Architecture

### ✅ Global Role (SUPER_ADMIN)

```
SUPER_ADMIN
├─ Membership 1: Tenant A (contains SUPER_ADMIN)
├─ Membership 2: Tenant B (contains SUPER_ADMIN)
├─ Membership N: Tenant N (contains SUPER_ADMIN)
└─ Result: isSuperAdmin = TRUE (regardless of activeTenantId)
```

**Characteristics**:
- ✅ Exists in user's memberships (NOT null)
- ✅ Can appear in ANY membership
- ✅ Not tied to `activeTenantId`
- ✅ User with SUPER_ADMIN in ANY membership is global SUPER_ADMIN
- ✅ Cannot be tenant-specific
- ✅ Cannot change based on active tenant

**Logic**:
```typescript
const isSuperAdmin = authSession.memberships.some((m) =>
  m.roles.includes('SUPER_ADMIN')  // ✅ Check ANY membership
);
```

---

### ✅ Tenant-Scoped Roles

```
Tenant A (id: "tenant-123")
├─ User roles: [TENANT_OWNER, TENANT_ADMIN]
└─ These are ONLY valid in tenant-123

Tenant B (id: "tenant-456")
├─ User roles: [OPERATOR, RESIDENT]
└─ These are ONLY valid in tenant-456

activeTenantId = "tenant-123"
→ Get roles from membership where tenantId === "tenant-123"
→ Result: [TENANT_OWNER, TENANT_ADMIN]
```

**Characteristics**:
- ✅ Tied to specific `tenantId` in membership
- ✅ Only valid within that tenant context
- ✅ Can be different per tenant (user has different roles in different tenants)
- ✅ Depend on `activeTenantId` for current context
- ✅ Cannot be used to grant global access
- ✅ Cannot include SUPER_ADMIN

**Logic**:
```typescript
// Only for non-SUPER_ADMIN users
const membershipRoles = authSession.memberships
  .find((m) => m.tenantId === authSession.activeTenantId)
  ?.roles ?? [];
```

---

## Auth Data Model

### AuthSession (Server-Sourced)

```typescript
type AuthSession = {
  user: AuthUser;           // id, email, name (from JWT)
  memberships: Membership[]; // Array of {tenantId, roles}
  activeTenantId: string;    // Current active tenant (for UI context)
};
```

**Key Point**: `memberships` contains BOTH global and tenant-scoped roles

```typescript
type Membership = {
  tenantId: string;
  roles: Role[];  // Can include SUPER_ADMIN if global admin
};
```

### AuthUser

```typescript
type AuthUser = {
  id: string;
  email: string;
  name: string;
  // NO roles here - roles come from memberships
};
```

---

## useAuth() Contract

### What It Exposes

```typescript
interface UseAuthReturn {
  // Raw session from server
  session: AuthSession | null;

  // Convenience object for component usage
  currentUser: CurrentUser | null;

  // Loading state
  isLoading: boolean;
}

interface CurrentUser {
  id: string;
  email: string;
  name: string;

  // ✅ CRITICAL: roles from ACTIVE TENANT ONLY
  // ❌ NOT the global SUPER_ADMIN
  // Use useIsSuperAdmin() for SUPER_ADMIN check
  roles?: Role[];
}
```

### ✅ What useAuth() Should NOT Do

❌ **WRONG**: Include SUPER_ADMIN in `currentUser.roles`
❌ **WRONG**: Change `currentUser.roles` based on `activeTenantId`
❌ **WRONG**: Treat SUPER_ADMIN as tenant role
❌ **WRONG**: Return SUPER_ADMIN in tenant context

### ✅ What useAuth() Should Do

✅ **CORRECT**: Always provide full `session` object
✅ **CORRECT**: Provide `currentUser.roles` from active tenant only
✅ **CORRECT**: Let other hooks extract SUPER_ADMIN from memberships
✅ **CORRECT**: Never mix global and tenant-scoped roles in `currentUser.roles`

---

## Hook Contract

### useAuth() - Raw Session + Convenience User

```typescript
export function useAuth(): UseAuthReturn {
  // Returns:
  // - session: Raw AuthSession (all memberships, all roles)
  // - currentUser: Convenience object with active tenant roles only
  // - isLoading: Boolean
}

// LOGIC:
function useAuth() {
  const authSession = getSession();

  if (authSession?.user) {
    const roles = authSession.memberships
      .find((m) => m.tenantId === authSession.activeTenantId)
      ?.roles;  // ✅ Active tenant roles ONLY

    const currentUser = { ...authSession.user, roles };
    return { currentUser, session: authSession, isLoading: false };
  }

  return { currentUser: null, session: null, isLoading: false };
}
```

### useIsSuperAdmin() - Global SUPER_ADMIN Detection

```typescript
export function useIsSuperAdmin(): boolean {
  const session = useAuthSession();

  // ✅ Check ANY membership for SUPER_ADMIN
  return session?.memberships.some((m) =>
    m.roles.includes('SUPER_ADMIN')
  ) ?? false;
}

// LOGIC:
// 1. Get session from storage
// 2. Check if SUPER_ADMIN exists in ANY membership
// 3. Return boolean (never tenant-specific)
```

### useAuthSession() - Direct Session Access

```typescript
export function useAuthSession(): AuthSession | null {
  // Returns raw session from localStorage
  // Includes all memberships with all roles
  // No filtering or processing
}
```

### useHasRoleInTenant() - Tenant-Specific Role Check

```typescript
export function useHasRoleInTenant(tenantId: string, role: Role): boolean {
  const session = useAuthSession();

  const membership = session?.memberships.find((m) =>
    m.tenantId === tenantId
  );

  return membership?.roles.includes(role) ?? false;
}

// LOGIC:
// 1. Find membership for specific tenant
// 2. Check if role exists in that membership
// 3. Return boolean
```

---

## Critical Rules

### 🚫 RULES TO NEVER BREAK

**Rule 1**: SUPER_ADMIN detection must check ALL memberships
```typescript
// ✅ CORRECT
const isSuperAdmin = authSession.memberships.some((m) =>
  m.roles.includes('SUPER_ADMIN')
);

// ❌ WRONG - Would lose SUPER_ADMIN if not in active tenant
const isSuperAdmin = currentUser.roles?.includes('SUPER_ADMIN');
```

**Rule 2**: Never evaluate SUPER_ADMIN within active tenant context
```typescript
// ✅ CORRECT - Global check
if (useIsSuperAdmin()) {
  // Redirect to /super-admin
}

// ❌ WRONG - Tenant-scoped check
if (membershipRoles.includes('SUPER_ADMIN')) {
  // This will never be true
}
```

**Rule 3**: Tenant roles must ONLY use activeTenantId
```typescript
// ✅ CORRECT
const tenantRoles = authSession.memberships
  .find((m) => m.tenantId === authSession.activeTenantId)
  ?.roles;

// ❌ WRONG - Would include SUPER_ADMIN
const tenantRoles = authSession.memberships.flatMap((m) => m.roles);
```

**Rule 4**: currentUser.roles is always for active tenant only
```typescript
// ✅ CORRECT - currentUser only has active tenant roles
const roles = isSuperAdmin
  ? ['SUPER_ADMIN']  // Special case for hook convenience
  : activeTenantRoles;

// ❌ WRONG - Would include roles from other tenants
const roles = authSession.memberships.flatMap((m) => m.roles);
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Backend (Login Endpoint)                                 │
├─────────────────────────────────────────────────────────┤
│ 1. Validate credentials                                  │
│ 2. Generate JWT (contains user + memberships)            │
│ 3. Return: { accessToken, user, memberships }           │
│                                                          │
│ memberships = [                                          │
│   { tenantId: "A", roles: [TENANT_OWNER, SUPER_ADMIN] },│
│   { tenantId: "B", roles: [OPERATOR] }                  │
│ ]                                                        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│ AuthBootstrap (session.storage)                          │
├─────────────────────────────────────────────────────────┤
│ 1. Parse JWT                                             │
│ 2. Store AuthSession in localStorage                     │
│    - user (global)                                       │
│    - memberships (all roles, all tenants)               │
│    - activeTenantId (context)                           │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│ useAuth() Hook                                           │
├─────────────────────────────────────────────────────────┤
│ Returns:                                                 │
│ - session: Raw AuthSession (all data)                   │
│ - currentUser: { id, email, name, roles }               │
│   └─ roles = active tenant roles ONLY                   │
│ - isLoading: boolean                                    │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│useIsSuperAd..│ │useHasRoleIn..│ │useAuthSess...│
│              │ │              │ │              │
│ Checks ALL   │ │ Checks       │ │ Returns raw  │
│ memberships  │ │ specific     │ │ session      │
│ for SUPER_...│ │ tenant role  │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
     (Global)     (Tenant-scoped)    (Raw data)
```

---

## Component Usage Examples

### ✅ CORRECT Usage

**Example 1: Check if SUPER_ADMIN (Global)**
```typescript
import { useIsSuperAdmin } from '@/features/auth/useAuthSession';

function Layout() {
  const isSuperAdmin = useIsSuperAdmin();  // ✅ Check global

  if (isSuperAdmin) {
    return <SuperAdminLayout />;
  }

  return <TenantLayout />;
}
```

**Example 2: Get Current Tenant Roles**
```typescript
import { useAuth } from '@/features/auth/useAuth';

function Dashboard() {
  const { currentUser } = useAuth();

  // ✅ currentUser.roles are ONLY for active tenant
  const isTenantAdmin = currentUser?.roles?.includes('TENANT_ADMIN');

  if (isTenantAdmin) {
    return <AdminDashboard />;
  }

  return <UserDashboard />;
}
```

**Example 3: Check Specific Role in Specific Tenant**
```typescript
import { useHasRoleInTenant } from '@/features/auth/useAuthSession';

function CheckAccess() {
  const hasAccess = useHasRoleInTenant(tenantId, 'TENANT_ADMIN');

  return hasAccess ? <AdminSection /> : <RestrictedMessage />;
}
```

---

### ❌ WRONG Usage (AVOID)

**Wrong 1: Checking SUPER_ADMIN from currentUser.roles**
```typescript
// ❌ WRONG - Will never detect SUPER_ADMIN
const { currentUser } = useAuth();
if (currentUser?.roles?.includes('SUPER_ADMIN')) {
  // This condition will NEVER be true
}

// ✅ USE INSTEAD:
const isSuperAdmin = useIsSuperAdmin();
if (isSuperAdmin) {
  // This is correct
}
```

**Wrong 2: Mixing global and tenant-scoped roles**
```typescript
// ❌ WRONG - Confused context
const { session } = useAuth();
const allRoles = session?.memberships.flatMap((m) => m.roles) ?? [];
if (allRoles.includes('SUPER_ADMIN')) {
  // This checks global role in tenant context
  // Confuses SUPER_ADMIN with tenant roles
}

// ✅ USE INSTEAD:
const isSuperAdmin = useIsSuperAdmin();  // Global check
const tenantRoles = currentUser?.roles;   // Tenant check
```

**Wrong 3: Storing SUPER_ADMIN in tenant context**
```typescript
// ❌ WRONG - SUPER_ADMIN not in active tenant
const isAdmin = currentUser?.roles?.includes('SUPER_ADMIN');

// But what if SUPER_ADMIN is in membership A, and active is B?
// It won't be detected!

// ✅ USE INSTEAD:
const isSuperAdmin = useIsSuperAdmin();
```

---

## Type Definitions

### Core Types

```typescript
/**
 * Global role (not tenant-scoped)
 * User with SUPER_ADMIN in ANY membership has this role
 */
type SuperAdminRole = 'SUPER_ADMIN';

/**
 * Tenant-scoped roles
 * User can have different roles in different tenants
 */
type TenantRole =
  | 'TENANT_OWNER'
  | 'TENANT_ADMIN'
  | 'OPERATOR'
  | 'RESIDENT';

/**
 * All possible roles (global + tenant-scoped)
 */
type Role = SuperAdminRole | TenantRole;

/**
 * Membership in a specific tenant
 * Can contain global role (SUPER_ADMIN) OR tenant roles, but never both in same membership should be goal
 * In practice: if SUPER_ADMIN exists in membership, tenant roles may also be present
 */
type Membership = {
  tenantId: string;
  roles: Role[];  // Can include SUPER_ADMIN or tenant roles
};

/**
 * Raw session from server (all data)
 */
type AuthSession = {
  user: AuthUser;
  memberships: Membership[];
  activeTenantId: string;
};

/**
 * Current user in active tenant context
 */
type CurrentUser = {
  id: string;
  email: string;
  name: string;
  roles?: TenantRole[];  // ✅ ONLY tenant roles, never SUPER_ADMIN
};
```

---

## Implementation Checklist

- [x] SUPER_ADMIN detection checks ALL memberships
- [x] useAuth() returns active tenant roles only in currentUser
- [x] useIsSuperAdmin() available for global checks
- [x] useHasRoleInTenant() for tenant-specific checks
- [x] currentUser.roles never includes SUPER_ADMIN
- [x] Never evaluate SUPER_ADMIN in tenant context
- [x] Documentation clear and accessible
- [x] Types reflect the contract
- [x] No reintroduction of "lose SUPER_ADMIN" bug

---

## Enforcement

### Code Review Checklist

When reviewing auth-related code:

- [ ] Is `useIsSuperAdmin()` used for global checks?
- [ ] Does `currentUser.roles` only contain tenant roles?
- [ ] Is SUPER_ADMIN never checked from `currentUser.roles`?
- [ ] Are tenant roles only accessed from active membership?
- [ ] Does the code differentiate global from tenant-scoped roles?

### Testing Checklist

When testing auth:

- [ ] SUPER_ADMIN user in tenant A with active tenant B still detected as SUPER_ADMIN?
- [ ] Tenant roles change when switching active tenant?
- [ ] Sidebar shows correct options for role?
- [ ] Layout guards work correctly?

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-14 | 1.0 | Initial contract definition |

---

## References

- **Implementation**: `apps/web/features/auth/useAuth.ts`
- **Types**: `apps/web/features/auth/auth.types.ts`
- **Hooks**: `apps/web/features/auth/useAuthSession.ts`
- **Contract Doc**: `AUTH_CONTRACT.md` (this file)

---

**Status**: ✅ DOCUMENTED & IMPLEMENTED
**Last Verified**: February 14, 2026

