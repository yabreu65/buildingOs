/**
 * AssistantQueryParser
 *
 * Centraliza TODO el parsing de lenguaje natural para preguntas operativas
 * del asistente de BuildingOS.
 *
 * Responsabilidades:
 * - Extraer tokens de unidad y edificio de mensajes en español/inglés
 * - Matching fuzzy contra datos reales de la DB
 * - Normalización de texto (minúsculas, sin acentos, sin guiones extraños)
 * - Sinónimos configurables (no hardcodeados en regex dispersos)
 *
 * Uso:
 *   const parser = new AssistantQueryParser();
 *   const unitToken = parser.extractUnitToken(message);
 *   const buildingToken = parser.extractBuildingToken(message);
 *   const buildingMatch = parser.findBuilding(buildings, buildingToken);
 *   const unitMatch = parser.findUnit(units, unitToken);
 */

export interface BuildingCandidate {
  id: string;
  name: string;
}

export interface UnitCandidate {
  id: string;
  code: string;
  label: string | null;
}

export interface UnitToken {
  unitCode: string;
  buildingAlias?: string;
  buildingName?: string;
  unitCodeCandidates?: string[];
  unitCodeRaw?: string;
}

export interface MatchResult<T> {
  matched: boolean;
  item: T | null;
  alternatives: T[];
  reason: 'exact' | 'fuzzy' | 'synonym' | 'partial' | 'none';
}

export const BUILDING_SYNONYMS = [
  'torre',
  'edificio',
  'bloque',
  'tower',
  'building',
  'sector',
  'pabellon',
  'pabellón',
  'residencia',
  'conjunto',
  'complejo',
];

export const UNIT_SYNONYMS = [
  'unidad',
  'apartamento',
  'depto',
  'departamento',
  'apto',
  'local',
  'oficina',
  'casa',
  'cochera',
  'garage',
  'baulera',
];

export class AssistantQueryParser {
  /**
   * Extrae el token de unidad de un mensaje.
   * Reconoce sinónimos: "unidad 0213", "depto 5B", "apto 301", etc.
   */
  extractUnitToken(message: string): string | null {
    const synonyms = UNIT_SYNONYMS.join('|');
    // Palabra clave + espacio + [opcional: palabra descriptiva] + identificador
    const pattern = new RegExp(`(?:${synonyms})\\s+(?:[a-z]+\\s+)?([a-zA-Z0-9\\-]+)`, 'i');
    const match = message.match(pattern);
    return match?.[1]?.trim() || null;
  }

  /**
   * Parsea una referencia completa a unidad.
   *
   * Regla de producto:
   * - El código de unidad se trata como identificador opaco.
   * - No se infiere edificio desde el código.
   * - El edificio solo se extrae cuando es explícito en el mensaje.
   */
  parseUnitReference(message: string): UnitToken | null {
    const unitCodeRaw = this.extractOpaqueUnitCode(message);
    if (!unitCodeRaw) return null;

    const normalized = UnitCodeNormalizer.normalize(unitCodeRaw);
    if (!normalized.normalized) return null;

    const explicitBuilding = this.extractExplicitBuildingReference(message);

    return {
      unitCodeRaw: normalized.raw,
      unitCode: normalized.normalized,
      unitCodeCandidates: normalized.candidates,
      buildingAlias: explicitBuilding?.buildingAlias,
      buildingName: explicitBuilding?.buildingName,
    };
  }

  private extractOpaqueUnitCode(message: string): string | null {
    const unitSynonyms = UNIT_SYNONYMS.join('|');
    const normalizedMessage = message.replace(/[\u2010-\u2015\u2212]/g, '-');
    const explicitUnitCodePattern =
      '([A-Za-z]{1,3}\\d{1,2}-\\d{2,4}|[A-Za-z]{1,3}\\s*-\\s*\\d{1,5}|\\d{1,4}\\s*-\\s*[A-Za-z0-9]{1,3}|[A-Za-z]{1,3}\\d{2,5}|\\d{1,4}[A-Za-z]{1,2}|[A-Za-z]{1,3}\\s+\\d{2,5}|\\d{1,5})';
    const genericUnitCodePattern =
      '([A-Za-z]{1,3}\\d{1,2}-\\d{2,4}|[A-Za-z]{1,3}\\s*-\\s*\\d{1,5}|\\d{1,4}\\s*-\\s*[A-Za-z0-9]{1,3}|[A-Za-z]{1,3}\\d{2,5}|\\d{1,4}[A-Za-z]{1,2})';

    // 1) Prefer explicit unit mention: "unidad X", "depto X"
    const explicitPattern = new RegExp(
      `(?:${unitSynonyms})\\s+(?:nro\\.?\\s*|numero\\s+|número\\s+|num\\.?\\s+)?${explicitUnitCodePattern}(?=\\s+(?:de|del|en)\\b|$)`,
      'i',
    );
    const explicitMatch = explicitPattern.exec(normalizedMessage);
    if (explicitMatch && explicitMatch[1]) {
      return explicitMatch[1];
    }

    // 2) Standalone operational patterns: "debe A-0123", "deuda de A0123", "debe PB-01", "deuda 2-B"
    const standalonePattern = new RegExp(`\\b${genericUnitCodePattern}\\b`, 'i');
    const standaloneMatch = standalonePattern.exec(normalizedMessage);
    if (standaloneMatch && standaloneMatch[1]) {
      return standaloneMatch[1];
    }

    // 3) Numeric unit fallback only when message is clearly operational
    if (/\b(deuda|debe|saldo|adeuda|pago|pagos|ticket|tickets|residente|vive)\b/i.test(normalizedMessage)) {
      const numericMatch = normalizedMessage.match(/\b(\d{3,4})\b/);
      if (numericMatch && numericMatch[1]) {
        return numericMatch[1];
      }
    }

    return null;
  }

