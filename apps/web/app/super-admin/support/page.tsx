'use client';

import { useState, useEffect } from 'react';
import { useSupportTickets } from '@/features/support-tickets/useSupportTickets';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
  ToastProvider,
} from '@/shared/components/ui';

export default function SupportTicketsPage() {
  const [status, setStatus] = useState<string>('');
  const [skip, setSkip] = useState(0);
  const take = 50;

  const { tickets, total, loading, error, fetch, updateStatus, assign, addComment } = useSupportTickets(
    undefined,
    true
  );

  const { toast } = useToast();

  // Fetch tickets on mount and when filters change
  useEffect(() => {
    fetch({ status: status || undefined, skip, take });
  }, [status, skip, fetch]);

  const handleStatusChange = async (ticketId: string, newStatus: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED') => {
    try {
      await updateStatus(ticketId, newStatus);
      toast('Ticket status updated', 'success');
      fetch({ status: status || undefined, skip, take });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update status', 'error');
    }
  };

  const statusColors: Record<string, string> = {
    OPEN: 'bg-blue-100 text-blue-900',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-900',
    RESOLVED: 'bg-green-100 text-green-900',
    CLOSED: 'bg-gray-100 text-gray-900',
  };

  const priorityColors: Record<string, string> = {
    LOW: 'bg-blue-100 text-blue-900',
    MEDIUM: 'bg-yellow-100 text-yellow-900',
    HIGH: 'bg-orange-100 text-orange-900',
    URGENT: 'bg-red-100 text-red-900',
  };

  if (loading && tickets.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-3xl font-bold">Support Tickets</h1>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error && tickets.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-6">Support Tickets</h1>
        <ErrorState
          message={error}
          onRetry={() => fetch({ status: status || undefined, skip, take })}
        />
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-6">Support Tickets</h1>
        <EmptyState
          title="No support tickets"
          description="There are no support tickets to display"
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Support Tickets</h1>
        <p className="text-gray-600 mt-2">Manage all tenant support requests</p>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-2">Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setSkip(0);
              }}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Tickets List */}
      <div className="space-y-3">
        {tickets.map((ticket) => (
          <Card key={ticket.id} className="p-4">
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold truncate">{ticket.title}</h3>
                  <Badge className={statusColors[ticket.status]}>
                    {ticket.status.replace(/_/g, ' ')}
                  </Badge>
                  <Badge className={priorityColors[ticket.priority]}>
                    {ticket.priority}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 mb-2">{ticket.description}</p>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>From: <strong>{ticket.createdBy.name}</strong></span>
                  <span>Category: <strong>{ticket.category.replace(/_/g, ' ')}</strong></span>
                  <span>Created: <strong>{new Date(ticket.createdAt).toLocaleDateString()}</strong></span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-4 pt-4 border-t flex gap-2 flex-wrap">
              {ticket.status !== 'CLOSED' && (
                <select
                  onChange={(e) => {
                    const newStatus = e.target.value as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
                    handleStatusChange(ticket.id, newStatus);
                  }}
                  className="px-3 py-1 text-sm border rounded"
                >
                  <option value="">Change Status</option>
                  {ticket.status === 'OPEN' && (
                    <>
                      <option value="IN_PROGRESS">Move to In Progress</option>
                      <option value="CLOSED">Close</option>
                    </>
                  )}
                  {ticket.status === 'IN_PROGRESS' && (
                    <>
                      <option value="RESOLVED">Mark Resolved</option>
                      <option value="CLOSED">Close</option>
                    </>
                  )}
                  {ticket.status === 'RESOLVED' && (
                    <option value="CLOSED">Close</option>
                  )}
                </select>
              )}
              <Button variant="secondary" size="sm">View Details</Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Pagination Info */}
      <div className="text-sm text-gray-600 text-center py-4">
        Showing {skip + 1} to {Math.min(skip + take, total)} of {total} tickets
      </div>
    </div>
  );
}
