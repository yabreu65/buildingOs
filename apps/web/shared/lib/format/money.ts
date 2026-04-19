/**
 * Currency formatting utilities
 * All financial amounts in the system are stored in cents (e.g., 10000 = $100.00)
 * Use these helpers to properly display amounts
 * 
 * CONTRACT: All amounts from API are in minor units (cents)
 * - Never use toFixed() or Intl.NumberFormat directly on money fields
 * - Always use formatCurrency() for display
 * - Fields from API should be named with *Minor suffix when ambiguous
 * 
 * @example
 * // BAD (causes bugs like 3309.00 instead of 33.09)
 * <td>{amount.toFixed(2)}</td>
 * 
 * // GOOD
 * <td>{formatCurrency(amount, currency)}</td>
 */

const DEFAULT_LOCALE = 'es-AR';
const DEFAULT_CURRENCY = 'ARS';

/**
 * Map currency codes to their appropriate locales
 */
const CURRENCY_LOCALE_MAP: Record<string, string> = {
  'ARS': 'es-AR',  // Argentine Peso
  'VES': 'es-VE',  // Venezuelan Bolívar
  'USD': 'en-US',  // US Dollar
};

/**
 * Get the appropriate locale for a given currency
 * @param currency - Currency code (e.g., ARS, VES, USD)
 * @returns Locale string for use with Intl.NumberFormat
 */
export function getLocaleForCurrency(currency: string): string {
  return CURRENCY_LOCALE_MAP[currency] || DEFAULT_LOCALE;
}

/**
 * Format amount in cents to currency string
 * @param cents - Amount stored in cents (e.g., 3500000 = $35,000.00)
 * @param currency - Currency code (default: ARS)
 * @param locale - Locale for formatting (default: es-AR)
 */
export function formatCurrency(
  cents: number,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Format amount in cents to simple number string (no currency symbol)
 * @param cents - Amount stored in cents
 * @param locale - Locale for formatting
 */
export function formatNumber(cents: number, locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Convert user input (in currency units) to cents for storage
 * @param amount - Amount in currency units (e.g., 35000)
 * @returns Amount in cents (e.g., 3500000)
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convert cents to currency units for display/editing
 * @param cents - Amount in cents
 * @returns Amount in currency units
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Legacy function - use formatCurrency instead
 * @deprecated Use formatCurrency for amounts from API (stored in cents)
 */
export function formatMoney(amount: number, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}
