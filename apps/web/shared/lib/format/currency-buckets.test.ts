import { formatCurrencyBuckets, formatRateBuckets } from './currency-buckets';

describe('formatCurrencyBuckets', () => {
  it('renders a single ARS bucket', () => {
    const result = formatCurrencyBuckets([{ currency: 'ARS', amountMinor: 10000 }]);
    expect(result).toContain('100');
    expect(result).not.toContain('·');
  });

  it('renders ARS + USD as two separate values', () => {
    const result = formatCurrencyBuckets([
      { currency: 'ARS', amountMinor: 12500 },
      { currency: 'USD', amountMinor: 6000 },
    ]);
    expect(result).toContain('125');
    expect(result).toContain('60');
    expect(result).toContain('·');
    // No combined scalar total is ever produced (12500+6000=18500).
    expect(result).not.toContain('185');
  });

  it('renders all four currencies separately and preserves backend order', () => {
    const result = formatCurrencyBuckets([
      { currency: 'USD', amountMinor: 100 },
      { currency: 'VES', amountMinor: 200 },
      { currency: 'ARS', amountMinor: 300 },
      { currency: 'COP', amountMinor: 400 },
    ]);
    expect(result.split('·')).toHaveLength(4);
    // Backend canonical order is USD first, COP last: their formatted
    // amounts must appear in that relative order in the output.
    expect(result.indexOf('1')).toBeLessThan(result.indexOf('4'));
    // No mixed scalar total (100+200+300+400=1000).
    expect(result).not.toContain('1000');
  });

  it('renders empty buckets with an empty representation', () => {
    expect(formatCurrencyBuckets([])).toBe('—');
    expect(formatCurrencyBuckets(null)).toBe('—');
    expect(formatCurrencyBuckets(undefined)).toBe('—');
  });

  it('renders a historical legacy currency (UYU) explicitly — display only', () => {
    const result = formatCurrencyBuckets([{ currency: 'UYU', amountMinor: 500000 }]);
    expect(result).toContain('UYU');
    expect(result).toContain('5.000');
  });

  it('renders canonical and legacy buckets together without mixing', () => {
    const result = formatCurrencyBuckets([
      { currency: 'ARS', amountMinor: 10000 },
      { currency: 'UYU', amountMinor: 500000 },
    ]);
    expect(result).toContain('100,00');
    expect(result).toContain('UYU');
    expect(result).toContain('5.000,00');
    expect(result.split('·')).toHaveLength(2);
  });

  it('renders malformed historical currency codes without throwing', () => {
    const result = formatCurrencyBuckets([
      { currency: 'US', amountMinor: 12345 },
      { currency: '', amountMinor: 67890 },
    ]);
    expect(result).toContain('123,45 US');
    expect(result).toContain('678,90');
  });

  it('renders a legacy code Intl accepts but is not canonical', () => {
    const result = formatCurrencyBuckets([{ currency: 'FOO', amountMinor: 1000 }]);
    expect(result).toContain('10,00');
  });
});

describe('formatRateBuckets', () => {
  it('renders one rate per currency, never blended', () => {
    const result = formatRateBuckets([
      { currency: 'USD', rate: 40 },
      { currency: 'ARS', rate: 13 },
    ]);
    expect(result).toBe('40% USD · 13% ARS');
  });

  it('renders empty buckets with an empty representation', () => {
    expect(formatRateBuckets([])).toBe('—');
    expect(formatRateBuckets(null)).toBe('—');
    expect(formatRateBuckets(undefined)).toBe('—');
  });
});