  private extractExplicitBuildingReference(message: string): { buildingAlias?: string; buildingName?: string } | null {
    const buildingSynonyms = BUILDING_SYNONYMS.join('|');
    const normalizedMessage = message.replace(/[\u2010-\u2015\u2212]/g, '-');
    const pattern = new RegExp(
      `(?:\\ben\\s+(?:la\\s+|el\\s+)?)?(?:${buildingSynonyms})\\s+([A-Za-z0-9]+(?:\\s+[A-Za-z0-9]+)*)`,
      'i',
    );
    const match = normalizedMessage.match(pattern);
    if (!match || !match[1]) return null;

    const rawToken = match[1].trim();
    if (/^[A-Za-z0-9]{1,3}$/.test(rawToken)) {
      return { buildingAlias: rawToken.toUpperCase() };
    }

    return { buildingName: rawToken };
  }

  /**
   * Extrae el token de edificio de un mensaje.
   * Reconoce sinónimos: "torre A", "edificio B", "bloque C", etc.
   */
  extractBuildingToken(message: string): string | null {
    const synonyms = BUILDING_SYNONYMS.join('|');
    const pattern = new RegExp(`(?:${synonyms})\\s+([a-zA-Z0-9]+)`, 'i');
    const match = message.match(pattern);
    return match?.[1]?.trim() || null;
  }

  /**
   * Busca un edificio por token, usando matching fuzzy.
   * Estrategias:
   * 1. Coincidencia exacta normalizada
   * 2. El nombre del edificio contiene el token
   * 3. El token es suficiente para identificar (ej: "A" en "Edificio A")
   * 4. Sinónimos cruzados ("torre" en mensaje vs "edificio" en DB)
   */
  findBuilding(buildings: BuildingCandidate[], token: string): MatchResult<BuildingCandidate> {
    if (!token || buildings.length === 0) {
      return { matched: false, item: null, alternatives: [], reason: 'none' };
    }

    const normalizedToken = this.normalize(token);

    // Estrategia 1: Coincidencia exacta del nombre completo
    const exact = buildings.find((b) => this.normalize(b.name) === normalizedToken);
    if (exact) {
      return { matched: true, item: exact, alternatives: [], reason: 'exact' };
    }

    // Estrategia 2: El nombre del edificio contiene el token
    // Solo para tokens de 3+ caracteres para evitar falsos positivos con letras sueltas
    if (normalizedToken.length >= 3) {
      const containing = buildings.filter((b) => this.normalize(b.name).includes(normalizedToken));
      if (containing.length === 1) {
        return { matched: true, item: containing[0]!, alternatives: [], reason: 'partial' };
      }
      if (containing.length > 1) {
        return { matched: false, item: null, alternatives: containing, reason: 'partial' };
      }
    }

    // Estrategia 3: Extraer la "clave" del edificio (la letra/número después del sinónimo)
    // y compararla con la clave del token
    let tokenKey = this.extractKeyAfterSynonym(normalizedToken);
    // Si el token es corto (1-2 chars) y no tiene sinónimo, usarlo directamente como clave
    if (!tokenKey && /^[a-z0-9]{1,2}$/.test(normalizedToken)) {
      tokenKey = normalizedToken;
    }
    if (tokenKey) {
      const keyMatches = buildings.filter((b) => {
        const buildingKey = this.extractKeyAfterSynonym(this.normalize(b.name));
        return buildingKey === tokenKey;
      });
      if (keyMatches.length === 1) {
        return { matched: true, item: keyMatches[0]!, alternatives: [], reason: 'fuzzy' };
      }
      if (keyMatches.length > 1) {
        return { matched: false, item: null, alternatives: keyMatches, reason: 'fuzzy' };
      }
    }

    // Estrategia 4: Comparación compacta (sin espacios ni guiones)
    const compactToken = normalizedToken.replace(/[^a-z0-9]/g, '');
    const compactMatches = buildings.filter((b) => {
      const compactName = this.normalize(b.name).replace(/[^a-z0-9]/g, '');
      return compactName === compactToken || compactName.includes(compactToken);
    });
    if (compactMatches.length === 1) {
      return { matched: true, item: compactMatches[0]!, alternatives: [], reason: 'fuzzy' };
    }
    if (compactMatches.length > 1) {
      return { matched: false, item: null, alternatives: compactMatches, reason: 'fuzzy' };
    }

    return { matched: false, item: null, alternatives: [], reason: 'none' };
  }

