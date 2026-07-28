/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams } from 'next/navigation';
import ResidentProfilePage from './page';
import type {
  ResidentProfile,
  UpdateResidentProfileInput,
} from '@/features/resident/profile/resident-profile.api';
import { useResidentProfile } from '@/features/resident/profile/useResidentProfile';
import { useRefreshSession } from '@/features/auth/useRefreshSession';
import { useTenants } from '@/features/tenants/tenants.hooks';

const toast = jest.fn();

jest.mock('@/shared/components/ui', () => {
  const actual = jest.requireActual('@/shared/components/ui');
  return {
    ...actual,
    useToast: () => ({ toast }),
  };
});

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('@/features/resident/profile/useResidentProfile', () => ({
  useResidentProfile: jest.fn(),
}));

jest.mock('@/features/auth/useRefreshSession', () => ({
  useRefreshSession: jest.fn(),
}));

jest.mock('@/features/tenants/tenants.hooks', () => ({
  useTenants: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseResidentProfile = jest.mocked(useResidentProfile);
const mockedUseRefreshSession = jest.mocked(useRefreshSession);
const mockedUseTenants = jest.mocked(useTenants);

interface ResidentProfileHookState {
  profileQuery: {
    data: ResidentProfile;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    refetch: jest.Mock;
  };
  updateProfile: {
    mutateAsync: jest.Mock<Promise<ResidentProfile>, [UpdateResidentProfileInput]>;
    isPending: boolean;
  };
  canAccessProfile: boolean;
  hasResidentMembership: boolean;
  userId: string;
}

interface ResidentProfileTestOverrides {
  profile?: Partial<ResidentProfile>;
  canAccessProfile?: boolean;
  hasResidentMembership?: boolean;
  userId?: string;
}

function createProfile(overrides: Partial<ResidentProfile> = {}) {
  return {
    id: 'member-1',
    tenantId: 'tenant-1',
    name: 'Resident One',
    email: 'resident@test.com',
    phone: '+584141111111',
    role: 'RESIDENT',
    status: 'ACTIVE',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

function createProfileState(overrides: ResidentProfileTestOverrides = {}): ResidentProfileHookState {
  return {
    profileQuery: {
      data: createProfile(overrides.profile ?? {}),
      isPending: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    },
    updateProfile: {
      mutateAsync: jest.fn().mockResolvedValue(
        createProfile({
          name: 'Resident Prime',
          phone: '+584141111222',
          updatedAt: '2026-07-27T01:00:00.000Z',
          ...(overrides.profile ?? {}),
        }),
      ),
      isPending: false,
    },
    canAccessProfile: overrides.canAccessProfile ?? true,
    hasResidentMembership: overrides.hasResidentMembership ?? true,
    userId: overrides.userId ?? 'user-1',
  };
}

function setResidentProfileHook(overrides: ResidentProfileTestOverrides = {}): ResidentProfileHookState {
  const state = createProfileState(overrides);
  mockedUseResidentProfile.mockReturnValue(state as never);
  return state;
}

describe('ResidentProfilePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUseTenants.mockReturnValue({
      data: [{ id: 'tenant-1', name: 'Horizonte' }],
    } as never);
  });

  it('renders the profile without internal identifiers and keeps the email read only', async () => {
    setResidentProfileHook();

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByText('Mi perfil')).toBeTruthy();
    });

    expect(screen.getAllByText('Horizonte').length).toBeGreaterThan(0);
    expect(screen.getByText('Administración')).toBeTruthy();
    expect(screen.queryByText('user-1')).toBeNull();
    expect(screen.queryByText('tenant-1')).toBeNull();

    const email = screen.getByLabelText('Correo de acceso');
    expect(email.getAttribute('id')).toBe('resident-profile-email');
    expect(email.hasAttribute('readonly')).toBe(true);
    expect(email.getAttribute('aria-describedby')).toBe('resident-profile-email-help');
    expect(screen.getByText('El correo de acceso no puede modificarse desde este perfil.')).toBeTruthy();
  });

  it('uses a neutral administration label when the tenant name is not loaded yet', async () => {
    mockedUseTenants.mockReturnValue({
      data: undefined,
    } as never);
    setResidentProfileHook();

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    expect(screen.getAllByText('Administración actual').length).toBeGreaterThan(0);
    expect(screen.queryByText('tenant-1')).toBeNull();
  });

  it('keeps access when activeTenantId points elsewhere but the membership is resident', async () => {
    setResidentProfileHook();

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    expect(screen.queryByText('Perfil no disponible')).toBeNull();
  });

  it('shows a neutral access message when the membership exists but the profile cannot be loaded', async () => {
    setResidentProfileHook({
      canAccessProfile: false,
      hasResidentMembership: true,
    });

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByText('Perfil no disponible')).toBeTruthy();
    });

    expect(screen.getByText('No pudimos identificar tu sesión para cargar este perfil.')).toBeTruthy();
    expect(screen.queryByText('Cambiá al tenant activo correcto para ver tu perfil residente.')).toBeNull();
  });

  it.each([
    ['empty name', '', 'El nombre es obligatorio.'],
    ['single character name', 'A', 'El nombre debe tener al menos 2 caracteres.'],
    [
      'long name',
      'a'.repeat(256),
      'El nombre no puede superar los 255 caracteres.',
    ],
  ])('marks %s as invalid and disables save', async (_label, name, message) => {
    const { updateProfile } = setResidentProfileHook();

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: name } });
    fireEvent.blur(screen.getByLabelText('Nombre'));

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByLabelText('Nombre').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement).disabled).toBe(true);
    expect(updateProfile.mutateAsync).not.toHaveBeenCalled();
  });

  it('marks an overlong phone number as invalid and blocks submission', async () => {
    const { updateProfile } = setResidentProfileHook();

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '1'.repeat(31) } });
    fireEvent.blur(screen.getByLabelText('Teléfono'));

    expect(screen.getByText('El teléfono no puede superar los 30 caracteres.')).toBeTruthy();
    expect(screen.getByLabelText('Teléfono').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement).disabled).toBe(true);
    expect(updateProfile.mutateAsync).not.toHaveBeenCalled();
  });

  it.each([
    {
      title: 'sends only the modified name',
      mutate: async (updateProfile: ReturnType<typeof createProfileState>['updateProfile']) => {
        updateProfile.mutateAsync.mockResolvedValueOnce(
          createProfile({ name: 'Resident Prime', phone: '+584141111111', updatedAt: '2026-07-27T01:00:00.000Z' }),
        );
      },
      change: () => fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Resident Prime' } }),
      expected: { name: 'Resident Prime' },
    },
    {
      title: 'sends only the modified phone',
      mutate: async (updateProfile: ReturnType<typeof createProfileState>['updateProfile']) => {
        updateProfile.mutateAsync.mockResolvedValueOnce(
          createProfile({ name: 'Resident One', phone: '+584141222222', updatedAt: '2026-07-27T01:00:00.000Z' }),
        );
      },
      change: () => fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '+584141222222' } }),
      expected: { phone: '+584141222222' },
    },
    {
      title: 'clears the phone by sending null',
      mutate: async (updateProfile: ReturnType<typeof createProfileState>['updateProfile']) => {
        updateProfile.mutateAsync.mockResolvedValueOnce(
          createProfile({ name: 'Resident One', phone: null, updatedAt: '2026-07-27T01:00:00.000Z' }),
        );
      },
      change: () => fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '   ' } }),
      expected: { phone: null },
    },
  ])('$title', async ({ mutate, change, expected }) => {
    const state = setResidentProfileHook();
    await mutate(state.updateProfile);

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    change();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(state.updateProfile.mutateAsync).toHaveBeenCalledWith(expected);
      expect(toast).toHaveBeenCalledWith('Perfil actualizado correctamente', 'success');
    });
  });

  it('does not enable save or submit when the name only changes by surrounding spaces', async () => {
    const { updateProfile } = setResidentProfileHook();

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '  Resident One  ' } });

    const saveButton = screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    const form = saveButton.closest('form');
    expect(form).not.toBeNull();
    if (form) {
      fireEvent.submit(form);
    }

    expect(updateProfile.mutateAsync).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalledWith('Perfil actualizado correctamente', 'success');
  });

  it('does not lose local edits when the same profile refetches with a new payload', async () => {
    setResidentProfileHook();

    const { rerender } = render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Resident Draft' } });

    mockedUseResidentProfile.mockReturnValue(
      createProfileState({
        profile: {
          name: 'Resident Refetched',
          updatedAt: '2026-07-27T02:00:00.000Z',
        },
      }) as never,
    );

    rerender(<ResidentProfilePage />);

    expect(screen.getByDisplayValue('Resident Draft')).toBeTruthy();
  });

  it('syncs the clean form when the same profile refetches with fresh server data', async () => {
    setResidentProfileHook();

    const { rerender } = render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    mockedUseResidentProfile.mockReturnValue(
      createProfileState({
        profile: {
          name: 'Resident Fresh',
          phone: '+584141999999',
        },
      }) as never,
    );

    rerender(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident Fresh')).toBeTruthy();
      expect(screen.getByDisplayValue('+584141999999')).toBeTruthy();
    });
  });

  it('reinitializes the form when tenantId changes', async () => {
    setResidentProfileHook();

    const { rerender } = render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Resident Draft' } });

    mockedUseParams.mockReturnValue({ tenantId: 'tenant-2' } as never);
    mockedUseTenants.mockReturnValue({
      data: [{ id: 'tenant-2', name: 'Aurora' }],
    } as never);
    mockedUseResidentProfile.mockReturnValue(
      createProfileState({
        profile: {
          id: 'member-2',
          tenantId: 'tenant-2',
          name: 'Resident Two',
          email: 'resident2@test.com',
          phone: '+584141222222',
        },
        userId: 'user-2',
      }) as never,
    );

    rerender(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident Two')).toBeTruthy();
    });
    expect(screen.getAllByText('Aurora').length).toBeGreaterThan(0);
  });

  it('reinitializes the form when userId changes', async () => {
    setResidentProfileHook();

    const { rerender } = render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Resident Draft' } });

    mockedUseResidentProfile.mockReturnValue(
      createProfileState({
        profile: {
          id: 'member-3',
          tenantId: 'tenant-1',
          name: 'Resident Three',
          email: 'resident3@test.com',
          phone: '+584141333333',
        },
        userId: 'user-3',
      }) as never,
    );

    rerender(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident Three')).toBeTruthy();
    });
  });

  it('adopts the saved profile as the new baseline and discard restores it', async () => {
    const state = setResidentProfileHook();
    state.updateProfile.mutateAsync.mockResolvedValueOnce(
      createProfile({
        name: 'Resident Prime',
        phone: '+584141222222',
        updatedAt: '2026-07-27T01:00:00.000Z',
      }),
    );

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Resident Prime' } });
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '+584141222222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Perfil actualizado correctamente', 'success');
      expect(screen.getByDisplayValue('Resident Prime')).toBeTruthy();
      expect(screen.getByDisplayValue('+584141222222')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Resident Temp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(screen.getByDisplayValue('Resident Prime')).toBeTruthy();
    expect(screen.getByDisplayValue('+584141222222')).toBeTruthy();
  });

  it.each([
    ['RESIDENT', 'Residente'],
    ['TENANT_ADMIN', 'Administrador'],
    ['TENANT_OWNER', 'Propietario'],
    ['OPERATOR', 'Operador'],
  ])('translates role %s as %s', async (role, expected) => {
    mockedUseResidentProfile.mockReturnValue(
      createProfileState({
        profile: {
          role,
        },
      }) as never,
    );

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(expected)).toBeTruthy();
    });
  });

  it.each([
    ['ACTIVE', 'Activo'],
    ['PENDING_INVITE', 'Invitación pendiente'],
    ['DRAFT', 'Borrador'],
    ['DISABLED', 'Deshabilitado'],
  ])('translates status %s as %s', async (status, expected) => {
    mockedUseResidentProfile.mockReturnValue(
      createProfileState({
        profile: {
          status,
        },
      }) as never,
    );

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(expected)).toBeTruthy();
    });
  });

  it('does not call useRefreshSession and keeps the session user immutable', async () => {
    const session = {
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident' },
      memberships: [
        {
          tenantId: 'tenant-1',
          roles: ['RESIDENT'],
        },
      ],
      activeTenantId: 'tenant-2',
    };

    mockedUseResidentProfile.mockReturnValue(createProfileState() as never);

    render(<ResidentProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Resident One')).toBeTruthy();
    });

    expect(session.user.name).toBe('Resident');
    expect(mockedUseRefreshSession).not.toHaveBeenCalled();
  });
});
