'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getSession, getLastTenant } from '../../../features/auth/session.storage';
import { useSignup } from '../../../features/auth/auth.hooks';
import Card from '../../../shared/components/ui/Card';
import Button from '../../../shared/components/ui/Button';

const signupSchema = z
  .object({
    name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
    email: z.string().email('Email inválido'),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres'),
    confirmPassword: z.string(),
    tenantName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
    tenantType: z.enum(['ADMINISTRADORA', 'EDIFICIO_AUTOGESTION']),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });

type SignupFormData = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const router = useRouter();
  const signupMutation = useSignup();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      tenantName: 'Mi Condominio',
      tenantType: 'EDIFICIO_AUTOGESTION',
    },
  });

  useEffect(() => {
    const s = getSession();
    const last = getLastTenant();
    if (s && last) {
      router.replace(`/${last}/dashboard`);
    }
  }, [router]);

  const onSubmit = async (data: SignupFormData) => {
    try {
      const { confirmPassword, ...payload } = data;
      await signupMutation.mutateAsync(payload);
    } catch (error) {
      console.error('Signup error:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Card className="p-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">BuildingOS</h1>
            <p className="text-sm text-muted-foreground">
              Crea una nueva cuenta
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Nombre
              </label>
              <input
                {...register('name')}
                type="text"
                id="name"
                placeholder="Tu nombre"
                className="w-full px-3 py-2 border border-input rounded-md text-sm"
              />
              {errors.name && (
                <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>
              )}
            </div>

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
                <p className="text-xs text-red-500 mt-1">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium mb-1"
              >
                Confirmar contraseña
              </label>
              <input
                {...register('confirmPassword')}
                type="password"
                id="confirmPassword"
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-input rounded-md text-sm"
              />
              {errors.confirmPassword && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="tenantName"
                className="block text-sm font-medium mb-1"
              >
                Nombre del edificio/condominio
              </label>
              <input
                {...register('tenantName')}
                type="text"
                id="tenantName"
                placeholder="Mi Condominio"
                className="w-full px-3 py-2 border border-input rounded-md text-sm"
              />
              {errors.tenantName && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.tenantName.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="tenantType"
                className="block text-sm font-medium mb-1"
              >
                Tipo de organización
              </label>
              <select
                {...register('tenantType')}
                id="tenantType"
                className="w-full px-3 py-2 border border-input rounded-md text-sm"
              >
                <option value="EDIFICIO_AUTOGESTION">
                  Edificio/Condominio (auto-gestión)
                </option>
                <option value="ADMINISTRADORA">
                  Administradora (múltiples edificios)
                </option>
              </select>
              {errors.tenantType && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.tenantType.message}
                </p>
              )}
            </div>

            {signupMutation.error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
                {signupMutation.error instanceof Error
                  ? signupMutation.error.message
                  : 'Error al crear cuenta'}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={signupMutation.isPending}
            >
              {signupMutation.isPending ? 'Creando cuenta...' : 'Crear cuenta'}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm">
            <p className="text-muted-foreground">
              ¿Ya tienes cuenta?{' '}
              <Link href="/login" className="text-blue-600 hover:underline">
                Inicia sesión
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
