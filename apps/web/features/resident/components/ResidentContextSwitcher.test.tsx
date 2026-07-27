import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useContextManager } from '@/features/context/useContext';
import { ResidentContextSwitcher } from './ResidentContextSwitcher';

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('@/features/context/useContext', () => ({
  useContextManager: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedUseContextManager = jest.mocked(useContextManager);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('ResidentContextSwitcher', () => {
  beforeEach(() => {
    mockedUseAuthSession.mockReset();
    mockedUseContextManager.mockReset();
  });

  it('shows a compact summary when only one resident occupancy is available', () => {
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });
    mockedUseContextManager.mockReturnValue({
      context: {
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      },
      options: {
        buildings: [{ id: 'building-1', name: 'Edificio A' }],
        unitsByBuilding: {
          'building-1': [{ id: 'unit-1', code: 'A-01', label: 'A-01' }],
        },
      },
      loading: false,
      error: null,
      refetch: jest.fn(),
      setActiveBuilding: jest.fn(),
      setActiveUnit: jest.fn(),
    });

    render(
      <ResidentContextSwitcher tenantId="tenant-1" />,
      { wrapper: createWrapper(new QueryClient()) },
    );

    expect(screen.getByText('Contexto activo')).toBeTruthy();
    expect(screen.getByText('Edificio A')).toBeTruthy();
    expect(screen.getByText('A-01')).toBeTruthy();
    expect(screen.queryByLabelText('Edificio')).toBeNull();
  });

  it('invalidates resident queries after changing the selected occupancy', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    const setActiveUnit = jest.fn().mockResolvedValue(undefined);

    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });
    mockedUseContextManager.mockReturnValue({
      context: {
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      },
      options: {
        buildings: [
          { id: 'building-1', name: 'Edificio A' },
          { id: 'building-2', name: 'Edificio B' },
        ],
        unitsByBuilding: {
          'building-1': [{ id: 'unit-1', code: 'A-01', label: 'A-01' }],
          'building-2': [
            { id: 'unit-2', code: 'B-01', label: 'B-01' },
            { id: 'unit-3', code: 'B-02', label: 'B-02' },
          ],
        },
      },
      loading: false,
      error: null,
      refetch: jest.fn(),
      setActiveBuilding: jest.fn(),
      setActiveUnit,
    });

    render(
      <ResidentContextSwitcher tenantId="tenant-1" />,
      { wrapper: createWrapper(queryClient) },
    );

    fireEvent.change(screen.getByLabelText('Edificio'), {
      target: { value: 'building-2' },
    });

    await waitFor(() => {
      expect(setActiveUnit).toHaveBeenCalledWith('building-2', 'unit-2');
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['residentContext', 'tenant-1', 'user-1'] });
    });
  });

  it('contains a long building name while keeping the selected unit visible', () => {
    const longBuildingName = 'Complejo Residencial con un nombre largo que no debe ampliar el viewport móvil';
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });
    mockedUseContextManager.mockReturnValue({
      context: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      options: {
        buildings: [{ id: 'building-1', name: longBuildingName }],
        unitsByBuilding: {
          'building-1': [{
            id: 'unit-1',
            code: 'A-01',
            label: 'Unidad con una referencia extensa para una pantalla móvil',
          }],
        },
      },
      loading: false,
      error: null,
      refetch: jest.fn(),
      setActiveBuilding: jest.fn(),
      setActiveUnit: jest.fn(),
    });

    const { container } = render(
      <ResidentContextSwitcher tenantId="tenant-1" />,
      { wrapper: createWrapper(new QueryClient()) },
    );

    const longUnitLabel = 'Unidad con una referencia extensa para una pantalla móvil';
    const unitSummary = container.querySelector(`[title="${longUnitLabel}"]`);

    expect(container.querySelector(`[title="${longBuildingName}"]`)?.getAttribute('title')).toBe(longBuildingName);
    expect(unitSummary?.className).toContain('truncate');
    expect(unitSummary?.className).toContain('min-w-0');
    expect(unitSummary?.className).not.toContain('shrink-0');
    expect(screen.getByText(longUnitLabel)).toBeTruthy();
    expect(container.querySelector('[class*="min-w-0"]')).toBeTruthy();
  });
});
