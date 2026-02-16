import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TicketsValidators: Scope validation helpers for Tickets
 *
 * Rules:
 * 1. Building must belong to tenant (404 if not)
 * 2. Ticket must belong to building and tenant (404 if not)
 * 3. Unit (if present) must belong to building and tenant (400/404 if not)
 *
 * Never returns success - throws on validation failure.
 * Prevents access to resources across tenant/building boundaries.
 */
@Injectable()
export class TicketsValidators {
  constructor(private prisma: PrismaService) {}

  /**
   * Validate that a building belongs to a tenant
   * @throws NotFoundException if building doesn't exist or doesn't belong to tenant
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
        `Building not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that a unit belongs to a building and tenant
   * @throws NotFoundException if unit doesn't exist or doesn't belong to building/tenant
   */
  async validateUnitBelongsToBuildingAndTenant(
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
        `Unit not found or does not belong to this building/tenant`,
      );
    }
  }

  /**
   * Validate that a ticket belongs to a building and tenant
   * @throws NotFoundException if ticket doesn't exist or doesn't belong to building/tenant
   */
  async validateTicketBelongsToBuildingAndTenant(
    tenantId: string,
    buildingId: string,
    ticketId: string,
  ): Promise<void> {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        tenantId,
        buildingId,
      },
    });

    if (!ticket) {
      throw new NotFoundException(
        `Ticket not found or does not belong to this building/tenant`,
      );
    }
  }

  /**
   * Validate a complete ticket scope:
   * 1. Building belongs to tenant
   * 2. Ticket belongs to building and tenant
   * 3. Unit (if present) belongs to building and tenant
   *
   * @throws NotFoundException if any validation fails
   * @throws BadRequestException if unitId is invalid
   */
  async validateTicketScope(
    tenantId: string,
    buildingId: string,
    ticketId: string,
    unitId?: string,
  ): Promise<void> {
    // 1. Validate building
    await this.validateBuildingBelongsToTenant(tenantId, buildingId);

    // 2. Validate ticket
    await this.validateTicketBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      ticketId,
    );

    // 3. Validate unit if provided
    if (unitId) {
      await this.validateUnitBelongsToBuildingAndTenant(
        tenantId,
        buildingId,
        unitId,
      );
    }
  }
}
