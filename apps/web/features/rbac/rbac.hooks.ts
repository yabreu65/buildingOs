 'use client';
 import { useMemo } from 'react';
import type { Role } from '@buildingos/contracts';
import { getSession } from '../auth/session.storage';
import { can as canPermission } from './rbac.permissions';

export function useCan(permission: string) {
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
       canPermission(role as Role, permission),
     );
   }, [session, permission]);
   return allowed;
 }
