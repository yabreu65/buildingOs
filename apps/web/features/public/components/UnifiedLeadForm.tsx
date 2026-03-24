'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { submitLead, registerUser } from '@/shared/api/leads.api';
import { Button, Input, Card } from '@/shared/components/ui';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

type LeadIntent = 'DEMO' | 'CONTACT' | 'SIGNUP';

interface UnifiedLeadFormProps {
  intent: LeadIntent;
  title?: string;
  subtitle?: string;
  successTitle?: string;
  successMessage?: string;
}

// Zod validation schema
const leadFormSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  phoneWhatsapp: z
    .string()
    .max(20, 'Phone must be max 20 characters')
    .optional()
    .or(z.literal('')),
  tenantType: z.enum(['ADMINISTRADORA', 'EDIFICIO_AUTOGESTION']),
  tenantName: z
    .string()
    .min(2, 'Nombre debe tener al menos 2 caracteres')
    .max(100)
    .optional()
    .or(z.literal('')),
  unitsEstimate: z.number().min(1, 'Must be at least 1').optional().or(z.undefined()),
  countryCity: z
    .string()
    .max(100, 'Location must be max 100 characters')
    .optional()
    .or(z.literal('')),
  message: z
    .string()
    .max(1000, 'Message must be max 1000 characters')
    .optional()
    .or(z.literal('')),
  website: z.string().max(0, 'Invalid submission').optional().or(z.literal('')),
});

type LeadFormData = z.infer<typeof leadFormSchema>;

