'use client';

import { useState } from 'react';
import { useTickets } from '../hooks/useTickets';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';
import { Ticket as TicketIcon, Plus, Send, X, AlertCircle } from 'lucide-react';
import type { Ticket } from '../services/tickets.api';
import { t } from '@/i18n';
import type { TicketPriority } from '@/types/enums';
import { ErrorBoundary } from '@/shared/components/error-boundary';
interface UnitTicketsListProps {
  buildingId: string;
  unitId: string;
}

/**
 * UnitTicketsList: Resident view of tickets for a specific unit
 * - Read-only status (no status changes allowed)
 * - Can create new tickets (unitId pre-filled)
 * - Can add comments
 * - Cannot assign or manage tickets (admin-only actions)
 */
export function UnitTicketsList({ buildingId, unitId }: UnitTicketsListProps) {
  const { toast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [addingComment, setAddingComment] = useState(false);

  // Filter tickets by this unit only
  const { tickets, loading, error, create, addComment, refetch } = useTickets({
    buildingId,
    filters: {
      unitId,
    },
  });

  const handleCreateSuccess = async (ticket: Ticket) => {
    setShowCreateForm(false);
    toast(t('tickets.created'), 'success');
    await refetch();
  };

  const handleAddComment = async () => {
    if (!selectedTicket || !commentBody.trim()) {
      toast(t('tickets.errors.commentEmpty'), 'error');
      return;
    }

    setAddingComment(true);
    try {
      await addComment(selectedTicket.id, { body: commentBody });
      toast(t('tickets.commentAdded'), 'success');
      setCommentBody('');
      // Refresh to get updated ticket with new comment
      await refetch();
      // Re-select the updated ticket
      const updated = tickets.find((t) => t.id === selectedTicket.id);
      if (updated) {
        setSelectedTicket(updated);
      }
    } catch {
      toast(t('tickets.errors.commentFailed'), 'error');
    } finally {
      setAddingComment(false);
    }
  };

  return (
    <ErrorBoundary level="feature">
      <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{t('tickets.myRequests')}</h2>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t('tickets.createRequest')}
        </Button>
      </div>

      {/* Create Form Card */}
      {showCreateForm && (
        <Card className="border-blue-200 bg-blue-50">
          <div className="mb-4 flex justify-between items-center">
            <h3 className="text-lg font-semibold">{t('tickets.createNew')}</h3>
            <button
              onClick={() => setShowCreateForm(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          </div>
          <UnitTicketForm
            buildingId={buildingId}
            unitId={unitId}
            onSuccess={handleCreateSuccess}
            onCancel={() => setShowCreateForm(false)}
          />
        </Card>
      )}

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
          title={t('tickets.emptyTitle')}
          description={t('tickets.emptyDescription')}
          cta={{
            text: t('tickets.createRequest'),
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
                <span>{ticket.comments?.length || 0} {t('common.comments')}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Ticket Detail Modal - Read-only view */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center">
          <Card className="w-full sm:w-[600px] max-h-[90vh] overflow-hidden flex flex-col rounded-t-lg sm:rounded-lg">
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-xl font-bold">{selectedTicket.title}</h2>
              <button
                onClick={() => setSelectedTicket(null)}
                className="text-gray-500 hover:text-gray-700 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body - Scrollable */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Status & Priority (Read-only) */}
              <div className="flex gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    {t('tickets.status')}
                  </label>
                  <div className="inline-block px-3 py-1 rounded bg-blue-100 text-blue-700 text-sm font-medium">
                    {selectedTicket.status}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('tickets.statusManagedByStaff')}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    {t('tickets.priority')}
                  </label>
                  <span className="text-sm font-medium px-2 py-1 rounded bg-orange-50 text-orange-700">
                    {selectedTicket.priority}
                  </span>
                </div>
              </div>

              {/* Timestamps */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  {t('tickets.timeline')}
                </label>
                <div className="text-sm space-y-1 text-muted-foreground">
                  <div>Created: {new Date(selectedTicket.createdAt).toLocaleString()}</div>
                  <div>Updated: {new Date(selectedTicket.updatedAt).toLocaleString()}</div>
                  {selectedTicket.closedAt && (
                    <div>Closed: {new Date(selectedTicket.closedAt).toLocaleString()}</div>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  {t('tickets.description')}
                </label>
                <p className="text-sm text-foreground">{selectedTicket.description}</p>
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  {t('tickets.category')}
                </label>
                <p className="text-sm">{selectedTicket.category}</p>
              </div>

              {/* Comments */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-3">
                  {t('common.comments')} ({selectedTicket.comments?.length || 0})
                </label>
                <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
                  {(!selectedTicket.comments || selectedTicket.comments.length === 0) && (
                    <p className="text-sm text-muted-foreground">
                      {t('tickets.noCommentsFirst')}
                    </p>
                  )}
                  {selectedTicket.comments?.map((comment) => (
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
                    placeholder={t('tickets.commentPlaceholder')}
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
          </Card>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}

/**
 * UnitTicketForm: Form for creating a maintenance request (resident view)
 * - Title, description, category, priority
 * - unitId is pre-filled and not editable
 */
function UnitTicketForm({
  buildingId,
  unitId,
  onSuccess,
  onCancel,
}: {
  buildingId: string;
  unitId: string;
  onSuccess: (ticket: Ticket) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { create } = useTickets({ buildingId });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('MAINTENANCE');
  const [priority, setPriority] = useState('MEDIUM');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    // Validation
    if (!title.trim()) {
      setValidationError(t('tickets.errors.titleRequired'));
      return;
    }
    if (!description.trim()) {
      setValidationError(t('tickets.errors.descriptionRequired'));
      return;
    }
    if (title.length < 3) {
      setValidationError(t('tickets.errors.titleMinLength'));
      return;
    }
    if (description.length < 5) {
      setValidationError(t('tickets.errors.descriptionMinLength'));
      return;
    }

    setSubmitting(true);
    try {
      const ticket = await create({
        title: title.trim(),
        description: description.trim(),
        category,
        priority: priority as TicketPriority,
        unitId, // Pre-filled from unit context
      });

      if (ticket) {
        onSuccess(ticket);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('tickets.errors.createFailed');
      setValidationError(message);
      toast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {validationError && (
        <div className="p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
          {validationError}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">{t('tickets.title')} *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('tickets.titlePlaceholder')}
          className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={submitting}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{t('tickets.description')} *</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('tickets.descriptionPlaceholder')}
          className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={4}
          disabled={submitting}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('tickets.category')} *</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={submitting}
          >
            <option value="MAINTENANCE">{t('tickets.categories.maintenance')}</option>
            <option value="REPAIR">{t('tickets.categories.repair')}</option>
            <option value="CLEANING">{t('tickets.categories.cleaning')}</option>
            <option value="COMPLAINT">{t('tickets.categories.complaint')}</option>
            <option value="OTHER">{t('tickets.categories.other')}</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">{t('tickets.priority')}</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={submitting}
          >
            <option value="LOW">{t('tickets.priorities.low')}</option>
            <option value="MEDIUM">{t('tickets.priorities.medium')}</option>
            <option value="HIGH">{t('tickets.priorities.high')}</option>
            <option value="URGENT">{t('tickets.priorities.urgent')}</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={submitting}>
          {t('tickets.createRequest')}
        </Button>
      </div>
    </form>
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
