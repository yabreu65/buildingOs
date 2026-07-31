/**
 * @jest-environment jsdom
 */

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import { useActiveTenantId, useHasRole } from '@/features/auth/useAuthSession';
import { useCan } from '@/features/rbac/rbac.hooks';
import { useInvitations } from '@/features/invitations/hooks/useInvitations';
import TeamPage from './page';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useActiveTenantId: jest.fn(),
  useHasRole: jest.fn(),
}));

jest.mock('@/features/rbac/rbac.hooks', () => ({
  useCan: jest.fn(),
}));

jest.mock('@/features/invitations/hooks/useInvitations', () => ({
  useInvitations: jest.fn(),
}));

jest.mock('@/features/memberships/components/OperationalMembersList', () => ({
  OperationalMembersList: () => <div data-testid="operational-members-list">Operational members</div>,
}));

jest.mock('@/features/memberships/components/PeopleModuleSwitcher', () => ({
  PeopleModuleSwitcher: () => <div data-testid="people-module-switcher">Switcher</div>,
}));

jest.mock('@/features/invitations/components/PendingInvitationsList', () => ({
  __esModule: true,
  default: () => <div data-testid="pending-invitations-list">Pending invitations</div>,
}));

jest.mock('@/features/invitations/components/InviteModal', () => ({
  InviteModal: () => <div data-testid="invite-modal">Invite modal</div>,
}));

jest.mock('@/shared/components/ui/Button', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

jest.mock('@/shared/components/ui/Toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseRouter = jest.mocked(useRouter);
const mockedUseActiveTenantId = jest.mocked(useActiveTenantId);
const mockedUseHasRole = jest.mocked(useHasRole);
const mockedUseCan = jest.mocked(useCan);
const mockedUseInvitations = jest.mocked(useInvitations);

describe('TeamPage', () => {
  const replace = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUseRouter.mockReturnValue({ replace } as never);
    mockedUseHasRole.mockReturnValue(false);
    mockedUseCan.mockReturnValue(true);
    mockedUseInvitations.mockReturnValue({
      members: [],
      pendingInvitations: [],
      loading: false,
      error: null,
      fetchMembers: jest.fn(),
      fetchInvitations: jest.fn(),
      refetch: jest.fn(),
      createInvitation: jest.fn(),
      revokeInvitation: jest.fn(),
      resendInvitation: jest.fn(),
    });
  });

  it('keeps the page gated when the session has no active tenant', () => {
    mockedUseActiveTenantId.mockReturnValue(null);

    render(<TeamPage />);

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId('operational-members-list')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to the active tenant when the route tenant does not match', () => {
    mockedUseActiveTenantId.mockReturnValue('tenant-2');

    render(<TeamPage />);

    expect(replace).toHaveBeenCalledWith('/tenant-2/settings/team');
    expect(screen.queryByTestId('operational-members-list')).toBeNull();
  });
});
