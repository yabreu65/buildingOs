 'use client';
 import { useMemo } from 'react';
 import { getSession } from '../auth/session.storage';
 import { can as canPermission } from './rbac.permissions';
 import type { Permission } from './rbac.types';

 export function useCan(permission: Permission) {
   const session = getSession();
   const allowed = useMemo(() => {
     if (!session) return false;
     // Get roles from active tenant membership
     const activeMembership = session.memberships.find(
       (m) => m.tenantId === session.activeTenantId,
     );
     if (!activeMembership || activeMembership.roles.length === 0) return false;
     // Check if any role has permission
     return activeMembership.roles.some((role) =>
       canPermission(role, permission),
     );
   }, [session, permission]);
   return allowed;
 }
