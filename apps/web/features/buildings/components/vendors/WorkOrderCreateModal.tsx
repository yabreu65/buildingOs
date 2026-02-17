'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { X, Loader2 } from 'lucide-react';
import { createWorkOrder, type Vendor } from '../../services/vendors.api';
import { listTickets } from '../../services/tickets.api';

const workOrderSchema = z.object({
  ticketId: z.string().optional(),
  vendorId: z.string().optional(),
  description: z.string().optional().or(z.literal('')),
  scheduledFor: z.string().optional(),
});

type WorkOrderFormData = z.infer<typeof workOrderSchema>;

interface WorkOrderCreateModalProps {
  buildingId: string;
  vendors: Vendor[];
  presetTicketId?: string;
  onSave: () => Promise<void>;
  onClose: () => void;
}

export default function WorkOrderCreateModal({
  buildingId,
  vendors,
  presetTicketId,
  onSave,
  onClose,
}: WorkOrderCreateModalProps) {
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
  } = useForm<WorkOrderFormData>({
    resolver: zodResolver(workOrderSchema),
    defaultValues: {
      ticketId: presetTicketId,
    },
  });

  const onSubmit = async (data: WorkOrderFormData) => {
    setIsSubmitting(true);
    try {
      await createWorkOrder(buildingId, {
        ticketId: data.ticketId || undefined,
        vendorId: data.vendorId || undefined,
        description: data.description || undefined,
        scheduledFor: data.scheduledFor || undefined,
      });

      toast('Work order created successfully', 'success');
      await onSave();
    } catch (error) {
      toast('Failed to create work order', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex justify-between items-center sticky top-0 bg-white pb-4">
          <h3 className="text-lg font-semibold">Nueva Orden de Trabajo</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

          <div>
            <label className="block text-sm font-medium mb-1">Proveedor (Opcional)</label>
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
            <label className="block text-sm font-medium mb-1">Descripción</label>
            <textarea
              {...register('description')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Detalles del trabajo..."
              rows={3}
            />
            {errors.description && <p className="text-red-600 text-sm mt-1">{errors.description.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Fecha Programada (Opcional)</label>
            <input
              type="date"
              {...register('scheduledFor')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {errors.scheduledFor && <p className="text-red-600 text-sm mt-1">{errors.scheduledFor.message}</p>}
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Crear Orden
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
