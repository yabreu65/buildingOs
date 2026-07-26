/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ResidentAnnouncementsPage from './page';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { useResidentContext } from '@/features/resident/hooks/useResidentContext';
import {
  getResidentCommunications,
  markResidentAsRead,
  type ResidentCommunicationItem,
} from '@/features/communications/services/communications.api';

jest.mock('@/features/tenancy/tenant.hooks', () => ({
  useTenantId: jest.fn(),
}));

jest.mock('@/features/resident/hooks/useResidentContext', () => ({
  useResidentContext: jest.fn(),
}));

jest.mock('@/features/communications/services/communications.api', () => ({
  getResidentCommunications: jest.fn(),
  markResidentAsRead: jest.fn(),
}));

const mockedUseTenantId = jest.mocked(useTenantId);
const mockedUseResidentContext = jest.mocked(useResidentContext);
const mockedGetResidentCommunications = jest.mocked(getResidentCommunications);
const mockedMarkResidentAsRead = jest.mocked(markResidentAsRead);

function makeComm(overrides: Partial<ResidentCommunicationItem> = {}): ResidentCommunicationItem {
  return {
    id: 'comm-1',
    title: 'Aviso importante',
    body: 'Se realiza asamblea el viernes.',
    priority: 'NORMAL',
    scopeType: 'BUILDING',
    buildingIds: ['building-1'],
    createdAt: '2026-07-01T00:00:00.000Z',
    publishedAt: '2026-07-01T00:00:00.000Z',
    deliveryStatus: 'UNREAD',
    readAt: null,
    ...overrides,
  };
}

