'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertCircle,
  Building2,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Badge, Button, Card, Input, Skeleton, useToast } from '@/shared/components/ui';
import { useTenants } from '@/features/tenants/tenants.hooks';
import { useResidentProfile } from '@/features/resident/profile/useResidentProfile';
import type { ResidentProfile, UpdateResidentProfileInput } from '@/features/resident/profile/resident-profile.api';

interface ProfileSnapshot {
  readonly name: string;
  readonly phone: string;
}

interface ResidentProfileFormProps {
  readonly profile: ResidentProfile;
  readonly tenantName: string;
  readonly toast: ReturnType<typeof useToast>['toast'];
  readonly updateProfile: ReturnType<typeof useResidentProfile>['updateProfile'];
}

function snapshotFromProfile(profile: ResidentProfile): ProfileSnapshot {
  return {
    name: profile.name ?? '',
    phone: profile.phone ?? '',
  };
}

function normalizeName(value: string): string {
  return value.trim();
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'El nombre es obligatorio.';
  }
  if (trimmed.length < 2) {
    return 'El nombre debe tener al menos 2 caracteres.';
  }
  if (trimmed.length > 255) {
    return 'El nombre no puede superar los 255 caracteres.';
  }
  return null;
}

function validatePhone(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > 30) {
    return 'El teléfono no puede superar los 30 caracteres.';
  }
  return null;
}

function formatRole(role: string): string {
  const labels: Record<string, string> = {
    RESIDENT: 'Residente',
    TENANT_ADMIN: 'Administrador',
    TENANT_OWNER: 'Propietario',
    OPERATOR: 'Operador',
  };
  return labels[role.trim().toUpperCase()] ?? role;
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    ACTIVE: 'Activo',
    PENDING_INVITE: 'Invitación pendiente',
    DRAFT: 'Borrador',
    DISABLED: 'Deshabilitado',
  };
  return labels[status.trim().toUpperCase()] ?? status;
}

