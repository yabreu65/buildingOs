'use client';

// Dynamic page - cannot be statically generated (uses searchParams)
export const dynamic = 'force-dynamic';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import Input from '@/shared/components/ui/Input';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import { apiClient } from '@/shared/lib/http/client';
import { setToken, setSession, setLastTenant } from '@/features/auth/session.storage';
import { t } from '@/i18n';

const acceptSchema = z.object({
  name: z.string().min(1, t('auth.invite.nameRequired')),
  password: z.string().min(8, t('auth.invite.passwordMinimum')),
});

type AcceptFormData = z.infer<typeof acceptSchema>;

function InvitePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get('token');
  const [validating, setValidating] = useState(!!token);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptFormData>({
    resolver: zodResolver(acceptSchema),
    defaultValues: {
      name: '',
      password: '',
    },
  });

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setValidating(false);
      return;
    }

    const validateToken = async () => {
      try {
        const response = await apiClient<{
          tenantId: string;
          tenantName: string;
          email: string;
          roles: string[];
          expiresAt: string;
        }>({
          path: `/invitations/validate?token=${encodeURIComponent(token)}`,
          method: 'GET',
        });
        setTenantId(response.tenantId);
        setEmail(response.email);
        setTenantName(response.tenantName);
        setRoles(Array.isArray(response.roles) ? response.roles : []);
        setExpiresAt(new Date(response.expiresAt));
        setValidating(false);
      } catch (err: any) {
        setValidationError(err?.message || t('auth.invite.invalidOrExpired'));
        setValidating(false);
      }
    };

    validateToken();
  }, [token]);

  const handleAcceptInvitation = async (data: AcceptFormData) => {
    if (!token || !tenantId || !email) {
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      const response = await apiClient<any, { token: string; name: string; password: string }>({
        path: '/invitations/accept',
        method: 'POST',
        body: {
          token,
          name: data.name,
          password: data.password,
        },
      });

      // Save session and redirect
      if (response.accessToken) {
        setToken(response.accessToken);
        setSession({
          user: response.user,
          memberships: response.memberships,
          activeTenantId: tenantId,
        });
        setLastTenant(tenantId);

        // If membership already existed, show neutral message before redirecting
        if (response.membershipExisted) {
          setSuccessMessage(t('auth.invite.alreadyMemberSuccess'));
          setTimeout(() => {
            router.push(`/${tenantId}/dashboard`);
          }, 2000);
        } else {
          // Redirect to dashboard immediately
          router.push(`/${tenantId}/dashboard`);
        }
      }
    } catch (err: any) {
      setSubmitError(err?.message || t('auth.invite.acceptError'));
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <div className="text-lg font-semibold mb-4">{t('auth.invite.validating')}</div>
          <div className="space-y-4">
            <Skeleton className="h-16 rounded" />
            <Skeleton className="h-16 rounded" />
          </div>
        </Card>
      </div>
    );
  }

  // Invalid/expired token
  if (validationError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <EmptyState
            title={t('auth.invite.invalidTitle')}
            description={validationError}
          />
          <Button
            className="w-full mt-6"
            onClick={() => router.push('/login')}
          >
            {t('auth.invite.backToLogin')}
          </Button>
        </Card>
      </div>
    );
  }

  // No token
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <EmptyState
            title={t('auth.invite.noTokenTitle')}
            description={t('auth.invite.noTokenDescription')}
          />
          <Button
            className="w-full mt-6"
            onClick={() => router.push('/login')}
          >
            {t('auth.invite.backToLogin')}
          </Button>
        </Card>
      </div>
    );
  }

  // Valid invitation
  if (!tenantId || !email) {
    return null;
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('es-AR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">{t('auth.invite.title')}</h1>
          <p className="text-gray-600 text-sm mb-4">{t('auth.invite.subtitle')}</p>

          {/* Organization name highlight */}
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 mb-4">
            <p className="font-bold text-lg text-blue-900">
              {tenantName}
            </p>
          </div>

          {/* Invitation details */}
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3 mb-4">
            <div className="text-sm">
              <p className="text-gray-600 font-medium mb-1">{t('auth.invite.invitedEmail')}</p>
              <p className="text-gray-900">{email}</p>
            </div>
            {Array.isArray(roles) && roles.length > 0 && (
              <div className="text-sm">
                <p className="text-gray-600 font-medium mb-1">{t('auth.invite.roles')}</p>
                <div className="flex flex-wrap gap-2">
                  {roles.map((role) => (
                    <span
                      key={role}
                      className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {expiresAt && (
              <div className="text-sm">
                <p className="text-gray-600 font-medium mb-1">{t('auth.invite.expiresAt')}</p>
                <p className="text-gray-900">{formatDate(expiresAt)}</p>
              </div>
            )}
          </div>

          {/* Clear instruction */}
          <p className="text-sm text-gray-700 bg-amber-50 p-3 rounded-lg border border-amber-200 mb-6">
            {t('auth.invite.instruction')}
          </p>
        </div>

        {/* Accept form */}
        <form onSubmit={handleSubmit(handleAcceptInvitation)} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">{t('auth.invite.nameLabel')}</label>
            <Input
              placeholder={t('auth.invite.namePlaceholder')}
              {...register('name')}
            />
            {errors.name && (
              <p className="text-sm text-red-600 mt-1">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">{t('auth.invite.passwordLabel')}</label>
            <Input
              type="password"
              placeholder={t('auth.invite.passwordPlaceholder')}
              {...register('password')}
            />
            <p className="text-xs text-gray-500 mt-1">{t('auth.invite.passwordHint')}</p>
            {errors.password && (
              <p className="text-sm text-red-600 mt-1">
                {errors.password.message}
              </p>
            )}
          </div>

          {submitError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {submitError}
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
              {successMessage}
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? t('auth.invite.processing') : t('auth.invite.submit')}
          </Button>

          <div className="text-center text-sm text-gray-600">
            {t('auth.invite.haveAccount')}{' '}
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="text-blue-600 hover:underline"
            >
              {t('auth.invite.loginLink')}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <Card className="w-full max-w-md">
            <div className="text-lg font-semibold mb-4">{t('common.loading')}</div>
            <Skeleton className="h-32 rounded" />
          </Card>
        </div>
      }
    >
      <InvitePageContent />
    </Suspense>
  );
}
