import { CANONICAL_CURRENCIES, isCanonicalCurrency } from '@buildingos/contracts';

/**
 * Shared backend report-side currency bucket helpers (Phase 3F).
 *
 * Reportable currency = the currency string as stored on the charge.
 * Canonical write currencies (USD/VES/ARS/COP) come first in canonical
 * order; historical legacy currencies (e.g. UYU) or malformed historical
 * codes are preserved explicitly in their own bucket — never converted,
 * never renamed, never summed across currencies.
 */

export interface ReportCurrencyAmountBucket {
  readonly currency: string;
  readonly amountMinor: number;
}

export interface ReportCurrencyInput {
  readonly currency: string;
  readonly amountMinor: number;
}

/**
 * Deterministic report-side ordering: canonical currencies first in
 * canonical order, then any other currency in lexicographic order.
 * Never converts or compares values across currencies.
 */
export function compareReportCurrencies(a: string, b: string): number {
  if (isCanonicalCurrency(a)) {
    return isCanonicalCurrency(b)
      ? CANONICAL_CURRENCIES.indexOf(a) - CANONICAL_CURRENCIES.indexOf(b)
      : -1;
  }
  return isCanonicalCurrency(b) ? 1 : a.localeCompare(b);
}

/**
 * Aggregate integer minor amounts grouped by currency into explicit
 * buckets, ordered deterministically (canonical first, then legacy
 * lexicographic). Never converts, never sums across currencies.
 */
export function aggregateReportBuckets(
  entries: readonly ReportCurrencyInput[],
): ReportCurrencyAmountBucket[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.amountMinor);
  }
  return Array.from(totals.entries())
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => compareReportCurrencies(a.currency, b.currency));
}

/**
 * Render a single bucket amount for report output (email, CSV-like text).
 * Legacy report currencies such as UYU format normally; a malformed
 * historical code (e.g. "US" or an empty string) must never throw — it is
 * rendered as a plain number with its raw code (escaping is the caller's
 * responsibility).
 */
export function formatCurrencySafe(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    const major = (amountMinor / 100).toFixed(2);
    return currency ? `${major} ${currency}` : major;
  }
}
