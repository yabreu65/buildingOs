import { describe, it, expect } from '@jest/globals';
import { AmbiguityService } from './ambiguity.service';
import type { EntityResolution } from '../intent-engine/intent.types';

describe('AmbiguityService', () => {
  let service: AmbiguityService;

  beforeEach(() => {
    service = new AmbiguityService();
  });

  describe('detectAmbiguity', () => {
    it('returns true when resolution has alternatives', () => {
      const resolution: EntityResolution = {
        building: { id: 'b1', name: 'Torre A', alias: 'A' },
        alternatives: [
          { type: 'building', id: 'b2', displayName: 'Torre B', matchScore: 0.9, reason: 'Test' },
        ],
      };

      expect(service.detectAmbiguity(resolution)).toBe(true);
    });

    it('returns false when no alternatives', () => {
      const resolution: EntityResolution = {
        building: { id: 'b1', name: 'Torre A', alias: 'A' },
        alternatives: [],
      };

      expect(service.detectAmbiguity(resolution)).toBe(false);
    });

    it('returns false when resolution is empty', () => {
      const resolution: EntityResolution = {
        alternatives: [],
      };

      expect(service.detectAmbiguity(resolution)).toBe(false);
    });
  });

  describe('generateClarification', () => {
    it('generates clarification for person ambiguity', () => {
      const resolution: EntityResolution = {
        person: { id: 'p1', name: 'Juan Perez' },
        alternatives: [
          { type: 'person', id: 'p2', displayName: 'Juan Perez (A-0101)', matchScore: 0.9, reason: 'Test' },
          { type: 'person', id: 'p3', displayName: 'Juan Perez (B-0203)', matchScore: 0.9, reason: 'Test' },
        ],
      };

      const result = service.generateClarification(resolution, 'person');

      expect(result.isAmbiguous).toBe(true);
      expect(result.alternatives).toHaveLength(2);
      expect(result.clarificationMessage).toContain('Juan Perez');
      expect(result.clarificationMessage).toContain('A-0101');
      expect(result.clarificationMessage).toContain('B-0203');
    });

    it('generates clarification for unit ambiguity', () => {
      const resolution: EntityResolution = {
        unit: { id: 'u1', code: '0101', buildingId: 'b1' },
        alternatives: [
          { type: 'unit', id: 'u2', displayName: 'A-0101', matchScore: 0.9, reason: 'Test' },
          { type: 'unit', id: 'u3', displayName: 'B-0101', matchScore: 0.9, reason: 'Test' },
        ],
      };

      const result = service.generateClarification(resolution, 'unit');

      expect(result.isAmbiguous).toBe(true);
      expect(result.alternatives).toHaveLength(2);
      expect(result.clarificationMessage).toContain('A-0101');
      expect(result.clarificationMessage).toContain('B-0101');
    });

    it('returns non-ambiguous result when no alternatives', () => {
      const resolution: EntityResolution = {
        building: { id: 'b1', name: 'Torre A', alias: 'A' },
        alternatives: [],
      };

      const result = service.generateClarification(resolution, 'building');

      expect(result.isAmbiguous).toBe(false);
      expect(result.alternatives).toHaveLength(0);
      expect(result.clarificationMessage).toBeUndefined();
    });

    it('never guesses - always returns clarification when ambiguous', () => {
      const resolution: EntityResolution = {
        person: { id: 'p1', name: 'Maria' },
        alternatives: [
          { type: 'person', id: 'p2', displayName: 'Maria Garcia (A-101)', matchScore: 0.7, reason: 'Partial match' },
        ],
      };

      const result = service.generateClarification(resolution, 'person');

      expect(result.isAmbiguous).toBe(true);
      expect(result.clarificationMessage).toBeDefined();
      expect(result.clarificationMessage).toContain('Maria Garcia');
      expect(result.clarificationMessage).toContain('A-101');
      // Should ask for clarification, not guess
      expect(result.clarificationMessage).toContain('¿');
    });
  });
});
