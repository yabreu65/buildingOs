import { useState, useCallback, useEffect, useRef } from 'react';
import {
  invitationsApi,
  CreateInvitationRequest,
  Member,
  PendingInvitation,
} from '../services/invitations.api';

export interface UseInvitationsState {
  members: Member[];
  pendingInvitations: PendingInvitation[];
  loading: boolean;
  error: string | null;
}

export interface UseInvitationsActions {
  fetchMembers: () => Promise<void>;
  fetchInvitations: () => Promise<void>;
  refetch: () => Promise<void>;
  createInvitation: (dto: CreateInvitationRequest) => Promise<void>;
  revokeInvitation: (invitationId: string) => Promise<void>;
  resendInvitation: (invitationId: string) => Promise<void>;
}

const initialState: UseInvitationsState = {
  members: [],
  pendingInvitations: [],
  loading: false,
  error: null,
};

export function useInvitations(tenantId: string | null): UseInvitationsState & UseInvitationsActions {
  const [state, setState] = useState<UseInvitationsState>(initialState);
  const tenantRef = useRef<string | null>(tenantId);
  const scopeRef = useRef(0);

  useEffect(() => {
    tenantRef.current = tenantId;
    scopeRef.current += 1;
    setState(initialState);
  }, [tenantId]);

  const isCurrentScope = useCallback((scope: number, scopeTenantId: string | null) => {
    return scopeRef.current === scope && tenantRef.current === scopeTenantId;
  }, []);

  const fetchMembers = useCallback(async () => {
    const scopeTenantId = tenantRef.current;
    if (!scopeTenantId) {
      return;
    }

    const scope = scopeRef.current;
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const members = await invitationsApi.listMembers(scopeTenantId);
      if (!isCurrentScope(scope, scopeTenantId)) {
        return;
      }
      setState((prev) => ({ ...prev, members, loading: false }));
    } catch (err: unknown) {
      if (!isCurrentScope(scope, scopeTenantId)) {
        return;
      }
      const message = err instanceof Error ? err.message : 'Erro ao carregar membros';
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  }, [isCurrentScope]);

  const fetchInvitations = useCallback(async () => {
    const scopeTenantId = tenantRef.current;
    if (!scopeTenantId) {
      return;
    }

    const scope = scopeRef.current;
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const pendingInvitations = await invitationsApi.listInvitations(scopeTenantId);
      if (!isCurrentScope(scope, scopeTenantId)) {
        return;
      }
      setState((prev) => ({ ...prev, pendingInvitations, loading: false }));
    } catch (err: unknown) {
      if (!isCurrentScope(scope, scopeTenantId)) {
        return;
      }
      const message = err instanceof Error ? err.message : 'Erro ao carregar convites pendentes';
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  }, [isCurrentScope]);

  const refetch = useCallback(
    async () => {
      await Promise.all([
        fetchMembers(),
        fetchInvitations(),
      ]);
    },
    [fetchMembers, fetchInvitations],
  );

  const createInvitation = useCallback(
    async (dto: CreateInvitationRequest) => {
      const scopeTenantId = tenantRef.current;
      if (!scopeTenantId) {
        return;
      }

      const scope = scopeRef.current;
      try {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        await invitationsApi.createInvitation(scopeTenantId, dto);
        if (!isCurrentScope(scope, scopeTenantId)) {
          return;
        }
        // Refetch invitations after creation
        await fetchInvitations();
        setState((prev) => ({ ...prev, loading: false }));
      } catch (err: unknown) {
        if (!isCurrentScope(scope, scopeTenantId)) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Erro ao enviar convite';
        setState((prev) => ({ ...prev, error: message, loading: false }));
        throw err;
      }
    },
    [fetchInvitations],
  );

  const revokeInvitation = useCallback(
    async (invitationId: string) => {
      const scopeTenantId = tenantRef.current;
      if (!scopeTenantId) {
        return;
      }

      const scope = scopeRef.current;
      try {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        await invitationsApi.revokeInvitation(scopeTenantId, invitationId);
        if (!isCurrentScope(scope, scopeTenantId)) {
          return;
        }
        // Refetch invitations after revocation
        await fetchInvitations();
        setState((prev) => ({ ...prev, loading: false }));
      } catch (err: unknown) {
        if (!isCurrentScope(scope, scopeTenantId)) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Erro ao revogar convite';
        setState((prev) => ({ ...prev, error: message, loading: false }));
        throw err;
      }
    },
    [fetchInvitations],
  );

  const resendInvitation = useCallback(
    async (invitationId: string) => {
      const scopeTenantId = tenantRef.current;
      if (!scopeTenantId) {
        return;
      }

      const scope = scopeRef.current;
      try {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        await invitationsApi.resendInvitation(scopeTenantId, invitationId);
        if (!isCurrentScope(scope, scopeTenantId)) {
          return;
        }
        // Refetch invitations after resending
        await fetchInvitations();
        setState((prev) => ({ ...prev, loading: false }));
      } catch (err: unknown) {
        if (!isCurrentScope(scope, scopeTenantId)) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Erro ao reenviar convite';
        setState((prev) => ({ ...prev, error: message, loading: false }));
        throw err;
      }
    },
    [fetchInvitations],
  );

  return {
    ...state,
    fetchMembers,
    fetchInvitations,
    refetch,
    createInvitation,
    revokeInvitation,
    resendInvitation,
  };
}
