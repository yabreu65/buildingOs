/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncomesTab } from './IncomesTab';
import * as useExpenseLedger from '../hooks/useExpenseLedger';
import * as useFundsModule from '../hooks/useFunds';
import * as useIncomeApplicationsModule from '../hooks/useIncomeApplications';

jest.mock('../hooks/useExpenseLedger', () => ({
  useIncomes: jest.fn(),
  useExpenseLedgerCategories: jest.fn(),
  useRecordIncome: jest.fn(),
  useVoidIncome: jest.fn(),
  useUpdateIncome: jest.fn(),
}));

jest.mock('../hooks/useFunds', () => ({
  useFunds: jest.fn(),
}));

jest.mock('../hooks/useIncomeApplications', () => ({
  useIncomeApplicationPlan: jest.fn(),
  useApplyIncomePolicy: jest.fn(),
  useCreateIncomeApplicationPlan: jest.fn(),
}));

jest.mock('@/shared/lib/format/money', () => ({
  formatCurrency: (value: number, currency: string) => `${currency} ${value}`,
}));

jest.mock('lucide-react', () => ({
  Loader2: () => <span>Loader2</span>,
  Plus: () => <span>Plus</span>,
  Save: () => <span>Save</span>,
  X: () => <span>X</span>,
}));

const mockedUseIncomes = jest.mocked(useExpenseLedger.useIncomes);
const mockedUseCategories = jest.mocked(useExpenseLedger.useExpenseLedgerCategories);
const mockedUseRecord = jest.mocked(useExpenseLedger.useRecordIncome);
const mockedUseVoid = jest.mocked(useExpenseLedger.useVoidIncome);
const mockedUseUpdate = jest.mocked(useExpenseLedger.useUpdateIncome);
const mockedUseFunds = jest.mocked(useFundsModule.useFunds);
const mockedUseIncomeApplicationPlan = jest.mocked(useIncomeApplicationsModule.useIncomeApplicationPlan);
const mockedUseApplyIncomePolicy = jest.mocked(useIncomeApplicationsModule.useApplyIncomePolicy);
const mockedUseCreateIncomeApplicationPlan = jest.mocked(useIncomeApplicationsModule.useCreateIncomeApplicationPlan);

