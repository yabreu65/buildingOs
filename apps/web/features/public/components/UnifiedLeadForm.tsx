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
  fullName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(100),
  email: z.string().email('Correo electrónico inválido'),
  phoneWhatsapp: z
    .string()
    .max(20, 'El teléfono debe tener como máximo 20 caracteres')
    .optional()
    .or(z.literal('')),
  tenantType: z.enum(['ADMINISTRADORA', 'EDIFICIO_AUTOGESTION']),
  tenantName: z
    .string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100)
    .optional()
    .or(z.literal('')),
  unitsEstimate: z.number().min(1, 'Debe ser al menos 1').optional().or(z.undefined()),
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
  website: z.string().max(0, 'Envío inválido').optional().or(z.literal('')),
});

type LeadFormData = z.infer<typeof leadFormSchema>;

export function UnifiedLeadForm({
  intent,
  title,
  subtitle,
  successTitle,
  successMessage,
}: UnifiedLeadFormProps) {
  const ids = {
    requiredNote: `lead-${intent.toLowerCase()}-required-note`,
    fullName: `lead-${intent.toLowerCase()}-full-name`,
    email: `lead-${intent.toLowerCase()}-email`,
    phoneWhatsapp: `lead-${intent.toLowerCase()}-phone-whatsapp`,
    tenantType: `lead-${intent.toLowerCase()}-tenant-type`,
    tenantName: `lead-${intent.toLowerCase()}-tenant-name`,
    unitsEstimate: `lead-${intent.toLowerCase()}-units-estimate`,
    countryCity: `lead-${intent.toLowerCase()}-country-city`,
    message: `lead-${intent.toLowerCase()}-message`,
  } as const;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors },
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
        console.log('📤 Enviando registro SIGNUP:', data);
        await registerUser({
          fullName: data.fullName,
          email: data.email,
          tenantName: data.tenantName,
          tenantType: data.tenantType,
          phoneWhatsapp: data.phoneWhatsapp || undefined,
        });
        console.log('✅ Registro SIGNUP enviado correctamente');
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

        console.log(`📤 Enviando lead ${intent}:`, submitData);
        await submitLead(submitData);
        console.log(`✅ Lead ${intent} enviado correctamente`);
      }

      setSubmitStatus('success');
      reset();

      setTimeout(() => setSubmitStatus('idle'), 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : `No se pudo enviar la solicitud ${intent.toLowerCase()}`;
      setSubmitError(message);
      setSubmitStatus('error');
      console.error(`❌ Error al enviar ${intent}:`, error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success state
  if (submitStatus === 'success') {
    const defaultSuccessTitle = intent === 'SIGNUP' ? '¡Cuenta creada!' : '¡Solicitud recibida!';
    const defaultSuccessMessage =
      intent === 'SIGNUP'
        ? 'Revisá tu correo electrónico: enviamos el enlace para crear tu contraseña. El enlace expira en 24 horas.'
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
                ? 'Crear mi cuenta'
                : intent === 'DEMO'
                ? 'Solicitar demo'
                : 'Comenzar')}
          </h2>
          <p className="text-sm text-gray-600 mt-2">
            {subtitle ||
              (intent === 'SIGNUP'
                ? 'Comenzá a usar BuildingOS hoy mismo.'
                : 'Completá el formulario y nos pondremos en contacto.')}
          </p>
        </div>

        <p id={ids.requiredNote} className="text-xs text-gray-500">
          Los campos marcados con * son obligatorios.
        </p>

        {submitStatus === 'error' && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {/* Full Name */}
          <div>
            <label htmlFor={ids.fullName} className="block text-sm font-medium text-gray-700 mb-1">
              Nombre completo <span className="text-red-500">*</span>
            </label>
            <Input
              id={ids.fullName}
              {...register('fullName')}
              placeholder="Juan Pérez"
              required
              aria-required="true"
              aria-invalid={Boolean(errors.fullName)}
              aria-describedby={errors.fullName ? `${ids.fullName}-error ${ids.requiredNote}` : ids.requiredNote}
              disabled={isSubmitting}
              className={errors.fullName ? 'border-red-500' : ''}
            />
            {errors.fullName && (
              <p id={`${ids.fullName}-error`} className="text-sm text-red-600 mt-1">
                {errors.fullName.message}
              </p>
            )}
          </div>

          {/* Email */}
          <div>
            <label htmlFor={ids.email} className="block text-sm font-medium text-gray-700 mb-1">
              Correo electrónico <span className="text-red-500">*</span>
            </label>
            <Input
              id={ids.email}
              {...register('email')}
              type="email"
              placeholder="tu@correo.com"
              required
              aria-required="true"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? `${ids.email}-error ${ids.requiredNote}` : ids.requiredNote}
              disabled={isSubmitting}
              className={errors.email ? 'border-red-500' : ''}
            />
            {errors.email && (
              <p id={`${ids.email}-error`} className="text-sm text-red-600 mt-1">
                {errors.email.message}
              </p>
            )}
          </div>

          {/* Phone/WhatsApp */}
          <div>
            <label htmlFor={ids.phoneWhatsapp} className="block text-sm font-medium text-gray-700 mb-1">
              WhatsApp {intent !== 'DEMO' && <span>(opcional)</span>}
            </label>
            <Input
              id={ids.phoneWhatsapp}
              {...register('phoneWhatsapp')}
              placeholder="+54 11 0000 0000"
              aria-invalid={Boolean(errors.phoneWhatsapp)}
              aria-describedby={errors.phoneWhatsapp ? `${ids.phoneWhatsapp}-error` : undefined}
              disabled={isSubmitting}
              className={errors.phoneWhatsapp ? 'border-red-500' : ''}
            />
            {errors.phoneWhatsapp && (
              <p id={`${ids.phoneWhatsapp}-error`} className="text-sm text-red-600 mt-1">
                {errors.phoneWhatsapp.message}
              </p>
            )}
          </div>

          {/* Tenant Type */}
          <div>
            <label htmlFor={ids.tenantType} className="block text-sm font-medium text-gray-700 mb-1">
              ¿Qué tipo de administración? <span className="text-red-500">*</span>
            </label>
            <select
              id={ids.tenantType}
              {...register('tenantType')}
              required
              aria-required="true"
              aria-invalid={Boolean(errors.tenantType)}
              aria-describedby={errors.tenantType ? `${ids.tenantType}-error ${ids.requiredNote}` : ids.requiredNote}
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
              <p id={`${ids.tenantType}-error`} className="text-sm text-red-600 mt-1">
                {errors.tenantType.message}
              </p>
            )}
          </div>

          {/* Tenant Name - Only for SIGNUP */}
          {intent === 'SIGNUP' && (
            <div>
              <label htmlFor={ids.tenantName} className="block text-sm font-medium text-gray-700 mb-1">
                Nombre de tu empresa/edificio <span className="text-red-500">*</span>
              </label>
              <Input
                id={ids.tenantName}
                {...register('tenantName')}
                placeholder="Ej: Edificio Flor de Ceibo"
                required
                aria-required="true"
                aria-invalid={Boolean(errors.tenantName)}
                aria-describedby={errors.tenantName ? `${ids.tenantName}-error ${ids.requiredNote}` : ids.requiredNote}
                disabled={isSubmitting}
                className={errors.tenantName ? 'border-red-500' : ''}
              />
              {errors.tenantName && (
                <p id={`${ids.tenantName}-error`} className="text-sm text-red-600 mt-1">
                  {errors.tenantName.message}
                </p>
              )}
            </div>
          )}

          {/* Units Estimate - Only for CONTACT */}
          {intent === 'CONTACT' && (
            <div>
              <label htmlFor={ids.unitsEstimate} className="block text-sm font-medium text-gray-700 mb-1">
                Cantidad de unidades (aprox.) <span className="text-red-500">*</span>
              </label>
              <Input
                id={ids.unitsEstimate}
                {...register('unitsEstimate', { valueAsNumber: true })}
                type="number"
                placeholder="50"
                required
                aria-required="true"
                aria-invalid={Boolean(errors.unitsEstimate)}
                aria-describedby={errors.unitsEstimate ? `${ids.unitsEstimate}-error ${ids.requiredNote}` : ids.requiredNote}
                disabled={isSubmitting}
                className={errors.unitsEstimate ? 'border-red-500' : ''}
                min="1"
              />
              {errors.unitsEstimate && (
                <p id={`${ids.unitsEstimate}-error`} className="text-sm text-red-600 mt-1">
                  {errors.unitsEstimate.message}
                </p>
              )}
            </div>
          )}

          {/* Location */}
          <div>
            <label htmlFor={ids.countryCity} className="block text-sm font-medium text-gray-700 mb-1">
              Ubicación (País, Ciudad) {intent !== 'DEMO' && <span className="text-gray-400">(opcional)</span>}
            </label>
            <Input
              id={ids.countryCity}
              {...register('countryCity')}
              placeholder="Argentina, Buenos Aires"
              aria-invalid={Boolean(errors.countryCity)}
              aria-describedby={errors.countryCity ? `${ids.countryCity}-error` : undefined}
              disabled={isSubmitting}
              className={errors.countryCity ? 'border-red-500' : ''}
            />
            {errors.countryCity && (
              <p id={`${ids.countryCity}-error`} className="text-sm text-red-600 mt-1">
                {errors.countryCity.message}
              </p>
            )}
          </div>

          {/* Message - Only for CONTACT */}
          {intent === 'CONTACT' && (
            <div>
              <label htmlFor={ids.message} className="block text-sm font-medium text-gray-700 mb-1">
                Mensaje adicional (opcional)
              </label>
              <textarea
                id={ids.message}
                {...register('message')}
                placeholder="Contanos más sobre tu propiedad..."
                disabled={isSubmitting}
                rows={4}
                aria-invalid={Boolean(errors.message)}
                aria-describedby={errors.message ? `${ids.message}-error` : undefined}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                  errors.message ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.message && (
                <p id={`${ids.message}-error`} className="text-sm text-red-600 mt-1">
                  {errors.message.message}
                </p>
              )}
            </div>
          )}

          {/* Honeypot */}
          <input type="hidden" {...register('website')} />

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full"
            size="md"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : intent === 'SIGNUP' ? (
              'Crear cuenta'
            ) : intent === 'DEMO' ? (
              'Solicitar demo'
            ) : (
              'Comenzar'
            )}
          </Button>

          <p className="text-xs text-gray-500 text-center">
            {intent === 'SIGNUP'
              ? 'Respetamos tu privacidad. Tu información será usada solo para crear tu cuenta.'
              : intent === 'DEMO'
              ? 'Respetamos tu privacidad. Tu información será usada solo para coordinar la demo.'
              : 'Respetamos tu privacidad. Tu información será usada solo para contactarte.'}
          </p>
        </form>
      </div>
    </Card>
  );
}
