import { z } from 'zod';
import { extractedIntentSchema, validateExtractedIntent } from './intent.schema';

describe('extractedIntentSchema', () => {
  describe('valid inputs', () => {
    it('accepts a valid extracted intent with all fields', () => {
      const validIntent = {
        intent: 'list_payments',
        entity: {
          type: 'building' as const,
          buildingAlias: 'Torre A',
        },
        filters: {
          minAmount: 1000,
          maxAmount: 50000,
          period: '2024-01',
          status: 'pending',
          sortOrder: 'desc' as const,
          limit: 50,
        },
        confidence: 0.95,
      };

      const result = extractedIntentSchema.safeParse(validIntent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.intent).toBe('list_payments');
        expect(result.data.entity.type).toBe('building');
        expect(result.data.confidence).toBe(0.95);
      }
    });

    it('accepts minimal valid intent', () => {
      const minimalIntent = {
        intent: 'search_tickets',
        entity: { type: 'unit' as const },
        filters: {},
        confidence: 0.5,
      };

      const result = extractedIntentSchema.safeParse(minimalIntent);
      expect(result.success).toBe(true);
    });

    it('accepts entity with all optional fields', () => {
      const intent = {
        intent: 'find_person',
        entity: {
          type: 'person' as const,
          buildingAlias: 'Torre A',
          unitCode: '101',
          personName: 'John Doe',
        },
        filters: {},
        confidence: 0.8,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entity.personName).toBe('John Doe');
      }
    });

    it('accepts all sortOrder values', () => {
      for (const sortOrder of ['asc', 'desc'] as const) {
        const intent = {
          intent: 'list_payments',
          entity: { type: 'building' as const },
          filters: { sortOrder },
          confidence: 0.9,
        };

        const result = extractedIntentSchema.safeParse(intent);
        expect(result.success).toBe(true);
      }
    });

    it('accepts all entity types', () => {
      for (const type of ['unit', 'building', 'person'] as const) {
        const intent = {
          intent: 'test_intent',
          entity: { type },
          filters: {},
          confidence: 0.7,
        };

        const result = extractedIntentSchema.safeParse(intent);
        expect(result.success).toBe(true);
      }
    });

    it('accepts all filter fields', () => {
      const intent = {
        intent: 'complex_search',
        entity: { type: 'unit' as const },
        filters: {
          minAmount: 100,
          maxAmount: 10000,
          period: '2024',
          status: 'approved',
          method: 'transfer',
          minAgeDays: 30,
          category: 'maintenance',
          sortField: 'amount',
          sortOrder: 'asc',
          limit: 100,
        },
        confidence: 1.0,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(true);
    });

    it('accepts confidence boundary values 0 and 1', () => {
      for (const confidence of [0, 0.5, 1] as const) {
        const intent = {
          intent: 'test',
          entity: { type: 'building' as const },
          filters: {},
          confidence,
        };

        const result = extractedIntentSchema.safeParse(intent);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('invalid inputs', () => {
    it('rejects unknown fields', () => {
      const intentWithUnknownField = {
        intent: 'list_payments',
        entity: { type: 'building' as const },
        filters: {},
        confidence: 0.9,
        unknownField: 'should cause error',
      };

      const result = extractedIntentSchema.safeParse(intentWithUnknownField);
      expect(result.success).toBe(false);
    });

    it('rejects missing intent field', () => {
      const intent = {
        entity: { type: 'building' as const },
        filters: {},
        confidence: 0.9,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects missing entity field', () => {
      const intent = {
        intent: 'list_payments',
        filters: {},
        confidence: 0.9,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects missing confidence field', () => {
      const intent = {
        intent: 'list_payments',
        entity: { type: 'building' as const },
        filters: {},
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects empty intent string', () => {
      const intent = {
        intent: '',
        entity: { type: 'building' as const },
        filters: {},
        confidence: 0.9,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects invalid entity type', () => {
      const intent = {
        intent: 'list_payments',
        entity: { type: 'invalid' as unknown as 'unit' },
        filters: {},
        confidence: 0.9,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects confidence below 0', () => {
      const intent = {
        intent: 'list_payments',
        entity: { type: 'building' as const },
        filters: {},
        confidence: -0.1,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects confidence above 1', () => {
      const intent = {
        intent: 'list_payments',
        entity: { type: 'building' as const },
        filters: {},
        confidence: 1.5,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects invalid sortOrder value', () => {
      const intent = {
        intent: 'list_payments',
        entity: { type: 'building' as const },
        filters: { sortOrder: 'invalid' as 'asc' | 'desc' },
        confidence: 0.9,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects limit above 100', () => {
      const intent = {
        intent: 'list_payments',
        entity: { type: 'building' as const },
        filters: { limit: 150 },
        confidence: 0.9,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects invalid filter field types', () => {
      const intent = {
        intent: 'list_payments',
        entity: { type: 'building' as const },
        filters: { minAmount: 'not a number' },
        confidence: 0.9,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });

    it('rejects unknown nested fields in entity', () => {
      const intent = {
        intent: 'list_payments',
        entity: {
          type: 'building' as const,
          unknownField: 'error',
        },
        filters: {},
        confidence: 0.9,
      };

      const result = extractedIntentSchema.safeParse(intent);
      expect(result.success).toBe(false);
    });
  });
});

describe('validateExtractedIntent helper', () => {
  it('returns success true for valid data', () => {
    const validData = {
      intent: 'list_payments',
      entity: { type: 'building' as const },
      filters: {},
      confidence: 0.9,
    };

    const result = validateExtractedIntent(validData);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('returns success false with error for invalid data', () => {
    const invalidData = {
      entity: { type: 'building' as const },
      filters: {},
      confidence: 0.9,
    };

    const result = validateExtractedIntent(invalidData);
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBeInstanceOf(z.ZodError);
  });

  it('provides detailed error messages', () => {
    const invalidData = {
      confidence: 2.0, // invalid - must be 0-1
    };

    const result = validateExtractedIntent(invalidData);
    expect(result.success).toBe(false);
    expect(result.error?.issues.length).toBeGreaterThan(0);
  });
});