/**
 * Convierte un índice numérico a alias tipo Excel.
 *
 * Reglas:
 * - 1  → A
 * - 2  → B
 * - 26 → Z
 * - 27 → AA
 * - 28 → AB
 * - 52 → AZ
 * - 53 → BA
 * - 702 → ZZ
 * - 703 → AAA
 *
 * @param index - Índice numérico (1-based)
 * @returns Alias alfabético (A, B, C... Z, AA, AB...)
 * @throws Error si index <= 0
 */
export function aliasFromIndex(index: number): string {
  if (index <= 0) {
    throw new Error('Index must be greater than 0');
  }

  let result = '';
  let n = index;

  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }

  return result;
}
