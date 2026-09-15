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

  return Array.from(totals, ([currency, amountMinor]) => ({ currency, amountMinor }));
};
