/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import InboxPage from './page';

jest.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ status: 'authenticated', session: { user: { id: 'u-1' } } }),
}));

jest.mock('@/features/context/useContext', () => ({
  useContextManager: () => ({
    context: { activeBuildingId: 'b-1' },
    options: [],
  }),
}));

jest.mock('@/features/assistant/hooks/useAiNudges', () => ({
  useAiNudges: () => ({ nudges: [], loading: false }),
}));

jest.mock('@/features/assistant/components/limits/AiNudgesPanel', () => ({
  AiNudgesPanel: () => null,
}));

jest.mock('@/features/inbox/useInboxSummary', () => ({
  useInboxSummary: () => ({ summary: mockedSummary(), loading: false, error: null, refetch: jest.fn() }),
}));

jest.mock('@/features/context/components/ContextSelector', () => ({
  ContextSelector: () => null,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/t-1/inbox',
}));

function mockedSummary() {
  return {
    tickets: [],
    payments: [
      { id: 'p1', buildingId: 'b-1', buildingName: 'B1', unitCode: 'U1', amount: 12345, currency: 'USD', method: 'TRANSFER', status: 'SUBMITTED', createdAt: '2026-01-01T00:00:00Z', proofFileId: null },
      { id: 'p2', buildingId: 'b-1', buildingName: 'B1', unitCode: 'U2', amount: 2000000, currency: 'ARS', method: 'TRANSFER', status: 'SUBMITTED', createdAt: '2026-01-02T00:00:00Z', proofFileId: null },
      { id: 'p3', buildingId: 'b-1', buildingName: 'B1', unitCode: 'U3', amount: 500000, currency: 'VES', method: 'TRANSFER', status: 'SUBMITTED', createdAt: '2026-01-03T00:00:00Z', proofFileId: null },
      { id: 'p4', buildingId: 'b-1', buildingName: 'B1', unitCode: 'U4', amount: 7000000, currency: 'COP', method: 'TRANSFER', status: 'SUBMITTED', createdAt: '2026-01-04T00:00:00Z', proofFileId: null },
    ],
    communications: [],
    alerts: { urgentUnassignedTicketsCount: 0, delinquentUnitsTop: [] },
  };
}

describe('Inbox page payments section (3F5 payment currency)', () => {
  it('renders each payment with its own currency and correct minor-unit scale', () => {
    render(<InboxPage params={{ tenantId: 't-1' }} />);

    // 12345 minor = 123.45; 2000000 minor = 20.000,00; 500000 = 5.000,00; 7000000 = 70.000,00
    const text = screen.getByText((content) => content.includes('123,45')).textContent ?? '';
    expect(text).toContain('US$');
    expect(screen.getByText((content) => content.includes('20.000,00') && content.includes('$'))).toBeTruthy();
    expect(screen.getByText((content) => content.includes('5.000,00') && content.includes('VES'))).toBeTruthy();
    expect(screen.getByText((content) => content.includes('70.000,00') && content.includes('COP'))).toBeTruthy();
  });

  it('never renders BRL and never mis-scales amounts', () => {
    const { container } = render(<InboxPage params={{ tenantId: 't-1' }} />);

    expect(container.innerHTML).not.toContain('BRL');
    // Scale guards: 12345 must not render as 12345 nor as 1,23.
    expect(container.innerHTML).not.toContain('123,45.00');
    expect(screen.queryByText((content) => content.includes('1,23'))).toBeNull();
  });
});
