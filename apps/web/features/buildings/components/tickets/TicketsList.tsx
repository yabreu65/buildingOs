'use client';

import { useState } from 'react';
import { useTickets } from '../../hooks/useTickets';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';
import { Ticket as TicketIcon, Plus, Filter } from 'lucide-react';
import TicketForm from './TicketForm';
import TicketDetail from './TicketDetail';
import type { Ticket } from '../../services/tickets.api';

interface TicketsListProps {
  buildingId: string;
}

export default function TicketsList({ buildingId }: TicketsListProps) {
  const { toast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('OPEN,IN_PROGRESS');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [unitIdFilter, setUnitIdFilter] = useState<string>('');

  const filters = {
    status: statusFilter,
    priority: priorityFilter || undefined,
    unitId: unitIdFilter || undefined,
  };

  const { tickets, loading, error, create, update, addComment, refetch } = useTickets({
    buildingId,
    filters,
  });

  const handleCreateSuccess = async (ticket: Ticket) => {
    setShowCreateForm(false);
    toast('Ticket created successfully', 'success');
    await refetch();
  };

  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    try {
      await update(ticketId, { status: newStatus as any });
      toast(`Ticket status updated to ${newStatus}`, 'success');
      setSelectedTicket(null);
      await refetch();
    } catch {
      toast('Failed to update ticket status', 'error');
    }
  };

  const handleAddComment = async (ticketId: string, body: string) => {
    try {
      await addComment(ticketId, { body });
      toast('Comment added', 'success');
      await refetch();
      // Refresh detail view to show new comment
      const refreshedTicket = await refetch();
      const updated = tickets.find((t) => t.id === ticketId);
      if (updated) {
        setSelectedTicket(updated);
      }
    } catch {
      toast('Failed to add comment', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Tickets</h2>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Ticket
        </Button>
      </div>

      {/* Create Form Modal */}
      {showCreateForm && (
        <Card className="border-blue-200 bg-blue-50">
          <div className="mb-4 flex justify-between items-center">
            <h3 className="text-lg font-semibold">Create New Ticket</h3>
            <button
              onClick={() => setShowCreateForm(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          </div>
          <TicketForm
            buildingId={buildingId}
            onSuccess={handleCreateSuccess}
            onCancel={() => setShowCreateForm(false)}
          />
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div>
          <label className="block text-sm font-medium mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="OPEN,IN_PROGRESS">Open & In Progress</option>
            <option value="OPEN">Open Only</option>
            <option value="IN_PROGRESS">In Progress Only</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
            <option value="">All Statuses</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Priority</label>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="">All Priorities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
      </div>

      {/* Error State */}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {/* Loading State */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height="100px" />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && tickets.length === 0 && (
        <EmptyState
          icon={<TicketIcon className="w-12 h-12 text-muted-foreground" />}
          title="No tickets yet"
          description="Create your first ticket to report issues in this building."
          cta={{
            text: 'Create Ticket',
            onClick: () => setShowCreateForm(true),
          }}
        />
      )}

      {/* Tickets List */}
      {!loading && tickets.length > 0 && (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <Card
              key={ticket.id}
              className="cursor-pointer hover:shadow-md transition p-4"
              onClick={() => setSelectedTicket(ticket)}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">{ticket.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {ticket.description}
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded ${getStatusColor(
                      ticket.status
                    )}`}
                  >
                    {ticket.status}
                  </span>
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded ${getPriorityColor(
                      ticket.priority
                    )}`}
                  >
                    {ticket.priority}
                  </span>
                </div>
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <span>{ticket.category}</span>
                <span>{ticket.comments?.length || 0} comments</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedTicket && (
        <TicketDetail
          buildingId={buildingId}
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onStatusChange={handleStatusChange}
          onAddComment={handleAddComment}
        />
      )}
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'bg-blue-100 text-blue-700';
    case 'IN_PROGRESS':
      return 'bg-yellow-100 text-yellow-700';
    case 'RESOLVED':
      return 'bg-green-100 text-green-700';
    case 'CLOSED':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'LOW':
      return 'bg-green-50 text-green-700 border border-green-200';
    case 'MEDIUM':
      return 'bg-blue-50 text-blue-700 border border-blue-200';
    case 'HIGH':
      return 'bg-orange-50 text-orange-700 border border-orange-200';
    case 'URGENT':
      return 'bg-red-50 text-red-700 border border-red-200';
    default:
      return 'bg-gray-50 text-gray-700 border border-gray-200';
  }
}
