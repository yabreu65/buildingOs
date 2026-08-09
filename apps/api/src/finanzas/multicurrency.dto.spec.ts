import { validate } from 'class-validator';
import { CreateExchangeRateDto, UpdateFinanceSettingsDto } from './multicurrency.dto';

describe('multicurrency DTO validation', () => {
  it.each(['USD', 'VES', 'ARS', 'COP'])('accepts functional currency %s', async (currency) => {
    const value = Object.assign(new UpdateFinanceSettingsDto(), { functionalCurrency: currency });
    await expect(validate(value)).resolves.toHaveLength(0);
  });

  it('rejects an unknown functional currency', async () => {
    const value = Object.assign(new UpdateFinanceSettingsDto(), { functionalCurrency: 'EUR' });
    expect(await validate(value)).not.toHaveLength(0);
  });

  it.each(['0', '-1', '1.1234567890123'])('rejects invalid rate %s', async (rate) => {
    const value = Object.assign(new CreateExchangeRateDto(), { baseCurrency: 'USD', quoteCurrency: 'VES', rate, effectiveAt: '2026-08-09T00:00:00.000Z' });
    expect(await validate(value)).not.toHaveLength(0);
  });

  it('rejects invalid currencies and effective dates', async () => {
    const value = Object.assign(new CreateExchangeRateDto(), { baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: '1', effectiveAt: 'not-a-date' });
    expect(await validate(value)).toHaveLength(3);
  });
});
