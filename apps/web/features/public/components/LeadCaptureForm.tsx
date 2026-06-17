'use client';

import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import z from 'zod';
import { submitLead } from '@/shared/api/leads.api';
import { Button, Input, Card } from '@/shared/components/ui';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/shared/components/error-boundary';
import { StorageService } from '@/shared/lib/storage';

// Esquema de validación Zod
const leadFormSchema = z.object({
  fullName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(100),
  email: z.string().email('Correo electrónico inválido'),
  phoneWhatsapp: z
    .string()
    .max(20, 'El teléfono debe tener como máximo 20 caracteres')
    .optional()
    .or(z.literal('')),
  tenantType: z.enum(['ADMINISTRADORA', 'EDIFICIO_AUTOGESTION']),
  buildingsCount: z
    .number()
    .min(1, 'Debe ser al menos 1')
    .optional()
    .or(z.undefined()),
  unitsEstimate: z.number().min(1, 'Debe ser al menos 1'),
  countryCity: z
    .string()
    .max(100, 'La ubicación debe tener como máximo 100 caracteres')
    .optional()
    .or(z.literal('')),
  message: z
    .string()
    .max(1000, 'El mensaje debe tener como máximo 1000 caracteres')
    .optional()
    .or(z.literal('')),
  // Honeypot: debe permanecer vacío
  website: z.string().max(0, 'Envío inválido').optional().or(z.literal('')),
});

type LeadFormData = z.infer<typeof leadFormSchema>;

/**
 * Lead Capture Form Component
 * - Validates all required fields
 * - Includes honeypot field for spam prevention
 * - Client-side rate limiting (3 submissions per 60 seconds)
 * - Tracks analytics events on submission
 * - Shows success/error states
 */
