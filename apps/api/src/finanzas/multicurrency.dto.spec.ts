import { validate } from 'class-validator';
import { CreateExchangeRateDto, UpdateExchangeRateDto, UpdateFinanceSettingsDto } from './multicurrency.dto';

describe('multicurrency DTO validation', () => {
  it.each(['USD', 'VES', 'ARS', 'COP'])('accepts functional currency %s', async (currency) => {
    const value = Object.assign(new UpdateFinanceSettingsDto(), { functionalCurrency: currency });
    await expect(validate(value)).resolves.toHaveLength(0);
  });

  it('rejects an unknown functional currency', async () => {
    const value = Object.assign(new UpdateFinanceSettingsDto(), { functionalCurrency: 'EUR' });
    expect(await validate(value)).not.toHaveLength(0);
  });

  describe.each([
    ['create', CreateExchangeRateDto, { baseCurrency: 'USD', quoteCurrency: 'VES' }],
    ['update', UpdateExchangeRateDto, {}],
  ] as const)('%s exchange rate', (_operation, Dto, additionalFields) => {
    it.each(['1', '36.5', '0.50', '0.000000000001', '9999999999999999', '9999999999999999.123456789012'])('accepts rate %s', async (rate) => {
      const value = Object.assign(new Dto(), additionalFields, { rate, effectiveAt: '2026-08-09T00:00:00.000Z' });
      await expect(validate(value)).resolves.toHaveLength(0);
    });

    it.each(['99999999999999999', '1.1234567890123', '0', '-1', '+0'])('rejects rate %s', async (rate) => {
      const value = Object.assign(new Dto(), additionalFields, { rate, effectiveAt: '2026-08-09T00:00:00.000Z' });
      expect(await validate(value)).not.toHaveLength(0);
    });
  });

  it('rejects invalid currencies and effective dates', async () => {
    const value = Object.assign(new CreateExchangeRateDto(), { baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: '1', effectiveAt: 'not-a-date' });
    expect(await validate(value)).toHaveLength(3);
  });
});