describe('ResidentAnnouncementsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseTenantId.mockReturnValue('tenant-1');
  });

  it('does not query without complete context', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: null },
      isLoading: false,
    } as never);

    render(<ResidentAnnouncementsPage />);

    expect(mockedGetResidentCommunications).not.toHaveBeenCalled();
    expect(screen.getByText(/Seleccioná un edificio y una unidad/)).toBeTruthy();
  });

  it('does not query when tenantId is missing', async () => {
    mockedUseTenantId.mockReturnValue(null as unknown as string);
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);

    render(<ResidentAnnouncementsPage />);

    expect(mockedGetResidentCommunications).not.toHaveBeenCalled();
  });

  it('queries with tenantId, buildingId and unitId when context is complete', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);
    mockedGetResidentCommunications.mockResolvedValue({
      items: [makeComm()],
      nextCursor: undefined,
    });

    render(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(mockedGetResidentCommunications).toHaveBeenCalledWith(
        'tenant-1',
        'building-1',
        'unit-1',
        20,
        undefined,
      );
    });

    expect(screen.getByText('Aviso importante')).toBeTruthy();
  });

  it('re-queries when context changes and resets previous items', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);
    mockedGetResidentCommunications.mockResolvedValue({
      items: [makeComm({ id: 'comm-old', title: 'Viejo edificio' })],
      nextCursor: undefined,
    });

    const { rerender } = render(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('Viejo edificio')).toBeTruthy();
    });

    mockedGetResidentCommunications.mockResolvedValue({
      items: [makeComm({ id: 'comm-new', title: 'Nuevo edificio' })],
      nextCursor: undefined,
    });
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-2', activeUnitId: 'unit-2' },
      isLoading: false,
    } as never);

    rerender(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(mockedGetResidentCommunications).toHaveBeenCalledWith(
        'tenant-1',
        'building-2',
        'unit-2',
        20,
        undefined,
      );
    });

    expect(screen.queryByText('Viejo edificio')).toBeNull();
    expect(screen.getByText('Nuevo edificio')).toBeTruthy();
  });

  it('does not mix results from the previous unit', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);
    mockedGetResidentCommunications.mockResolvedValue({
      items: [makeComm({ id: 'comm-1', title: 'Unidad 1' })],
      nextCursor: undefined,
    });

    const { rerender } = render(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('Unidad 1')).toBeTruthy();
    });

    mockedGetResidentCommunications.mockResolvedValue({
      items: [makeComm({ id: 'comm-2', title: 'Unidad 2' })],
      nextCursor: undefined,
    });
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-2' },
      isLoading: false,
    } as never);

    rerender(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('Unidad 2')).toBeTruthy();
    });

    expect(screen.queryByText('Unidad 1')).toBeNull();
  });

  it('load more uses the selected context', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);
    mockedGetResidentCommunications
      .mockResolvedValueOnce({
        items: [makeComm({ id: 'comm-1', title: 'First' })],
        nextCursor: 'cursor-abc',
      })
      .mockResolvedValueOnce({
        items: [makeComm({ id: 'comm-2', title: 'Second' })],
        nextCursor: undefined,
      });

    render(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
    });

    const loadMoreBtn = screen.getByText('Ver más');
    loadMoreBtn.click();

    await waitFor(() => {
      expect(mockedGetResidentCommunications).toHaveBeenCalledWith(
        'tenant-1',
        'building-1',
        'unit-1',
        20,
        'cursor-abc',
      );
    });

    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('shows error state and retry works', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);
    mockedGetResidentCommunications.mockRejectedValueOnce(new Error('Network error'));

    render(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('No pudimos cargar los comunicados')).toBeTruthy();
    });

    mockedGetResidentCommunications.mockResolvedValue({
      items: [makeComm()],
      nextCursor: undefined,
    });

    screen.getByText('Reintentar').click();

    await waitFor(() => {
      expect(screen.getByText('Aviso importante')).toBeTruthy();
    });
  });

  it('shows safe state when context is loading', () => {
    mockedUseResidentContext.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);

    const { container } = render(<ResidentAnnouncementsPage />);

    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('markResidentAsRead receives tenantId and communicationId', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);
    mockedGetResidentCommunications.mockResolvedValue({
      items: [makeComm()],
      nextCursor: undefined,
    });
    mockedMarkResidentAsRead.mockResolvedValue({ readAt: '2026-07-26T00:00:00.000Z' });

    render(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('Aviso importante')).toBeTruthy();
    });

    screen.getByText('Aviso importante').click();

    await waitFor(() => {
      expect(mockedMarkResidentAsRead).toHaveBeenCalledWith('tenant-1', 'comm-1');
    });
  });

  it('shows error state for mark-as-read failure', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);
    mockedGetResidentCommunications.mockResolvedValue({
      items: [makeComm()],
      nextCursor: undefined,
    });
    mockedMarkResidentAsRead.mockRejectedValue(new Error('Mark read failed'));

    render(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('Aviso importante')).toBeTruthy();
    });

    screen.getByText('Aviso importante').click();

    await waitFor(() => {
      expect(screen.getByText('Mark read failed')).toBeTruthy();
    });
  });

  it('does not repopulate screen with stale response after context change to incomplete', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveFirst!: (value: any) => void;
    mockedGetResidentCommunications.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve as never; }),
    );

    const { rerender } = render(<ResidentAnnouncementsPage />);

    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: null, activeUnitId: null },
      isLoading: false,
    } as never);

    rerender(<ResidentAnnouncementsPage />);

    resolveFirst({
      items: [makeComm({ id: 'stale-comm', title: 'Stale' })],
      nextCursor: undefined,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(screen.queryByText('Stale')).toBeNull();
  });

  it('does not apply stale mark-as-read result to new context', async () => {
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);
    mockedGetResidentCommunications.mockResolvedValue({
      items: [makeComm({ id: 'comm-1', title: 'Original' })],
      nextCursor: undefined,
    });

    render(<ResidentAnnouncementsPage />);

    await waitFor(() => {
      expect(screen.getByText('Original')).toBeTruthy();
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveMarkRead!: (value: any) => void;
    mockedMarkResidentAsRead.mockImplementationOnce(
      () => new Promise((resolve) => { resolveMarkRead = resolve as never; }),
    );

    screen.getByText('Original').click();

    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-2', activeUnitId: 'unit-2' },
      isLoading: false,
    } as never);

    resolveMarkRead({ readAt: '2026-07-26T00:00:00.000Z' });

    await new Promise((r) => setTimeout(r, 10));

    const readIcons = screen.queryAllByText('Original');
    readIcons.forEach((el) => {
      expect(el.closest('button')?.querySelector('[data-testid="read-icon"]')).toBeNull();
    });
  });
});
