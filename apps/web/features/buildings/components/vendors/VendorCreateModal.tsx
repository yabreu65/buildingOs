'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { X, Loader2 } from 'lucide-react';
import type { CreateVendorInput } from '../../services/vendors.api';
import { createVendor, createVendorAssignment } from '../../services/vendors.api';

const vendorSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  serviceType: z.string().min(2, 'Service type is required'),
});

type VendorFormData = z.infer<typeof vendorSchema>;

interface VendorCreateModalProps {
  buildingId: string;
  onSave: () => Promise<void>;
  onClose: () => void;
}

export default function VendorCreateModal({ buildingId, onSave, onClose }: VendorCreateModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VendorFormData>({
    resolver: zodResolver(vendorSchema),
  });

  const onSubmit = async (data: VendorFormData) => {
    setIsSubmitting(true);
    try {
      const vendorInput: CreateVendorInput = {
        name: data.name,
        email: data.email || undefined,
        phone: data.phone || undefined,
        notes: data.notes || undefined,
      };

      const newVendor = await createVendor(vendorInput);
      await createVendorAssignment(buildingId, {
        vendorId: newVendor.id,
        serviceType: data.serviceType,
      });

      toast('Vendor created and assigned', 'success');
      await onSave();
    } catch (error) {
      toast('Failed to create vendor', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Crear Proveedor</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nombre</label>
            <input
              type="text"
              {...register('name')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Proveedor Inc."
            />
            {errors.name && <p className="text-red-600 text-sm mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              {...register('email')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="contact@proveedor.com"
            />
            {errors.email && <p className="text-red-600 text-sm mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Teléfono</label>
            <input
              type="tel"
              {...register('phone')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="+54 9 11 0000-0000"
            />
            {errors.phone && <p className="text-red-600 text-sm mt-1">{errors.phone.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tipo de Servicio</label>
            <input
              type="text"
              {...register('serviceType')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Electricista, Plomería, etc."
            />
            {errors.serviceType && <p className="text-red-600 text-sm mt-1">{errors.serviceType.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notas</label>
            <textarea
              {...register('notes')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Información adicional..."
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
              Crear y Asignar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
