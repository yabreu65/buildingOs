'use client';

// Dynamic page - cannot be statically generated (uses searchParams)
export const dynamic = 'force-dynamic';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle } from 'lucide-react';
import type { Role } from '@buildingos/contracts';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import Input from '@/shared/components/ui/Input';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import { setSession, setLastTenant } from '@/features/auth/session.storage';
import { clearAllImpersonationData } from '@/features/impersonation/impersonation.storage';
import {
  invitationsApi,
  type AcceptInvitationResponse,
  type ValidateTokenResponse,
} from '@/features/invitations/services/invitations.api';
import { t } from '@/i18n';

const acceptSchema = z.object({
  name: z.string().trim().min(1, t('auth.invite.nameRequired')),
  password: z.string().min(8, t('auth.invite.passwordMinimum')),
});

type AcceptFormData = z.infer<typeof acceptSchema>;

type InviteStatus = 'loading' | 'invalid' | 'ready' | 'submitting';

const inviteFieldIds = {
  name: 'invite-name',
  password: 'invite-password',
  passwordHint: 'invite-password-hint',
  nameError: 'invite-name-error',
  passwordError: 'invite-password-error',
} as const;

function InvitePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get('token')?.trim() ?? null;
  const [status, setStatus] = useState<InviteStatus>(token ? 'loading' : 'invalid');
  const [statusMessage, setStatusMessage] = useState<string | null>(
    token ? null : t('auth.invite.noTokenDescription'),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      setStatus('invalid');
      setStatusMessage(t('auth.invite.noTokenDescription'));
      return;
    }

    const validateToken = async () => {
      try {
        const response: ValidateTokenResponse & {
          tenantName: string;
          roles: Role[];
        } = await invitationsApi.validateToken(token);
        setTenantId(response.tenantId);
        setEmail(response.email);
        setTenantName(response.tenantName);
        setRoles(Array.isArray(response.roles) ? response.roles : []);
        setExpiresAt(new Date(response.expiresAt));
        setStatus('ready');
        setStatusMessage(null);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('auth.invite.invalidOrExpired');
        setStatus('invalid');
        setStatusMessage(errorMessage);
      }
    };

    validateToken();
  }, [token]);

  const handleAcceptInvitation = async (data: AcceptFormData) => {
    if (!token || !tenantId || !email) {
      setStatus('invalid');
      setStatusMessage(t('auth.invite.invalidOrExpired'));
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      const response: AcceptInvitationResponse = await invitationsApi.acceptInvitation({
        token,
        name: data.name.trim(),
        password: data.password,
      });
      setStatus('ready');

      // Save session and redirect
      clearAllImpersonationData();
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
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('auth.invite.acceptError');
      setSubmitError(errorMessage);
      setStatus('ready');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (status === 'loading') {
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
  if (status === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <EmptyState
            title={t('auth.invite.invalidTitle')}
            description={
              statusMessage ??
              'La invitación no está completa o ya no es válida. Revisá el enlace o pedile a tu administrador que te envíe una nueva invitación.'
            }
          />
          <div className="mt-6 grid gap-3">
            <Button className="w-full" onClick={() => router.push('/login')}>
              {t('auth.invite.backToLogin')}
            </Button>
            <Button asChild variant="secondary" className="w-full">
              <Link href="/contact">Solicitar ayuda</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (status !== 'ready' || !tenantId || !email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <EmptyState
            title={t('auth.invite.invalidTitle')}
            description={
              'No pudimos validar la invitación. Revisá el enlace completo o pedí una nueva invitación al administrador.'
            }
          />
          <div className="mt-6 grid gap-3">
            <Button className="w-full" onClick={() => router.push('/login')}>
              {t('auth.invite.backToLogin')}
            </Button>
            <Button asChild variant="secondary" className="w-full">
              <Link href="/contact">Solicitar ayuda</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
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

          {/* 24-hour expiration warning */}
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex gap-3 mb-6">
            <AlertCircle className="w-5 h-5 text-yellow-700 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800">
                ⚠️ Este link de activación expira en 24 horas
              </p>
              <p className="text-xs text-yellow-700 mt-1">
                Asegúrate de crear tu contraseña antes de que venza.
              </p>
            </div>
          </div>

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
            <label htmlFor={inviteFieldIds.name} className="block text-sm font-semibold mb-1">
              {t('auth.invite.nameLabel')}
            </label>
            <Input
              id={inviteFieldIds.name}
              placeholder={t('auth.invite.namePlaceholder')}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? inviteFieldIds.nameError : undefined}
              {...register('name')}
            />
            {errors.name && (
              <p id={inviteFieldIds.nameError} className="text-sm text-red-600 mt-1">
                {errors.name.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={inviteFieldIds.password} className="block text-sm font-semibold mb-1">
              {t('auth.invite.passwordLabel')}
            </label>
            <Input
              id={inviteFieldIds.password}
              type="password"
              placeholder={t('auth.invite.passwordPlaceholder')}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={`${inviteFieldIds.passwordHint}${errors.password ? ` ${inviteFieldIds.passwordError}` : ''}`}
              {...register('password')}
            />
            <p id={inviteFieldIds.passwordHint} className="text-xs text-gray-500 mt-1">
              {t('auth.invite.passwordHint')}
            </p>
            {errors.password && (
              <p id={inviteFieldIds.passwordError} className="text-sm text-red-600 mt-1">
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
