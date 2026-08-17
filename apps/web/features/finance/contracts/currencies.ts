import { CANONICAL_CURRENCIES, type CanonicalCurrency } from '@buildingos/contracts';

// Platform-accepted currencies, not a tenant-specific allowlist.
export { CANONICAL_CURRENCIES } from '@buildingos/contracts';
export type { CanonicalCurrency } from '@buildingos/contracts';

export function isFinanceCurrency(value: unknown): value is CanonicalCurrency {
  return typeof value === 'string' && CANONICAL_CURRENCIES.some((currency) => currency === value);
}
