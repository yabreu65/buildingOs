/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { TenantFinanceDashboard } from './TenantFinanceDashboard';

const routerReplace = jest.fn();
const routerPush = jest.fn();
const routerRefresh = jest.fn();
const useQueryMock = jest.fn();
const useMutationMock = jest.fn();
const useQueryClientMock = jest.fn();
const useTenantFinanceSummaryMock = jest.fn();
const useBuildingsMock = jest.fn();
const useExpensesMock = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  usePathname: () => '/tenant-1/finanzas',
  useRouter: () => ({
    replace: routerReplace,
    push: routerPush,
    refresh: routerRefresh,
  }),
  useSearchParams: () => searchParams,
  useParams: () => ({ tenantId: 'tenant-1' }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQueryClient: (...args: unknown[]) => useQueryClientMock(...args),
}));

jest.mock('../hooks/useTenantFinanceSummary', () => ({
  useTenantFinanceSummary: (...args: unknown[]) => useTenantFinanceSummaryMock(...args),
}));

jest.mock('@/features/buildings/hooks', () => ({
  useBuildings: (...args: unknown[]) => useBuildingsMock(...args),
}));

jest.mock('../hooks/useExpenseLedger', () => ({
  useExpenses: (...args: unknown[]) => useExpensesMock(...args),
}));

jest.mock('../services/finance.api', () => ({
  PaymentStatus: { SUBMITTED: 'SUBMITTED' },
  approvePaymentTenant: jest.fn(),
  listPendingPayments: jest.fn(),
}));

jest.mock('@/features/buildings/services/documents.api', () => ({
  getDownloadUrl: jest.fn(),
}));

jest.mock('@/shared/components/ui/Toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

jest.mock('./FinanceSummaryCards', () => ({
  FinanceSummaryCards: () => <div>Finance summary cards</div>,
}));

jest.mock('./BuildingsFinanceSummary', () => ({
  BuildingsFinanceSummary: () => <div>Buildings summary</div>,
}));

jest.mock('./TenantDelinquentUnitsList', () => ({
  TenantDelinquentUnitsList: () => <div>Delinquent units</div>,
}));

jest.mock('./PaymentApproveModal', () => ({
  PaymentApproveModal: () => null,
}));

jest.mock('./TenantChargesTab', () => ({
  TenantChargesTab: () => <div>Charges tab</div>,
}));

jest.mock('./ExpenseLedgerCategoriesManager', () => ({
  ExpenseLedgerCategoriesManager: () => <div>Rubros manager</div>,
}));

jest.mock('./TenantExpensesList', () => ({
  TenantExpensesList: () => <div>Expenses list</div>,
}));

jest.mock('./ExpenseHistoryReport', () => ({
  ExpenseHistoryReport: () => <div>Expense history</div>,
}));

jest.mock('./NotasRevelatoriasPanel', () => ({
  NotasRevelatoriasPanel: () => <div>Notas Revelatorias panel</div>,
}));

jest.mock('@/shared/lib/format/money', () => ({
  formatCurrency: (value: number) => `$${value.toLocaleString('es-AR')}`,
}));

jest.mock('lucide-react', () => ({
  FileText: () => <span>FileText</span>,
  Loader2: () => <span>Loader2</span>,
}));

describe('TenantFinanceDashboard', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    routerReplace.mockReset();
    routerPush.mockReset();
    routerRefresh.mockReset();
    useQueryMock.mockReturnValue({ data: [], isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
    useQueryClientMock.mockReturnValue({ invalidateQueries: jest.fn() });
    useTenantFinanceSummaryMock.mockReturnValue({
      data: {
        totalCharges: 1000,
        totalPaid: 250,
        totalOutstanding: 750,
        delinquentUnitsCount: 0,
        topDelinquentUnits: [],
        currency: 'ARS',
      },
      isPending: false,
      error: null,
      refetch: jest.fn(),
    });
    useBuildingsMock.mockReturnValue({
      buildings: [{ id: 'building-a', name: 'Torre Sur' }],
      loading: false,
    });
    useExpensesMock.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
  });

  it('opens the payments tab from the query string and updates when navigation changes', () => {
    const { rerender } = render(<TenantFinanceDashboard />);

    expect(screen.getByText('Buildings summary')).toBeTruthy();
    expect(screen.queryByText('No hay pagos para aprobar')).toBeNull();

    searchParams = new URLSearchParams('tab=payments');
    rerender(<TenantFinanceDashboard />);

    expect(screen.getByText('No hay pagos para aprobar')).toBeTruthy();
    expect(screen.queryByText('Buildings summary')).toBeNull();

    searchParams = new URLSearchParams('tab=notas');
    rerender(<TenantFinanceDashboard />);

    expect(screen.getByText('Notas Revelatorias panel')).toBeTruthy();
    expect(screen.queryByText('No hay pagos para aprobar')).toBeNull();
  });

  it('updates the URL while preserving the existing query string and local period state', () => {
    searchParams = new URLSearchParams('foo=bar');
    render(<TenantFinanceDashboard />);

    const periodInput = screen.getByDisplayValue(new Date().toISOString().slice(0, 7)) as HTMLInputElement;
    fireEvent.change(periodInput, { target: { value: '2026-08' } });
    expect(periodInput.value).toBe('2026-08');

    fireEvent.click(screen.getByRole('button', { name: 'Pagos (0)' }));

    expect(routerReplace).toHaveBeenCalledWith('/tenant-1/finanzas?foo=bar&tab=payments', { scroll: false });
    expect(periodInput.value).toBe('2026-08');
  });
});
