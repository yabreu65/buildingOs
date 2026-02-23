'use client';

import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import z from 'zod';
import { submitLead } from '@/shared/api/leads.api';
import { Button, Input, Card } from '@/shared/components/ui';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

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
  buildingsCount: z
    .number()
    .min(1, 'Must be at least 1')
    .optional()
    .or(z.undefined()),
  unitsEstimate: z.number().min(1, 'Must be at least 1'),
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
  // Honeypot: must remain empty
  website: z.string().max(0, 'Invalid submission').optional().or(z.literal('')),
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

  // Debug: log validation errors
  React.useEffect(() => {
    if (Object.keys(errors).length > 0) {
      console.log('🔴 Validation errors:', errors);
    }
  }, [errors]);

  // Check rate limiting (client-side)
  const checkRateLimit = useCallback((): boolean => {
    const now = Date.now();
    const key = 'lead_form_submissions';
    const stored = localStorage.getItem(key);
    const data = stored ? JSON.parse(stored) : { count: 0, resetTime: now + 60000 };

    if (now > data.resetTime) {
      // Reset window
      data.count = 1;
      data.resetTime = now + 60000;
    } else if (data.count >= 3) {
      // Rate limit exceeded
      return false;
    } else {
      data.count += 1;
    }

    localStorage.setItem(key, JSON.stringify(data));
    return true;
  }, []);

  // Handle form submission
  const onSubmit = async (data: LeadFormData) => {
    // Check honeypot
    if (data.website) {
      console.warn('Honeypot field filled, ignoring submission');
      return;
    }

    // Check rate limit
    if (!checkRateLimit()) {
      setSubmitError('Too many submissions. Please try again in 60 seconds.');
      setSubmitStatus('error');
      setTimeout(() => setSubmitStatus('idle'), 5000);
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');
    setSubmitError('');

    try {
      // Parse number fields
      const buildingsCountValue = data.buildingsCount
        ? parseInt(String(data.buildingsCount), 10)
        : undefined;
      const unitsEstimateValue = parseInt(String(data.unitsEstimate), 10);

      // Validate numbers
      if (isNaN(unitsEstimateValue) || unitsEstimateValue < 1) {
        throw new Error('Units estimate must be a number greater than 0');
      }
      if (buildingsCountValue !== undefined && (isNaN(buildingsCountValue) || buildingsCountValue < 1)) {
        throw new Error('Buildings count must be a number greater than 0');
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
        source: 'lead-form-web',
      };

      console.log('📤 Submitting lead:', submitData);
      const response = await submitLead(submitData);
      console.log('✅ Lead submitted successfully:', response);

      // Track analytics event
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'lead_submitted', {
          tenant_type: data.tenantType,
          units_estimate: data.unitsEstimate,
        });
      }

      setSubmissionCount((prev) => prev + 1);
      setSubmitStatus('success');
      reset();

      // Auto-clear success state
      setTimeout(() => setSubmitStatus('idle'), 5000);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to submit lead. Please try again.';
      setSubmitError(message);
      setSubmitStatus('error');
      console.error('❌ Lead submission error:', error);

      // Log detailed error info for debugging
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

  // Success state
  if (submitStatus === 'success') {
    return (
      <Card className="w-full max-w-md mx-auto p-8 border-green-200 bg-green-50">
        <div className="flex flex-col items-center text-center space-y-4">
          <CheckCircle className="w-16 h-16 text-green-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Lead Submitted Successfully!</h3>
            <p className="text-sm text-gray-600 mt-2">
              Our sales team will contact you shortly. Thank you for your interest in BuildingOS.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setSubmitStatus('idle');
            }}
            className="mt-4"
          >
            Submit Another
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Get Started</h2>
          <p className="text-sm text-gray-600 mt-2">
            Tell us about your property. Our team will get back to you within 24 hours.
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
              Full Name <span className="text-red-500">*</span>
            </label>
            <Input
              {...register('fullName')}
              placeholder="John Doe"
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
              placeholder="john@example.com"
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
              Phone / WhatsApp
            </label>
            <Input
              {...register('phoneWhatsapp')}
              placeholder="+1 (555) 000-0000"
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
              Tenant Type <span className="text-red-500">*</span>
            </label>
            <select
              {...register('tenantType')}
              disabled={isSubmitting}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.tenantType ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">Select property type</option>
              <option value="ADMINISTRADORA">Management Company</option>
              <option value="EDIFICIO_AUTOGESTION">Self-Managed Building</option>
            </select>
            {errors.tenantType && (
              <p className="text-sm text-red-600 mt-1">{errors.tenantType.message}</p>
            )}
          </div>

          {/* Buildings Count */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Number of Buildings (optional)
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

          {/* Units Estimate */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Estimated Number of Units <span className="text-red-500">*</span>
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

          {/* Country / City */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location (Country, City) (optional)
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

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Additional Information (optional)
            </label>
            <textarea
              {...register('message')}
              placeholder="Tell us more about your property and any specific needs..."
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

          {/* Honeypot field - hidden from users */}
          <input type="hidden" {...register('website')} />

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting || !isValid || isValidating}
            className="w-full"
            size="md"
            title={!isValid ? 'Please fill all required fields correctly' : ''}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : isValidating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Validating...
              </>
            ) : !isValid ? (
              'Complete the form to submit'
            ) : (
              'Submit Lead'
            )}
          </Button>

          {/* Privacy note */}
          <p className="text-xs text-gray-500 text-center">
            We respect your privacy. Your information will only be used to contact you about our services.
          </p>
        </form>
      </div>
    </Card>
  );
}

// Declare gtag for analytics
declare global {
  interface Window {
    gtag?: (command: string, event: string, data?: Record<string, any>) => void;
  }
}
