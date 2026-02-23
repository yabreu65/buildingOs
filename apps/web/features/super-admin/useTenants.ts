/**
 * useTenants Hook
 * Manages tenant data from the backend API
 */

import { useState, useEffect } from 'react';
import {
  listTenants,
  getTenant,
  updateTenant,
  changeTenantPlan,
  type TenantFromAPI,
  type TenantDetailFromAPI,
} from './tenants.api';

export interface UseTenantsState {
  tenants: TenantFromAPI[];
  loading: boolean;
  error: string | null;
  total: number;
}

export function useTenants() {
  const [state, setState] = useState<UseTenantsState>({
    tenants: [],
    loading: true,
    error: null,
    total: 0,
  });

  // Fetch tenants on mount
  const fetchTenants = async (skip: number = 0, take: number = 20) => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const response = await listTenants({ skip, take });
      setState({
        tenants: response.data,
        total: response.total,
        loading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch tenants';
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  };

  // Fetch single tenant details
  const fetchTenant = async (tenantId: string): Promise<TenantDetailFromAPI | null> => {
    try {
      return await getTenant(tenantId);
    } catch (err) {
      console.error('Failed to fetch tenant:', err);
      return null;
    }
  };

  // Update tenant
  const update = async (tenantId: string, data: Partial<TenantFromAPI>) => {
    try {
      const updated = await updateTenant(tenantId, data);
      setState((prev) => ({
        ...prev,
        tenants: prev.tenants.map((t) => (t.id === tenantId ? updated : t)),
      }));
      return updated;
    } catch (err) {
      console.error('Failed to update tenant:', err);
      return null;
    }
  };

  // Change plan
  const changePlan = async (tenantId: string, newPlanId: string) => {
    try {
      const result = await changeTenantPlan(tenantId, newPlanId);
      // Refresh tenant details
      await fetchTenants();
      return result;
    } catch (err) {
      console.error('Failed to change plan:', err);
      throw err;
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchTenants();
  }, []);

  return {
    ...state,
    fetchTenants,
    fetchTenant,
    update,
    changePlan,
  };
}
