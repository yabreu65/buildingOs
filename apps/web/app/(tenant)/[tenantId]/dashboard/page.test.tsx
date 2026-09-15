/**
 * @jest-environment jsdom
 */

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import DashboardPage from './page';
import { useContextAware } from '@/features/buildings/hooks/useContextAware';
import { useAuthSession, useIsSuperAdmin } from '@/features/auth/useAuthSession';
import { useEffectiveRole } from '@/features/tenancy/hooks/useEffectiveRole';
import { useBuildingList, useDashboardSummary } from '@/features/dashboard/hooks/useDashboardSummary';
import { formatCurrencyBuckets } from '@/shared/lib/format/currency-buckets';
import { formatCurrency } from '@/shared/lib/format/money';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('@/shared/components/ui/Card', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/shared/components/ui/Skeleton', () => ({
  __esModule: true,
  default: () => <div />,
}));

jest.mock('@/shared/components/ui/Table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  THead: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TR: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
  TH: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TD: ({ children }: { children: ReactNode }) => <td>{children}</td>,
}));

jest.mock('@/features/onboarding/OnboardingChecklist', () => ({
  OnboardingChecklist: () => null,
}));

jest.mock('@/features/buildings/hooks/useContextAware', () => ({
  useContextAware: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
  useIsSuperAdmin: jest.fn(),
}));

jest.mock('@/features/tenancy/hooks/useEffectiveRole', () => ({
  useEffectiveRole: jest.fn(),
}));

jest.mock('@/features/dashboard/hooks/useDashboardSummary', () => ({
  useDashboardSummary: jest.fn(),
  useBuildingList: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseRouter = jest.mocked(useRouter);
const mockedUseContextAware = jest.mocked(useContextAware);
const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedUseIsSuperAdmin = jest.mocked(useIsSuperAdmin);
const mockedUseEffectiveRole = jest.mocked(useEffectiveRole);
const mockedUseDashboardSummary = jest.mocked(useDashboardSummary);
const mockedUseBuildingList = jest.mocked(useBuildingList);

describe('DashboardPage building alerts', () => {
  beforeEach(() => {
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUseRouter.mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
    } as never);
    mockedUseContextAware.mockReturnValue({ isReady: true } as never);
    mockedUseAuthSession.mockReturnValue({ user: { id: 'admin-1' } } as never);
    mockedUseIsSuperAdmin.mockReturnValue(false);
    mockedUseEffectiveRole.mockReturnValue('TENANT_ADMIN' as never);
    mockedUseBuildingList.mockReturnValue({ data: [] } as never);
    mockedUseDashboardSummary.mockReturnValue({
      data: {
        kpis: {
          outstandingByCurrency: [],
          collectedByCurrency: [],
          collectionRateByCurrency: [],
          delinquentUnits: 0,
        },
        queues: {
          tickets: { open: 0, inProgress: 0, overdue: 0, top: [] },
          paymentsToValidate: { count: 0, top: [] },
          unitsWithoutResponsible: { count: 0, top: [] },
        },
        buildingAlerts: [
          {
            buildingId: 'building-1',
            buildingName: 'Torre del Parque',
            outstandingByCurrency: [
              { currency: 'USD', amountMinor: 5000 },
              { currency: 'ARS', amountMinor: 198200 },
            ],
            overdueTickets: 0,
            unitsWithoutResponsible: 0,
            riskScore: 'LOW',
          },
          {
            buildingId: 'building-2',
            buildingName: 'Edificio del Río',
            outstandingByCurrency: [
              { currency: 'USD', amountMinor: 2500 },
              { currency: 'ARS', amountMinor: 474600 },
            ],
            overdueTickets: 0,
            unitsWithoutResponsible: 0,
            riskScore: 'LOW',
          },
        ],
        quickActions: [],
        metadata: { period: '2026-05', buildingId: null, generatedAt: '2026-05-01T00:00:00.000Z' },
      },
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
  });

  it('renders each building and the footer with their actual currency buckets', () => {
    render(<DashboardPage />);

    const expectCurrencyBuckets = (amounts: Array<{ currency: string; amountMinor: number }>) => {
      const formatted = formatCurrencyBuckets(amounts);
      expect(screen.getAllByText((_content, element) => element?.textContent === formatted)).not.toHaveLength(0);
    };

    expectCurrencyBuckets([
      { currency: 'USD', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 198200 },
    ]);
    expectCurrencyBuckets([
      { currency: 'USD', amountMinor: 2500 },
      { currency: 'ARS', amountMinor: 474600 },
    ]);
    expectCurrencyBuckets([
      { currency: 'USD', amountMinor: 7500 },
      { currency: 'ARS', amountMinor: 672800 },
    ]);
  });

  it('formats each pending payment with its stored currency', () => {
    mockedUseDashboardSummary.mockReturnValue({
      data: {
        kpis: {
          outstandingByCurrency: [],
          collectedByCurrency: [],
          collectionRateByCurrency: [],
          delinquentUnits: 0,
        },
        queues: {
          tickets: { open: 0, inProgress: 0, overdue: 0, top: [] },
          paymentsToValidate: {
            count: 2,
            top: [
              { id: 'payment-usd-1', unitLabel: 'A-101', buildingName: 'Edificio A', amount: 5000, currency: 'USD', submittedAt: '2026-05-01T00:00:00.000Z' },
              { id: 'payment-cop-1', unitLabel: 'B-202', buildingName: 'Edificio B', amount: 198200, currency: 'COP', submittedAt: '2026-05-01T00:00:00.000Z' },
            ],
          },
          unitsWithoutResponsible: { count: 0, top: [] },
        },
        buildingAlerts: [],
        quickActions: [],
        metadata: { period: '2026-05', buildingId: null, generatedAt: '2026-05-01T00:00:00.000Z' },
      },
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<DashboardPage />);

    const usdPaymentAmount = screen.getByText('A-101').parentElement?.lastElementChild;
    const copPaymentAmount = screen.getByText('B-202').parentElement?.lastElementChild;

    expect(usdPaymentAmount?.textContent).toBe(formatCurrency(5000, 'USD'));
    expect(usdPaymentAmount?.textContent).not.toBe(formatCurrency(5000, 'ARS'));
    expect(copPaymentAmount?.textContent).toBe(formatCurrency(198200, 'COP'));
    expect(copPaymentAmount?.textContent).not.toBe(formatCurrency(198200, 'ARS'));
    expect(copPaymentAmount?.textContent).not.toBe(formatCurrency(198200, 'USD'));
  });
});
