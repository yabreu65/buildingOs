import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ReportsValidators: Security and validation helpers for reports endpoints
 *
 * Handles:
 * - Role-based access control (TENANT_ADMIN, TENANT_OWNER, OPERATOR only)
 * - Building scope validation (building belongs to tenant)
 * - Date parsing and validation
 */
@Injectable()
export class ReportsValidators {
  constructor(private prisma: PrismaService) {}

  /**
   * Check if user roles include report read permission
   * RESIDENT role is not allowed to read reports
   */
  canReadReports(userRoles: string[]): boolean {
    const allowedRoles = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'];
    return allowedRoles.some((role) => userRoles.includes(role));
  }

  /**
   * Throw ForbiddenException for reports access
   */
  throwForbidden(): void {
    throw new ForbiddenException(
      'You do not have permission to access reports'
    );
  }

  /**
   * Validate that a building belongs to a tenant
   * Throws NotFoundException if building not found or belongs to different tenant
   */
  async validateBuildingScope(
    tenantId: string,
    buildingId?: string
  ): Promise<void> {
    if (!buildingId) return;

    const building = await this.prisma.building.findFirst({
      where: {
        id: buildingId,
        tenantId,
      },
    });

    if (!building) {
      throw new NotFoundException('Building not found');
    }
  }

  /**
   * Parse date string to Date object
   * Returns undefined if string is empty or invalid
   */
  parseDate(value?: string): Date | undefined {
    if (!value || value.trim() === '') return undefined;

    const date = new Date(value);
    return isNaN(date.getTime()) ? undefined : date;
  }
}
