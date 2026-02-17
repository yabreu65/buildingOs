'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Button from '@/shared/components/ui/Button';
import Input from '@/shared/components/ui/Input';
import { createTenantSchema } from '../super-admin.validation';
import type { CreateTenantInput } from '../super-admin.types';
import type { z } from 'zod';

interface TenantCreateWizardProps {
  onSubmit: (data: CreateTenantInput) => Promise<void>;
  isLoading?: boolean;
  feedback?: { type: 'success' | 'error'; message: string } | null;
}

type CreateTenantFormData = z.infer<typeof createTenantSchema>;

export default function TenantCreateWizard({
  onSubmit,
  isLoading = false,
  feedback,
}: TenantCreateWizardProps) {
  const [step, setStep] = useState(1);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<CreateTenantFormData>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: {
      name: '',
      type: 'ADMINISTRADORA',
      plan: 'FREE',
      ownerEmail: '',
    },
  });

  const formData = watch();
  const isLoaded = isLoading || isSubmitting;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Crear Tenant</h1>
        <p className="text-muted-foreground">Paso {step} de 3</p>
      </div>

      {/* Progress */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-2 flex-1 rounded-full ${
              s <= step ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`px-4 py-3 rounded-md text-sm ${
            feedback.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Step 1: Info Básica */}
        {step === 1 && (
          <div className="space-y-4 border border-border rounded-lg p-6 bg-card">
            <h2 className="text-lg font-semibold">Información Básica</h2>

            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Nombre del Tenant *
              </label>
              <Input
                id="name"
                placeholder="Ej: Acme Corporation"
                {...register('name')}
                disabled={isLoaded}
              />
              {errors.name && (
                <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-3">
                Tipo de Tenant *
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="ADMINISTRADORA"
                    {...register('type')}
                    disabled={isLoaded}
                  />
                  <span className="text-sm">ADMINISTRADORA (Empresa inmobiliaria)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="EDIFICIO_AUTOGESTION"
                    {...register('type')}
                    disabled={isLoaded}
                  />
                  <span className="text-sm">EDIFICIO_AUTOGESTION (Consorcio individual)</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Plan y Contacto */}
        {step === 2 && (
          <div className="space-y-4 border border-border rounded-lg p-6 bg-card">
            <h2 className="text-lg font-semibold">Plan y Contacto</h2>

            <div>
              <label htmlFor="plan" className="block text-sm font-medium mb-1">
                Plan *
              </label>
              <select
                id="plan"
                className="w-full px-3 py-2 border border-input rounded-md text-sm disabled:opacity-50"
                {...register('plan')}
                disabled={isLoaded}
              >
                <option value="FREE">FREE (1 edificio, 10 unidades, 20 usuarios)</option>
                <option value="BASIC">BASIC (5 edificios, 50 unidades, 100 usuarios)</option>
                <option value="PRO">PRO (20 edificios, 500 unidades, 500 usuarios)</option>
                <option value="ENTERPRISE">ENTERPRISE (Ilimitado, custom)</option>
              </select>
              {errors.plan && (
                <p className="text-xs text-red-600 mt-1">{errors.plan.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="ownerEmail" className="block text-sm font-medium mb-1">
                Email del Owner *
              </label>
              <Input
                id="ownerEmail"
                type="email"
                placeholder="admin@empresa.com"
                {...register('ownerEmail')}
                disabled={isLoaded}
              />
              {errors.ownerEmail && (
                <p className="text-xs text-red-600 mt-1">{errors.ownerEmail.message}</p>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-4 border border-border rounded-lg p-6 bg-card">
            <h2 className="text-lg font-semibold">Revisar y Crear</h2>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Nombre:</span>
                <span className="text-sm font-medium">{formData.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Tipo:</span>
                <span className="text-sm font-medium">
                  {formData.type === 'ADMINISTRADORA' ? 'Empresa inmobiliaria' : 'Consorcio'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Plan:</span>
                <span className="text-sm font-medium">{formData.plan}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Email Owner:</span>
                <span className="text-sm font-medium">{formData.ownerEmail}</span>
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 justify-between">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1 || isLoaded}
          >
            Atrás
          </Button>

          {step < 3 ? (
            <Button type="button" onClick={() => setStep(step + 1)} disabled={isLoaded}>
              Siguiente
            </Button>
          ) : (
            <Button type="submit" disabled={isLoaded}>
              {isLoading || isSubmitting ? 'Creando...' : 'Crear Tenant'}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
