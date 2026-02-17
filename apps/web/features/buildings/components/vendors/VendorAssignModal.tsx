'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { X, Loader2 } from 'lucide-react';
import type { Vendor, CreateVendorAssignmentInput } from '../../services/vendors.api';

const assignSchema = z.object({
  vendorId: z.string().min(1, 'Vendor is required'),
  serviceType: z.string().min(2, 'Service type is required'),
});

type AssignFormData = z.infer<typeof assignSchema>;

interface VendorAssignModalProps {
  allVendors: Vendor[];
  onSave: () => Promise<void>;
  onClose: () => void;
  assignVendor: (input: CreateVendorAssignmentInput) => Promise<any>;
}

export default function VendorAssignModal({
  allVendors,
  onSave,
  onClose,
  assignVendor,
}: VendorAssignModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AssignFormData>({
    resolver: zodResolver(assignSchema),
  });

  const onSubmit = async (data: AssignFormData) => {
    setIsSubmitting(true);
    try {
      await assignVendor({
        vendorId: data.vendorId,
        serviceType: data.serviceType,
      });
      toast('Vendor assigned', 'success');
      await onSave();
    } catch (error) {
      toast('Failed to assign vendor', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Asignar Proveedor</h3>
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
              {allVendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
            {errors.vendorId && <p className="text-red-600 text-sm mt-1">{errors.vendorId.message}</p>}
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

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Asignar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
