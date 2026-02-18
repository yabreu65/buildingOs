import { useState, useEffect, useCallback } from 'react';
import { ScopedRole } from '../auth/auth.types';
import {
  listMemberRoles,
  addMemberRole,
  removeMemberRole,
  AddRoleInput,
} from './memberships.api';

interface UseMemberRolesState {
  roles: ScopedRole[];
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook for managing member roles with scopes
 *
 * Usage:
 * const { roles, loading, error, addRole, removeRole, refetch } = useMemberRoles(
 *   tenantId,
 *   membershipId,
 * );
 */
export function useMemberRoles(
  tenantId: string | null,
  membershipId: string | null,
) {
  const [state, setState] = useState<UseMemberRolesState>({
    roles: [],
    loading: false,
    error: null,
  });

  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Load roles on mount or when params change
  useEffect(() => {
    if (!tenantId || !membershipId) return;

    const loadRoles = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const roles = await listMemberRoles(tenantId, membershipId);
        setState((prev) => ({ ...prev, roles, loading: false }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    };

    loadRoles();
  }, [tenantId, membershipId]);

  const addRole = useCallback(
    async (input: AddRoleInput) => {
      if (!tenantId || !membershipId) return;

      setIsAdding(true);
      setAddError(null);

      try {
        const newRole = await addMemberRole(tenantId, membershipId, input);
        setState((prev) => ({
          ...prev,
          roles: [...prev.roles, newRole],
        }));
        return newRole;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setAddError(message);
        throw error;
      } finally {
        setIsAdding(false);
      }
    },
    [tenantId, membershipId],
  );

  const removeRole = useCallback(
    async (roleId: string) => {
      if (!tenantId || !membershipId) return;

      try {
        await removeMemberRole(tenantId, membershipId, roleId);
        setState((prev) => ({
          ...prev,
          roles: prev.roles.filter((r) => r.id !== roleId),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      }
    },
    [tenantId, membershipId],
  );

  const refetch = useCallback(async () => {
    if (!tenantId || !membershipId) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const roles = await listMemberRoles(tenantId, membershipId);
      setState((prev) => ({ ...prev, roles, loading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [tenantId, membershipId]);

  return {
    ...state,
    isAdding,
    addError,
    addRole,
    removeRole,
    refetch,
  };
}