  /**
   * Busca una unidad por token, usando matching fuzzy.
   * Estrategias:
   * 1. Coincidencia exacta del código
   * 2. Coincidencia exacta del label
   * 3. Comparación compacta (sin guiones ni espacios)
   * 4. Matching de piso-departamento (ej: "2-13" → "213")
   */
  findUnit<T extends UnitCandidate>(units: T[], token: string): MatchResult<T> {
    if (!token || units.length === 0) {
      return { matched: false, item: null, alternatives: [], reason: 'none' };
    }

    const normalizedToken = this.normalize(token);
    const compactToken = normalizedToken.replace(/[^a-z0-9]/g, '');

    // Estrategia 1: Código exacto
    const exactCode = units.find((u) => this.normalize(u.code) === normalizedToken);
    if (exactCode) {
      return { matched: true, item: exactCode, alternatives: [], reason: 'exact' };
    }

    // Estrategia 2: Label exacto
    const exactLabel = units.find((u) => this.normalize(u.label || '') === normalizedToken);
    if (exactLabel) {
      return { matched: true, item: exactLabel, alternatives: [], reason: 'exact' };
    }

    // Estrategia 3: Piso-departamento (ej: "2-13" → "213")
    // Va antes de compacta para dar prioridad al patrón estructurado
    const floorDeptMatch = normalizedToken.match(/^(\d{1,2})[-\s](\d{1,2})$/);
    if (floorDeptMatch) {
      const derivedCode = `${floorDeptMatch[1]}${floorDeptMatch[2]}`;
      const derivedMatches = units.filter((u) => {
        const compactCode = this.normalize(u.code).replace(/[^a-z0-9]/g, '');
        return compactCode === derivedCode;
      });
      if (derivedMatches.length === 1) {
        return { matched: true, item: derivedMatches[0]!, alternatives: [], reason: 'fuzzy' };
      }
      if (derivedMatches.length > 1) {
        return { matched: false, item: null, alternatives: derivedMatches, reason: 'fuzzy' };
      }
    }

    // Estrategia 4: Comparación compacta (sin guiones ni espacios, sin ceros a la izquierda)
    const compactTokenNoZeros = compactToken.replace(/^0+/, '');
    const compactMatches = units.filter((u) => {
      const compactCode = this.normalize(u.code).replace(/[^a-z0-9]/g, '').replace(/^0+/, '');
      const compactLabel = this.normalize(u.label || '').replace(/[^a-z0-9]/g, '').replace(/^0+/, '');
      return compactCode === compactTokenNoZeros || compactLabel === compactTokenNoZeros;
    });
    if (compactMatches.length === 1) {
      return { matched: true, item: compactMatches[0]!, alternatives: [], reason: 'fuzzy' };
    }
    if (compactMatches.length > 1) {
      return { matched: false, item: null, alternatives: compactMatches, reason: 'fuzzy' };
    }

    return { matched: false, item: null, alternatives: [], reason: 'none' };
  }

  /**
   * Genera un mensaje de clarificación cuando hay múltiples opciones.
   */
  buildClarificationMessage(
    type: 'building' | 'unit',
    alternatives: Array<{ name?: string; label?: string | null; code?: string }>,
  ): string {
    const options = alternatives
      .slice(0, 3)
      .map((a, i) => `${i + 1}) ${a.name ?? a.label ?? a.code ?? '?'}`)
      .join(' | ');

    if (type === 'building') {
      return `Hay más de un edificio coincidente. Opciones: ${options}. Indica el nombre exacto.`;
    }
    return `Hay más de una unidad coincidente. Opciones: ${options}. Indica el identificador exacto.`;
  }

  /**
   * Normaliza texto: minúsculas, sin acentos, sin espacios extra.
   */
  normalize(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Extrae la "clave" de un nombre de edificio.
   * Ej: "Edificio A" → "a", "Torre B" → "b", "Sector 1" → "1"
   */
  private extractKeyAfterSynonym(normalizedName: string): string | null {
    const allSynonyms = [...BUILDING_SYNONYMS].join('|');
    const pattern = new RegExp(`(?:${allSynonyms})\\s*([a-z0-9]+)`);
    const match = normalizedName.match(pattern);
    return match?.[1] || null;
  }
}
import { UnitCodeNormalizer } from '../unit-code-normalizer';
