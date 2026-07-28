/**
 * @jest-environment jsdom
 */

process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import ResidentTicketsPage from './page';
import * as residentContextHook from '@/features/resident/hooks/useResidentContext';
import * as tenanciesHook from '@/features/tenants/tenants.hooks';
import * as authHook from '@/features/auth/useAuthSession';
import * as reactQuery from '@tanstack/react-query';
import { residentTicketDetailPath } from '@/shared/lib/routes';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

jest.mock('@/features/resident/hooks/useResidentContext', () => ({
  useResidentContext: jest.fn(),
}));

jest.mock('@/features/tenants/tenants.hooks', () => ({
  useTenants: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseResidentContext = jest.mocked(residentContextHook.useResidentContext);
const mockedUseTenants = jest.mocked(tenanciesHook.useTenants);
const mockedUseAuthSession = jest.mocked(authHook.useAuthSession);
const mockedUseQuery = jest.mocked(reactQuery.useQuery);
const mockedUseQueryClient = jest.mocked(reactQuery.useQueryClient);

describe('ResidentTicketsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUseAuthSession.mockReturnValue({
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
      user: { id: 'resident-1', email: 'resident@test.com', name: 'Resident' },
    } as never);
    mockedUseResidentContext.mockReturnValue({
      data: { tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' },
      isLoading: false,
    } as never);
    mockedUseTenants.mockReturnValue({
      data: [{ id: 'tenant-1', name: 'Tenant One' }],
    } as never);
    mockedUseQueryClient.mockReturnValue({ removeQueries: jest.fn() } as never);
    mockedUseQuery.mockReturnValue({
      data: [
        {
          id: 'ticket-1',
          title: 'Fuga de agua',
          description: 'Detalle',
          status: 'OPEN',
          priority: 'MEDIUM',
          category: 'MAINTENANCE',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          closedAt: null,
          createdBy: { id: 'resident-1', name: 'Resident' },
          assignedTo: null,
          building: { id: 'building-1', name: 'Building One' },
          unit: { id: 'unit-1', label: '101', code: 'A01' },
          comments: [],
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as never);
  });

  it('links each resident ticket to the canonical detail route', () => {
    render(<ResidentTicketsPage />);

    const link = screen.getByRole('link', { name: /ver reclamo fuga de agua/i });
    expect(link.getAttribute('href')).toBe(residentTicketDetailPath('tenant-1', 'ticket-1'));
  });
});
