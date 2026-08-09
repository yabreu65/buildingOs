import { CANONICAL_CURRENCIES, isCanonicalCurrency } from '@buildingos/contracts';

describe('canonical currencies contract', () => {
  it.each(CANONICAL_CURRENCIES)('accepts %s', (currency) => {
    expect(isCanonicalCurrency(currency)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isCanonicalCurrency('EUR')).toBe(false);
  });
});
