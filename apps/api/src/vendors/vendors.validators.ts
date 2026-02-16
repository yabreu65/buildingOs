import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * VendorsValidators: Scope validation helpers for Vendors, Quotes, and WorkOrders
 *
 * Rules:
 * 1. Vendor must belong to tenant (404 if not)
 * 2. VendorAssignment must have vendor and building in same tenant (404 if not)
 * 3. Quote must belong to tenant + building (404 if not)
 * 4. Quote's ticket (if present) must belong to same tenant/building
 * 5. WorkOrder must belong to tenant + building (404 if not)
 * 6. WorkOrder's ticket (if present) must belong to same tenant/building
 *
 * Never returns success - throws on validation failure.
 * Prevents access to resources across tenant boundaries.
 */
@Injectable()
export class VendorsValidators {
  constructor(private prisma: PrismaService) {}

  // ============================================================================
  // VENDOR VALIDATORS
  // ============================================================================

  /**
   * Validate that a vendor belongs to a tenant
   * @throws NotFoundException if vendor doesn't exist or doesn't belong to tenant
   */
  async validateVendorBelongsToTenant(
    tenantId: string,
    vendorId: string,
  ): Promise<void> {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, tenantId },
    });

    if (!vendor) {
      throw new NotFoundException(
        `Vendor not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that a building belongs to a tenant
   * Reuses same logic as tickets validator (DRY)
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
   * Validate that a vendor assignment belongs to a tenant
   * @throws NotFoundException if assignment doesn't exist or doesn't belong to tenant
   */
  async validateVendorAssignmentBelongsToTenant(
    tenantId: string,
    assignmentId: string,
  ): Promise<void> {
    const assignment = await this.prisma.vendorAssignment.findFirst({
      where: { id: assignmentId, tenantId },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Vendor assignment not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that vendor + building pair is valid for a tenant
   * Used when creating/validating vendor assignments
   * @throws NotFoundException if vendor or building don't belong to tenant
   */
  async validateVendorAndBuildingBelongToTenant(
    tenantId: string,
    vendorId: string,
    buildingId: string,
  ): Promise<void> {
    // Check vendor
    await this.validateVendorBelongsToTenant(tenantId, vendorId);

    // Check building
    await this.validateBuildingBelongsToTenant(tenantId, buildingId);
  }

  // ============================================================================
  // QUOTE VALIDATORS
  // ============================================================================

  /**
   * Validate that a quote belongs to a tenant
   * @throws NotFoundException if quote doesn't exist or doesn't belong to tenant
   */
  async validateQuoteBelongsToTenant(
    tenantId: string,
    quoteId: string,
  ): Promise<void> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, tenantId },
    });

    if (!quote) {
      throw new NotFoundException(
        `Quote not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that a quote belongs to a tenant and building
   * @throws NotFoundException if quote doesn't exist or doesn't belong to tenant/building
   */
  async validateQuoteBelongsToBuildingAndTenant(
    tenantId: string,
    buildingId: string,
    quoteId: string,
  ): Promise<void> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, tenantId, buildingId },
    });

    if (!quote) {
      throw new NotFoundException(
        `Quote not found or does not belong to this building/tenant`,
      );
    }
  }

  /**
   * Validate that a ticket belongs to a building and tenant
   * Reuses validation from tickets module context
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
   * Validate a complete quote scope:
   * 1. Building belongs to tenant
   * 2. Vendor belongs to tenant
   * 3. Quote belongs to tenant and building
   * 4. If quote has ticketId: ticket belongs to same building/tenant
   *
   * @throws NotFoundException if any validation fails
   */
  async validateQuoteScope(
    tenantId: string,
    buildingId: string,
    quoteId: string,
  ): Promise<void> {
    // 1. Validate building
    await this.validateBuildingBelongsToTenant(tenantId, buildingId);

    // 2. Validate quote belongs to tenant and building
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, tenantId, buildingId },
    });

    if (!quote) {
      throw new NotFoundException(
        `Quote not found or does not belong to this building/tenant`,
      );
    }

    // 3. If ticket is associated, validate it belongs to same building
    if (quote.ticketId) {
      await this.validateTicketBelongsToBuildingAndTenant(
        tenantId,
        buildingId,
        quote.ticketId,
      );
    }
  }

  // ============================================================================
  // WORK ORDER VALIDATORS
  // ============================================================================

  /**
   * Validate that a work order belongs to a tenant
   * @throws NotFoundException if work order doesn't exist or doesn't belong to tenant
   */
  async validateWorkOrderBelongsToTenant(
    tenantId: string,
    workOrderId: string,
  ): Promise<void> {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, tenantId },
    });

    if (!workOrder) {
      throw new NotFoundException(
        `Work order not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that a work order belongs to a tenant and building
   * @throws NotFoundException if work order doesn't exist or doesn't belong to tenant/building
   */
  async validateWorkOrderBelongsToBuildingAndTenant(
    tenantId: string,
    buildingId: string,
    workOrderId: string,
  ): Promise<void> {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, tenantId, buildingId },
    });

    if (!workOrder) {
      throw new NotFoundException(
        `Work order not found or does not belong to this building/tenant`,
      );
    }
  }

  /**
   * Validate a complete work order scope:
   * 1. Building belongs to tenant
   * 2. Work order belongs to tenant and building
   * 3. If work order has ticketId: ticket belongs to same building/tenant
   *
   * @throws NotFoundException if any validation fails
   */
  async validateWorkOrderScope(
    tenantId: string,
    buildingId: string,
    workOrderId: string,
  ): Promise<void> {
    // 1. Validate building
    await this.validateBuildingBelongsToTenant(tenantId, buildingId);

    // 2. Validate work order belongs to tenant and building
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, tenantId, buildingId },
    });

    if (!workOrder) {
      throw new NotFoundException(
        `Work order not found or does not belong to this building/tenant`,
      );
    }

    // 3. If ticket is associated, validate it belongs to same building
    if (workOrder.ticketId) {
      await this.validateTicketBelongsToBuildingAndTenant(
        tenantId,
        buildingId,
        workOrder.ticketId,
      );
    }
  }

  // ============================================================================
  // PERMISSION HELPERS
  // ============================================================================

  /**
   * Check if user has a specific role in their current context
   * @returns true if user has the role in any of their memberships
   */
  hasRole(userRoles: string[], role: string): boolean {
    return userRoles?.includes(role) || false;
  }

  /**
   * Check if user has required permission for vendors operations
   * @param userRoles array of roles from JWT
   * @param permission 'vendors.read' | 'vendors.write'
   * @returns true if user can perform the action
   */
  canAccessVendors(userRoles: string[], permission: 'read' | 'write'): boolean {
    // TENANT_ADMIN: full access (read + write)
    if (this.hasRole(userRoles, 'TENANT_ADMIN')) return true;

    // TENANT_OWNER: read-only for vendors
    if (permission === 'read' && this.hasRole(userRoles, 'TENANT_OWNER'))
      return true;

    // OPERATOR: no vendor management access
    // RESIDENT: no vendor access

    return false;
  }

  /**
   * Check if user can manage quotes (create, update, view)
   * @param userRoles array of roles from JWT
   * @param permission 'read' | 'write' | 'approve'
   * @returns true if user can perform the action
   */
  canManageQuotes(
    userRoles: string[],
    permission: 'read' | 'write' | 'approve',
  ): boolean {
    // TENANT_ADMIN: full access
    if (this.hasRole(userRoles, 'TENANT_ADMIN')) return true;

    // OPERATOR: can view and create quotes
    if (['read', 'write'].includes(permission) && this.hasRole(userRoles, 'OPERATOR'))
      return true;

    // TENANT_OWNER: can view and approve quotes
    if (['read', 'approve'].includes(permission) && this.hasRole(userRoles, 'TENANT_OWNER'))
      return true;

    // RESIDENT: no quote access

    return false;
  }

  /**
   * Check if user can manage work orders (create, update, change status)
   * @param userRoles array of roles from JWT
   * @param permission 'read' | 'write' | 'execute'
   * @returns true if user can perform the action
   */
  canManageWorkOrders(
    userRoles: string[],
    permission: 'read' | 'write' | 'execute',
  ): boolean {
    // TENANT_ADMIN: full access
    if (this.hasRole(userRoles, 'TENANT_ADMIN')) return true;

    // OPERATOR: can view and execute work orders
    if (['read', 'execute'].includes(permission) && this.hasRole(userRoles, 'OPERATOR'))
      return true;

    // TENANT_OWNER: can view work orders (read-only)
    if (permission === 'read' && this.hasRole(userRoles, 'TENANT_OWNER'))
      return true;

    // RESIDENT: no work order access

    return false;
  }

  /**
   * Throw ForbiddenException with clear message
   * Used consistently across controllers
   */
  throwForbidden(resource: string, action: string): void {
    throw new ForbiddenException(
      `You do not have permission to ${action} ${resource}`,
    );
  }
}
