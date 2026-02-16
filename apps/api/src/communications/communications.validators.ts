/**
 * CommunicationsValidators: Scope and permission validation for Communications
 *
 * Ensures that:
 * 1. Communications belong to the user's tenant
 * 2. Buildings/Units referenced belong to the tenant
 * 3. Targets are valid for the tenant
 * 4. Cross-tenant access is prevented (always returns 404, never 403)
 */

import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationTargetType } from '@prisma/client';

@Injectable()
export class CommunicationsValidators {
  constructor(private prisma: PrismaService) {}

  /**
   * Validate that a communication belongs to the tenant
   *
   * @throws NotFoundException if communication doesn't belong to tenant
   */
  async validateCommunicationBelongsToTenant(
    tenantId: string,
    communicationId: string,
  ): Promise<void> {
    const communication = await this.prisma.communication.findFirst({
      where: {
        id: communicationId,
        tenantId,
      },
      select: { id: true },
    });

    if (!communication) {
      throw new NotFoundException(
        `Communication not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that a communication belongs to both tenant and building
   *
   * @throws NotFoundException if communication doesn't belong to tenant/building
   */
  async validateCommunicationBelongsToBuildingAndTenant(
    tenantId: string,
    buildingId: string,
    communicationId: string,
  ): Promise<void> {
    const communication = await this.prisma.communication.findFirst({
      where: {
        id: communicationId,
        tenantId,
        buildingId, // Optional: communication may be building-scoped
      },
      select: { id: true },
    });

    if (!communication) {
      throw new NotFoundException(
        `Communication not found or does not belong to this tenant/building`,
      );
    }
  }

  /**
   * Validate that a building belongs to the tenant
   *
   * @throws NotFoundException if building doesn't belong to tenant
   */
  async validateBuildingBelongsToTenant(
    tenantId: string,
    buildingId: string,
  ): Promise<void> {
    const building = await this.prisma.building.findFirst({
      where: {
        id: buildingId,
        tenantId,
      },
      select: { id: true },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that a unit belongs to the tenant (indirectly via building)
   *
   * @throws NotFoundException if unit doesn't belong to tenant
   */
  async validateUnitBelongsToTenant(
    tenantId: string,
    unitId: string,
  ): Promise<void> {
    const unit = await this.prisma.unit.findFirst({
      where: {
        id: unitId,
        building: { tenantId },
      },
      select: { id: true },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that a target is valid for the tenant and target type
   *
   * Rules:
   * - ALL_TENANT: targetId must be null
   * - BUILDING: targetId must be a building belonging to tenant
   * - UNIT: targetId must be a unit belonging to tenant
   * - ROLE: targetId must be a valid role code (RESIDENT, OWNER, etc)
   *
   * @throws BadRequestException if target is invalid
   * @throws NotFoundException if referenced resource doesn't belong to tenant
   */
  async validateTarget(
    tenantId: string,
    targetType: CommunicationTargetType,
    targetId: string | null,
  ): Promise<void> {
    switch (targetType) {
      case 'ALL_TENANT':
        if (targetId !== null && targetId !== undefined && targetId !== '') {
          throw new BadRequestException(
            `ALL_TENANT target must have null targetId, got: "${targetId}"`,
          );
        }
        break;

      case 'BUILDING':
        if (!targetId) {
          throw new BadRequestException(
            `BUILDING target requires buildingId in targetId`,
          );
        }
        await this.validateBuildingBelongsToTenant(tenantId, targetId);
        break;

      case 'UNIT':
        if (!targetId) {
          throw new BadRequestException(
            `UNIT target requires unitId in targetId`,
          );
        }
        await this.validateUnitBelongsToTenant(tenantId, targetId);
        break;

      case 'ROLE':
        if (!targetId) {
          throw new BadRequestException(
            `ROLE target requires role code in targetId`,
          );
        }
        // Validate role is a valid value (RESIDENT, OWNER, etc)
        const validRoles = ['RESIDENT', 'OWNER', 'OPERATOR', 'TENANT_ADMIN', 'TENANT_OWNER', 'SUPER_ADMIN'];
        if (!validRoles.includes(targetId.toUpperCase())) {
          throw new BadRequestException(
            `Invalid role: "${targetId}". Valid roles: ${validRoles.join(', ')}`,
          );
        }
        break;

      default:
        throw new BadRequestException(
          `Unknown targetType: "${targetType}"`,
        );
    }
  }

  /**
   * Get all user IDs that should receive a communication
   * based on its targets
   *
   * @returns Array of userIds that match the targets
   */
  async resolveRecipients(
    tenantId: string,
    communicationId: string,
  ): Promise<string[]> {
    // Get all targets for this communication
    const targets = await this.prisma.communicationTarget.findMany({
      where: {
        communicationId,
        tenantId,
      },
      select: {
        targetType: true,
        targetId: true,
      },
    });

    if (targets.length === 0) {
      return [];
    }

    const recipientIds = new Set<string>();

    for (const target of targets) {
      const userIds = await this.resolveTarget(tenantId, target.targetType, target.targetId);
      userIds.forEach((id) => recipientIds.add(id));
    }

    return Array.from(recipientIds);
  }

  /**
   * Resolve a single target to its list of user IDs
   *
   * @private
   */
  private async resolveTarget(
    tenantId: string,
    targetType: CommunicationTargetType,
    targetId: string | null,
  ): Promise<string[]> {
    switch (targetType) {
      case 'ALL_TENANT':
        // All users in the tenant
        const tenantUsers = await this.prisma.user.findMany({
          where: {
            memberships: {
              some: {
                tenantId,
              },
            },
          },
          select: { id: true },
        });
        return tenantUsers.map((u) => u.id);

      case 'BUILDING':
        // All unit occupants in this building
        const buildingOccupants = await this.prisma.unitOccupant.findMany({
          where: {
            unit: {
              building: {
                id: targetId,
                tenantId,
              },
            },
          },
          select: { userId: true },
          distinct: ['userId'],
        });
        return buildingOccupants.map((o) => o.userId);

      case 'UNIT':
        // All unit occupants in this unit
        const unitOccupants = await this.prisma.unitOccupant.findMany({
          where: {
            unitId: targetId,
            unit: {
              building: { tenantId },
            },
          },
          select: { userId: true },
          distinct: ['userId'],
        });
        return unitOccupants.map((o) => o.userId);

      case 'ROLE':
        // All users with this role in the tenant
        const roleUsers = await this.prisma.user.findMany({
          where: {
            memberships: {
              some: {
                tenantId,
                roles: {
                  some: {
                    role: targetId as any,
                  },
                },
              },
            },
          },
          select: { id: true },
        });
        return roleUsers.map((u) => u.id);

      default:
        return [];
    }
  }

  /**
   * Check if a user can read a communication
   *
   * Rules:
   * - TENANT_ADMIN/OWNER/OPERATOR: can read all
   * - RESIDENT: can only read if they have a receipt for it
   *
   * @returns true if user can read, false otherwise
   */
  async canUserReadCommunication(
    tenantId: string,
    userId: string,
    communicationId: string,
    userRoles: string[],
  ): Promise<boolean> {
    // Admin roles can read all
    const adminRoles = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'];
    if (userRoles.some((r) => adminRoles.includes(r))) {
      return true;
    }

    // RESIDENT can only read if they have a receipt
    // (i.e., they were in the targets)
    const receipt = await this.prisma.communicationReceipt.findUnique({
      where: {
        communicationId_userId: {
          communicationId,
          userId,
        },
      },
      select: { id: true },
    });

    return !!receipt;
  }
}
