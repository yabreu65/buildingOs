'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  tenantMembersApi,
  TenantMember,
  AssignableResident,
  CreateMemberInput,
  UpdateMemberInput,
  TenantInvitation,
} from '../api/tenant-members.api';

// Query keys
export const tenantMembersKeys = {
  all: (tenantId: string) => ['tenantMembers', tenantId] as const,
  assignable: (tenantId: string, unitId?: string) =>
    ['tenantMembers', tenantId, 'assignable', unitId] as const,
  member: (tenantId: string, memberId: string) =>
    ['tenantMembers', tenantId, 'member', memberId] as const,
  list: (tenantId: string, status?: string) =>
    ['tenantMembers', tenantId, 'list', status] as const,
};

/**
 * Hook to create a new tenant member
 */
export function useCreateTenantMember(tenantId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateMemberInput) => tenantMembersApi.createMember(tenantId, input),
    onSuccess: () => {
      // Invalidate all member queries
      queryClient.invalidateQueries({
        queryKey: tenantMembersKeys.all(tenantId),
      });
    },
  });
}

/**
 * Hook to update a tenant member
 */
export function useUpdateTenantMember(tenantId: string, memberId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateMemberInput) =>
      tenantMembersApi.updateMember(tenantId, memberId, input),
    onSuccess: () => {
      // Invalidate member-specific queries
      queryClient.invalidateQueries({
        queryKey: tenantMembersKeys.member(tenantId, memberId),
      });
      queryClient.invalidateQueries({
        queryKey: tenantMembersKeys.all(tenantId),
      });
    },
  });
}

/**
 * Hook to send invitation to a member
 */
export function useInviteTenantMember(tenantId: string, memberId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (force?: boolean) => tenantMembersApi.inviteMember(tenantId, memberId, force),
    onSuccess: () => {
      // Invalidate member-specific queries
      queryClient.invalidateQueries({
        queryKey: tenantMembersKeys.member(tenantId, memberId),
      });
      queryClient.invalidateQueries({
        queryKey: tenantMembersKeys.all(tenantId),
      });
    },
  });
}

/**
 * Hook to get members assignable to units
 */
export function useAssignableResidents(tenantId: string, unitId?: string) {
  return useQuery({
    queryKey: tenantMembersKeys.assignable(tenantId, unitId),
    queryFn: () => tenantMembersApi.getAssignableResidents(tenantId, unitId),
    enabled: !!tenantId,
  });
}

/**
 * Hook to get a single member by ID
 */
export function useTenantMember(tenantId: string, memberId: string | null | undefined) {
  return useQuery({
    queryKey: tenantMembersKeys.member(tenantId, memberId || ''),
    queryFn: () => tenantMembersApi.getMember(tenantId, memberId!),
    enabled: !!tenantId && !!memberId,
  });
}

/**
 * Hook to list all members in tenant
 */
export function useTenantMembers(
  tenantId: string,
  status?: 'DRAFT' | 'PENDING_INVITE' | 'ACTIVE' | 'DISABLED',
) {
  return useQuery({
    queryKey: tenantMembersKeys.list(tenantId, status),
    queryFn: () => tenantMembersApi.listMembers(tenantId, status),
    enabled: !!tenantId,
  });
}

/**
 * Hook to delete a tenant member
 */
export function useDeleteTenantMember(tenantId: string, memberId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => tenantMembersApi.deleteMember(tenantId, memberId),
    onSuccess: () => {
      // Invalidate all member queries
      queryClient.invalidateQueries({
        queryKey: tenantMembersKeys.all(tenantId),
      });
    },
  });
}
