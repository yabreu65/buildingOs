/**
 * The platform currently stores every supported currency in two minor units.
 * Keep user-entered decimal text out of financial calculations until this
 * conversion succeeds.
 */
export function decimalToAmountMinor(value: string): number | null {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null;
  if (whole > Math.floor((Number.MAX_SAFE_INTEGER - fraction) / 100)) return null;

  const amountMinor = whole * 100 + fraction;
  return amountMinor > 0 && Number.isSafeInteger(amountMinor) ? amountMinor : null;
}

export function percentageToBasisPoints(value: string): number | null {
  const normalized = value.trim();
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = whole * 100 + fraction;
  return basisPoints >= 1 && basisPoints <= 10000 ? basisPoints : null;
}

export function sumAmountMinor(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) return null;
    total += value;
  }
  return total;
}

/**
 * Convierte amountMinor (entero de la plataforma) a su representación
 * decimal de entrada, p.ej. 10000 -> "100.00", 12345 -> "123.45", 1 -> "0.01".
 *
 * Operaciones enteras/string exactas: sin parseInt de floats, sin Math.round,
 * sin aritmética float sobre dinero.
 */
export function minorToDecimalString(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return '';
  const whole = Math.floor(amountMinor / 100);
  const fraction = amountMinor - whole * 100;
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}