function ResidentProfileForm({
  profile,
  tenantName,
  toast,
  updateProfile,
}: ResidentProfileFormProps) {
  const [baseline, setBaseline] = useState<ProfileSnapshot>(() => snapshotFromProfile(profile));
  const [form, setForm] = useState<ProfileSnapshot>(() => snapshotFromProfile(profile));
  const [touched, setTouched] = useState({ name: false, phone: false });
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const lastServerSnapshotRef = useRef<ProfileSnapshot>(snapshotFromProfile(profile));

  useEffect(() => {
    if (normalizeName(form.name) !== normalizeName(baseline.name) || normalizePhone(form.phone) !== normalizePhone(baseline.phone)) {
      return;
    }

    const nextSnapshot: ProfileSnapshot = {
      name: profile.name ?? '',
      phone: profile.phone ?? '',
    };
    if (
      nextSnapshot.name === lastServerSnapshotRef.current.name &&
      nextSnapshot.phone === lastServerSnapshotRef.current.phone
    ) {
      return;
    }

    lastServerSnapshotRef.current = nextSnapshot;
    setBaseline(nextSnapshot);
    setForm(nextSnapshot);
    setTouched({ name: false, phone: false });
    setAttemptedSubmit(false);
  }, [baseline.name, baseline.phone, form.name, form.phone, profile.id, profile.name, profile.phone, profile.tenantId]);

  const nameError = validateName(form.name);
  const phoneError = validatePhone(form.phone);
  const dirty =
    normalizeName(form.name) !== normalizeName(baseline.name) ||
    normalizePhone(form.phone) !== normalizePhone(baseline.phone);

  const showNameError = attemptedSubmit || touched.name;
  const showPhoneError = attemptedSubmit || touched.phone;

  const handleDiscard = () => {
    setForm(baseline);
    setTouched({ name: false, phone: false });
    setAttemptedSubmit(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ name: true, phone: true });
    setAttemptedSubmit(true);

    if (nameError || phoneError) {
      return;
    }

    const payload: UpdateResidentProfileInput = {};
    const nextName = normalizeName(form.name);
    if (nextName !== normalizeName(baseline.name)) {
      payload.name = nextName;
    }

    const nextPhone = normalizePhone(form.phone);
    if (nextPhone !== normalizePhone(baseline.phone)) {
      payload.phone = nextPhone;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    try {
      const updatedProfile = await updateProfile.mutateAsync(payload);
      const nextSnapshot = snapshotFromProfile(updatedProfile);
      setBaseline(nextSnapshot);
      setForm(nextSnapshot);
      setTouched({ name: false, phone: false });
      setAttemptedSubmit(false);
      toast('Perfil actualizado correctamente', 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'No pudimos guardar los cambios.',
        'error',
      );
    }
  };

  const canSave = dirty && !nameError && !phoneError && !updateProfile.isPending;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Mi perfil</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tenantName}</p>
      </div>

      <Card>
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRound size={20} />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Datos de tu membresía</p>
            <p className="text-xs text-muted-foreground">Solo podés editar tu nombre y teléfono</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Building2 size={16} />
              Administración
            </p>
            <p className="text-sm font-medium text-foreground">{tenantName}</p>
          </div>

          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShieldCheck size={16} />
              Rol
            </p>
            <Badge variant="info">{formatRole(profile.role)}</Badge>
          </div>

          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShieldCheck size={16} />
              Estado
            </p>
            <Badge variant={profile.status.toUpperCase() === 'ACTIVE' ? 'success' : 'muted'}>
              {formatStatus(profile.status)}
            </Badge>
          </div>
        </div>
      </Card>

      <Card>
        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="resident-profile-name" className="block text-sm font-medium text-foreground">
                Nombre
              </label>
              <Input
                id="resident-profile-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                placeholder="Tu nombre"
                autoComplete="name"
                aria-invalid={Boolean(showNameError && nameError)}
                aria-describedby={showNameError && nameError ? 'resident-profile-name-error' : undefined}
              />
              {showNameError && nameError && (
                <p id="resident-profile-name-error" className="text-sm text-red-600 dark:text-red-400">
                  {nameError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="resident-profile-phone" className="block text-sm font-medium text-foreground">
                Teléfono
              </label>
              <Input
                id="resident-profile-phone"
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                onBlur={() => setTouched((current) => ({ ...current, phone: true }))}
                placeholder="Opcional"
                autoComplete="tel"
                aria-invalid={Boolean(showPhoneError && phoneError)}
                aria-describedby={showPhoneError && phoneError ? 'resident-profile-phone-error' : undefined}
              />
              {showPhoneError && phoneError && (
                <p id="resident-profile-phone-error" className="text-sm text-red-600 dark:text-red-400">
                  {phoneError}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="resident-profile-email" className="block text-sm font-medium text-foreground">
              Correo de acceso
            </label>
            <Input
              id="resident-profile-email"
              readOnly
              value={profile.email ?? ''}
              aria-describedby="resident-profile-email-help"
            />
            <p id="resident-profile-email-help" className="text-sm text-muted-foreground">
              El correo de acceso no puede modificarse desde este perfil.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={handleDiscard}
              disabled={!dirty || updateProfile.isPending}
            >
              <RotateCcw size={16} className="mr-2" />
              Descartar
            </Button>
            <Button type="submit" disabled={!canSave}>
              {updateProfile.isPending ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save size={16} className="mr-2" />
                  Guardar cambios
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function ResidentProfilePage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params?.tenantId ?? null;
  const { toast } = useToast();
  const { data: tenants } = useTenants();
  const tenantName = useMemo(
    () => (tenantId ? tenants?.find((tenant) => tenant.id === tenantId)?.name ?? 'Administración actual' : 'Administración actual'),
    [tenantId, tenants],
  );
  const { profileQuery, updateProfile, canAccessProfile, hasResidentMembership, userId } = useResidentProfile(tenantId);
  const profile = profileQuery.data;

  if (!canAccessProfile) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Mi perfil</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tenantName}</p>
        </div>

        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 text-amber-600 dark:text-amber-300" size={20} />
            <div className="space-y-1">
              <p className="font-medium text-amber-900 dark:text-amber-100">Perfil no disponible</p>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {hasResidentMembership
                  ? 'No pudimos identificar tu sesión para cargar este perfil.'
                  : 'Necesitás una membresía residente activa para acceder a tu perfil.'}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (profileQuery.isPending) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (profileQuery.isError) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Mi perfil</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tenantName}</p>
        </div>

        <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 text-red-600 dark:text-red-300" size={20} />
            <div className="space-y-1">
              <p className="font-medium text-red-900 dark:text-red-100">No pudimos cargar tu perfil</p>
              <p className="text-sm text-red-800 dark:text-red-200">
                {profileQuery.error instanceof Error ? profileQuery.error.message : 'Reintentalo en unos segundos.'}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() => void profileQuery.refetch()}
              >
                Reintentar
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <ResidentProfileForm
      key={`${profile.id}:${profile.tenantId}:${userId ?? ''}`}
      profile={profile}
      tenantName={tenantName}
      toast={toast}
      updateProfile={updateProfile}
    />
  );
}
