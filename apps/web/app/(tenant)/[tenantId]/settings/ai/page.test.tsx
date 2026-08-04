/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { useAuthSession, useActiveTenantId } from '@/features/auth/useAuthSession';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { useAiAnalytics } from '@/features/assistant/hooks/useAiAnalytics';
import { useAiLimits } from '@/features/assistant/hooks/useAiLimits';
import { useAiNudges } from '@/features/assistant/hooks/useAiNudges';
import TenantAiAnalyticsPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
  useActiveTenantId: jest.fn(),
}));

jest.mock('@/features/auth/useAuthorizedPortalContext', () => ({
  useAuthorizedPortalContext: jest.fn(),
}));

jest.mock('@/features/tenancy/tenant.hooks', () => ({
  useTenantId: jest.fn(),
}));

jest.mock('@/features/assistant/hooks/useAiAnalytics', () => ({
  useAiAnalytics: jest.fn(),
}));

jest.mock('@/features/assistant/hooks/useAiLimits', () => ({
  useAiLimits: jest.fn(),
}));

jest.mock('@/features/assistant/hooks/useAiNudges', () => ({
  useAiNudges: jest.fn(),
}));

jest.mock('@/features/assistant/components/analytics/AiAnalyticsPanel', () => ({
  AiAnalyticsPanel: ({ error }: { error: string | null }) => (
    <div data-testid="ai-analytics-panel">{error ?? 'analytics-ok'}</div>
  ),
}));

jest.mock('@/features/assistant/components/limits/AiPlanLimitsCard', () => ({
  AiPlanLimitsCard: () => <div data-testid="ai-limits-card">limits</div>,
}));

jest.mock('@/features/assistant/components/limits/AiLimitBanner', () => ({
  AiLimitBanner: ({ type }: { type: string }) => <div data-testid={`ai-banner-${type}`} />,
}));

jest.mock('@/features/assistant/components/limits/AiNudgesPanel', () => ({
  AiNudgesPanel: () => <div data-testid="ai-nudges-panel">nudges</div>,
}));

jest.mock('@/shared/lib/routes', () => ({
  routes: {
    residentDashboard: (tenantId: string) => `/${tenantId}/resident/dashboard`,
  },
}));

const mockedUseRouter = jest.mocked(useRouter);
const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedUseActiveTenantId = jest.mocked(useActiveTenantId);
const mockedUseAuthorizedPortalContext = jest.mocked(useAuthorizedPortalContext);
const mockedUseTenantId = jest.mocked(useTenantId);
const mockedUseAiAnalytics = jest.mocked(useAiAnalytics);
const mockedUseAiLimits = jest.mocked(useAiLimits);
const mockedUseAiNudges = jest.mocked(useAiNudges);

