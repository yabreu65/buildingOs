import { resolveDefaultCurrency } from './currency-default';

const CANON = ['ARS', 'USD', 'VES', 'COP'] as const;

describe('resolveDefaultCurrency', () => {
  it('uses the configured functional currency', () => {
    expect(resolveDefaultCurrency('USD', CANON)).toBe('USD');
    expect(resolveDefaultCurrency('VES', CANON)).toBe('VES');
    expect(resolveDefaultCurrency('COP', CANON)).toBe('COP');
  });

  it('falls back to the first canonical currency when settings are absent', () => {
    expect(resolveDefaultCurrency(undefined, CANON)).toBe('ARS');
    expect(resolveDefaultCurrency(null, CANON)).toBe('ARS');
  });

  it('ignores an unknown functional currency and falls back to canonical', () => {
    expect(resolveDefaultCurrency('EUR' as string, CANON)).toBe('ARS');
  });
});
