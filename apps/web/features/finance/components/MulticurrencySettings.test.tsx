/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MulticurrencySettings } from './MulticurrencySettings';
import * as api from '../services/multicurrency.api';
import { can } from '@/features/rbac/rbac.permissions';
import * as rbacHooks from '@/features/rbac/rbac.hooks';
import type { Role } from '@buildingos/contracts';

jest.mock('../services/multicurrency.api');
jest.mock('@/features/rbac/rbac.hooks', () => ({ useCan: jest.fn() }));
jest.mock('@buildingos/contracts', () => ({ CANONICAL_CURRENCIES: ['USD', 'VES', 'ARS', 'COP'] }));
const mockedApi = jest.mocked(api);
const mockedUseCan = jest.mocked(rbacHooks.useCan);

function renderSubject(role: Role = 'TENANT_ADMIN') {
  mockedUseCan.mockImplementation((permission) => can(role, permission));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MulticurrencySettings tenantId="tenant-1" /></QueryClientProvider>);
}

describe('MulticurrencySettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getFinanceSettings.mockResolvedValue({ functionalCurrency: 'VES' });
    mockedApi.listExchangeRates.mockResolvedValue([]);
    mockedApi.updateFinanceSettings.mockResolvedValue({ functionalCurrency: 'COP' });
    mockedApi.createExchangeRate.mockResolvedValue({ id: 'rate-1', baseCurrency: 'USD', quoteCurrency: 'VES', rate: '36.5', effectiveAt: '2026-08-09T00:00:00.000Z', source: null });
    mockedApi.updateExchangeRate.mockResolvedValue({ id: 'rate-1', baseCurrency: 'USD', quoteCurrency: 'VES', rate: '40.25', effectiveAt: '2026-08-10T00:00:00.000Z', source: 'Market' });
  });

  it('shows loading, all four currencies, loaded functional currency and empty rates', async () => {
    renderSubject();
    expect(screen.getByText(/Cargando configuración/)).toBeTruthy();
    await screen.findByText('No hay tasas registradas.');
    expect((screen.getByLabelText('Moneda funcional') as HTMLSelectElement).value).toBe('VES');
    for (const currency of ['USD', 'VES', 'ARS', 'COP']) expect(screen.getAllByRole('option', { name: currency }).length).toBeGreaterThan(0);
  });

  it('updates functional currency and shows success', async () => {
    renderSubject();
    await screen.findByText('No hay tasas registradas.');
    fireEvent.change(screen.getByLabelText('Moneda funcional'), { target: { value: 'COP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mockedApi.updateFinanceSettings).toHaveBeenCalledWith('tenant-1', 'COP'));
    expect(await screen.findByText('Moneda funcional actualizada.')).toBeTruthy();
  });

  it('rejects an exchange rate with the same currency pair', async () => {
    renderSubject();
    await screen.findByText('No hay tasas registradas.');
    fireEvent.change(screen.getByLabelText('Destino'), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('Tasa'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Fecha efectiva'), { target: { value: '2026-08-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar tasa' }));
    expect(screen.getByText('Origen y destino deben ser diferentes.')).toBeTruthy();
    expect(mockedApi.createExchangeRate).not.toHaveBeenCalled();
  });

  it.each(['1', '36.5', '0.50', '0.1', '0.000000000001', '9999999999999999', '9999999999999999.123456789012'])('accepts rate %s and preserves its string payload', async (rate) => {
    renderSubject();
    await screen.findByText('No hay tasas registradas.');
    fireEvent.change(screen.getByLabelText('Tasa'), { target: { value: rate } });
    fireEvent.change(screen.getByLabelText('Fecha efectiva'), { target: { value: '2026-08-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar tasa' }));
    await waitFor(() => expect(mockedApi.createExchangeRate).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ rate })));
  });

  it.each([
    ['0', 'La tasa debe ser mayor que cero.'],
    ['0.0', 'La tasa debe ser mayor que cero.'],
    ['0.000000000000', 'La tasa debe ser mayor que cero.'],
    ['-1', 'La tasa debe ser mayor que cero.'],
    ['-0.50', 'La tasa debe ser mayor que cero.'],
    ['+0', 'La tasa debe ser mayor que cero.'],
    ['99999999999999999', 'La tasa debe ser mayor que cero.'],
    ['1.1234567890123', 'La tasa debe ser mayor que cero.'],
    ['abc', 'La tasa debe ser mayor que cero.'],
    ['', 'La tasa es obligatoria.'],
    ['.50', 'La tasa debe ser mayor que cero.'],
  ])('rejects rate %s', async (rate, message) => {
    renderSubject();
    await screen.findByText('No hay tasas registradas.');
    fireEvent.change(screen.getByLabelText('Tasa'), { target: { value: rate } });
    fireEvent.change(screen.getByLabelText('Fecha efectiva'), { target: { value: '2026-08-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar tasa' }));
    expect(screen.getByText(message)).toBeTruthy();
    expect(mockedApi.createExchangeRate).not.toHaveBeenCalled();
  });

  it('shows API loading errors', async () => {
    mockedApi.getFinanceSettings.mockRejectedValue(new Error('network failed'));
    renderSubject();
    expect(await screen.findByText(/network failed/)).toBeTruthy();
  });

  it('lists and edits history without sending currencies in PATCH', async () => {
    mockedApi.listExchangeRates.mockResolvedValue([{ id: 'rate-1', baseCurrency: 'USD', quoteCurrency: 'VES', rate: '36.5', effectiveAt: '2026-08-09T00:00:00.000Z', source: 'Central bank' }]);
    renderSubject();
    await screen.findByText('Central bank');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Tasa'), { target: { value: '40.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(mockedApi.updateExchangeRate).toHaveBeenCalledWith('tenant-1', 'rate-1', expect.objectContaining({ rate: '40.25' })));
    const payload = mockedApi.updateExchangeRate.mock.calls[0][2];
    expect(payload).not.toHaveProperty('baseCurrency');
    expect(payload).not.toHaveProperty('quoteCurrency');
  });

  it('shows data without mutation controls for an OPERATOR', async () => {
    mockedApi.listExchangeRates.mockResolvedValue([{ id: 'rate-1', baseCurrency: 'USD', quoteCurrency: 'VES', rate: '36.5', effectiveAt: '2026-08-09T00:00:00.000Z', source: 'Central bank' }]);
    renderSubject('OPERATOR');
    await screen.findByText('Central bank');
    expect(screen.getAllByText('VES')).not.toHaveLength(0);
    expect(screen.getByText('09/08/2026')).toBeTruthy();
    expect(screen.queryByLabelText('Moneda funcional')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar tasa' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });

  it.each<Role>(['TENANT_ADMIN', 'TENANT_OWNER'])('allows %s to mutate using canonical permissions', async (role) => {
    mockedApi.listExchangeRates.mockResolvedValue([{ id: 'rate-1', baseCurrency: 'USD', quoteCurrency: 'VES', rate: '36.5', effectiveAt: '2026-08-09T00:00:00.000Z', source: null }]);
    renderSubject(role);
    await screen.findByText('09/08/2026');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agregar tasa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
  });
});
