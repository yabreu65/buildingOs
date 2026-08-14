import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import type { AuthSession } from '@/features/auth/auth.types';
import { getResidentLedger, type UnitLedger } from '../api/resident-context.api';
import { useResidentLedger } from './useResidentLedger';

type MockSession = AuthSession;

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('../api/resident-context.api', () => ({
  getResidentLedger: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedGetResidentLedger = jest.mocked(getResidentLedger);

function makeSession(userId = 'user-1'): MockSession {
  return {
    user: {
      id: userId,
      email: `${userId}@test.com`,
      name: 'Resident',
    },
    memberships: [
      {
        tenantId: 'tenant-1',
        roles: ['RESIDENT'],
      },
    ],
    activeTenantId: 'tenant-2',
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  return { Wrapper, queryClient };
}

function ledger(balance: number): UnitLedger {
  return {
    unitId: 'unit-1',
    totals: {
      totalChargesByCurrency: [{ currency: 'ARS', amountMinor: balance }],
      totalPaidByCurrency: [],
      totalAllocatedByCurrency: [],
      balanceByCurrency: [{ currency: 'ARS', amountMinor: balance }],
    },
    charges: [],
    payments: [],
  };
}

describe('useResidentLedger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuthSession.mockReturnValue(makeSession());
  });

  it.each([
    ['tenantId', null, 'unit-1'],
    ['unitId', 'tenant-1', null],
  ])(
    'does not query without %s',
    (_missingField, tenantId, unitId) => {
      const { Wrapper } = createWrapper();

      const { result } = renderHook(
        () => useResidentLedger(tenantId, unitId),
        { wrapper: Wrapper },
      );

      expect(result.current.fetchStatus).toBe('idle');
      expect(mockedGetResidentLedger).not.toHaveBeenCalled();
    },
  );

  it('does not query without an authenticated user', () => {
    mockedUseAuthSession.mockReturnValue(null);

    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () => useResidentLedger('tenant-1', 'unit-1'),
      { wrapper: Wrapper },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedGetResidentLedger).not.toHaveBeenCalled();
  });

  it('fetches the ledger using the route tenant and active unit even when activeTenantId points elsewhere', async () => {
    mockedGetResidentLedger.mockResolvedValue(ledger(1250));

    const { Wrapper, queryClient } = createWrapper();

    const { result } = renderHook(
      () => useResidentLedger('tenant-1', 'unit-1'),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.data?.totals.balanceByCurrency[0]?.amountMinor).toBe(1250);
    });

    expect(mockedGetResidentLedger).toHaveBeenCalledWith(
      'tenant-1',
      'unit-1',
    );

    expect(
      queryClient.getQueryState([
        'residentLedger',
        'tenant-1',
        'tenant-2',
        'user-1',
        'unit-1',
      ]),
    ).toBeDefined();
  });

  it('uses separate cache entries when the authenticated user changes', async () => {
    mockedGetResidentLedger
      .mockResolvedValueOnce(ledger(100))
      .mockResolvedValueOnce(ledger(200));

    const { Wrapper, queryClient } = createWrapper();

    const { result, rerender } = renderHook(
      () => useResidentLedger('tenant-1', 'unit-1'),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.data?.totals.balanceByCurrency[0]?.amountMinor).toBe(100);
    });

    mockedUseAuthSession.mockReturnValue(makeSession('user-2'));
    rerender();

    await waitFor(() => {
      expect(result.current.data?.totals.balanceByCurrency[0]?.amountMinor).toBe(200);
    });

    expect(mockedGetResidentLedger).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryState([
        'residentLedger',
        'tenant-1',
        'tenant-2',
        'user-1',
        'unit-1',
      ]),
    ).toBeDefined();
    expect(
      queryClient.getQueryState([
        'residentLedger',
        'tenant-1',
        'tenant-2',
        'user-2',
        'unit-1',
      ]),
    ).toBeDefined();
  });

  it('loads a separate ledger when the active unit changes', async () => {
    mockedGetResidentLedger
      .mockResolvedValueOnce(ledger(300))
      .mockResolvedValueOnce(ledger(450));

    const { Wrapper } = createWrapper();

    const { result, rerender } = renderHook(
      ({ unitId }: { unitId: string }) =>
        useResidentLedger('tenant-1', unitId),
      {
        wrapper: Wrapper,
        initialProps: { unitId: 'unit-1' },
      },
    );

    await waitFor(() => {
      expect(result.current.data?.totals.balanceByCurrency[0]?.amountMinor).toBe(300);
    });

    rerender({ unitId: 'unit-2' });

    await waitFor(() => {
      expect(result.current.data?.totals.balanceByCurrency[0]?.amountMinor).toBe(450);
    });

    expect(mockedGetResidentLedger).toHaveBeenNthCalledWith(
      1,
      'tenant-1',
      'unit-1',
    );
    expect(mockedGetResidentLedger).toHaveBeenNthCalledWith(
      2,
      'tenant-1',
      'unit-2',
    );
  });
});
