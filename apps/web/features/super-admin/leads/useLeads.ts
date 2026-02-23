/**
 * useLeads Hook
 * Manages leads list with filtering and pagination
 */

import { useState, useEffect } from 'react';
import {
  listLeads,
  getLead,
  updateLead,
  convertLead,
  deleteLead,
  Lead,
  ListLeadsResponse,
  UpdateLeadDto,
  ConvertLeadDto,
  ConvertLeadResponse,
} from './leads.api';

export interface UseLeadsState {
  leads: Lead[];
  total: number;
  page: number;
  loading: boolean;
  error: string | null;
  filters: {
    status?: string;
    email?: string;
    source?: string;
  };
}

export function useLeads() {
  const [state, setState] = useState<UseLeadsState>({
    leads: [],
    total: 0,
    page: 0,
    loading: true,
    error: null,
    filters: {},
  });

  const pageSize = 50;

  // Fetch leads
  const fetchLeads = async (
    filters?: UseLeadsState['filters'],
    page: number = 0
  ) => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const response = await listLeads({
        ...filters,
        skip: page * pageSize,
        take: pageSize,
      });
      setState((prev) => ({
        ...prev,
        leads: response.data,
        total: response.total,
        page: response.page,
        filters: filters || {},
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch leads';
      setState((prev) => ({ ...prev, error: message }));
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  };

  // Get single lead
  const fetchLead = async (id: string): Promise<Lead | null> => {
    try {
      return await getLead(id);
    } catch (err) {
      console.error('Failed to fetch lead:', err);
      return null;
    }
  };

  // Update lead
  const update = async (id: string, dto: UpdateLeadDto): Promise<Lead | null> => {
    try {
      const updated = await updateLead(id, dto);
      // Refresh list
      await fetchLeads(state.filters, state.page);
      return updated;
    } catch (err) {
      console.error('Failed to update lead:', err);
      return null;
    }
  };

  // Convert lead to tenant
  const convert = async (
    id: string,
    dto: ConvertLeadDto
  ): Promise<ConvertLeadResponse | null> => {
    try {
      const result = await convertLead(id, dto);
      // Refresh list
      await fetchLeads(state.filters, state.page);
      return result;
    } catch (err) {
      console.error('Failed to convert lead:', err);
      return null;
    }
  };

  // Delete lead
  const remove = async (id: string): Promise<boolean> => {
    try {
      await deleteLead(id);
      // Refresh list
      await fetchLeads(state.filters, state.page);
      return true;
    } catch (err) {
      console.error('Failed to delete lead:', err);
      return false;
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchLeads();
  }, []);

  return {
    ...state,
    fetchLeads,
    fetchLead,
    update,
    convert,
    remove,
    pageSize,
  };
}
