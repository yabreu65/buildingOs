import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { getContext, getContextOptions } from './context.api';
import type { ContextOptions, UserContext } from './context.types';
import { useContextManager } from './useContext';

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('./context.api', () => ({
  getContext: jest.fn(),
  setContext: jest.fn(),
  getContextOptions: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedGetContext = jest.mocked(getContext);
const mockedGetContextOptions = jest.mocked(getContextOptions);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('useContextManager', () => {
  beforeEach(() => {
    mockedUseAuthSession.mockReset();
    mockedGetContext.mockReset();
    mockedGetContextOptions.mockReset();
  });

  it('reloads context data when the authenticated user changes within the same tenant', async () => {
    const context1 = createDeferred<UserContext>();
    const options1 = createDeferred<ContextOptions>();
    const context2 = createDeferred<UserContext>();
    const options2 = createDeferred<ContextOptions>();

    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident1@buildingos.test', name: 'Resident 1' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });
    mockedGetContext.mockImplementationOnce(() => context1.promise);
    mockedGetContextOptions.mockImplementationOnce(() => options1.promise);
    mockedGetContext.mockImplementationOnce(() => context2.promise);
    mockedGetContextOptions.mockImplementationOnce(() => options2.promise);

    const { result, rerender } = renderHook(
      ({ tenantId }: { tenantId: string | null }) => useContextManager(tenantId),
      { initialProps: { tenantId: 'tenant-1' } },
    );

    await waitFor(() => {
      expect(mockedGetContext).toHaveBeenCalledTimes(1);
      expect(mockedGetContextOptions).toHaveBeenCalledTimes(1);
    });

    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-2', email: 'resident2@buildingos.test', name: 'Resident 2' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });

    rerender({ tenantId: 'tenant-1' });

    await waitFor(() => {
      expect(mockedGetContext).toHaveBeenCalledTimes(2);
      expect(mockedGetContextOptions).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      context2.resolve({
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-2',
      });
      options2.resolve({
        buildings: [{ id: 'building-1', name: 'Tower One' }],
        unitsByBuilding: { 'building-1': [{ id: 'unit-2', label: 'B-02' }] },
      });
    });

    await waitFor(() => {
      expect(result.current.context).toEqual({
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-2',
      });
      expect(result.current.options).toEqual({
        buildings: [{ id: 'building-1', name: 'Tower One' }],
        unitsByBuilding: { 'building-1': [{ id: 'unit-2', label: 'B-02' }] },
      });
    });

    await act(async () => {
      context1.resolve({
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      });
      options1.resolve({
        buildings: [{ id: 'building-1', name: 'Tower One' }],
        unitsByBuilding: { 'building-1': [{ id: 'unit-1', label: 'A-01' }] },
      });
    });

    await waitFor(() => {
      expect(result.current.context).toEqual({
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-2',
      });
      expect(result.current.options).toEqual({
        buildings: [{ id: 'building-1', name: 'Tower One' }],
        unitsByBuilding: { 'building-1': [{ id: 'unit-2', label: 'B-02' }] },
      });
    });
  });
});
