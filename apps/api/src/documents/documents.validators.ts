import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentVisibility, Role } from '@prisma/client';

/**
 * DocumentsValidators: Scope and permission validation helpers
 *
 * Validates:
 * 1. Document scope constraint (exactly ONE: buildingId, unitId, or both null)
 * 2. Building/unit belong to tenant
 * 3. Unit belongs to building
 * 4. Visibility enforcement (who can access document)
 * 5. RESIDENT unit access (RESIDENT only sees docs from units they occupy)
 */
@Injectable()
export class DocumentsValidators {
  constructor(private prisma: PrismaService) {}

  /**
   * Validate document scope constraint
   *
   * Rule: Document MUST be scoped to exactly ONE of:
   *   A) buildingId only (building-scoped)
   *   B) buildingId + unitId (unit-scoped)
   *   C) both null (tenant-wide)
   *
   * @throws BadRequestException if scope is invalid
   */
  validateDocumentScope(
    buildingId: string | undefined,
    unitId: string | undefined,
  ): void {
    const hasBuilding = buildingId != null;
    const hasUnit = unitId != null;

    // Rule: If unitId is set, buildingId MUST also be set
    if (hasUnit && !hasBuilding) {
      throw new BadRequestException(
        'Unit-scoped document must also have buildingId',
      );
    }

    // Rule: If both null, it's tenant-wide (valid)
    // If building only, it's building-scoped (valid)
    // If building + unit, it's unit-scoped (valid)
  }

  /**
   * Validate that building belongs to tenant
   * @throws NotFoundException if building doesn't belong to tenant
   */
  async validateBuildingBelongsToTenant(
    tenantId: string,
    buildingId: string,
  ): Promise<void> {
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
    });

    if (!building) {
      throw new NotFoundException(
        'Building not found or does not belong to your tenant',
      );
    }
  }

  /**
   * Validate that unit belongs to building and tenant
   * @throws NotFoundException if unit doesn't belong to building/tenant
   */
  async validateUnitBelongsToBuilding(
    tenantId: string,
    buildingId: string,
    unitId: string,
  ): Promise<void> {
    const unit = await this.prisma.unit.findFirst({
      where: {
        id: unitId,
        buildingId,
        building: { tenantId },
      },
    });

    if (!unit) {
      throw new NotFoundException(
        'Unit not found or does not belong to the specified building',
      );
    }
  }

  /**
   * Validate that document can be accessed by user based on visibility rules
   *
   * Visibility Rules:
   * - TENANT_ADMINS: TENANT_ADMIN, TENANT_OWNER, OPERATOR roles only
   * - RESIDENTS: ALL roles can view (if scoped to unit/building they have access to)
   * - PRIVATE: Only creator (createdByMembershipId) + SUPER_ADMIN
   *
   * Returns boolean: true if user can access, false otherwise
   */
  canAccessDocument(
    visibility: DocumentVisibility,
    userRoles: string[],
    isDocumentCreator: boolean,
    isSuperAdmin: boolean,
  ): boolean {
    if (visibility === DocumentVisibility.TENANT_ADMINS) {
      // Only admins
      return (
        userRoles.includes(Role.TENANT_ADMIN) ||
        userRoles.includes(Role.TENANT_OWNER) ||
        userRoles.includes(Role.OPERATOR)
      );
    }

    if (visibility === DocumentVisibility.RESIDENTS) {
      // All roles in tenant can view
      return true;
    }

    if (visibility === DocumentVisibility.PRIVATE) {
      // Only creator or SUPER_ADMIN
      return isDocumentCreator || isSuperAdmin;
    }

    return false;
  }

  /**
   * Get array of unit IDs where a RESIDENT user has occupant assignment
   * Used for RESIDENT scope validation on scoped documents
   *
   * @param tenantId - Tenant context
   * @param userId - User to check
   * @returns Array of unit IDs user can access
   */
  async getUserUnitIds(tenantId: string, userId: string): Promise<string[]> {
    const occupancies = await this.prisma.unitOccupant.findMany({
      where: {
        userId,
        unit: {
          building: { tenantId },
        },
      },
      select: { unitId: true },
      distinct: ['unitId'],
    });

    return occupancies.map((o) => o.unitId);
  }

  /**
   * Get array of building IDs where a RESIDENT user has occupants
   * Used for RESIDENT scope validation on building-scoped documents
   *
   * @param tenantId - Tenant context
   * @param userId - User to check
   * @returns Array of building IDs user can access
   */
  async getUserBuildingIds(tenantId: string, userId: string): Promise<string[]> {
    const buildings = await this.prisma.building.findMany({
      where: {
        tenantId,
        units: {
          some: {
            unitOccupants: {
              some: { userId },
            },
          },
        },
      },
      select: { id: true },
      distinct: ['id'],
    });

    return buildings.map((b) => b.id);
  }

  /**
   * Validate that RESIDENT user can access a document based on scope
   *
   * Rules:
   * - Tenant-wide (buildingId=null, unitId=null): Can access if visibility=RESIDENTS
   * - Building-scoped (buildingId set, unitId=null): Can access if in buildingIds OR is creator
   * - Unit-scoped (buildingId + unitId): Can access if in unitIds OR is creator
   *
   * @throws NotFoundException if user doesn't have access
   */
  async validateResidentDocumentAccess(
    tenantId: string,
    userId: string,
    buildingId: string | null,
    unitId: string | null,
    visibility: DocumentVisibility,
    isDocumentCreator: boolean,
  ): Promise<void> {
    // Creators can always access their own documents
    if (isDocumentCreator) {
      return;
    }

    // Tenant-wide documents: only RESIDENTS visibility
    if (!buildingId && !unitId) {
      if (visibility !== DocumentVisibility.RESIDENTS) {
        throw new NotFoundException(
          'Document not found or does not belong to you',
        );
      }
      return;
    }

    // Unit-scoped: check if user is occupant of unit
    if (unitId) {
      const userUnitIds = await this.getUserUnitIds(tenantId, userId);
      if (!userUnitIds.includes(unitId)) {
        throw new NotFoundException(
          'Document not found or does not belong to you',
        );
      }
      return;
    }

    // Building-scoped: check if user has occupants in building
    if (buildingId) {
      const userBuildingIds = await this.getUserBuildingIds(tenantId, userId);
      if (!userBuildingIds.includes(buildingId)) {
        throw new NotFoundException(
          'Document not found or does not belong to you',
        );
      }
      return;
    }
  }
}
