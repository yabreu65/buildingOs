/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/shared/components/ui/Toast';
import { TenantRecurringExpensesTab } from './TenantRecurringExpensesTab';
import * as useExpenseLedger from '../hooks/useExpenseLedger';
import * as useBuildingsModule from '@/features/buildings/hooks';

jest.mock('../hooks/useExpenseLedger', () => ({
  useTenantRecurringExpenses: jest.fn(),
  useCreateTenantRecurringExpense: jest.fn(),
  useUpdateTenantRecurringExpense: jest.fn(),
  useExpenseLedgerCategories: jest.fn(),
}));

jest.mock('@/features/buildings/hooks', () => ({
  useBuildings: jest.fn(),
}));

jest.mock('@/shared/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockedUseTenantRecurringExpenses = jest.mocked(useExpenseLedger.useTenantRecurringExpenses);
const mockedUseCreate = jest.mocked(useExpenseLedger.useCreateTenantRecurringExpense);
const mockedUseUpdate = jest.mocked(useExpenseLedger.useUpdateTenantRecurringExpense);
const mockedUseCategories = jest.mocked(useExpenseLedger.useExpenseLedgerCategories);
const mockedUseBuildings = jest.mocked(useBuildingsModule.useBuildings);

const mockRule = (overrides: Record<string, unknown> = {}) => ({
  id: 're-1',
  tenantId: 'tenant-1',
  buildingId: null,
  scopeType: 'TENANT_SHARED',
  allocationMode: 'MANUAL',
  categoryId: 'category-1',
  amount: 10000,
  currency: 'ARS',
  concept: 'Limpieza mensual',
  frequency: 'MONTHLY',
  nextRunDate: '2026-09-01T00:00:00.000Z',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

function mockMutations() {
  const createMutate = jest.fn().mockResolvedValue({});
  const updateMutate = jest.fn().mockResolvedValue({});
  mockedUseCreate.mockReturnValue({
    mutateAsync: createMutate,
    isPending: false,
  } as never);
  mockedUseUpdate.mockReturnValue({
    mutateAsync: updateMutate,
    isPending: false,
  } as never);
  return { createMutate, updateMutate };
}

describe('TenantRecurringExpensesTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseCategories.mockReturnValue({
      data: [
        { id: 'category-1', name: 'Limpieza' },
        { id: 'category-2', name: 'Seguridad' },
      ],
    } as never);
    mockedUseBuildings.mockReturnValue({
      buildings: [
        { id: 'building-1', tenantId: 'tenant-1', name: 'Torre Norte' },
        { id: 'building-2', tenantId: 'tenant-1', name: 'Torre Sur' },
      ],
      loading: false,
      error: null,
    } as never);
  });

  it('muestra empty state cuando no hay reglas', () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    expect(screen.getByText(/no hay reglas recurrentes comunes/i)).toBeTruthy();
  });

  it('lista reglas MANUAL/EQUAL_SHARE/BUILDING_TOTAL_M2 con etiquetas amigables', () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [
        mockRule({ allocationMode: 'MANUAL', concept: 'Manual test' }),
        mockRule({
          id: 're-2',
          allocationMode: 'EQUAL_SHARE',
          concept: 'Iguales test',
        }),
        mockRule({
          id: 're-3',
          allocationMode: 'BUILDING_TOTAL_M2',
          concept: 'M2 test',
        }),
      ],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    expect(screen.getByText('Manual test')).toBeTruthy();
    expect(screen.getByText('Iguales test')).toBeTruthy();
    expect(screen.getByText('M2 test')).toBeTruthy();
    expect(screen.getByText('Distribución manual')).toBeTruthy();
    expect(screen.getByText('Partes iguales')).toBeTruthy();
    expect(screen.getByText('Según m² de los edificios')).toBeTruthy();
  });

  it('muestra reglas inactivas con estado Inactiva', () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [mockRule({ isActive: false })],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    expect(screen.getByText('Inactiva')).toBeTruthy();
    expect(screen.getByText('Activar')).toBeTruthy();
  });

  it('toggle de activación llama PATCH con isActive correcto', async () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [mockRule({ isActive: true })],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    const { updateMutate } = mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    fireEvent.click(screen.getByText('Desactivar'));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith({
        recurringExpenseId: 're-1',
        data: { isActive: false },
      });
    });
  });

  it('creación EQUAL_SHARE no envía allocations', async () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    const { createMutate } = mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    fireEvent.click(screen.getByText('Nueva regla'));
    await screen.findByText('Nueva regla recurrente');

    fireEvent.change(screen.getByLabelText('Rubro'), { target: { value: 'category-1' } });
    fireEvent.change(screen.getByLabelText('Concepto'), {
      target: { value: 'Limpieza' },
    });
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '100' } });

    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          allocationMode: 'EQUAL_SHARE',
          scopeType: 'TENANT_SHARED',
          allocations: undefined,
        }),
      );
    });
  });

  it('creación BUILDING_TOTAL_M2 no envía allocations', async () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    const { createMutate } = mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    fireEvent.click(screen.getByText('Nueva regla'));
    await screen.findByText('Nueva regla recurrente');

    fireEvent.change(screen.getByLabelText('Rubro'), { target: { value: 'category-1' } });
    fireEvent.change(screen.getByLabelText('Concepto'), {
      target: { value: 'M2 test' },
    });
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '100' } });

    fireEvent.change(screen.getByLabelText('Método de distribución'), {
      target: { value: 'BUILDING_TOTAL_M2' },
    });

    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          allocationMode: 'BUILDING_TOTAL_M2',
          allocations: undefined,
        }),
      );
    });
  });

  it('MANUAL exige suma exactamente 100 y genera allocations con IDs reales', async () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    const { createMutate } = mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    fireEvent.click(screen.getByText('Nueva regla'));
    await screen.findByText('Nueva regla recurrente');

    fireEvent.change(screen.getByLabelText('Rubro'), { target: { value: 'category-1' } });
    fireEvent.change(screen.getByLabelText('Concepto'), {
      target: { value: 'Manual test' },
    });
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Método de distribución'), {
      target: { value: 'MANUAL' },
    });

    fireEvent.change(screen.getByLabelText('Porcentaje para Torre Norte'), {
      target: { value: '50' },
    });
    fireEvent.change(screen.getByLabelText('Porcentaje para Torre Sur'), {
      target: { value: '40' },
    });

    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      expect(createMutate).not.toHaveBeenCalled();
    });
    expect(screen.getByText(/debe ser exactamente 100%/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Porcentaje para Torre Sur'), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          allocationMode: 'MANUAL',
          allocations: [
            { buildingId: 'building-1', percentage: 50 },
            { buildingId: 'building-2', percentage: 50 },
          ],
        }),
      );
    });
  });

  it('edición no permite modificar allocationMode', async () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [mockRule({ allocationMode: 'EQUAL_SHARE' })],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    const { updateMutate } = mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    fireEvent.click(screen.getByText('Editar'));
    await screen.findByText('Editar regla recurrente');

    expect(screen.queryByLabelText('Método de distribución')).toBeNull();
    expect(screen.getAllByText('Partes iguales').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Concepto'), {
      target: { value: 'Nuevo concepto' },
    });
    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith({
        recurringExpenseId: 're-1',
        data: { amount: 10000, concept: 'Nuevo concepto' },
      });
    });
  });

  it('muestra loading mientras carga', () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: undefined,
      isPending: true,
      error: null,
      refetch: jest.fn(),
    } as never);
    mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('bloquea creación sin edificios en el tenant', async () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    mockedUseBuildings.mockReturnValue({
      buildings: [],
      loading: false,
      error: null,
    } as never);
    const { createMutate } = mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    fireEvent.click(screen.getByText('Nueva regla'));
    await screen.findByText('Nueva regla recurrente');

    fireEvent.change(screen.getByLabelText('Rubro'), { target: { value: 'category-1' } });
    fireEvent.change(screen.getByLabelText('Concepto'), {
      target: { value: 'Sin edificios' },
    });
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '100' } });

    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      expect(createMutate).not.toHaveBeenCalled();
    });
    expect(screen.getByText(/no tiene edificios/i)).toBeTruthy();
  });

  it('MANUAL no envía allocations con porcentaje 0', async () => {
    mockedUseTenantRecurringExpenses.mockReturnValue({
      data: [],
      isPending: false,
      error: null,
      refetch: jest.fn(),
    } as never);
    const { createMutate } = mockMutations();

    renderWithProviders(<TenantRecurringExpensesTab tenantId="tenant-1" />);

    fireEvent.click(screen.getByText('Nueva regla'));
    await screen.findByText('Nueva regla recurrente');

    fireEvent.change(screen.getByLabelText('Rubro'), { target: { value: 'category-1' } });
    fireEvent.change(screen.getByLabelText('Concepto'), {
      target: { value: 'Con cero' },
    });
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Método de distribución'), {
      target: { value: 'MANUAL' },
    });

    fireEvent.change(screen.getByLabelText('Porcentaje para Torre Norte'), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText('Porcentaje para Torre Sur'), {
      target: { value: '0' },
    });

    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          allocationMode: 'MANUAL',
          allocations: [{ buildingId: 'building-1', percentage: 100 }],
        }),
      );
    });
  });
});
