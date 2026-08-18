/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncomeCreateModal } from './IncomeCreateModal';
import * as useFinanceSettingsModule from '../hooks/useFinanceSettings';

jest.mock('@/shared/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/features/buildings/hooks', () => ({
  useBuildings: () => ({ buildings: [], loading: false }),
}));

jest.mock('../hooks/useExpenseLedger', () => ({
  useCreateIncome: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useExpenseLedgerCategories: () => ({ data: [], isLoading: false }),
}));

jest.mock('../hooks/useFinanceSettings', () => ({
  useFinanceSettings: jest.fn(),
}));

jest.mock('@buildingos/contracts', () => ({
  CANONICAL_CURRENCIES: ['COP', 'USD', 'ARS', 'VES'],
}));

jest.mock('lucide-react', () => ({
  Loader2: () => <span>Loader2</span>,
  X: () => <span>X</span>,
}));

const mockedUseFinanceSettings = jest.mocked(useFinanceSettingsModule.useFinanceSettings);

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IncomeCreateModal tenantId="tenant-1" period="2026-08" onClose={() => undefined} onCreated={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('IncomeCreateModal currency default (FIN-07BR3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['USD', 'VES', 'COP'] as const)('starts with configured functional currency %s', (currency) => {
    mockedUseFinanceSettings.mockReturnValue({ data: { functionalCurrency: currency } } as never);
    renderModal();
    expect((screen.getByLabelText('Moneda') as HTMLSelectElement).value).toBe(currency);
  });

  it('falls back to the first canonical currency when settings are absent', () => {
    mockedUseFinanceSettings.mockReturnValue({ data: undefined } as never);
    renderModal();
    expect((screen.getByLabelText('Moneda') as HTMLSelectElement).value).toBe('COP');
  });

  it('defaults to a non-ARS canonical currency instead of a hardcoded ARS default', () => {
    mockedUseFinanceSettings.mockReturnValue({ data: undefined } as never);
    renderModal();
    expect((screen.getByLabelText('Moneda') as HTMLSelectElement).value).not.toBe('ARS');
  });

  it('does not overwrite a user-selected currency when settings arrive later', () => {
    mockedUseFinanceSettings.mockReturnValue({ data: undefined } as never);
    const { rerender } = renderModal();
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } });
    expect((screen.getByLabelText('Moneda') as HTMLSelectElement).value).toBe('USD');

    // Settings arrive later with a different functional currency.
    mockedUseFinanceSettings.mockReturnValue({ data: { functionalCurrency: 'VES' } } as never);
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IncomeCreateModal tenantId="tenant-1" period="2026-08" onClose={() => undefined} onCreated={() => undefined} />
      </QueryClientProvider>,
    );
    expect((screen.getByLabelText('Moneda') as HTMLSelectElement).value).toBe('USD');
  });
});