const makeIncome = (overrides: Record<string, unknown> = {}) => ({
  id: 'income-1',
  tenantId: 'tenant-1',
  buildingId: 'building-1',
  period: '2026-08',
  categoryId: 'category-1',
  categoryName: 'Alquiler',
  scopeType: 'BUILDING',
  unitGroupId: null,
  destination: 'APPLY_TO_EXPENSES',
  amountMinor: 10000,
  currencyCode: 'ARS',
  receivedDate: '2026-08-10T00:00:00.000Z',
  description: null,
  attachmentFileKey: null,
  status: 'DRAFT',
  functionalAmountMinor: null,
  functionalCurrencyCode: null,
  exchangeRateId: null,
  exchangeRateValue: null,
  exchangeRateDirection: null,
  exchangeRateEffectiveAt: null,
  conversionDate: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const makePlan = (applications: unknown[] = []) => ({
  incomeId: 'income-1',
  currencyCode: 'ARS',
  totalAmountMinor: applications.reduce((sum, app) => sum + ((app as { amountMinor?: number }).amountMinor ?? 0), 0),
  applications,
});

const makeApplication = () => ({
  id: 'app-1', tenantId: 'tenant-1', incomeId: 'income-1', destinationType: 'OFFSET_EXPENSES',
  fundId: null, amountMinor: 10000, currencyCode: 'ARS', fundTransactionId: null,
  policyVersionId: null, legacyDestination: null, createdAt: '2026-08-01T00:00:00.000Z',
});

function renderIncomesTab(incomes: ReturnType<typeof makeIncome>[], plan?: unknown) {
  mockedUseIncomes.mockReturnValue({ data: incomes, isPending: false, error: null } as never);
  mockedUseCategories.mockReturnValue({ data: [{ id: 'category-1', name: 'Alquiler' }] } as never);
  mockedUseFunds.mockReturnValue({ data: [] } as never);
  mockedUseRecord.mockReturnValue({ mutateAsync: jest.fn(), isPending: false } as never);
  mockedUseVoid.mockReturnValue({ mutateAsync: jest.fn(), isPending: false } as never);
  const updateMutate = jest.fn().mockResolvedValue({});
  mockedUseUpdate.mockReturnValue({ mutateAsync: updateMutate, isPending: false } as never);
  mockedUseIncomeApplicationPlan.mockReturnValue({
    data: plan,
    isPending: plan === undefined ? true : false,
    error: null,
  } as never);
  mockedUseApplyIncomePolicy.mockReturnValue({ mutateAsync: jest.fn(), isPending: false } as never);
  mockedUseCreateIncomeApplicationPlan.mockReturnValue({ mutateAsync: jest.fn(), isPending: false } as never);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <IncomesTab tenantId="tenant-1" period="2026-08" />
    </QueryClientProvider>,
  );
  return { ...utils, updateMutate };
}

describe('IncomesTab income edit (FIN-07BR)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes Edit for a DRAFT income', () => {
    renderIncomesTab([makeIncome()]);
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
  });

  it('does not expose Edit for a RECORDED income', () => {
    renderIncomesTab([makeIncome({ status: 'RECORDED' })]);
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });

  it('does not expose Edit for a VOID income', () => {
    renderIncomesTab([makeIncome({ status: 'VOID' })]);
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });

  it('submits an exact amountMinor conversion on edit', async () => {
    const { updateMutate } = renderIncomesTab([makeIncome()]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    const amountInput = screen.getByPlaceholderText('Dejarlo vacío conserva el actual');
    fireEvent.change(amountInput, { target: { value: '123.45' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith({
        incomeId: 'income-1',
        data: expect.objectContaining({ amountMinor: 12345 }),
      });
    });
  });

  it('closes the dialog when nothing changed', async () => {
    const { updateMutate } = renderIncomesTab([makeIncome()]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    await waitFor(() => {
      expect(updateMutate).not.toHaveBeenCalled();
    });
  });
});

describe('IncomesTab allocated-income edit safety (FIN-07BR3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['TENANT_SHARED', 'UNIT_GROUP'] as const)('locks amount and currency for %s', (scopeType) => {
    renderIncomesTab([makeIncome({ scopeType })]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const amount = screen.getByPlaceholderText('No editable con asignaciones') as HTMLInputElement;
    const currency = screen.getByLabelText('Moneda') as HTMLSelectElement;
    expect(amount.disabled).toBe(true);
    expect(currency.disabled).toBe(true);
    expect(screen.getByText(/asignaciones por edificio/)).toBeTruthy();
  });

  it.each([['TENANT_SHARED', 10000, '100.00'], ['UNIT_GROUP', 5000, '50.00']] as const)(
    '%s disabled amount displays the decimal user value (not minor units)',
    (scopeType, amountMinor, expected) => {
      renderIncomesTab([makeIncome({ scopeType, amountMinor })]);
      fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
      const amount = screen.getByPlaceholderText('No editable con asignaciones') as HTMLInputElement;
      expect(amount.value).toBe(expected);
    },
  );

  it.each(['TENANT_SHARED', 'UNIT_GROUP'] as const)('%s PATCH never includes amountMinor or currencyCode', async (scopeType) => {
    const { updateMutate } = renderIncomesTab([makeIncome({ scopeType, description: 'vieja' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'nueva' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledTimes(1);
    });
    const data = updateMutate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.amountMinor).toBeUndefined();
    expect(data.currencyCode).toBeUndefined();
    expect(data.description).toBe('nueva');
  });

  it('keeps category/date/description editable for shared scopes', async () => {
    const { updateMutate } = renderIncomesTab([makeIncome({ scopeType: 'TENANT_SHARED' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Fecha recibida'), { target: { value: '2026-08-12' } });
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const data = updateMutate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.receivedDate).toBe('2026-08-12');
    expect(data.description).toBe('x');
    expect(data.categoryId).toBe('category-1');
  });

  it('allows BUILDING to PATCH currencyCode', async () => {
    const { updateMutate } = renderIncomesTab([makeIncome()]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect((updateMutate.mock.calls[0][0].data as Record<string, unknown>).currencyCode).toBe('USD');
  });
});

describe('IncomesTab description clear and date normalization (FIN-07BR3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears an existing Income description intentionally', async () => {
    const { updateMutate } = renderIncomesTab([makeIncome({ description: 'texto viejo' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect((updateMutate.mock.calls[0][0].data as Record<string, unknown>).description).toBe('');
  });

  it('does not manufacture a change for an unchanged null/empty description', async () => {
    const { updateMutate } = renderIncomesTab([makeIncome({ description: null })]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Fecha recibida'), { target: { value: '2026-08-12' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const data = updateMutate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.description).toBeUndefined();
    expect(data.receivedDate).toBe('2026-08-12');
  });

  it('renders the list date as YYYY-MM-DD, not raw ISO', () => {
    renderIncomesTab([makeIncome()]);
    expect(screen.getByText(/2026-08-10/)).toBeTruthy();
    expect(screen.queryByText(/2026-08-10T00:00:00/)).toBeNull();
  });

  it('initializes the edit date input to YYYY-MM-DD', () => {
    renderIncomesTab([makeIncome()]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect((screen.getByLabelText('Fecha recibida') as HTMLInputElement).value).toBe('2026-08-10');
  });

  it('sends a changed date as YYYY-MM-DD', async () => {
    const { updateMutate } = renderIncomesTab([makeIncome()]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Fecha recibida'), { target: { value: '2026-08-11' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const data = updateMutate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.receivedDate).toBe('2026-08-11');
  });

  it('does not send receivedDate when unchanged', async () => {
    const { updateMutate } = renderIncomesTab([makeIncome()]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'nuevo' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const data = updateMutate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.receivedDate).toBeUndefined();
  });
});

describe('IncomesTab plan state machine (FIN-07BR3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('VOID with empty plan does not say "Plan aplicado" nor expose creation', () => {
    renderIncomesTab([makeIncome({ status: 'VOID' })], makePlan([]));
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(screen.queryByText(/Plan aplicado\. Solo lectura/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Guardar plan manual/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Aplicar política/ })).toBeNull();
    expect(screen.getByText(/anulado y no tiene plan de aplicaciones/)).toBeTruthy();
  });

  it('VOID with existing applications shows the historical read-only plan', () => {
    renderIncomesTab([makeIncome({ status: 'VOID' })], makePlan([makeApplication()]));
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(screen.getByText(/Plan aplicado\. Solo lectura/)).toBeTruthy();
  });

  it('RECORDED with empty plan exposes the application builder', () => {
    renderIncomesTab([makeIncome({ status: 'RECORDED' })], makePlan([]));
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(screen.getByRole('button', { name: /Aplicar política/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Guardar plan manual/ })).toBeTruthy();
  });

  it('DRAFT requires record first', () => {
    renderIncomesTab([makeIncome()], makePlan([]));
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(screen.getByText(/Registrá este ingreso antes de definir su plan/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Guardar plan manual/ })).toBeNull();
  });
});
