'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSupportTickets } from '@/features/support-tickets/useSupportTickets';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '@/shared/components/ui';

interface CreateTicketFormState {
  title: string;
  description: string;
  category: string;
  priority: string;
}

export default function TenantSupportPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;

  const [status, setStatus] = useState<string>('');
  const [skip, setSkip] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState<CreateTicketFormState>({
    title: '',
    description: '',
    category: 'OTHER',
    priority: 'MEDIUM',
  });

  const { tickets, total, loading, error, fetch, create, update, addComment } = useSupportTickets(
    tenantId,
    false
  );

  const { toast } = useToast();

  const take = 50;

  // Fetch tickets on mount and when filters change
  useEffect(() => {
    if (tenantId) {
      fetch({ status: status || undefined, skip, take });
    }
  }, [status, skip, fetch, tenantId]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim() || !formData.description.trim()) {
      toast('Title and description are required', 'error');
      return;
    }

    try {
      await create({
        title: formData.title,
        description: formData.description,
        category: formData.category,
        priority: formData.priority,
      });
      toast('Ticket created successfully', 'success');
      setFormData({ title: '', description: '', category: 'OTHER', priority: 'MEDIUM' });
      setShowCreateForm(false);
      setSkip(0);
      fetch({ status: status || undefined, skip: 0, take });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create ticket', 'error');
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
        <h1 className="text-3xl font-bold">Support Requests</h1>
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
        <h1 className="text-3xl font-bold mb-6">Support Requests</h1>
        <ErrorState
          message={error}
          onRetry={() => fetch({ status: status || undefined, skip, take })}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Support Requests</h1>
          <p className="text-gray-600 mt-2">Submit and manage your support tickets</p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)} variant="primary">
          {showCreateForm ? 'Cancel' : 'Create Ticket'}
        </Button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <Card className="p-6 bg-blue-50">
          <h2 className="text-xl font-semibold mb-4">Create New Support Ticket</h2>
          <form onSubmit={handleCreateTicket} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Enter ticket title"
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe your issue"
                rows={4}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="BILLING">Billing</option>
                  <option value="FEATURE_REQUEST">Feature Request</option>
                  <option value="BUG_REPORT">Bug Report</option>
                  <option value="ACCOUNT_ISSUE">Account Issue</option>
                  <option value="TECHNICAL_SUPPORT">Technical Support</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" variant="primary">Create Ticket</Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

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
      {tickets.length === 0 ? (
        <EmptyState
          title="No support tickets"
          description={showCreateForm ? "Submit your first support request above" : "You don't have any support tickets yet"}
        />
      ) : (
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
                    <span>Category: <strong>{ticket.category.replace(/_/g, ' ')}</strong></span>
                    <span>Created: <strong>{new Date(ticket.createdAt).toLocaleDateString()}</strong></span>
                  </div>
                </div>
              </div>

              {/* Comments Section */}
              {ticket.comments && ticket.comments.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <h4 className="text-sm font-semibold mb-2">Comments ({ticket.comments.length})</h4>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {ticket.comments.map((comment) => (
                      <div key={comment.id} className="bg-gray-50 p-2 rounded text-xs">
                        <div className="font-medium">{comment.author.name}</div>
                        <div className="text-gray-600">{comment.body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Pagination Info */}
      {tickets.length > 0 && (
        <div className="text-sm text-gray-600 text-center py-4">
          Showing {skip + 1} to {Math.min(skip + take, total)} of {total} tickets
        </div>
      )}
    </div>
  );
}
