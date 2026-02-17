'use client';

import { useParams } from 'next/navigation';

export interface ContextAwareParams {
  tenantId?: string;
  buildingId?: string;
  unitId?: string;
  isReady: boolean; // true only if tenantId is present
  error: string | null; // descriptive error message if context is missing
}

/**
 * useContextAware: Extract tenantId, buildingId, unitId from URL params
 * Provides type-safe context awareness for building/unit pages with validation
 */
export function useContextAware(): ContextAwareParams {
  const params = useParams<{
    tenantId?: string;
    buildingId?: string;
    unitId?: string;
  }>();

  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;
  const unitId = params?.unitId;

  if (!tenantId) {
    return {
      tenantId: undefined,
      buildingId: undefined,
      unitId: undefined,
      isReady: false,
      error: 'Tenant ID not found in URL. Verify the route is correct.',
    };
  }

  return {
    tenantId,
    buildingId,
    unitId,
    isReady: true,
    error: null,
  };
}
