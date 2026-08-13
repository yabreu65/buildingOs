import { formatCurrency, formatNumber } from './money';

export interface DisplayCurrencyBucket {
  readonly currency: string;
  readonly amountMinor: number;
}

export interface DisplayRateBucket {
  readonly currency: string;
  readonly rate: number;
}

/**
 * Format a single bucket amount. Legacy report currencies such as UYU
 * format normally; a malformed historical code (for example "US" or an
 * empty string) must never throw while rendering the report — it is shown
 * as a plain amount with its raw code instead.
 */
function formatBucketAmount(amountMinor: number, currency: string): string {
  try {
    return formatCurrency(amountMinor, currency);
  } catch {
    return currency ? `${formatNumber(amountMinor)} ${currency}` : formatNumber(amountMinor);
  }
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
  return buckets.map((bucket) => formatBucketAmount(bucket.amountMinor, bucket.currency)).join(' · ');
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
