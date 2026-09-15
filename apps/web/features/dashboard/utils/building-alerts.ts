import { CANONICAL_CURRENCIES, isCanonicalCurrency } from '@buildingos/contracts';
import type { BuildingAlert, CurrencyAmountBucket } from '../services/dashboard.api';

export const getTotalAccumulatedDebtByCurrency = (
  buildingAlerts: BuildingAlert[],
): CurrencyAmountBucket[] => {
  const totals = new Map<string, number>();

  for (const alert of buildingAlerts) {
    for (const bucket of alert.outstandingByCurrency) {
      totals.set(bucket.currency, (totals.get(bucket.currency) ?? 0) + bucket.amountMinor);
    }
  }

  const buckets = Array.from(totals, ([currency, amountMinor]) => ({ currency, amountMinor }));

  return buckets.sort((a, b) => {
    if (isCanonicalCurrency(a.currency)) {
      return isCanonicalCurrency(b.currency)
        ? CANONICAL_CURRENCIES.indexOf(a.currency) - CANONICAL_CURRENCIES.indexOf(b.currency)
        : -1;
    }
    return isCanonicalCurrency(b.currency) ? 1 : a.currency.localeCompare(b.currency);
  });
};
