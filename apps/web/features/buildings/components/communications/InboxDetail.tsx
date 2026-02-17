'use client';

import { useEffect, useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { Eye } from 'lucide-react';
import type { InboxCommunication } from '../../services/communications.api';

interface InboxDetailProps {
  communication: InboxCommunication;
  onMarkAsRead: () => Promise<void>;
  onClose: () => void;
}

/**
 * InboxDetail: View communication in inbox + mark as read
 */
export function InboxDetail({
  communication,
  onMarkAsRead,
  onClose,
}: InboxDetailProps) {
  const { toast } = useToast();
  const [isMarking, setIsMarking] = useState(false);

  const receipt = communication.receipts?.[0];
  const isUnread = !receipt?.readAt;

  // Auto-mark as read on mount
  useEffect(() => {
    if (isUnread) {
      const markRead = async () => {
        setIsMarking(true);
        try {
          await onMarkAsRead();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to mark as read';
          console.error(message);
          // Don't show error toast, silently fail
        } finally {
          setIsMarking(false);
        }
      };
      markRead();
    }
  }, [communication.id, isUnread, onMarkAsRead]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50">
      <Card className="w-full md:w-2xl md:max-h-[90vh] md:rounded-lg rounded-t-lg overflow-auto">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-2xl font-bold">{communication.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{communication.channel}</p>
            </div>
            {!isUnread && (
              <div className="flex items-center gap-2 text-xs text-green-700 bg-green-100 px-2 py-1 rounded-full">
                <Eye className="w-3 h-3" />
                Read
              </div>
            )}
          </div>

          {/* Body */}
          <div className="bg-muted p-4 rounded-lg">
            <p className="whitespace-pre-wrap text-sm">{communication.body}</p>
          </div>

          {/* Metadata */}
          <div className="text-xs text-muted-foreground space-y-1 border-t pt-4">
            <p>From: {communication.createdBy?.name}</p>
            <p>
              Sent {new Date(communication.sentAt || communication.createdAt).toLocaleString()}
            </p>
            {receipt?.readAt && (
              <p>
                Read {new Date(receipt.readAt).toLocaleString()}
              </p>
            )}
          </div>

          {/* Close Button */}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={onClose} disabled={isMarking}>
              Close
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
