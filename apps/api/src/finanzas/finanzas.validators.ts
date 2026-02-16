import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * FinanzasValidators: Scope validation helpers for Finanzas (Charges, Payments, Allocations)
 *
 * Rules:
 * 1. Charge must belong to tenant + building + unit (404 if not)
 * 2. Payment must belong to tenant + building (404 if not)
 * 3. PaymentAllocation must belong to tenant + valid payment/charge (404 if not)
 * 4. RESIDENT/OWNER users can ONLY operate on their assigned units (404 otherwise)
 * 5. Admin/Operator can manage all units within their tenant
 *
 * RBAC Permissions:
 * - finance.read: view charges/payments/allocations
 * - finance.charge.write: create/edit/cancel charges (admin/operator only)
 * - finance.payment.submit: submit payments (all authenticated)
 * - finance.payment.review: approve/reject payments (admin/operator only)
 * - finance.allocate: create allocations (admin/operator only)
 *
 * Never returns success - throws on validation failure.
 * Prevents access to resources across tenant/building boundaries.
 */
@Injectable()
export class FinanzasValidators {
  constructor(private prisma: PrismaService) {}

  // ============================================================================
  // RESIDENT UNIT ACCESS (CRITICAL)
  // ============================================================================

  /**
   * Get array of unit IDs where a user is an active occupant within a tenant
   * Used to restrict RESIDENT/OWNER access to their own units
   *
   * @param tenantId - Tenant context
   * @param userId - User to check
   * @returns Array of unit IDs where user has active occupancy
   */
  async getUserUnitIds(tenantId: string, userId: string): Promise<string[]> {
    const occupancies = await this.prisma.unitOccupant.findMany({
      where: {
        userId,
        unit: {
          building: { tenantId }, // Ensure unit belongs to tenant
        },
      },
      select: { unitId: true },
      distinct: ['unitId'],
    });

    return occupancies.map((o) => o.unitId);
  }

  /**
   * Validate that a RESIDENT user has access to a specific unit
   * Returns 404 (same as "unit doesn't exist") for unauthorized access
   *
   * @param tenantId - Tenant context
   * @param userId - User to validate
   * @param unitId - Unit to access
   * @throws NotFoundException if user doesn't have access to unit
   */
  async validateResidentUnitAccess(
    tenantId: string,
    userId: string,
    unitId: string,
  ): Promise<void> {
    const userUnitIds = await this.getUserUnitIds(tenantId, userId);
    if (!userUnitIds.includes(unitId)) {
      throw new NotFoundException(
        `Unit not found or does not belong to you`,
      );
    }
  }

  // ============================================================================
  // BUILDING & UNIT VALIDATORS
  // ============================================================================

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

  // ============================================================================
  // CHARGE VALIDATORS
  // ============================================================================

