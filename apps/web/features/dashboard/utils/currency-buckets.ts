import { formatCurrency } from '@/shared/lib/format/money';

export interface DisplayCurrencyBucket {
  readonly currency: string;
  readonly amountMinor: number;
}

/**
 * Render a currency bucket list (minor units) as compact lines, one per
 * currency, in the order provided by the backend (canonical currency order).
 * Never sums different currencies into a single nominal total.
 */
export const formatCurrencyBuckets = (
  buckets: readonly DisplayCurrencyBucket[] | null | undefined,
): string => {
  if (!buckets || buckets.length === 0) {
    return '—';
  }
  return buckets
    .map((bucket) => formatCurrency(bucket.amountMinor, bucket.currency))
    .join(' · ');
};
