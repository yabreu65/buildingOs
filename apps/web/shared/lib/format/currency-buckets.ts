import { formatCurrency } from './money';

export interface DisplayCurrencyBucket {
  readonly currency: string;
  readonly amountMinor: number;
}

export interface DisplayRateBucket {
  readonly currency: string;
  readonly rate: number;
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

/**
 * Render per-currency rate buckets as compact lines, one per currency, in
 * the order provided by the backend. Never blends rates into a single value.
 */
export const formatRateBuckets = (
  buckets: readonly DisplayRateBucket[] | null | undefined,
): string => {
  if (!buckets || buckets.length === 0) {
    return '—';
  }
  return buckets.map((bucket) => `${bucket.rate}% ${bucket.currency}`).join(' · ');
};
