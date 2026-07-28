'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import {
  getResidentProfile,
  updateResidentProfile,
  type ResidentProfile,
  type UpdateResidentProfileInput,
} from './resident-profile.api';

export const residentProfileKeys = {
  profile: (tenantId: string | null | undefined, userId: string | null | undefined) =>
    ['residentProfile', tenantId ?? null, userId ?? null] as const,
};

export interface UseResidentProfileResult {
  profileQuery: ReturnType<typeof useQuery<ResidentProfile>>;
  updateProfile: ReturnType<typeof useMutation<ResidentProfile, Error, UpdateResidentProfileInput>>;
  queryKey: readonly [string, string | null, string | null];
  hasResidentMembership: boolean;
  canAccessProfile: boolean;
  tenantId: string | null;
  userId: string | null;
}

export function useResidentProfile(tenantId: string | null | undefined): UseResidentProfileResult {
  const session = useAuthSession();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;

  const residentMembership = useMemo(() => {
    if (!tenantId || !session) {
      return null;
    }

    return (
      session.memberships.find(
        (membership) => membership.tenantId === tenantId && membership.roles.includes('RESIDENT'),
      ) ?? null
    );
  }, [session, tenantId]);

  const canAccessProfile = Boolean(tenantId && userId && residentMembership);
  const queryKey = residentProfileKeys.profile(tenantId, userId);

  const profileQuery = useQuery<ResidentProfile>({
    queryKey,
    queryFn: () => getResidentProfile(tenantId!),
    enabled: canAccessProfile,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  const updateProfile = useMutation<ResidentProfile, Error, UpdateResidentProfileInput>({
    mutationFn: (input) => updateResidentProfile(tenantId!, input),
    onSuccess: (updatedProfile) => {
      if (tenantId && userId) {
        queryClient.setQueryData(residentProfileKeys.profile(tenantId, userId), updatedProfile);
      }
    },
  });

  return {
    profileQuery,
    updateProfile,
    queryKey,
    hasResidentMembership: residentMembership !== null,
    canAccessProfile,
    tenantId: tenantId ?? null,
    userId,
  };
}
