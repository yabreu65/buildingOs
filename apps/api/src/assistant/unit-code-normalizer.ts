export interface UnitCodeNormalizationResult {
  raw: string;
  normalized: string;
  candidates: string[];
}

export class UnitCodeNormalizer {
  static normalize(rawInput: string): UnitCodeNormalizationResult {
    const raw = (rawInput || '').trim();
    const normalized = raw
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/\s+/g, ' ')
      .toUpperCase();

    const candidates = new Set<string>();
    if (!normalized) {
      return { raw, normalized, candidates: [] };
    }

    candidates.add(normalized);
    candidates.add(normalized.replace(/-/g, ''));

    // Variantes: espacios vs guion vs compacto (ej: "A 0123")
    if (normalized.includes(' ')) {
      candidates.add(normalized.replace(/\s+/g, '-'));
      candidates.add(normalized.replace(/\s+/g, ''));
    }

    // Variantes: compacto letra+digitos -> con guion (ej: A0123 -> A-0123)
    const compactLetterDigits = normalized.match(/^([A-Z]{1,3})(\d{2,5})$/);
    if (compactLetterDigits && compactLetterDigits[1] && compactLetterDigits[2]) {
      candidates.add(`${compactLetterDigits[1]}-${compactLetterDigits[2]}`);
      candidates.add(compactLetterDigits[2]);
    }

    // Variante opaca con prefijo de letra/torre (ej: A-0123 -> 0123)
    const prefixedHyphenDigits = normalized.match(/^[A-Z]{1,3}-(\d{2,5})$/);
    if (prefixedHyphenDigits && prefixedHyphenDigits[1]) {
      candidates.add(prefixedHyphenDigits[1]);
    }

    // Variantes: estilo bloque (A1-123) -> 0123 (para tenants que guardan numérico)
    const blockStyle = normalized.match(/^([A-Z])(\d{1,2})-(\d{2,4})$/);
    if (blockStyle && blockStyle[3]) {
      candidates.add(blockStyle[3].padStart(4, '0'));
    }

    // Variante numérica con padding
    if (/^\d{1,4}$/.test(normalized)) {
      candidates.add(normalized.padStart(4, '0'));
    }

    return {
      raw,
      normalized,
      candidates: Array.from(candidates),
    };
  }
}
