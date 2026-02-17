'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { X, Send, AlertCircle, Plus, FileText, Wrench } from 'lucide-react';
import type { Ticket } from '../../services/tickets.api';
import { useAuth } from '@/features/auth';
import { useQuotes } from '../../hooks/useQuotes';
import { useWorkOrders } from '../../hooks/useWorkOrders';
import { QuoteCreateModal, WorkOrderCreateModal } from '../../components/vendors';

interface TicketDetailProps {
  buildingId: string;
  ticket: Ticket;
  onClose: () => void;
  onStatusChange: (ticketId: string, newStatus: string) => Promise<void>;
  onAddComment: (ticketId: string, body: string) => Promise<void>;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: ['OPEN'],
};

export default function TicketDetail({
  buildingId,
  ticket,
  onClose,
  onStatusChange,
  onAddComment,
}: TicketDetailProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [commentBody, setCommentBody] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showCreateQuote, setShowCreateQuote] = useState(false);
  const [showCreateWorkOrder, setShowCreateWorkOrder] = useState(false);

  const isAdmin = currentUser?.roles?.some((r) => ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].includes(r)) ?? false;

  const { quotes, refetch: refetchQuotes } = useQuotes({
    buildingId,
    filters: { ticketId: ticket.id },
  });

  const { workOrders, refetch: refetchWorkOrders } = useWorkOrders({
    buildingId,
    filters: { ticketId: ticket.id },
  });

  const allowedTransitions = VALID_TRANSITIONS[ticket.status] || [];

  const handleAddComment = async () => {
    if (!commentBody.trim()) {
      toast('Comment cannot be empty', 'error');
      return;
    }

    setAddingComment(true);
    try {
      await onAddComment(ticket.id, commentBody);
      setCommentBody('');
    } finally {
      setAddingComment(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setChangingStatus(true);
    try {
      if (newStatus === 'CLOSED') {
        setShowCloseConfirm(true);
      } else {
        await onStatusChange(ticket.id, newStatus);
      }
    } finally {
      setChangingStatus(false);
    }
  };

  const confirmClose = async () => {
    setShowCloseConfirm(false);
    try {
      await onStatusChange(ticket.id, 'CLOSED');
    } catch {
      // Error already handled in onStatusChange
    }
  };

  const handleQuoteCreated = async () => {
    setShowCreateQuote(false);
    toast('Quote created', 'success');
    await refetchQuotes();
  };

  const handleWorkOrderCreated = async () => {
    setShowCreateWorkOrder(false);
    toast('Work order created', 'success');
    await refetchWorkOrders();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center">
      <Card className="w-full sm:w-[600px] max-h-[90vh] overflow-hidden flex flex-col rounded-t-lg sm:rounded-lg">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-xl font-bold">{ticket.title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Status & Priority */}
          <div className="flex gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Status
              </label>
              <div className="space-y-2">
                <div className="inline-block px-3 py-1 rounded bg-blue-100 text-blue-700 text-sm font-medium">
                  {ticket.status}
                </div>
                {allowedTransitions.length > 0 && (
                  <div className="space-y-1">
                    {allowedTransitions.map((status) => (
                      <Button
                        key={status}
                        size="sm"
                        variant="secondary"
                        onClick={() => handleStatusChange(status)}
                        disabled={changingStatus}
                        className="w-full justify-start"
                      >
                        {status === 'CLOSED' && <AlertCircle className="w-3 h-3 mr-2" />}
                        {status}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Priority
              </label>
              <span className="text-sm font-medium px-2 py-1 rounded bg-orange-50 text-orange-700">
                {ticket.priority}
              </span>
            </div>
          </div>

          {/* Timestamps */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Timeline
            </label>
            <div className="text-sm space-y-1 text-muted-foreground">
              <div>Created: {new Date(ticket.createdAt).toLocaleString()}</div>
              <div>Updated: {new Date(ticket.updatedAt).toLocaleString()}</div>
              {ticket.closedAt && (
                <div>Closed: {new Date(ticket.closedAt).toLocaleString()}</div>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Description
            </label>
            <p className="text-sm text-foreground">{ticket.description}</p>
          </div>

          {/* Unit & Assignee */}
          <div className="grid grid-cols-2 gap-4">
            {ticket.unit && (
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Unit
                </label>
                <p className="text-sm">{ticket.unit.label} ({ticket.unit.code})</p>
              </div>
            )}
            {ticket.assignedTo && (
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Assigned To
                </label>
                <p className="text-sm">{ticket.assignedTo.user.name}</p>
              </div>
            )}
          </div>

          {/* Quotes Section (Admin Only) */}
          {isAdmin && (
            <div>
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Quotes ({quotes.length})
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowCreateQuote(true)}
                  className="flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Nueva
                </Button>
              </div>
              {quotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No quotes yet</p>
              ) : (
                <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                  {quotes.map((quote) => (
                    <div key={quote.id} className="p-2 bg-muted rounded-md text-sm">
                      <p className="font-medium">{quote.vendor?.name}</p>
                      <p className="text-muted-foreground">
                        {quote.currency} ${quote.amount.toFixed(2)} - {quote.status}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Work Orders Section (Admin Only) */}
          {isAdmin && (
            <div>
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Wrench className="w-4 h-4" />
                  Work Orders ({workOrders.length})
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowCreateWorkOrder(true)}
                  className="flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Nueva
                </Button>
              </div>
              {workOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No work orders yet</p>
              ) : (
                <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                  {workOrders.map((wo) => (
                    <div key={wo.id} className="p-2 bg-muted rounded-md text-sm">
                      <p className="font-medium">{wo.vendor?.name || wo.assignedTo?.user?.name}</p>
                      <p className="text-muted-foreground">{wo.status}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Comments */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-3">
              Comments ({ticket.comments?.length || 0})
            </label>
            <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
              {(!ticket.comments || ticket.comments.length === 0) && (
                <p className="text-sm text-muted-foreground">No comments yet</p>
              )}
              {ticket.comments?.map((comment) => (
                <div
                  key={comment.id}
                  className="p-3 bg-muted rounded-md space-y-1"
                >
                  <div className="flex justify-between items-start">
                    <p className="text-sm font-medium">{comment.author.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(comment.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <p className="text-sm text-foreground">{comment.body}</p>
                </div>
              ))}
            </div>

            {/* Add Comment Form */}
            <div className="flex gap-2">
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 px-3 py-2 border rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
              />
              <Button
                onClick={handleAddComment}
                disabled={addingComment || !commentBody.trim()}
                size="sm"
                className="self-end"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Create Quote Modal */}
        {showCreateQuote && (
          <QuoteCreateModal
            buildingId={buildingId}
            vendors={[]}
            presetTicketId={ticket.id}
            onSave={handleQuoteCreated}
            onClose={() => setShowCreateQuote(false)}
          />
        )}

        {/* Create Work Order Modal */}
        {showCreateWorkOrder && (
          <WorkOrderCreateModal
            buildingId={buildingId}
            vendors={[]}
            presetTicketId={ticket.id}
            onSave={handleWorkOrderCreated}
            onClose={() => setShowCreateWorkOrder(false)}
          />
        )}

        {/* Close Confirmation Modal */}
        {showCloseConfirm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <Card className="w-[400px] p-6 space-y-4">
              <h3 className="text-lg font-bold">Close Ticket?</h3>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to close this ticket? You can reopen it later if needed.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setShowCloseConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmClose}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Close Ticket
                </Button>
              </div>
            </Card>
          </div>
        )}
      </Card>
    </div>
  );
}
