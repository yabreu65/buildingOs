/**
 * FIN-07BR3: resolución del default de moneda.
 *
 * Precedencia:
 * 1. financeSettings.functionalCurrency (solo si pertenece al canon)
 * 2. CANONICAL_CURRENCIES[0] como fallback técnico
 *
 * Nunca hardcodear ARS/USD/VES/COP como default de negocio.
 */
export function resolveDefaultCurrency(
  functionalCurrency: string | null | undefined,
  canonical: readonly string[],
): string {
  if (functionalCurrency && canonical.includes(functionalCurrency)) {
    return functionalCurrency;
  }
  return canonical[0] ?? '';
}