describe('TenantAiAnalyticsPage', () => {
  const replace = jest.fn();
  const routerMock = {
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn().mockResolvedValue(undefined),
    push: jest.fn(),
    refresh: jest.fn(),
    replace,
  };
  let mockSession: {
    activeTenantId: string | null;
    memberships: Array<{ tenantId: string; roles: string[] }>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = {
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] }],
    };
    mockedUseRouter.mockReturnValue(routerMock);
    mockedUseAuthSession.mockImplementation(() => mockSession as never);
    mockedUseActiveTenantId.mockImplementation(() => mockSession.activeTenantId);
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');
    mockedUseTenantId.mockReturnValue('tenant-1');
    mockedUseAiAnalytics.mockReturnValue({
      analytics: null,
      loading: false,
      error: null,
      month: '2026-08',
      setMonth: jest.fn(),
      refetch: jest.fn(),
    });
    mockedUseAiLimits.mockReturnValue({
      limits: { budgetCents: 500, callsLimit: 100, allowBigModel: false },
      usage: {
        month: '2026-08',
        budgetCents: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostCents: 0,
        percentUsed: 0,
        callsPercent: 0,
      },
      loading: false,
      error: undefined,
    });
    mockedUseAiNudges.mockReturnValue({
      nudges: [],
      loading: false,
      error: null,
      submitting: false,
      hasBlockingNudge: false,
      dismiss: jest.fn(),
      requestUpgrade: jest.fn(),
      reload: jest.fn(),
    });
  });

  it('keeps the page gated while the portal context resolves', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue(null);

    render(<TenantAiAnalyticsPage />);

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId('ai-analytics-panel')).toBeNull();
    expect(mockedUseAiAnalytics).not.toHaveBeenCalled();
    expect(mockedUseAiLimits).not.toHaveBeenCalled();
    expect(mockedUseAiNudges).not.toHaveBeenCalled();
  });

  it('redirects resident portal users and never mounts AI hooks', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');

    render(<TenantAiAnalyticsPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/resident/dashboard');
    });

    expect(screen.queryByTestId('ai-analytics-panel')).toBeNull();
    expect(mockedUseAiAnalytics).not.toHaveBeenCalled();
    expect(mockedUseAiLimits).not.toHaveBeenCalled();
    expect(mockedUseAiNudges).not.toHaveBeenCalled();
  });

  it('renders the AI settings content for tenant owners', () => {
    mockSession = {
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_OWNER'] }],
    };

    render(<TenantAiAnalyticsPage />);

    expect(screen.getByText('AI Assistant')).not.toBeNull();
    expect(mockedUseAiAnalytics).toHaveBeenCalledWith('tenant-1');
    expect(mockedUseAiLimits).toHaveBeenCalledWith('tenant-1');
    expect(mockedUseAiNudges).toHaveBeenCalledWith('tenant-1');
  });

  it('renders the AI settings content for tenant admins', () => {
    mockSession = {
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] }],
    };

    render(<TenantAiAnalyticsPage />);

    expect(screen.getByTestId('ai-analytics-panel').textContent).toBe('analytics-ok');
  });

  it('renders the AI settings content for operators', () => {
    mockSession = {
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['OPERATOR'] }],
    };

    render(<TenantAiAnalyticsPage />);

    expect(screen.getByTestId('ai-nudges-panel')).not.toBeNull();
  });

  it('shows access denied for admin portal users without AI capability', () => {
    mockSession = {
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
    };

    render(<TenantAiAnalyticsPage />);

    expect(screen.getByText('No tenés permiso para acceder a las métricas de IA del tenant.')).not.toBeNull();
    expect(mockedUseAiAnalytics).not.toHaveBeenCalled();
    expect(mockedUseAiLimits).not.toHaveBeenCalled();
    expect(mockedUseAiNudges).not.toHaveBeenCalled();
  });

  it('redirects mixed-role users when the portal resolves to resident', async () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('resident');
    mockSession = {
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN', 'RESIDENT'] }],
    };

    render(<TenantAiAnalyticsPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-1/resident/dashboard');
    });

    expect(mockedUseAiAnalytics).not.toHaveBeenCalled();
  });

  it('renders mixed-role users when the portal resolves to admin and access is allowed', () => {
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');
    mockSession = {
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] }],
    };

    render(<TenantAiAnalyticsPage />);

    expect(screen.getByText('Usage Analytics')).not.toBeNull();
  });

  it('redirects when the route tenant is stale relative to the active tenant', async () => {
    mockedUseTenantId.mockReturnValue('tenant-route');
    mockedUseActiveTenantId.mockReturnValue('tenant-active');
    mockedUseAuthorizedPortalContext.mockReturnValue('admin');
    mockSession = {
      activeTenantId: 'tenant-active',
      memberships: [
        { tenantId: 'tenant-route', roles: ['TENANT_ADMIN'] },
        { tenantId: 'tenant-active', roles: ['RESIDENT'] },
      ],
    };

    render(<TenantAiAnalyticsPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/tenant-active/settings/ai');
    });

    expect(mockedUseAiAnalytics).not.toHaveBeenCalled();
    expect(mockedUseAiLimits).not.toHaveBeenCalled();
    expect(mockedUseAiNudges).not.toHaveBeenCalled();
  });

  it('re-evaluates the tenant and blocks the stale admin content when the tenant changes to resident', () => {
    const { rerender } = render(<TenantAiAnalyticsPage />);

    expect(mockedUseAiAnalytics).toHaveBeenLastCalledWith('tenant-1');

    mockedUseTenantId.mockReturnValue('tenant-2');
    mockSession = {
      activeTenantId: 'tenant-2',
      memberships: [
        { tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] },
        { tenantId: 'tenant-2', roles: ['RESIDENT'] },
      ],
    };

    rerender(<TenantAiAnalyticsPage />);

    expect(screen.getByText('No tenés permiso para acceder a las métricas de IA del tenant.')).not.toBeNull();
    expect(mockedUseAiAnalytics).not.toHaveBeenCalledWith('tenant-2');
    expect(mockedUseAiLimits).not.toHaveBeenCalledWith('tenant-2');
    expect(mockedUseAiNudges).not.toHaveBeenCalledWith('tenant-2');
  });
});
