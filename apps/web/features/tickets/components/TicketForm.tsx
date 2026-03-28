'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/ui/Toast';
import { useTickets } from '../hooks/useTickets';
import { Loader2 } from 'lucide-react';
import type { Ticket } from '../services/tickets.api';
import type { Unit } from '@/features/units/units.types';
import { t } from '@/i18n';
import type { TicketPriority } from '@/types/enums';

interface TicketFormProps {
  buildingId: string;
  buildingName?: string;
  units?: Unit[];
  onSuccess: (ticket: Ticket) => void;
  onCancel: () => void;
}

export default function TicketForm({
  buildingId,
  buildingName = 'Edificio',
  units = [],
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
        unitId: unitId || undefined,
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

      <div>
        <label className="block text-sm font-medium mb-1">{t('tickets.unitOptional')}</label>
        {units.length > 0 ? (
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={submitting}
          >
            <option value="">{buildingName} (área común)</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label || u.unitCode || u.id}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            placeholder={t('tickets.unitPlaceholder')}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={submitting}
          />
        )}
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
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t('tickets.creating')}
            </>
          ) : (
            t('tickets.createTicket')
          )}
        </Button>
      </div>
    </form>
  );
}