  /**
   * Validate that a charge belongs to a tenant
   * @throws NotFoundException if charge doesn't exist or doesn't belong to tenant
   */
  async validateChargeBelongsToTenant(
    tenantId: string,
    chargeId: string,
  ): Promise<void> {
    const charge = await this.prisma.charge.findFirst({
      where: { id: chargeId, tenantId },
    });

    if (!charge) {
      throw new NotFoundException(
        `Charge not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that a charge belongs to a tenant and building
   * @throws NotFoundException if charge doesn't exist or doesn't belong to tenant/building
   */
  async validateChargeBelongsToBuildingAndTenant(
    tenantId: string,
    buildingId: string,
    chargeId: string,
  ): Promise<void> {
    const charge = await this.prisma.charge.findFirst({
      where: { id: chargeId, tenantId, buildingId },
    });

    if (!charge) {
      throw new NotFoundException(
        `Charge not found or does not belong to this building/tenant`,
      );
    }
  }

  /**
   * Validate a complete charge scope:
   * 1. Building belongs to tenant
   * 2. Unit belongs to building and tenant
   * 3. Charge belongs to tenant, building, and unit
   *
   * @throws NotFoundException if any validation fails
   */
  async validateChargeScope(
    tenantId: string,
    buildingId: string,
    unitId: string,
    chargeId: string,
  ): Promise<void> {
    // 1. Validate building
    await this.validateBuildingBelongsToTenant(tenantId, buildingId);

    // 2. Validate unit
    await this.validateUnitBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      unitId,
    );

    // 3. Validate charge
    const charge = await this.prisma.charge.findFirst({
      where: {
        id: chargeId,
        tenantId,
        buildingId,
        unitId,
      },
    });

    if (!charge) {
      throw new NotFoundException(
        `Charge not found or does not belong to this unit/building/tenant`,
      );
    }
  }

  // ============================================================================
  // PAYMENT VALIDATORS
  // ============================================================================

  /**
   * Validate that a payment belongs to a tenant
   * @throws NotFoundException if payment doesn't exist or doesn't belong to tenant
   */
  async validatePaymentBelongsToTenant(
    tenantId: string,
    paymentId: string,
  ): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate that a payment belongs to a tenant and building
   * @throws NotFoundException if payment doesn't exist or doesn't belong to tenant/building
   */
  async validatePaymentBelongsToBuildingAndTenant(
    tenantId: string,
    buildingId: string,
    paymentId: string,
  ): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, buildingId },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }
  }

  /**
   * Validate a complete payment scope:
   * 1. Building belongs to tenant
   * 2. Payment belongs to tenant and building
   * 3. If payment has unitId: unit belongs to building and tenant
   *
   * @throws NotFoundException if any validation fails
   */
  async validatePaymentScope(
    tenantId: string,
    buildingId: string,
    paymentId: string,
  ): Promise<void> {
    // 1. Validate building
    await this.validateBuildingBelongsToTenant(tenantId, buildingId);

    // 2. Validate payment belongs to tenant and building
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, buildingId },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    // 3. If payment has unitId, validate it belongs to building
    if (payment.unitId) {
      await this.validateUnitBelongsToBuildingAndTenant(
        tenantId,
        buildingId,
        payment.unitId,
      );
    }
  }

  // ============================================================================
  // ALLOCATION VALIDATORS
  // ============================================================================

  /**
   * Validate that a payment allocation belongs to a tenant
   * @throws NotFoundException if allocation doesn't exist or doesn't belong to tenant
   */
  async validateAllocationBelongsToTenant(
    tenantId: string,
    allocationId: string,
  ): Promise<void> {
    const allocation = await this.prisma.paymentAllocation.findFirst({
      where: { id: allocationId, tenantId },
    });

    if (!allocation) {
      throw new NotFoundException(
        `Allocation not found or does not belong to this tenant`,
      );
    }
  }

  /**
   * Validate a complete allocation scope:
   * 1. Building belongs to tenant
   * 2. Allocation belongs to tenant
   * 3. Payment in allocation belongs to tenant and building
   * 4. Charge in allocation belongs to tenant and building
   *
   * @throws NotFoundException if any validation fails
   */
  async validateAllocationScope(
    tenantId: string,
    buildingId: string,
    allocationId: string,
  ): Promise<void> {
    // 1. Validate building
    await this.validateBuildingBelongsToTenant(tenantId, buildingId);

    // 2. Validate allocation
    const allocation = await this.prisma.paymentAllocation.findFirst({
      where: { id: allocationId, tenantId },
    });

    if (!allocation) {
      throw new NotFoundException(
        `Allocation not found or does not belong to this tenant`,
      );
    }

    // 3. Validate payment belongs to tenant and building
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: allocation.paymentId,
        tenantId,
        buildingId,
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Associated payment does not belong to this building/tenant`,
      );
    }

    // 4. Validate charge belongs to tenant and building
    const charge = await this.prisma.charge.findFirst({
      where: {
        id: allocation.chargeId,
        tenantId,
        buildingId,
      },
    });

    if (!charge) {
      throw new NotFoundException(
        `Associated charge does not belong to this building/tenant`,
      );
    }
  }

  // ============================================================================
  // RBAC PERMISSION HELPERS
  // ============================================================================

  /**
   * Check if user has a specific role
   * @returns true if user has the role
   */
  hasRole(userRoles: string[], role: string): boolean {
    return userRoles?.includes(role) || false;
  }

  /**
   * Check if user is admin or operator (can manage finances)
   * @returns true if user can manage charges/allocations
   */
  isAdminOrOperator(userRoles: string[]): boolean {
    return this.hasRole(userRoles, 'TENANT_ADMIN') ||
           this.hasRole(userRoles, 'OPERATOR');
  }

  /**
   * Check if user is resident or owner (can only view/submit for own unit)
   * @returns true if user is resident or owner
   */
  isResidentOrOwner(userRoles: string[]): boolean {
    return this.hasRole(userRoles, 'RESIDENT') ||
           this.hasRole(userRoles, 'TENANT_OWNER');
  }

  /**
   * Check if user can read charges (all authenticated users)
   * @param userRoles array of roles from JWT
   * @returns true if user can read charges
   */
  canReadCharges(userRoles: string[]): boolean {
    // All authenticated users can read
    return userRoles && userRoles.length > 0;
  }

  /**
   * Check if user can create/edit/cancel charges (admin/operator only)
   * @param userRoles array of roles from JWT
   * @returns true if user can write charges
   */
  canWriteCharges(userRoles: string[]): boolean {
    return this.isAdminOrOperator(userRoles);
  }

  /**
   * Check if user can submit payments (residents can for their units, admins for all)
   * @param userRoles array of roles from JWT
   * @returns true if user can submit payments
   */
  canSubmitPayments(userRoles: string[]): boolean {
    // All authenticated users can submit payments
    return userRoles && userRoles.length > 0;
  }

  /**
   * Check if user can review/approve/reject payments (admin/operator only)
   * @param userRoles array of roles from JWT
   * @returns true if user can review payments
   */
  canReviewPayments(userRoles: string[]): boolean {
    return this.isAdminOrOperator(userRoles);
  }

  /**
   * Check if user can create allocations (admin/operator only)
   * @param userRoles array of roles from JWT
   * @returns true if user can allocate
   */
  canAllocate(userRoles: string[]): boolean {
    return this.isAdminOrOperator(userRoles);
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
