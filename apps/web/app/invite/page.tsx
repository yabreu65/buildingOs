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

const acceptSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
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
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

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
          email: string;
          expiresAt: string;
        }>({
          path: `/invitations/validate?token=${encodeURIComponent(token)}`,
          method: 'GET',
        });
        setTenantId(response.tenantId);
        setEmail(response.email);
        setValidating(false);
      } catch (err: any) {
        setValidationError(err?.message || 'Convite inválido ou expirado');
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

        // Redirect to dashboard
        router.push(`/${tenantId}/dashboard`);
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Erro ao aceitar convite');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <div className="text-lg font-semibold mb-4">Validando Convite...</div>
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
            title="Convite inválido"
            description={validationError}
          />
          <Button
            className="w-full mt-6"
            onClick={() => router.push('/login')}
          >
            Voltar ao login
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
            title="Sem convite"
            description="Um link de convite é necessário para aceitar o convite"
          />
          <Button
            className="w-full mt-6"
            onClick={() => router.push('/login')}
          >
            Voltar ao login
          </Button>
        </Card>
      </div>
    );
  }

  // Valid invitation
  if (!tenantId || !email) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold mb-2">Aceitar Convite</h1>

          {/* Invitation details */}
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <p className="text-sm text-gray-600 mb-2">
              Você foi convidado para
            </p>
            <p className="font-semibold text-lg text-gray-900 mb-3">
              {email}
            </p>
          </div>
        </div>

        {/* Accept form */}
        <form onSubmit={handleSubmit(handleAcceptInvitation)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nome</label>
            <Input
              placeholder="Seu nome completo"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-sm text-red-600 mt-1">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Senha</label>
            <Input
              type="password"
              placeholder="Mínimo 8 caracteres"
              {...register('password')}
            />
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

          <Button
            type="submit"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? 'Processando...' : 'Aceitar Convite'}
          </Button>

          <div className="text-center text-sm text-gray-600">
            Já tem conta?{' '}
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="text-blue-600 hover:underline"
            >
              Faça login
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
            <div className="text-lg font-semibold mb-4">Carregando...</div>
            <Skeleton className="h-32 rounded" />
          </Card>
        </div>
      }
    >
      <InvitePageContent />
    </Suspense>
  );
}
