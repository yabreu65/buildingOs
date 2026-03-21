/**
 * Zod schemas for localStorage validation
 * Provides runtime type safety for persisted data
 */
import { z } from 'zod';

// ============================================================================
// Auth
// ============================================================================

export const StoredAuthSessionSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    fullName: z.string().optional(),
  }),
  memberships: z.array(
    z.object({
      tenantId: z.string(),
      roles: z.array(z.string()),
    })
  ),
  expiresAt: z.number().optional(),
});

export type StoredAuthSession = z.infer<typeof StoredAuthSessionSchema>;

// ============================================================================
// Units
// ============================================================================

export const StoredUnitSchema = z.object({
  id: z.string(),
  label: z.string(),
  buildingId: z.string(),
  unitCode: z.string().optional(),
  unitType: z.enum([
    'STUDIO',
    'ONE_BED',
    'TWO_BED',
    'THREE_PLUS_BED',
  ]),
  occupancyStatus: z.enum(['OCCUPIED', 'VACANT', 'MAINTENANCE']),
  createdAt: z.string(),
});

export type StoredUnit = z.infer<typeof StoredUnitSchema>;

// ============================================================================
// Buildings
// ============================================================================

export const StoredBuildingSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  address: z.string().optional(),
  createdAt: z.string(),
});

export type StoredBuilding = z.infer<typeof StoredBuildingSchema>;

// ============================================================================
// Invitations
// ============================================================================

export const InvitationDataSchema = z.object({
  token: z.string(),
  tenantId: z.string(),
  email: z.string().email(),
  expiresAt: z.number(),
});

export type InvitationData = z.infer<typeof InvitationDataSchema>;

// ============================================================================
// Tenant
// ============================================================================

export const StoredTenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  plan: z
    .enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'])
    .optional(),
});

export type StoredTenant = z.infer<typeof StoredTenantSchema>;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Safely parse JSON and validate against schema
 * Returns null if invalid, otherwise returns parsed value
 */
export function parseStorageValue<T>(
  raw: unknown,
  schema: z.ZodSchema<T>
): T | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return schema.parse(parsed);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join(', ')
        : err instanceof Error
          ? err.message
          : String(err);
    console.error('Storage validation failed:', message);
    return null;
  }
}

/**
 * Validate array of items against schema
 */
export function parseStorageArray<T>(
  raw: unknown,
  schema: z.ZodSchema<T>
): T[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return z.array(schema).parse(parsed);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join(', ')
        : err instanceof Error
          ? err.message
          : String(err);
    console.error('Storage array validation failed:', message);
    return [];
  }
}