export function LeadCaptureForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [submitError, setSubmitError] = useState<string>('');
  const [submissionCount, setSubmissionCount] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid, isValidating },
    reset,
    watch,
    setValue,
  } = useForm<LeadFormData>({
    resolver: zodResolver(leadFormSchema),
    mode: 'onChange',
  });

  // Debug: registrar errores de validación
  React.useEffect(() => {
    if (Object.keys(errors).length > 0) {
      console.log('🔴 Errores de validación:', errors);
    }
  }, [errors]);

  // Verificar límite de envíos (lado cliente)
  const checkRateLimit = useCallback((): boolean => {
    const now = Date.now();
    const data = StorageService.get<{ count: number; resetTime: number }>(
      'lead_form_submissions',
      undefined,
      { count: 0, resetTime: now + 60000 }
    ) || { count: 0, resetTime: now + 60000 };

    if (now > data.resetTime) {
      // Reiniciar ventana
      data.count = 1;
      data.resetTime = now + 60000;
    } else if (data.count >= 3) {
      // Límite de envíos excedido
      return false;
    } else {
      data.count += 1;
    }

    StorageService.set('lead_form_submissions', data);
    return true;
  }, []);

  // Manejar envío del formulario
  const onSubmit = async (data: LeadFormData) => {
    // Verificar honeypot
    if (data.website) {
      console.warn('Campo honeypot completado, se ignora el envío');
      return;
    }

    // Verificar límite de envíos
    if (!checkRateLimit()) {
      setSubmitError('Demasiados envíos. Probá de nuevo en 60 segundos.');
      setSubmitStatus('error');
      setTimeout(() => setSubmitStatus('idle'), 5000);
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');
    setSubmitError('');

    try {
      // Parsear campos numéricos
      const buildingsCountValue = data.buildingsCount
        ? parseInt(String(data.buildingsCount), 10)
        : undefined;
      const unitsEstimateValue = parseInt(String(data.unitsEstimate), 10);

      // Validar números
      if (isNaN(unitsEstimateValue) || unitsEstimateValue < 1) {
        throw new Error('La estimación de unidades debe ser un número mayor que 0');
      }
      if (buildingsCountValue !== undefined && (isNaN(buildingsCountValue) || buildingsCountValue < 1)) {
        throw new Error('La cantidad de edificios debe ser un número mayor que 0');
      }

      const submitData = {
        fullName: data.fullName,
        email: data.email,
        phoneWhatsapp: data.phoneWhatsapp || undefined,
        tenantType: data.tenantType,
        buildingsCount: buildingsCountValue,
        unitsEstimate: unitsEstimateValue,
        countryCity: data.countryCity || undefined,
        message: data.message || undefined,
        source: 'formulario-web-leads',
      };

      console.log('📤 Enviando lead:', submitData);
      const response = await submitLead(submitData);
      console.log('✅ Solicitud enviada correctamente:', response);

      // Registrar evento de analítica
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'lead_submitted', {
          tenant_type: data.tenantType,
          units_estimate: data.unitsEstimate,
        });
      }

      setSubmissionCount((prev) => prev + 1);
      setSubmitStatus('success');
      reset();

      // Limpiar estado de éxito automáticamente
      setTimeout(() => setSubmitStatus('idle'), 5000);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar el lead. Probá de nuevo.';
      setSubmitError(message);
      setSubmitStatus('error');
      console.error('❌ Error al enviar el lead:', error);

      // Registrar detalle del error para depuración
      if (error instanceof Error) {
        console.error('Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Estado de éxito
  if (submitStatus === 'success') {
    return (
      <ErrorBoundary level="feature">
        <Card className="w-full max-w-md mx-auto p-8 border-green-200 bg-green-50">
          <div className="flex flex-col items-center text-center space-y-4">
          <CheckCircle className="w-16 h-16 text-green-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Solicitud enviada correctamente</h3>
            <p className="text-sm text-gray-600 mt-2">
              Nuestro equipo comercial se va a contactar pronto. Gracias por tu interés en BuildingOS.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setSubmitStatus('idle');
            }}
            className="mt-4"
          >
            Enviar otra solicitud
          </Button>
          </div>
        </Card>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary level="feature">
      <Card className="w-full max-w-md mx-auto p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Comenzar</h2>
          <p className="text-sm text-gray-600 mt-2">
            Contanos sobre tu propiedad. Nuestro equipo te va a responder dentro de 24 horas.
          </p>
        </div>

        {submitStatus === 'error' && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {/* Nombre completo */}
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

          {/* Correo electrónico */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Correo electrónico <span className="text-red-500">*</span>
            </label>
            <Input
              {...register('email')}
              type="email"
              placeholder="tu@correo.com"
              disabled={isSubmitting}
              className={errors.email ? 'border-red-500' : ''}
            />
            {errors.email && (
              <p className="text-sm text-red-600 mt-1">{errors.email.message}</p>
            )}
          </div>

          {/* Teléfono / WhatsApp */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teléfono / WhatsApp
            </label>
            <Input
              {...register('phoneWhatsapp')}
              placeholder="+54 11 0000 0000"
              disabled={isSubmitting}
              className={errors.phoneWhatsapp ? 'border-red-500' : ''}
            />
            {errors.phoneWhatsapp && (
              <p className="text-sm text-red-600 mt-1">{errors.phoneWhatsapp.message}</p>
            )}
          </div>

          {/* Tipo de administración */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de administración <span className="text-red-500">*</span>
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
              <option value="EDIFICIO_AUTOGESTION">Edificio autogestionado</option>
            </select>
            {errors.tenantType && (
              <p className="text-sm text-red-600 mt-1">{errors.tenantType.message}</p>
            )}
          </div>

          {/* Cantidad de edificios */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cantidad de edificios (opcional)
            </label>
            <Input
              {...register('buildingsCount', { valueAsNumber: true })}
              type="number"
              placeholder="1"
              disabled={isSubmitting}
              className={errors.buildingsCount ? 'border-red-500' : ''}
              min="1"
            />
            {errors.buildingsCount && (
              <p className="text-sm text-red-600 mt-1">{errors.buildingsCount.message}</p>
            )}
          </div>

          {/* Estimación de unidades */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cantidad estimada de unidades <span className="text-red-500">*</span>
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

          {/* País / ciudad */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ubicación (País, Ciudad) (opcional)
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

          {/* Mensaje */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Información adicional (opcional)
            </label>
            <textarea
              {...register('message')}
              placeholder="Contanos más sobre tu propiedad y tus necesidades específicas..."
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

          {/* Campo honeypot - oculto para usuarios */}
          <input type="hidden" {...register('website')} />

          {/* Botón de envío */}
          <Button
            type="submit"
            disabled={isSubmitting || !isValid || isValidating}
            className="w-full"
            size="md"
            title={!isValid ? 'Completá correctamente todos los campos obligatorios' : ''}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : isValidating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Validando...
              </>
            ) : !isValid ? (
              'Completá el formulario para enviar'
            ) : (
              'Enviar solicitud'
            )}
          </Button>

          {/* Aviso de privacidad */}
          <p className="text-xs text-gray-500 text-center">
            Respetamos tu privacidad. Tu información se usará solo para contactarte sobre nuestros servicios.
          </p>
        </form>
      </div>
    </Card>
    </ErrorBoundary>
  );
}

// Declare gtag for analytics
declare global {
  interface Window {
    gtag?: (command: string, event: string, data?: Record<string, string | number | boolean | undefined>) => void;
  }
}
