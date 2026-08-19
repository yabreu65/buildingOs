import { HttpError } from '@/shared/lib/http/client';

/**
 * FIN-07C: traduce códigos de dominio de liquidación (campo `error` de la
 * respuesta 422) a mensajes accionables. No exponer stack traces ni texto
 * interno del backend.
 */

const LIQUIDATION_DOMAIN_MESSAGES: Record<string, string> = {
  LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS:
    'Los ingresos aplicados superan el subtotal distribuible. Verificá los ingresos del período.',
  LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH:
    'No se puede aplicar un ingreso en otra moneda en una liquidación nominal. Ajustá la moneda o la valuación funcional.',
  LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED:
    'Falta la valuación funcional congelada para completar la liquidación. Verificá la configuración multicurrency.',
  LIQUIDATION_INCOME_SOURCE_DRIFT:
    'Las fuentes financieras congeladas ya no coinciden con el borrador. Cancelá y regenerá la liquidación para mayor seguridad.',
  LIQUIDATION_BASE_CURRENCY_MISMATCH:
    'La moneda base de la liquidación no coincide con la esperada.',
  MIXED_CURRENCY_LIQUIDATION_NOT_SUPPORTED:
    'No se soportan liquidaciones con gastos en múltiples monedas sin valuación funcional.',
  LIQUIDATION_PUBLICATION_SOURCE_DRIFT:
    'Las fuentes de publicación ya no coinciden con el borrador. Cancelá y regenerá la liquidación.',
};

/**
 * Devuelve un mensaje de error amigable para errores de dominio de liquidación.
 * Si el error no es de dominio, conserva el mensaje original del error.
 */
export function liquidationDomainErrorMessage(
  err: unknown,
  fallback: string,
): string {
  if (err instanceof HttpError && err.data) {
    const code = err.data.error ?? err.data.code;
    if (typeof code === 'string' && code in LIQUIDATION_DOMAIN_MESSAGES) {
      return LIQUIDATION_DOMAIN_MESSAGES[code];
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}
