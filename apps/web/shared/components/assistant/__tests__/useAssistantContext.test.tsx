import { renderHook } from '@testing-library/react';
import { useAssistantContext } from '../useAssistantContext';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  usePathname: jest.fn(),
}));

jest.mock('@/features/auth/session.storage', () => ({
  getSession: jest.fn(),
}));

const { useParams, usePathname } = jest.requireMock('next/navigation') as {
  useParams: jest.Mock;
  usePathname: jest.Mock;
};

const { getSession } = jest.requireMock('@/features/auth/session.storage') as {
  getSession: jest.Mock;
};

describe('useAssistantContext', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    useParams.mockReturnValue({ tenantId: 'tenant-1', buildingId: 'demo-B' });
    usePathname.mockReturnValue('/tenant-1/buildings/demo-B/finance');
    getSession.mockReturnValue({
      activeTenantId: 'tenant-1',
      user: { id: 'user-1' },
      memberships: [{ roles: ['TENANT_ADMIN'] }],
    });
  });

  it('includes buildingId and financePeriod from the current finance page', () => {
    const input = document.createElement('input');
    input.type = 'month';
    input.value = '2026-06';
    document.body.appendChild(input);

    const { result } = renderHook(() => useAssistantContext());

    expect(result.current.tenantId).toBe('tenant-1');
    expect(result.current.buildingId).toBe('demo-B');
    expect(result.current.page).toBe('charges');
    expect(result.current.currentPage).toBe('/tenant-1/buildings/demo-B/finance');
    expect(result.current.financePeriod).toBe('2026-06');
  });
});
