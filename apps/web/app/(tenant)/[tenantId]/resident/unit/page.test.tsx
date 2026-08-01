/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import ResidentUnitPage from './page';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useResidentContext } from '@/features/resident/hooks/useResidentContext';
import { useContextOptions } from '@/features/context/useContextOptions';
import { getUnit } from '@/features/units/units.api';
import { useTenants } from '@/features/tenants/tenants.hooks';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('@/features/resident/hooks/useResidentContext', () => ({
  useResidentContext: jest.fn(),
}));

jest.mock('@/features/context/useContextOptions', () => ({
  useContextOptions: jest.fn(),
}));

jest.mock('@/features/units/units.api', () => ({
  getUnit: jest.fn(),
}));

jest.mock('@/features/tenants/tenants.hooks', () => ({
  useTenants: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseQuery = jest.mocked(useQuery);
const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedUseResidentContext = jest.mocked(useResidentContext);
const mockedUseContextOptions = jest.mocked(useContextOptions);
const mockedGetUnit = jest.mocked(getUnit);
const mockedUseTenants = jest.mocked(useTenants);

const refetchContext = jest.fn();
const refetchUnit = jest.fn();

function setBaseMocks() {
  mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);

  mockedUseAuthSession.mockReturnValue({
    user: {
      id: 'user-1',
      email: 'resident@test.com',
      name: 'Resident One',
    },
    memberships: [
      {
        tenantId: 'tenant-1',
        roles: ['RESIDENT'],
      },
    ],
    activeTenantId: 'tenant-2',
  } as never);

  mockedUseTenants.mockReturnValue({
    data: [{ id: 'tenant-1', name: 'Horizonte' }],
  } as never);

  mockedUseResidentContext.mockReturnValue({
    data: {
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchContext,
  } as never);

  mockedUseContextOptions.mockReturnValue({
    data: {
      buildings: [{ id: 'building-1', name: 'Torre Horizonte' }],
      unitsByBuilding: {
        'building-1': [{ id: 'unit-1', label: 'A-101' }],
      },
    },
  } as never);

  mockedUseQuery.mockReturnValue({
    data: {
      id: 'unit-1',
      buildingId: 'building-1',
      code: 'A101',
      label: 'A-101',
      unitType: 'APARTMENT',
      occupancyStatus: 'OCCUPIED',
      m2: 85,
      unitCategory: {
        id: 'category-1',
        name: 'Residencial',
      },
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
      unitOccupants: [
        {
          id: 'occupant-1',
          memberId: 'member-1',
          unitId: 'unit-1',
          role: 'RESIDENT',
          member: {
            id: 'member-1',
            name: 'Resident One',
            email: 'resident@test.com',
            phone: '+584141111111',
          },
        },
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchUnit,
  } as never);
}

describe('ResidentUnitPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setBaseMocks();
  });

  it('loads the route tenant unit with a user-isolated query key', async () => {
    mockedGetUnit.mockResolvedValue({} as never);

    render(<ResidentUnitPage />);

    expect(screen.getByText('Información de la unidad')).toBeTruthy();
    expect(screen.getByText('A101')).toBeTruthy();
    expect(screen.getByText('Departamento')).toBeTruthy();
    expect(screen.getByText('85 m²')).toBeTruthy();
    expect(screen.getByText('Ocupada')).toBeTruthy();
    expect(screen.getByText('Resident One')).toBeTruthy();
    expect(screen.getByText('Torre Horizonte')).toBeTruthy();

    const queryOptions = mockedUseQuery.mock.calls[0][0] as {
      queryKey: unknown[];
      queryFn: () => Promise<unknown>;
      enabled: boolean;
    };

    expect(queryOptions.queryKey).toEqual([
      'residentUnit',
      'tenant-1',
      'user-1',
      'building-1',
      'unit-1',
    ]);
    expect(queryOptions.enabled).toBe(true);

    await queryOptions.queryFn();

    expect(mockedGetUnit).toHaveBeenCalledWith(
      'tenant-1',
      'building-1',
      'unit-1',
    );
  });

  it('does not enable the unit query without an authenticated user', () => {
    mockedUseAuthSession.mockReturnValue(null);

    render(<ResidentUnitPage />);

    const queryOptions = mockedUseQuery.mock.calls[0][0] as {
      queryKey: unknown[];
      enabled: boolean;
    };

    expect(queryOptions.queryKey).toEqual([
      'residentUnit',
      'tenant-1',
      null,
      'building-1',
      'unit-1',
    ]);
    expect(queryOptions.enabled).toBe(false);
  });

  it('shows the context error and retries the resident context', () => {
    mockedUseResidentContext.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Context failed'),
      refetch: refetchContext,
    } as never);

    render(<ResidentUnitPage />);

    expect(
      screen.getByText('No pudimos cargar tu contexto residente.'),
    ).toBeTruthy();
    expect(screen.getByText('Context failed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(refetchContext).toHaveBeenCalledTimes(1);
  });

  it('shows the unit error instead of presenting empty successful data', () => {
    mockedUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Unit failed'),
      refetch: refetchUnit,
    } as never);

    render(<ResidentUnitPage />);

    expect(
      screen.getByText('No pudimos cargar la información de tu unidad.'),
    ).toBeTruthy();
    expect(screen.getByText('Unit failed')).toBeTruthy();
    expect(screen.queryByText('No hay ocupantes registrados')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(refetchUnit).toHaveBeenCalledTimes(1);
  });

  it('shows the unassigned state when the resident has no active unit', () => {
    mockedUseResidentContext.mockReturnValue({
      data: {
        activeBuildingId: null,
        activeUnitId: null,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchContext,
    } as never);

    render(<ResidentUnitPage />);

    expect(screen.getByText('Sin unidad asignada')).toBeTruthy();
    expect(
      screen.getByText(
        'Comunicate con la administración para que te asignen una unidad.',
      ),
    ).toBeTruthy();

    const queryOptions = mockedUseQuery.mock.calls[0][0] as {
      enabled: boolean;
    };
    expect(queryOptions.enabled).toBe(false);
  });
});
