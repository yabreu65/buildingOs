'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getSession, getLastTenant } from '../../../features/auth/session.storage';
import { useLogin } from '../../../features/auth/auth.hooks';
import Card from '../../../shared/components/ui/Card';
import Button from '../../../shared/components/ui/Button';

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const loginMutation = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    const s = getSession();
    const last = getLastTenant();
    if (s && last) {
      router.replace(`/${last}/dashboard`);
    }
  }, [router]);

  const onSubmit = async (data: LoginFormData) => {
    try {
      await loginMutation.mutateAsync(data);
    } catch (error) {
      // Error está manejado por la mutación
      console.error('Login error:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Card className="p-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">BuildingOS</h1>
            <p className="text-sm text-muted-foreground">
              Inicia sesión con tu cuenta
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email
              </label>
              <input
                {...register('email')}
                type="email"
                id="email"
                placeholder="tu@email.com"
                className="w-full px-3 py-2 border border-input rounded-md text-sm"
              />
              {errors.email && (
                <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">
                Contraseña
              </label>
              <input
                {...register('password')}
                type="password"
                id="password"
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-input rounded-md text-sm"
              />
              {errors.password && (
                <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>
              )}
            </div>

            {loginMutation.error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
                {loginMutation.error instanceof Error
                  ? loginMutation.error.message
                  : 'Error al iniciar sesión'}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? 'Iniciando...' : 'Iniciar sesión'}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm">
            <p className="text-muted-foreground">
              ¿No tienes cuenta?{' '}
              <Link href="/signup" className="text-blue-600 hover:underline">
                Crea una
              </Link>
            </p>
          </div>
        </Card>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} BuildingOS
        </div>
      </div>
    </div>
  );
}
