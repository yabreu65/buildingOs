const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Formats a Date into period format YYYY-MM.
 */
export function formatPeriod(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Shifts a period (YYYY-MM) by delta months (can be negative).
 */
export function shiftPeriod(period: string, deltaMonths: number): string {
  const { year, month } = parsePeriod(period);
  const shifted = new Date(year, month - 1 + deltaMonths, 1);
  return formatPeriod(shifted);
}

/**
 * Returns the last N complete periods, optionally excluding current month.
 * Output is ordered ascending (oldest -> newest).
 */
export function getLastCompletePeriods(
  asOf: Date,
  n: number,
  excludeCurrent: boolean,
): string[] {
  const safeN = Math.max(0, Math.floor(n));
  if (safeN === 0) return [];

  const currentPeriod = formatPeriod(asOf);
  const endPeriod = excludeCurrent ? shiftPeriod(currentPeriod, -1) : currentPeriod;
  const startPeriod = shiftPeriod(endPeriod, -(safeN - 1));

  return Array.from({ length: safeN }, (_, index) => shiftPeriod(startPeriod, index));
}

/**
 * Returns all period buckets (YYYY-MM) touched by a date range.
 */
export function getPeriodsBetweenDates(startDate: Date, endDate: Date): string[] {
  const periods: string[] = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= endCursor) {
    periods.push(formatPeriod(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return periods;
}

/**
 * Returns the full date range for a business period (YYYY-MM).
 */
export function getPeriodDateRange(period: string): { startDate: Date; endDate: Date } {
  const { year, month } = parsePeriod(period);
  return {
    startDate: new Date(year, month - 1, 1, 0, 0, 0, 0),
    endDate: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

function parsePeriod(period: string): { year: number; month: number } {
  if (!PERIOD_REGEX.test(period)) {
    throw new Error(`Invalid period format: ${period}. Expected YYYY-MM`);
  }

  const [yearPart, monthPart] = period.split('-');
  return {
    year: Number(yearPart),
    month: Number(monthPart),
  };
}

