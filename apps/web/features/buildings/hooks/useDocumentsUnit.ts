'use client';

import { useState, useEffect, useCallback } from 'react';
import { Document, listDocuments } from '../services/documents.api';

interface UseDocumentsUnitOptions {
  tenantId: string;
  buildingId: string;
  unitId: string;
  autoFetch?: boolean;
}

/**
 * Hook for resident/owner to view documents for their unit
 *
 * Features:
 * - Auto-fetches documents for unit + building-scoped docs
 * - No upload/edit/delete (read-only for residents)
 * - Backend handles visibility filtering (RESIDENTS only)
 */
export function useDocumentsUnit({
  tenantId,
  buildingId,
  unitId,
  autoFetch = true,
}: UseDocumentsUnitOptions) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(!!unitId && autoFetch);
  const [error, setError] = useState<string | null>(null);

  // Fetch documents
  const fetch = useCallback(async () => {
    if (!unitId || !tenantId || !buildingId) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch unit-scoped documents
      const unitDocs = await listDocuments(tenantId, { unitId });

      // Fetch building-scoped documents
      const buildingDocs = await listDocuments(tenantId, { buildingId });

      // Combine and deduplicate
      const allDocs = [
        ...unitDocs,
        ...buildingDocs.filter(
          (doc) => !unitDocs.find((ud) => ud.id === doc.id),
        ),
      ];

      setDocuments(allDocs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load documents';
      setError(message);
      console.error('[useDocumentsUnit] Error:', message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, buildingId, unitId]);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      fetch();
    }
  }, [autoFetch, fetch]);

  return {
    documents,
    loading,
    error,
    fetch,
    refetch: fetch,
  };
}
