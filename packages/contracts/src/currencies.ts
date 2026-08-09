export const CANONICAL_CURRENCIES = ['USD', 'VES', 'ARS', 'COP'] as const;

export type CanonicalCurrency = (typeof CANONICAL_CURRENCIES)[number];

export function isCanonicalCurrency(value: unknown): value is CanonicalCurrency {
  return typeof value === 'string' && CANONICAL_CURRENCIES.some((currency) => currency === value);
}
