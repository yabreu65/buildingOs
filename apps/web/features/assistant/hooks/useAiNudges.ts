'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AiNudge,
  dismissAiNudge,
  fetchAiNudges,
  requestRecommendedUpgrade,
} from '../services/ai-nudges.api';

export function useAiNudges(tenantId: string) {
  const [nudges, setNudges] = useState<AiNudge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) {
      setNudges([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await fetchAiNudges(tenantId);
      setNudges(result ?? []);
    } catch (err) {
      console.error('Failed to load AI nudges:', err);
      setError(err instanceof Error ? err.message : 'No se pudieron cargar nudges');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = useCallback(
    async (key: AiNudge['key']) => {
      setSubmitting(true);
      setError(null);
      try {
        await dismissAiNudge(tenantId, key);
        await load();
      } catch (err) {
        console.error('Failed to dismiss AI nudge:', err);
        setError(err instanceof Error ? err.message : 'No se pudo descartar el nudge');
      } finally {
        setSubmitting(false);
      }
    },
    [tenantId, load],
  );

  const requestUpgrade = useCallback(async () => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await requestRecommendedUpgrade(tenantId);
      await load();
      return response;
    } catch (err) {
      console.error('Failed to create recommended upgrade request:', err);
      setError(err instanceof Error ? err.message : 'No se pudo crear la solicitud');
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [tenantId, load]);

  const hasBlockingNudge = useMemo(
    () => nudges.some((nudge) => nudge.severity === 'BLOCK'),
    [nudges],
  );

  return {
    nudges,
    loading,
    error,
    submitting,
    hasBlockingNudge,
    dismiss,
    requestUpgrade,
    reload: load,
  };
}
