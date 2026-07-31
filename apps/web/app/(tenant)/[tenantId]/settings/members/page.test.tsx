/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import { useActiveTenantId, useHasRole } from '@/features/auth/useAuthSession';
import { useCan } from '@/features/rbac/rbac.hooks';
import MembersPage from './page';

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

jest.mock('@/features/tenant-members/components/MembersList', () => ({
  MembersList: () => <div data-testid="members-list">Members list</div>,
}));

jest.mock('@/features/tenant-members/components/CreateMemberModal', () => ({
  CreateMemberModal: () => <div data-testid="create-member-modal">Create member modal</div>,
}));

jest.mock('@/features/memberships/components/PeopleModuleSwitcher', () => ({
  PeopleModuleSwitcher: () => <div data-testid="people-module-switcher">Switcher</div>,
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseRouter = jest.mocked(useRouter);
const mockedUseActiveTenantId = jest.mocked(useActiveTenantId);
const mockedUseHasRole = jest.mocked(useHasRole);
const mockedUseCan = jest.mocked(useCan);

describe('MembersPage', () => {
  const replace = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUseRouter.mockReturnValue({ replace } as never);
    mockedUseHasRole.mockReturnValue(false);
    mockedUseCan.mockReturnValue(true);
  });

  it('keeps the page gated when the session has no active tenant', () => {
    mockedUseActiveTenantId.mockReturnValue(null);

    render(<MembersPage />);

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId('members-list')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to the active tenant when the route tenant does not match', () => {
    mockedUseActiveTenantId.mockReturnValue('tenant-2');

    render(<MembersPage />);

    expect(replace).toHaveBeenCalledWith('/tenant-2/settings/members');
    expect(screen.queryByTestId('members-list')).toBeNull();
  });
});
