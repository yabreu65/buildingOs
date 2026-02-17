/**
 * useQuotes Hook
 * Manages quotes state for a building
 */

import { useState, useCallback, useEffect } from 'react';
import {
  listQuotes,
  createQuote,
  updateQuote,
  type Quote,
  type CreateQuoteInput,
  type UpdateQuoteInput,
} from '../services/vendors.api';

interface UseQuotesOptions {
  buildingId?: string;
  filters?: {
    status?: string;
    ticketId?: string;
    vendorId?: string;
  };
}

export function useQuotes(options: UseQuotesOptions) {
  const { buildingId, filters } = options;

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all quotes
  const fetchQuotes = useCallback(async () => {
    if (!buildingId) {
      setQuotes([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await listQuotes(buildingId, filters);
      setQuotes(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch quotes';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [buildingId, filters]);

  // Auto-fetch on mount and dependency changes
  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  // Create a new quote
  const create = useCallback(
    async (input: CreateQuoteInput): Promise<Quote | null> => {
      if (!buildingId) return null;
      try {
        const newQuote = await createQuote(buildingId, input);
        setQuotes((prev) => [newQuote, ...prev]);
        return newQuote;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create quote';
        setError(message);
        throw err;
      }
    },
    [buildingId]
  );

  // Update quote status
  const updateStatus = useCallback(
    async (quoteId: string, status: string): Promise<Quote | null> => {
      if (!buildingId) return null;
      try {
        const updated = await updateQuote(buildingId, quoteId, { status: status as any });
        setQuotes((prev) =>
          prev.map((q) => (q.id === quoteId ? updated : q))
        );
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update quote';
        setError(message);
        throw err;
      }
    },
    [buildingId]
  );

  // Refetch quotes
  const refetch = useCallback(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  return {
    quotes,
    loading,
    error,
    create,
    updateStatus,
    refetch,
  };
}
