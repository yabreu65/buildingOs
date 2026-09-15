/**
 * @jest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaymentsReviewUI from './payments.review.ui';
import { getPaymentMetrics } from '../finance/services/finance.api';

jest.mock('next/navigation', () => ({
  useParams: () => ({ tenantId: 'tenant-1' }),
}));

jest.mock('../finance/services/finance.api', () => ({
  PaymentStatus: {
    SUBMITTED: 'SUBMITTED',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    RECONCILED: 'RECONCILED',
  },
  getPaymentMetrics: jest.fn(),
  listPendingPayments: jest.fn().mockResolvedValue([]),
  approvePaymentTenant: jest.fn(),
  rejectPaymentTenant: jest.fn(),
  getPaymentAuditLog: jest.fn(),
  checkPaymentDuplicate: jest.fn(),
}));

jest.mock('../buildings/services/buildings.api', () => ({
  fetchBuildings: jest.fn().mockResolvedValue([]),
}));

jest.mock('../rbac/rbac.hooks', () => ({
  useCan: () => false,
}));

jest.mock('@/features/tenancy/hooks/useTenantBranding', () => ({
  useTenantCurrency: () => ({
    format: (amount: number) => `tenant-currency:${amount}`,
  }),
}));

jest.mock('@/shared/lib/format/currency-buckets', () => ({
  formatCurrencyBuckets: (buckets: readonly { currency: string; amountMinor: number }[]) =>
    buckets.map((bucket) => `${bucket.currency}:${bucket.amountMinor}`).join(' | '),
}));

jest.mock('@/shared/components/ui/Button', () => ({
  __esModule: true,
  default: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}));

jest.mock('@/shared/components/ui/Card', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/shared/components/ui/Input', () => ({
  __esModule: true,
  default: (props: ButtonHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

jest.mock('@/shared/components/ui/Select', () => ({
  __esModule: true,
  default: ({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props}>{children}</select>
  ),
}));

jest.mock('@/shared/components/ui/Badge', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

jest.mock('@/shared/components/ui/Table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  THead: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TR: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
  TH: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TD: ({ children }: { children: ReactNode }) => <td>{children}</td>,
}));

const mockedGetPaymentMetrics = jest.mocked(getPaymentMetrics);

describe('PaymentsReviewUI payment metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetPaymentMetrics.mockResolvedValue({
      backlogCount: 3,
      backlogAmountByCurrency: [
        { currency: 'ARS', amountMinor: 1250 },
        { currency: 'USD', amountMinor: 2200 },
        { currency: 'UYU', amountMinor: 3000 },
      ],
      agingMedianDays: 2,
      agingP95Days: 4,
      totalReviewed: 1,
      approvalRate: 100,
      rejectionRate: 0,
      rejectionReasons: [],
      byBuilding: [],
    } as never);
  });

  it('renders each returned backlog currency bucket instead of the tenant-currency scalar', async () => {
    render(<PaymentsReviewUI />);

    fireEvent.click(screen.getByRole('button', { name: /métricas/i }));

    await waitFor(() => {
      expect(screen.getByText('ARS:1250 | USD:2200 | UYU:3000')).toBeTruthy();
    });
    expect(screen.queryByText('tenant-currency:undefined')).toBeNull();
    expect(screen.queryByText('tenant-currency:6450')).toBeNull();
  });
});
