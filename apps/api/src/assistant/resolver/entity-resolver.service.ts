import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolution, EntityAlternative } from '../intent-engine/intent.types';

/**
 * EntityResolverService - Resolves entity references to database records
 *
 * Multi-tenant safe: all queries scoped by tenantId.
 *
 * @example
 * ```typescript
 * const result = await entityResolver.resolveBuilding('A', 'tenant-1');
 * if (result?.alternatives.length > 0) {
 *   // Handle ambiguity
 * }
 * ```
 */
@Injectable()
export class EntityResolverService {
  private readonly logger = new Logger(EntityResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a building by alias or name
   *
   * Resolution order:
   * 1. Exact match on alias (case-insensitive)
   * 2. Name contains match (case-insensitive)
   *
   * @param aliasOrName - Building alias or name to search
   * @param tenantId - Tenant ID for multi-tenant isolation
   * @returns EntityResolution with alternatives if multiple matches, or null if not found
   */
  async resolveBuilding(
    aliasOrName: string,
    tenantId: string,
  ): Promise<EntityResolution | null> {
    // Try exact alias match first
    const exactMatch = await this.prisma.building.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        alias: {
          equals: aliasOrName,
          mode: 'insensitive',
        },
      },
      select: { id: true, name: true, alias: true },
    });

    if (exactMatch) {
      return {
        building: {
          id: exactMatch.id,
          name: exactMatch.name,
          alias: exactMatch.alias ?? undefined,
        },
        alternatives: [],
      };
    }

    // Try name contains match
    const nameMatch = await this.prisma.building.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        name: {
          contains: aliasOrName,
          mode: 'insensitive',
        },
      },
      select: { id: true, name: true, alias: true },
    });

    if (nameMatch) {
      return {
        building: {
          id: nameMatch.id,
          name: nameMatch.name,
          alias: nameMatch.alias ?? undefined,
        },
        alternatives: [],
      };
    }

    // No match found
    return null;
  }

  /**
   * Resolve a unit by code within a building
   *
   * @param code - Unit code to search
   * @param buildingId - Building ID to scope the search
   * @param tenantId - Tenant ID for multi-tenant isolation
   * @returns EntityResolution with alternatives if multiple matches, or null if not found
   */
  async resolveUnit(
    code: string,
    buildingId: string,
    tenantId: string,
  ): Promise<EntityResolution | null> {
    // Exact match on code within building
    const exactMatch = await this.prisma.unit.findFirst({
      where: {
        tenantId,
        buildingId,
        code,
      },
      select: { id: true, code: true, label: true, buildingId: true },
    });

    if (exactMatch) {
      return {
        unit: {
          id: exactMatch.id,
          code: exactMatch.code,
          label: exactMatch.label ?? undefined,
          buildingId: exactMatch.buildingId,
        },
        alternatives: [],
      };
    }

    // No match found
    return null;
  }

  /**
   * Resolve a person by name search across UnitOccupant + TenantMember
   *
   * @param name - Person name to search (case-insensitive contains)
   * @param tenantId - Tenant ID for multi-tenant isolation
   * @returns EntityResolution with person info and unit context, alternatives if multiple matches
   */
  async resolvePerson(
    name: string,
    tenantId: string,
  ): Promise<EntityResolution | null> {
    // Search UnitOccupant joined with TenantMember where name contains
    const occupants = await this.prisma.unitOccupant.findMany({
      where: {
        tenantId,
        endDate: null, // Only active occupants
        member: {
          name: {
            contains: name,
            mode: 'insensitive',
          },
        },
      },
      include: {
        member: {
          select: { id: true, name: true },
        },
        unit: {
          select: { id: true, code: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (occupants.length === 0) {
      return null;
    }

    // First match is the primary resolution
    const primary = occupants[0]!;

    // Build alternatives from remaining matches
    const alternatives: EntityAlternative[] = occupants
      .slice(1)
      .map((o) => ({
        type: 'person' as const,
        id: o.member.id,
        displayName: `${o.member.name} (${o.unit.code})`,
        matchScore: 0.8,
        reason: `Coincidencia parcial con "${name}"`,
      }));

    return {
      person: {
        id: primary.member.id,
        name: primary.member.name,
        unitId: primary.unit.id,
      },
      alternatives,
    };
  }
}
