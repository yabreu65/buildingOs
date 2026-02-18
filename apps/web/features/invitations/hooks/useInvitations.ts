import { useState, useCallback } from 'react';
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
  fetchMembers: (tenantId: string) => Promise<void>;
  fetchInvitations: (tenantId: string) => Promise<void>;
  refetch: (tenantId: string) => Promise<void>;
  createInvitation: (tenantId: string, dto: CreateInvitationRequest) => Promise<void>;
  revokeInvitation: (tenantId: string, invitationId: string) => Promise<void>;
  resendInvitation: (tenantId: string, invitationId: string) => Promise<void>;
}

export function useInvitations(): UseInvitationsState & UseInvitationsActions {
  const [state, setState] = useState<UseInvitationsState>({
    members: [],
    pendingInvitations: [],
    loading: false,
    error: null,
  });

  const fetchMembers = useCallback(async (tenantId: string) => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const members = await invitationsApi.listMembers(tenantId);
      setState((prev) => ({ ...prev, members, loading: false }));
    } catch (err: any) {
      const message = err?.message || 'Erro ao carregar membros';
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  }, []);

  const fetchInvitations = useCallback(async (tenantId: string) => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const pendingInvitations = await invitationsApi.listInvitations(tenantId);
      setState((prev) => ({ ...prev, pendingInvitations, loading: false }));
    } catch (err: any) {
      const message = err?.message || 'Erro ao carregar convites pendentes';
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  }, []);

  const refetch = useCallback(
    async (tenantId: string) => {
      await Promise.all([
        fetchMembers(tenantId),
        fetchInvitations(tenantId),
      ]);
    },
    [fetchMembers, fetchInvitations],
  );

  const createInvitation = useCallback(
    async (tenantId: string, dto: CreateInvitationRequest) => {
      try {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        await invitationsApi.createInvitation(tenantId, dto);
        // Refetch invitations after creation
        await fetchInvitations(tenantId);
        setState((prev) => ({ ...prev, loading: false }));
      } catch (err: any) {
        const message = err?.message || 'Erro ao enviar convite';
        setState((prev) => ({ ...prev, error: message, loading: false }));
        throw err;
      }
    },
    [fetchInvitations],
  );

  const revokeInvitation = useCallback(
    async (tenantId: string, invitationId: string) => {
      try {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        await invitationsApi.revokeInvitation(tenantId, invitationId);
        // Refetch invitations after revocation
        await fetchInvitations(tenantId);
        setState((prev) => ({ ...prev, loading: false }));
      } catch (err: any) {
        const message = err?.message || 'Erro ao revogar convite';
        setState((prev) => ({ ...prev, error: message, loading: false }));
        throw err;
      }
    },
    [fetchInvitations],
  );

  const resendInvitation = useCallback(
    async (tenantId: string, invitationId: string) => {
      try {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        await invitationsApi.resendInvitation(tenantId, invitationId);
        // Refetch invitations after resending
        await fetchInvitations(tenantId);
        setState((prev) => ({ ...prev, loading: false }));
      } catch (err: any) {
        const message = err?.message || 'Erro ao reenviar convite';
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
