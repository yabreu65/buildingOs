'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Input from '@/shared/components/ui/Input';
import { X, Loader2 } from 'lucide-react';
import { useToast } from '@/shared/components/ui/Toast';
import { useCreateTenantMember } from '../hooks/useTenantMembers';

interface CreateMemberModalProps {
  tenantId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const createMemberSchema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  email: z.string().min(1, 'Email requerido').email('Email inválido'),
  phone: z.string().min(1, 'Teléfono requerido'),
  notes: z.string().optional().or(z.literal('')),
});

type CreateMemberFormData = z.infer<typeof createMemberSchema>;

export const CreateMemberModal = ({
  tenantId,
  onClose,
  onSuccess,
}: CreateMemberModalProps) => {
  const { toast } = useToast();
  const createMutation = useCreateTenantMember(tenantId);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<CreateMemberFormData>({
    resolver: zodResolver(createMemberSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      notes: '',
    },
  });

  const handleCreate = async (data: CreateMemberFormData) => {
    setSubmitError(null);

    try {
      await createMutation.mutateAsync({
        name: data.name,
        email: data.email || undefined,
        phone: data.phone || undefined,
        notes: data.notes || undefined,
        role: 'RESIDENT',
      });

      toast('Miembro creado correctamente', 'success');
      reset();
      onClose();
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al crear miembro';
      setSubmitError(message);
      toast(message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="max-w-lg w-full border-blue-200 bg-blue-50">
        <div className="mb-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Crear Nuevo Miembro</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            disabled={createMutation.isPending}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submitError && (
          <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit(handleCreate)} className="space-y-4">
          {/* Name - Required */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1">
              Nombre *
            </label>
            <Input
              id="name"
              placeholder="e.g., Juan García"
              {...register('name')}
              disabled={createMutation.isPending}
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && (
              <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>
            )}
          </div>

          {/* Email - Required */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email *
            </label>
            <Input
              id="email"
              type="email"
              placeholder="juan@example.com"
              {...register('email')}
              disabled={createMutation.isPending}
              className={errors.email ? 'border-red-500' : ''}
            />
            {errors.email && (
              <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>
            )}
          </div>

          {/* Phone - Required */}
          <div>
            <label htmlFor="phone" className="block text-sm font-medium mb-1">
              Teléfono *
            </label>
            <Input
              id="phone"
              placeholder="+54 9 11 2345-6789"
              {...register('phone')}
              disabled={createMutation.isPending}
              className={errors.phone ? 'border-red-500' : ''}
            />
            {errors.phone && (
              <p className="text-xs text-red-600 mt-1">{errors.phone.message}</p>
            )}
          </div>

          {/* Notes - Optional */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium mb-1">
              Notas (opcional)
            </label>
            <textarea
              id="notes"
              placeholder="Observaciones sobre este miembro..."
              {...register('notes')}
              disabled={createMutation.isPending}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>

          {/* Info Box */}
          <div className="p-3 bg-blue-100 border border-blue-300 rounded-md text-sm text-blue-800">
            El miembro se creará en estado <strong>PENDIENTE</strong> y recibirá una invitación por email.
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-4 border-t">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={createMutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creando...
                </>
              ) : (
                'Crear Miembro'
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
