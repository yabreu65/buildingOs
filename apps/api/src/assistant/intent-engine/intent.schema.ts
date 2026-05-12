import { z } from 'zod';

/**
 * Zod v4 schema for ExtractedIntent validation
 * Strict validation - rejects unknown fields with detailed error messages
 */

// Entity reference schema - strict to reject unknown fields
const entityReferenceSchema: z.ZodType<{
  type: 'unit' | 'building' | 'person';
  buildingAlias?: string;
  unitCode?: string;
  personName?: string;
}> = z
  .object({
    type: z.enum(['unit', 'building', 'person']),
    buildingAlias: z.string().optional(),
    unitCode: z.string().optional(),
    personName: z.string().optional(),
  })
  .strict();

// Supported filters schema - strict to reject unknown fields
const intentFiltersSchema: z.ZodType<{
  minAmount?: number;
  maxAmount?: number;
  period?: string;
  status?: string;
  method?: string;
  minAgeDays?: number;
  category?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}> = z
  .object({
    minAmount: z.number().optional(),
    maxAmount: z.number().optional(),
    period: z.string().optional(),
    status: z.string().optional(),
    method: z.string().optional(),
    minAgeDays: z.number().optional(),
    category: z.string().optional(),
    sortField: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    limit: z.number().max(100).optional(),
  })
  .strict();

/**
 * Schema for validating ExtractedIntent from NLU engine output
 *
 * Usage:
 * ```typescript
 * const result = extractedIntentSchema.safeParse(extractedIntent);
 * if (!result.success) {
 *   console.error('Validation failed:', result.error.issues);
 * }
 * ```
 */
export const extractedIntentSchema = z.object({
  intent: z.string().min(1, 'Intent name is required'),
  entity: entityReferenceSchema,
  filters: intentFiltersSchema,
  confidence: z.number().min(0, 'Confidence must be at least 0').max(1, 'Confidence must be at most 1'),
}).strict();

/**
 * Inferred TypeScript type from schema
 */
export type ValidatedExtractedIntent = z.infer<typeof extractedIntentSchema>;

/**
 * Validate an extracted intent and return typed result
 *
 * @param data - Raw intent data to validate
 * @returns Typed result with success/error info
 */
export function validateExtractedIntent(data: unknown): {
  success: boolean;
  data?: ValidatedExtractedIntent;
  error?: z.ZodError;
} {
  const result = extractedIntentSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}