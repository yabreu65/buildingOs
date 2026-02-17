'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { X, Loader2 } from 'lucide-react';
import { createQuote, type Vendor } from '../../services/vendors.api';
import { listTickets } from '../../services/tickets.api';

const quoteSchema = z.object({
  vendorId: z.string().min(1, 'Vendor is required'),
  ticketId: z.string().optional(),
  amount: z.any().transform((v) => (typeof v === 'string' ? parseFloat(v) : v)),
  currency: z.enum(['ARS', 'USD']),
  notes: z.string().optional().or(z.literal('')),
}).refine((data) => data.amount >= 0.01, {
  message: 'Amount must be greater than 0',
  path: ['amount'],
});

type QuoteFormData = z.infer<typeof quoteSchema>;

interface QuoteCreateModalProps {
  buildingId: string;
  vendors: Vendor[];
  presetTicketId?: string;
  onSave: () => Promise<void>;
  onClose: () => void;
}

export default function QuoteCreateModal({
  buildingId,
  vendors,
  presetTicketId,
  onSave,
  onClose,
}: QuoteCreateModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  useEffect(() => {
    const loadTickets = async () => {
      setLoadingTickets(true);
      try {
        const data = await listTickets(buildingId, { status: 'OPEN,IN_PROGRESS' });
        setTickets(data);
      } catch (error) {
        console.error('Failed to load tickets:', error);
      } finally {
        setLoadingTickets(false);
      }
    };
    loadTickets();
  }, [buildingId]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<QuoteFormData>({
    resolver: zodResolver(quoteSchema),
    defaultValues: {
      ticketId: presetTicketId,
      currency: 'ARS',
    },
  });

  const onSubmit = async (data: QuoteFormData) => {
    setIsSubmitting(true);
    try {
      await createQuote(buildingId, {
        vendorId: data.vendorId,
        ticketId: data.ticketId || undefined,
        amount: data.amount,
        currency: data.currency,
        notes: data.notes || undefined,
      });

      toast('Quote created successfully', 'success');
      await onSave();
    } catch (error) {
      toast('Failed to create quote', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex justify-between items-center sticky top-0 bg-white pb-4">
          <h3 className="text-lg font-semibold">Nueva Cotización</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Proveedor</label>
            <select
              {...register('vendorId')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Seleccionar proveedor...</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
            {errors.vendorId && <p className="text-red-600 text-sm mt-1">{errors.vendorId.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Ticket (Opcional)</label>
            <select
              {...register('ticketId')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={loadingTickets}
            >
              <option value="">Seleccionar ticket...</option>
              {tickets.map((ticket) => (
                <option key={ticket.id} value={ticket.id}>
                  {ticket.title}
                </option>
              ))}
            </select>
            {errors.ticketId && <p className="text-red-600 text-sm mt-1">{errors.ticketId.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Monto</label>
              <input
                type="number"
                step="0.01"
                {...register('amount')}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="0.00"
              />
              {errors.amount && (
                <p className="text-red-600 text-sm mt-1">
                  {typeof errors.amount === 'object' && errors.amount && 'message' in errors.amount
                    ? (errors.amount as any).message
                    : 'Invalid amount'}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Moneda</label>
              <select
                {...register('currency')}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
              {errors.currency && <p className="text-red-600 text-sm mt-1">{errors.currency.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notas</label>
            <textarea
              {...register('notes')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Detalles adicionales..."
              rows={3}
            />
            {errors.notes && <p className="text-red-600 text-sm mt-1">{errors.notes.message}</p>}
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Crear Cotización
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
