/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import ResidentDashboardPage from './page';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { getResidentTickets } from '@/features/resident/api/resident-context.api';
import { useResidentProfile } from '@/features/resident/profile/useResidentProfile';
import { useResidentContext } from '@/features/resident/hooks/useResidentContext';
import { useResidentLedger } from '@/features/resident/hooks/useResidentLedger';
import { useResidentCommunications } from '@/features/resident/hooks/useResidentCommunications';
import { useContextOptions } from '@/features/context/useContextOptions';
import { useTenants } from '@/features/tenants/tenants.hooks';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));

jest.mock('@/features/resident/api/resident-context.api', () => ({
  getResidentTickets: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('@/features/resident/profile/useResidentProfile', () => ({
  useResidentProfile: jest.fn(),
}));

jest.mock('@/features/resident/hooks/useResidentContext', () => ({
  useResidentContext: jest.fn(),
}));

jest.mock('@/features/resident/hooks/useResidentLedger', () => ({
  useResidentLedger: jest.fn(),
}));

jest.mock('@/features/resident/hooks/useResidentCommunications', () => ({
  useResidentCommunications: jest.fn(),
}));

jest.mock('@/features/context/useContextOptions', () => ({
  useContextOptions: jest.fn(),
}));

jest.mock('@/features/tenants/tenants.hooks', () => ({
  useTenants: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseQuery = jest.mocked(useQuery);
const mockedGetResidentTickets = jest.mocked(getResidentTickets);
const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedUseResidentProfile = jest.mocked(useResidentProfile);
const mockedUseResidentContext = jest.mocked(useResidentContext);
const mockedUseResidentLedger = jest.mocked(useResidentLedger);
const mockedUseResidentCommunications = jest.mocked(useResidentCommunications);
const mockedUseContextOptions = jest.mocked(useContextOptions);
const mockedUseTenants = jest.mocked(useTenants);

function setBaseMocks(overrides: {
  sessionName?: string;
  profileName?: string | null;
  profileLoading?: boolean;
  profileError?: boolean;
} = {}) {
  mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
  mockedUseAuthSession.mockReturnValue({
    user: {
      id: 'user-1',
      email: 'resident@test.com',
      name: overrides.sessionName ?? 'Resident Session',
    },
    memberships: [
      {
        tenantId: 'tenant-1',
        roles: ['RESIDENT'],
      },
    ],
    activeTenantId: 'tenant-2',
  } as never);
  mockedUseResidentProfile.mockReturnValue({
    profileQuery: {
      data: overrides.profileName === undefined ? undefined : {
        id: 'member-1',
        tenantId: 'tenant-1',
        name: overrides.profileName,
        email: 'resident@test.com',
        phone: null,
        role: 'RESIDENT',
        status: 'ACTIVE',
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
      },
      isLoading: overrides.profileLoading ?? false,
      isError: overrides.profileError ?? false,
      error: overrides.profileError ? new Error('Profile failed') : null,
    },
  } as never);
  mockedUseResidentContext.mockReturnValue({
    data: {
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  } as never);
  mockedUseResidentLedger.mockReturnValue({
    data: {
      totals: {
        balance: 0,
        currency: 'ARS',
      },
      payments: [],
      charges: [],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  } as never);
  mockedUseResidentCommunications.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  } as never);
  mockedUseContextOptions.mockReturnValue({
    data: {
      buildings: [{ id: 'building-1', name: 'Torre Horizonte' }],
      unitsByBuilding: {
        'building-1': [{ id: 'unit-1', label: 'A-101' }],
      },
    },
    isError: false,
    error: null,
    refetch: jest.fn(),
  } as never);
  mockedUseTenants.mockReturnValue({
    data: [{ id: 'tenant-1', name: 'Horizonte' }],
  } as never);
  mockedUseQuery.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  } as never);
  mockedGetResidentTickets.mockResolvedValue([] as never);
}

describe('ResidentDashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setBaseMocks();
  });

  it('prefers the resident profile name over the session name and uses the route tenantId', async () => {
    setBaseMocks({
      sessionName: 'Resident Session',
      profileName: 'Resident Profile',
    });

    render(<ResidentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Hola, Resident Profile')).toBeTruthy();
    });

    expect(screen.queryByText('Hola, Resident Session')).toBeNull();
    expect(mockedUseResidentProfile).toHaveBeenCalledWith('tenant-1');
  });

  it('falls back to the session name while the profile loads', async () => {
    setBaseMocks({
      sessionName: 'Resident Session',
      profileName: undefined,
      profileLoading: true,
    });

    render(<ResidentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Hola, Resident Session')).toBeTruthy();
    });
  });

  it('falls back to the session name when the profile query fails', async () => {
    setBaseMocks({
      sessionName: 'Resident Session',
      profileName: undefined,
      profileError: true,
    });

    render(<ResidentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Hola, Resident Session')).toBeTruthy();
    });
  });

  it('falls back to the session name when the resident profile name is blank', async () => {
    setBaseMocks({
      sessionName: 'Resident Session',
      profileName: '   ',
    });

    render(<ResidentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Hola, Resident Session')).toBeTruthy();
    });
  });

  it('shows Mi portal when no usable name exists', async () => {
    setBaseMocks({
      sessionName: '',
      profileName: '   ',
    });

    render(<ResidentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Mi portal')).toBeTruthy();
    });

    expect(screen.queryByText(/Hola,/)).toBeNull();
  });
});
