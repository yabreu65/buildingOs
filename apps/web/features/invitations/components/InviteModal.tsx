'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import Input from '@/shared/components/ui/Input';
import { CreateInvitationRequest } from '../services/invitations.api';

const inviteSchema = z.object({
  email: z.string().email('Email inválido'),
});

type InviteFormData = z.infer<typeof inviteSchema>;

interface InviteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (dto: CreateInvitationRequest) => Promise<void>;
}

export default function InviteModal({
  open,
  onOpenChange,
  onSubmit,
}: InviteModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
    },
  });

  const handleFormSubmit = async (data: InviteFormData) => {
    if (selectedRoles.length === 0) {
      setError('Selecione pelo menos um papel');
      return;
    }

    try {
      setError(null);
      setLoading(true);
      await onSubmit({
        email: data.email,
        roles: selectedRoles,
      });
      reset();
      setSelectedRoles([]);
      onOpenChange(false);
    } catch (err: any) {
      const message = err?.message || 'Erro ao enviar convite';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Convidar Membro
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Envie um convite para adicionar um novo membro à sua equipe
          </p>
        </div>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <Input
              type="email"
              placeholder="usuario@example.com"
              {...register('email')}
            />
            {errors.email && (
              <p className="text-sm text-red-600 mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Papéis</label>
            <div className="space-y-2">
              {['TENANT_ADMIN', 'OPERATOR', 'RESIDENT'].map((role) => (
                <label
                  key={role}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(role)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedRoles([...selectedRoles, role]);
                      } else {
                        setSelectedRoles(
                          selectedRoles.filter((r) => r !== role)
                        );
                      }
                    }}
                  />
                  <span className="text-sm">{role}</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                reset();
                setSelectedRoles([]);
                setError(null);
              }}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={loading || selectedRoles.length === 0}>
              {loading ? 'Enviando...' : 'Enviar Convite'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
