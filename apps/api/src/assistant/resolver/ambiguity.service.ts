import { Injectable } from '@nestjs/common';
import { EntityResolution, AmbiguityResult, AmbiguityAlternative } from '../intent-engine/intent.types';

/**
 * AmbiguityService - Detects and handles entity resolution ambiguity
 *
 * NEVER guesses - always asks for clarification when ambiguous.
 *
 * @example
 * ```typescript
 * if (ambiguityService.detectAmbiguity(resolution)) {
 *   const clarification = ambiguityService.generateClarification(resolution, 'person');
 *   return { type: 'clarification', ...clarification };
 * }
 * ```
 */
@Injectable()
export class AmbiguityService {
  /**
   * Detect if a resolution has ambiguity (multiple alternatives)
   *
   * @param resolution - Entity resolution to check
   * @returns True if resolution.alternatives.length > 0
   */
  detectAmbiguity(resolution: EntityResolution): boolean {
    return resolution.alternatives.length > 0;
  }

  /**
   * Generate a clarification message for ambiguous resolutions
   *
   * NEVER guesses - always asks the user to clarify.
   *
   * @param resolution - Entity resolution with alternatives
   * @param entityType - Type of entity ('person', 'unit', 'building')
   * @returns AmbiguityResult with isAmbiguous=true, alternatives, and clarificationMessage
   */
  generateClarification(resolution: EntityResolution, entityType: string): AmbiguityResult {
    if (resolution.alternatives.length === 0) {
      return {
        isAmbiguous: false,
        alternatives: [],
      };
    }

    const alternatives: AmbiguityAlternative[] = resolution.alternatives.map((alt) => ({
      intent: 'unknown',
      entity: {
        type: alt.type,
      },
      confidence: alt.matchScore,
      reason: alt.reason,
    }));

    let clarificationMessage: string;

    if (entityType === 'person') {
      const personName = resolution.person?.name ?? 'Persona';
      const altDisplays = resolution.alternatives.map((alt) => alt.displayName).join(' y ');
      clarificationMessage = `Encontré ${resolution.alternatives.length + 1} "${personName}": ${resolution.person ? `${personName}` : ''}${resolution.person && resolution.alternatives.length > 0 ? ', ' : ''}${altDisplays}. ¿A cuál te referís?`;
    } else if (entityType === 'unit') {
      const unitCode = resolution.unit?.code ?? 'Unidad';
      const altDisplays = resolution.alternatives.map((alt) => alt.displayName).join(' y ');
      clarificationMessage = `Encontré ${resolution.alternatives.length + 1} "${unitCode}": ${resolution.unit ? `${unitCode}` : ''}${resolution.unit && resolution.alternatives.length > 0 ? ' y ' : ''}${altDisplays}. ¿Cuál querés?`;
    } else {
      const buildingName = resolution.building?.name ?? 'Edificio';
      const altDisplays = resolution.alternatives.map((alt) => alt.displayName).join(' y ');
      clarificationMessage = `Encontré ${resolution.alternatives.length + 1} "${buildingName}": ${resolution.building ? `${buildingName}` : ''}${resolution.building && resolution.alternatives.length > 0 ? ' y ' : ''}${altDisplays}. ¿A cuál te referís?`;
    }

    return {
      isAmbiguous: true,
      alternatives,
      clarificationMessage,
    };
  }
}