export function UnifiedLeadForm({
  intent,
  title,
  subtitle,
  successTitle,
  successMessage,
}: UnifiedLeadFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useForm<LeadFormData>({
    resolver: zodResolver(leadFormSchema),
    mode: 'onChange',
  });

  const onSubmit = async (data: LeadFormData) => {
    if (data.website) {
      console.warn('Honeypot field filled, ignoring submission');
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');
    setSubmitError('');

    try {
      // SIGNUP flow - register user
      if (intent === 'SIGNUP' && data.tenantName) {
        console.log(`📤 Submitting SIGNUP registration:`, data);
        await registerUser({
          fullName: data.fullName,
          email: data.email,
          tenantName: data.tenantName,
          tenantType: data.tenantType,
          phoneWhatsapp: data.phoneWhatsapp || undefined,
        });
        console.log(`✅ SIGNUP registration submitted successfully`);
      } else {
        // DEMO/CONTACT flow - submit as lead
        const submitData = {
          fullName: data.fullName,
          email: data.email,
          phoneWhatsapp: data.phoneWhatsapp || undefined,
          tenantType: data.tenantType,
          unitsEstimate: data.unitsEstimate || 1, // Default to 1 if not provided
          countryCity: data.countryCity || undefined,
          message: data.message || undefined,
          source: intent === 'DEMO' ? 'landing' : 'contact-form',
          intent,
        };

        console.log(`📤 Submitting ${intent} lead:`, submitData);
        await submitLead(submitData);
        console.log(`✅ ${intent} lead submitted successfully`);
      }

      setSubmitStatus('success');
      reset();

      setTimeout(() => setSubmitStatus('idle'), 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to submit ${intent.toLowerCase()} request`;
      setSubmitError(message);
      setSubmitStatus('error');
      console.error(`❌ ${intent} submission error:`, error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success state
  if (submitStatus === 'success') {
    const defaultSuccessTitle = intent === 'SIGNUP' ? '¡Cuenta creada!' : '¡Solicitud recibida!';
    const defaultSuccessMessage =
      intent === 'SIGNUP'
        ? 'Revisá tu email — enviamos el link para crear tu contraseña. El link expira en 24 horas.'
        : 'Te contactaremos pronto. Gracias por tu interés en BuildingOS.';

    return (
      <Card className="w-full max-w-md mx-auto p-8 border-green-200 bg-green-50">
        <div className="flex flex-col items-center text-center space-y-4">
          <CheckCircle className="w-16 h-16 text-green-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {successTitle || defaultSuccessTitle}
            </h3>
            <p className="text-sm text-gray-600 mt-2">
              {successMessage || defaultSuccessMessage}
            </p>
          </div>
          <Button variant="secondary" onClick={() => reset()} className="mt-4">
            Enviar otra
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {title ||
              (intent === 'SIGNUP'
                ? 'Crear mi Cuenta'
                : intent === 'DEMO'
                ? 'Solicitar Demo'
                : 'Get Started')}
          </h2>
          <p className="text-sm text-gray-600 mt-2">
            {subtitle ||
              (intent === 'SIGNUP'
                ? 'Comenzá a usar BuildingOS hoy mismo.'
                : 'Completa el formulario y nos pondremos en contacto.')}
          </p>
        </div>

        {submitStatus === 'error' && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre completo <span className="text-red-500">*</span>
            </label>
            <Input
              {...register('fullName')}
              placeholder="Juan Pérez"
              disabled={isSubmitting}
              className={errors.fullName ? 'border-red-500' : ''}
            />
            {errors.fullName && (
              <p className="text-sm text-red-600 mt-1">{errors.fullName.message}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <Input
              {...register('email')}
              type="email"
              placeholder="juan@example.com"
              disabled={isSubmitting}
              className={errors.email ? 'border-red-500' : ''}
            />
            {errors.email && (
              <p className="text-sm text-red-600 mt-1">{errors.email.message}</p>
            )}
          </div>

          {/* Phone/WhatsApp */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              WhatsApp {intent !== 'DEMO' && <span>(opcional)</span>}
            </label>
            <Input
              {...register('phoneWhatsapp')}
              placeholder="+58 412 000 0000"
              disabled={isSubmitting}
              className={errors.phoneWhatsapp ? 'border-red-500' : ''}
            />
            {errors.phoneWhatsapp && (
              <p className="text-sm text-red-600 mt-1">{errors.phoneWhatsapp.message}</p>
            )}
          </div>

          {/* Tenant Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ¿Qué tipo de administración? <span className="text-red-500">*</span>
            </label>
            <select
              {...register('tenantType')}
              disabled={isSubmitting}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.tenantType ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">Seleccionar</option>
              <option value="ADMINISTRADORA">Administradora</option>
              <option value="EDIFICIO_AUTOGESTION">Autogestión</option>
            </select>
            {errors.tenantType && (
              <p className="text-sm text-red-600 mt-1">{errors.tenantType.message}</p>
            )}
          </div>

          {/* Tenant Name - Only for SIGNUP */}
          {intent === 'SIGNUP' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nombre de tu empresa/edificio <span className="text-red-500">*</span>
              </label>
              <Input
                {...register('tenantName')}
                placeholder="Ej: Edificio Flor de Ceibo"
                disabled={isSubmitting}
                className={errors.tenantName ? 'border-red-500' : ''}
              />
              {errors.tenantName && (
                <p className="text-sm text-red-600 mt-1">{errors.tenantName.message}</p>
              )}
            </div>
          )}

          {/* Units Estimate - Only for CONTACT */}
          {intent === 'CONTACT' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cantidad de unidades (aprox.) <span className="text-red-500">*</span>
              </label>
              <Input
                {...register('unitsEstimate', { valueAsNumber: true })}
                type="number"
                placeholder="50"
                disabled={isSubmitting}
                className={errors.unitsEstimate ? 'border-red-500' : ''}
                min="1"
              />
              {errors.unitsEstimate && (
                <p className="text-sm text-red-600 mt-1">{errors.unitsEstimate.message}</p>
              )}
            </div>
          )}

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ubicación (País, Ciudad) {intent !== 'DEMO' && <span className="text-gray-400">(opcional)</span>}
            </label>
            <Input
              {...register('countryCity')}
              placeholder="Argentina, Buenos Aires"
              disabled={isSubmitting}
              className={errors.countryCity ? 'border-red-500' : ''}
            />
            {errors.countryCity && (
              <p className="text-sm text-red-600 mt-1">{errors.countryCity.message}</p>
            )}
          </div>

          {/* Message - Only for CONTACT */}
          {intent === 'CONTACT' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mensaje adicional (opcional)
              </label>
              <textarea
                {...register('message')}
                placeholder="Cuéntanos más sobre tu propiedad..."
                disabled={isSubmitting}
                rows={4}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                  errors.message ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.message && (
                <p className="text-sm text-red-600 mt-1">{errors.message.message}</p>
              )}
            </div>
          )}

          {/* Honeypot */}
          <input type="hidden" {...register('website')} />

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting || !isValid}
            className="w-full"
            size="md"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : intent === 'SIGNUP' ? (
              'Crear Cuenta'
            ) : intent === 'DEMO' ? (
              'Solicitar demo'
            ) : (
              'Get Started'
            )}
          </Button>

          <p className="text-xs text-gray-500 text-center">
            {intent === 'SIGNUP'
              ? 'Respetamos tu privacidad. Tu información será usada solo para crear tu cuenta.'
              : intent === 'DEMO'
              ? 'Sumate a la lista de espera de BuildingOS.'
              : 'Respetamos tu privacidad. Tu información será usada solo para contactarte.'}
          </p>
        </form>
      </div>
    </Card>
  );
}
