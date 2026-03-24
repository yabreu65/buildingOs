/**
 * useCommunicationsInbox Hook
 * Manages user inbox communications + mark as read
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  getInbox,
  markAsRead as markAsReadAPI,
  type InboxCommunication,
} from '../services/communications.api';

interface UseCommunicationsInboxOptions {
  buildingId?: string;
}

export function useCommunicationsInbox(options: UseCommunicationsInboxOptions) {
  const { buildingId } = options;

  const [inbox, setInbox] = useState<InboxCommunication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch inbox communications
  const fetchInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getInbox({ buildingId });
      setInbox(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch inbox';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [buildingId]);

  // Auto-fetch on mount and dependency changes
  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  // Mark a communication as read
  const markAsRead = useCallback(
    async (communicationId: string): Promise<void> => {
      try {
        await markAsReadAPI(communicationId);
        // Update local state: set readAt timestamp on the receipt
        setInbox((prev) =>
          prev.map((c) => {
            if (c.id === communicationId) {
              return {
                ...c,
                receipts: c.receipts.map((r) => ({
                  ...r,
                  readAt: r.readAt || new Date().toISOString(),
                })),
              };
            }
            return c;
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to mark as read';
        setError(message);
        throw err;
      }
    },
    []
  );

  // Calculate unread count
  const unreadCount = useMemo(() => {
    return inbox.filter((c) => {
      const receipt = c.receipts?.[0];
      return !receipt?.readAt;
    }).length;
  }, [inbox]);

  // Refetch inbox
  const refetch = useCallback(() => {
    fetchInbox();
  }, [fetchInbox]);

  return {
    inbox,
    loading,
    error,
    markAsRead,
    unreadCount,
    refetch,
  };
}
