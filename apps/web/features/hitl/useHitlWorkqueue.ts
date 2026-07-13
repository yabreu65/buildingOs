'use client';

import { useCallback, useState } from 'react';
import { hitlService, HitlHandoff, HitlHandoffDetail } from '@/shared/services/hitlService';

export function useHitlWorkqueue() {
  const [items, setItems] = useState<HitlHandoff[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useCallback(async (params: {
    status?: 'open' | 'in_progress' | 'resolved' | 'dismissed';
    tenantId?: string;
    fallbackPath?: string;
    cursor?: string;
    limit?: number;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await hitlService.list(params);
      setItems(response.items);
      setNextCursor(response.nextCursor);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo cargar la cola HITL';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getById = useCallback(async (id: string): Promise<HitlHandoffDetail> => {
    return hitlService.getById(id);
  }, []);

  const assignToMe = useCallback(async (id: string) => {
    const updated = await hitlService.assignToMe(id);
    setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    return updated;
  }, []);

  const resolve = useCallback(async (id: string, resolutionNote: string, notifyUser?: boolean) => {
    const updated = await hitlService.resolve(id, resolutionNote, notifyUser);
    setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    return updated;
  }, []);

  const dismiss = useCallback(async (id: string) => {
    const updated = await hitlService.dismiss(id);
    setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    return updated;
  }, []);

  return {
    items,
    nextCursor,
    loading,
    error,
    list,
    getById,
    assignToMe,
    resolve,
    dismiss,
  };
}
