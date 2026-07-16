import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { getInboxSummary } from './inbox.api';
import type { InboxSummaryResponse } from './inbox.types';
import { useInboxSummary } from './useInboxSummary';

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('./inbox.api', () => ({
  getInboxSummary: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedGetInboxSummary = jest.mocked(getInboxSummary);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('useInboxSummary', () => {
  beforeEach(() => {
    mockedUseAuthSession.mockReset();
    mockedGetInboxSummary.mockReset();
  });

  it('reloads the inbox summary when the authenticated user changes within the same tenant', async () => {
    const firstSummary = createDeferred<InboxSummaryResponse>();
    const secondSummary = createDeferred<InboxSummaryResponse>();

    const oldSummary: InboxSummaryResponse = {
      tickets: [
        {
          id: 'ticket-1',
          buildingId: 'building-1',
          title: 'Old ticket',
          buildingName: 'Tower One',
          unitCode: 'A-01',
          createdAt: '2026-07-01T00:00:00.000Z',
          priority: 'HIGH',
          status: 'OPEN',
        },
      ],
      payments: [
        {
          id: 'payment-1',
          buildingId: 'building-1',
          buildingName: 'Tower One',
          amount: 1000,
          method: 'TRANSFER',
          status: 'PENDING',
          createdAt: '2026-07-01T00:00:00.000Z',
          proofFileId: null,
        },
      ],
      communications: [],
      alerts: { urgentUnassignedTicketsCount: 0, delinquentUnitsTop: [] },
    };

    const newSummary: InboxSummaryResponse = {
      tickets: [
        {
          id: 'ticket-2',
          buildingId: 'building-1',
          title: 'New ticket',
          buildingName: 'Tower One',
          unitCode: 'B-02',
          createdAt: '2026-07-02T00:00:00.000Z',
          priority: 'LOW',
          status: 'OPEN',
        },
      ],
      payments: [
        {
          id: 'payment-2',
          buildingId: 'building-1',
          buildingName: 'Tower One',
          amount: 2000,
          method: 'TRANSFER',
          status: 'PENDING',
          createdAt: '2026-07-02T00:00:00.000Z',
          proofFileId: null,
        },
      ],
      communications: [],
      alerts: { urgentUnassignedTicketsCount: 0, delinquentUnitsTop: [] },
    };

    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident1@buildingos.test', name: 'Resident 1' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });
    mockedGetInboxSummary.mockImplementationOnce(() => firstSummary.promise);
    mockedGetInboxSummary.mockImplementationOnce(() => secondSummary.promise);

    const { result, rerender } = renderHook(
      ({ tenantId, buildingId }: { tenantId: string | null; buildingId: string | null }) =>
        useInboxSummary(tenantId, buildingId, 20),
      {
        initialProps: { tenantId: 'tenant-1', buildingId: 'building-1' },
      },
    );

    await waitFor(() => {
      expect(mockedGetInboxSummary).toHaveBeenCalledTimes(1);
    });

    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-2', email: 'resident2@buildingos.test', name: 'Resident 2' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });

    rerender({ tenantId: 'tenant-1', buildingId: 'building-1' });

    await waitFor(() => {
      expect(mockedGetInboxSummary).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      secondSummary.resolve(newSummary);
    });

    await waitFor(() => {
      expect(result.current.summary).toEqual(newSummary);
    });

    await act(async () => {
      firstSummary.resolve(oldSummary);
    });

    await waitFor(() => {
      expect(result.current.summary).toEqual(newSummary);
    });
  });
});
