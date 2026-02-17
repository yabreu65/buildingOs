'use client';

import { useState } from 'react';
import Card from '@/shared/components/ui/Card';
import ErrorState from '@/shared/components/ui/ErrorState';
import EmptyState from '@/shared/components/ui/EmptyState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useCommunicationsInbox } from '../../hooks/useCommunicationsInbox';
import { InboxDetail } from './InboxDetail';
import { Bell, Mail } from 'lucide-react';
import type { InboxCommunication } from '../../services/communications.api';

interface InboxListProps {
  buildingId: string;
}

/**
 * InboxList: Resident view of communications inbox
 */
export function InboxList({ buildingId }: InboxListProps) {
  const [selectedComm, setSelectedComm] = useState<InboxCommunication | null>(null);
  const {
    inbox,
    loading,
    error,
    markAsRead,
    unreadCount,
    refetch,
  } = useCommunicationsInbox({ buildingId });

  if (error && inbox.length === 0) {
    return <ErrorState message={error} onRetry={refetch} />;
  }

  if (loading && inbox.length === 0) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} width="100%" height="100px" />
        ))}
      </div>
    );
  }

  if (inbox.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="w-12 h-12 text-muted-foreground" />}
        title="No Communications"
        description="You haven't received any communications yet."
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Header with unread count */}
      {unreadCount > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 bg-blue-500 rounded-full" />
          <span className="text-sm text-muted-foreground">
            {unreadCount} unread message{unreadCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Communications List */}
      {inbox.map((comm) => {
        const receipt = comm.receipts?.[0];
        const isUnread = !receipt?.readAt;

        return (
          <Card
            key={comm.id}
            className={`p-4 cursor-pointer transition ${
              isUnread ? 'bg-blue-50 border-blue-200' : 'hover:bg-muted/50'
            }`}
            onClick={() => setSelectedComm(comm)}
          >
            <div className="flex items-start gap-3">
              {isUnread && <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold truncate">{comm.title}</h3>
                  {isUnread && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full whitespace-nowrap">
                      New
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                  {comm.body}
                </p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{comm.channel}</span>
                  <span>
                    {new Date(comm.sentAt || comm.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
              {isUnread && (
                <Mail className="w-5 h-5 text-blue-500 flex-shrink-0" />
              )}
            </div>
          </Card>
        );
      })}

      {/* Detail Modal */}
      {selectedComm && (
        <InboxDetail
          communication={selectedComm}
          onMarkAsRead={() => markAsRead(selectedComm.id)}
          onClose={() => setSelectedComm(null)}
        />
      )}
    </div>
  );
}
