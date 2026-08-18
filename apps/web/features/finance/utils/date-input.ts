/**
 * FIN-07BR3: normalización de fechas tipo date input (YYYY-MM-DD).
 *
 * El backend serializa Income.receivedDate como ISO (p.ej. 2026-08-10T00:00:00.000Z),
 * pero un <input type="date"> requiere YYYY-MM-DD. Recortar prefix es seguro
 * porque la plataforma trabaja con fechas calendario (sin semántica de instante).
 */
export function toDateInputValue(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, 10);
}

/**
 * True si el valor editado representa la misma fecha que el original
 * (comparación normalizada; evita "changes" espurios por offsets ISO).
 */
export function sameDateInput(edited: string, original: string): boolean {
  return toDateInputValue(edited) === toDateInputValue(original);
}

/**
 * YYYY-MM-DD desde los componentes de calendario LOCAL del Date dado.
 *
 * NO usar toISOString() para "hoy": toISOString es UTC y puede devolver
 * el día siguiente en timezones UTC-negativas durante la tarde/noche.
 */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Fecha de calendario local de "hoy" (o del Date provisto) en YYYY-MM-DD. */
export function todayLocalDate(now: Date = new Date()): string {
  return toLocalDateString(now);
}
