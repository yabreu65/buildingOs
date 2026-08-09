/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MulticurrencySettings } from './MulticurrencySettings';
import * as api from '../services/multicurrency.api';

jest.mock('../services/multicurrency.api');
jest.mock('@buildingos/contracts', () => ({ CANONICAL_CURRENCIES: ['USD', 'VES', 'ARS', 'COP'] }));
const mockedApi = jest.mocked(api);

function renderSubject() {
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

  it.each([
    ['same pair', 'Origen y destino deben ser diferentes.', { destination: 'USD', rate: '1' }],
    ['required rate', 'La tasa es obligatoria.', { destination: 'VES', rate: '' }],
    ['positive rate', 'La tasa debe ser mayor que cero.', { destination: 'VES', rate: '0' }],
  ])('validates %s', async (_name, message, values) => {
    renderSubject();
    await screen.findByText('No hay tasas registradas.');
    fireEvent.change(screen.getByLabelText('Destino'), { target: { value: values.destination } });
    fireEvent.change(screen.getByLabelText('Tasa'), { target: { value: values.rate } });
    fireEvent.change(screen.getByLabelText('Fecha efectiva'), { target: { value: '2026-08-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar tasa' }));
    expect(screen.getByText(message)).toBeTruthy();
    expect(mockedApi.createExchangeRate).not.toHaveBeenCalled();
  });

  it('creates a rate while preserving its decimal string payload', async () => {
    renderSubject();
    await screen.findByText('No hay tasas registradas.');
    fireEvent.change(screen.getByLabelText('Tasa'), { target: { value: '36.500000000001' } });
    fireEvent.change(screen.getByLabelText('Fecha efectiva'), { target: { value: '2026-08-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar tasa' }));
    await waitFor(() => expect(mockedApi.createExchangeRate).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ rate: '36.500000000001' })));
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
});
