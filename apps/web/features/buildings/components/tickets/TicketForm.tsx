'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/ui/Toast';
import { useTickets } from '../../hooks/useTickets';
import { Loader2 } from 'lucide-react';
import type { Ticket } from '../../services/tickets.api';

interface TicketFormProps {
  buildingId: string;
  onSuccess: (ticket: Ticket) => void;
  onCancel: () => void;
}

export default function TicketForm({
  buildingId,
  onSuccess,
  onCancel,
}: TicketFormProps) {
  const { toast } = useToast();
  const { create } = useTickets({ buildingId });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('MAINTENANCE');
  const [priority, setPriority] = useState('MEDIUM');
  const [unitId, setUnitId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    // Validation
    if (!title.trim()) {
      setValidationError('Title is required');
      return;
    }
    if (!description.trim()) {
      setValidationError('Description is required');
      return;
    }
    if (title.length < 3) {
      setValidationError('Title must be at least 3 characters');
      return;
    }
    if (description.length < 5) {
      setValidationError('Description must be at least 5 characters');
      return;
    }

    setSubmitting(true);
    try {
      const ticket = await create({
        title: title.trim(),
        description: description.trim(),
        category,
        priority: priority as any,
        unitId: unitId || undefined,
      });

      if (ticket) {
        onSuccess(ticket);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create ticket';
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
        <label className="block text-sm font-medium mb-1">Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Broken door lock"
          className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={submitting}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description *</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the issue in detail..."
          className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={4}
          disabled={submitting}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Category *</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={submitting}
          >
            <option value="MAINTENANCE">Maintenance</option>
            <option value="REPAIR">Repair</option>
            <option value="CLEANING">Cleaning</option>
            <option value="COMPLAINT">Complaint</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={submitting}
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Unit (Optional)</label>
        <input
          type="text"
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          placeholder="Unit ID (e.g., unit-123)"
          className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={submitting}
        />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Ticket'
          )}
        </Button>
      </div>
    </form>
  );
}
