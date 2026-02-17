import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  CreateChargeDto,
  UpdateChargeDto,
  CancelChargeDto,
  SubmitPaymentDto,
  ApprovePaymentDto,
  RejectPaymentDto,
  CreateAllocationDto,
  ListChargesQueryDto,
  ListPaymentsQueryDto,
} from './finanzas.dto';
import { ChargeStatus, PaymentStatus } from '@prisma/client';

@Injectable()
export class FinanzasService {
  constructor(
    private prisma: PrismaService,
    private validators: FinanzasValidators,
  ) {}

  // ============================================================================
  // CHARGE OPERATIONS
  // ============================================================================

  /**
   * Create a new charge for a unit
   *
   * Security:
   * - Validates building belongs to tenant
   * - Validates unit belongs to building and tenant
   * - Admin/Operator only
   */
  async createCharge(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    userId: string,
    dto: CreateChargeDto,
  ) {
    // 1. Permission check
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('charges', 'create');
    }

    // 2. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 3. Validate unit
    await this.validators.validateUnitBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      dto.unitId,
    );

    // 4. Check for duplicate (unique per unit/period/concept)
    const existing = await this.prisma.charge.findFirst({
      where: {
        tenantId,
        buildingId,
        unitId: dto.unitId,
        period: dto.period || new Date().toISOString().substring(0, 7),
        concept: dto.concept,
        canceledAt: null, // Don't count canceled charges
      },
    });

    if (existing) {
      throw new ConflictException(
        `Charge already exists for this unit/period/concept`,
      );
    }

    // 5. Create charge with PENDING status
    return this.prisma.charge.create({
      data: {
        tenantId,
        buildingId,
        unitId: dto.unitId,
        period: dto.period || new Date().toISOString().substring(0, 7),
        type: dto.type,
        concept: dto.concept,
        amount: dto.amount,
        currency: dto.currency || 'ARS',
        dueDate: new Date(dto.dueDate),
        status: ChargeStatus.PENDING,
        createdByMembershipId: dto.createdByMembershipId,
      },
    });
  }

  /**
   * List charges for a building
   *
   * Security:
   * - For RESIDENT/OWNER: filtered to their units only (404 otherwise)
   * - For Admin/Operator: all building charges
   */
  async listCharges(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    userId: string,
    query: ListChargesQueryDto,
  ) {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 2. Build where clause
    const where: any = {
      tenantId,
      buildingId,
      canceledAt: null, // Exclude canceled charges
    };

    // 3. Apply RESIDENT/OWNER scope
    if (this.validators.isResidentOrOwner(userRoles)) {
      const userUnitIds = await this.validators.getUserUnitIds(
        tenantId,
        userId,
      );
      if (userUnitIds.length === 0) {
        return []; // User has no assigned units
      }
      where.unitId = { in: userUnitIds };
    }

    // 4. Apply filters
    if (query.period) {
      where.period = query.period;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.unitId) {
      // Validate unit access for RESIDENT/OWNER
      if (this.validators.isResidentOrOwner(userRoles)) {
        await this.validators.validateResidentUnitAccess(
          tenantId,
          userId,
          query.unitId,
        );
      }
      where.unitId = query.unitId;
    }

    // 5. Execute query
    const limit = Math.min(query.limit || 50, 500);
    const offset = query.offset || 0;

    return this.prisma.charge.findMany({
      where,
      orderBy: { dueDate: 'desc' },
      take: limit,
      skip: offset,
      include: {
        paymentAllocations: true,
      },
    });
  }

  /**
   * Get a single charge detail
   *
   * Security:
   * - For RESIDENT/OWNER: only if unit is theirs (404 otherwise)
   */
  async getCharge(
    tenantId: string,
    buildingId: string,
    chargeId: string,
    userRoles: string[],
    userId: string,
  ) {
    // 1. Validate charge belongs to building and tenant
    const charge = await this.prisma.charge.findFirst({
      where: {
        id: chargeId,
        tenantId,
        buildingId,
      },
      include: {
        paymentAllocations: true,
      },
    });

    if (!charge) {
      throw new NotFoundException(
        `Charge not found or does not belong to this building/tenant`,
      );
    }

    // 2. Validate RESIDENT/OWNER can only access their units
    if (this.validators.isResidentOrOwner(userRoles)) {
      await this.validators.validateResidentUnitAccess(
        tenantId,
        userId,
        charge.unitId,
      );
    }

    return charge;
  }

  /**
   * Update a charge
   *
   * Security:
   * - Admin/Operator only
   * - Cannot update if payment allocations exist
   */
  async updateCharge(
    tenantId: string,
    buildingId: string,
    chargeId: string,
    userRoles: string[],
    dto: UpdateChargeDto,
  ) {
    // 1. Permission check
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('charges', 'update');
    }

    // 2. Validate charge
    const charge = await this.prisma.charge.findFirst({
      where: {
        id: chargeId,
        tenantId,
        buildingId,
      },
      include: {
        paymentAllocations: true,
      },
    });

    if (!charge) {
      throw new NotFoundException(
        `Charge not found or does not belong to this building/tenant`,
      );
    }

    // 3. Cannot update if has allocations
    if (charge.paymentAllocations.length > 0) {
      throw new ConflictException(
        `Cannot update charge that has payment allocations`,
      );
    }

    // 4. Update
    return this.prisma.charge.update({
      where: { id: chargeId },
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Cancel a charge (soft delete)
   *
   * Security:
   * - Admin/Operator only
   */
  async cancelCharge(
    tenantId: string,
    buildingId: string,
    chargeId: string,
    userRoles: string[],
    dto: CancelChargeDto,
  ) {
    // 1. Permission check
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('charges', 'cancel');
    }

    // 2. Validate charge
    await this.validators.validateChargeBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      chargeId,
    );

    // 3. Cancel
    return this.prisma.charge.update({
      where: { id: chargeId },
      data: {
        canceledAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // ============================================================================
  // PAYMENT OPERATIONS
  // ============================================================================

  /**
   * Submit a payment (RESIDENT or ADMIN)
   *
   * Security:
   * - RESIDENT can only submit for their own units (unitId required and validated)
   * - ADMIN can submit for any unit
   */
  async submitPayment(
    tenantId: string,
    buildingId: string,
    userId: string,
    userRoles: string[],
    dto: SubmitPaymentDto,
  ) {
    // 1. Permission check
    if (!this.validators.canSubmitPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'submit');
    }

    // 2. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 3. If RESIDENT/OWNER and unitId provided, validate access
    if (this.validators.isResidentOrOwner(userRoles) && dto.unitId) {
      await this.validators.validateResidentUnitAccess(
        tenantId,
        userId,
        dto.unitId,
      );
    }

    // 4. If unitId provided, validate it belongs to building
    if (dto.unitId) {
      await this.validators.validateUnitBelongsToBuildingAndTenant(
        tenantId,
        buildingId,
        dto.unitId,
      );
    }

    // 5. Create payment with SUBMITTED status
    return this.prisma.payment.create({
      data: {
        tenantId,
        buildingId,
        unitId: dto.unitId || null,
        amount: dto.amount,
        currency: dto.currency || 'ARS',
        method: dto.method,
        status: PaymentStatus.SUBMITTED,
        reference: dto.reference,
        proofFileId: dto.proofFileId || null,
        createdByUserId: userId,
      },
    });
  }

  /**
   * List payments for a building
   *
   * Security:
   * - For RESIDENT/OWNER: filtered to their units only
   * - For Admin/Operator: all building payments
   */
  async listPayments(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    userId: string,
    query: ListPaymentsQueryDto,
  ) {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 2. Build where clause
    const where: any = {
      tenantId,
      buildingId,
    };

    // 3. Apply RESIDENT/OWNER scope
    if (this.validators.isResidentOrOwner(userRoles)) {
      const userUnitIds = await this.validators.getUserUnitIds(
        tenantId,
        userId,
      );
      if (userUnitIds.length === 0) {
        return [];
      }
      where.OR = [
        { unitId: { in: userUnitIds } },
        { createdByUserId: userId }, // Can see own submissions
      ];
    }

    // 4. Apply filters
    if (query.status) {
      where.status = query.status;
    }
    if (query.unitId) {
      if (this.validators.isResidentOrOwner(userRoles)) {
        await this.validators.validateResidentUnitAccess(
          tenantId,
          userId,
          query.unitId,
        );
      }
      where.unitId = query.unitId;
    }

    // 5. Execute query
    const limit = Math.min(query.limit || 50, 500);
    const offset = query.offset || 0;

    return this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        paymentAllocations: true,
        createdByUser: {
          select: { id: true, name: true, email: true },
        },
        reviewedByMembership: {
          select: { id: true, user: { select: { name: true } } },
        },
      },
    });
  }

  /**
   * Approve a payment
   *
   * Security:
   * - Admin/Operator only
   */
  async approvePayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    dto: ApprovePaymentDto,
  ) {
    // 1. Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'approve');
    }

    // 2. Validate payment
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
        buildingId,
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    // 3. Update to APPROVED
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.APPROVED,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        reviewedByMembershipId: membershipId,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Reject a payment
   *
   * Security:
   * - Admin/Operator only
   */
  async rejectPayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    dto: RejectPaymentDto,
  ) {
    // 1. Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'reject');
    }

    // 2. Validate payment
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
        buildingId,
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    // 3. Update to REJECTED
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.REJECTED,
        reviewedByMembershipId: membershipId,
        updatedAt: new Date(),
      },
    });
  }

  // ============================================================================
  // ALLOCATION OPERATIONS
  // ============================================================================

  /**
   * Create a payment allocation
   *
   * Security:
   * - Admin/Operator only
   * - Cannot exceed payment amount
   */
  async createAllocation(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    dto: CreateAllocationDto,
  ) {
    // 1. Permission check
    if (!this.validators.canAllocate(userRoles)) {
      this.validators.throwForbidden('allocations', 'create');
    }

    // 2. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 3. Validate payment and charge
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: dto.paymentId,
        tenantId,
        buildingId,
      },
      include: {
        paymentAllocations: true,
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    const charge = await this.prisma.charge.findFirst({
      where: {
        id: dto.chargeId,
        tenantId,
        buildingId,
      },
    });

    if (!charge) {
      throw new NotFoundException(
        `Charge not found or does not belong to this building/tenant`,
      );
    }

    // 4. Validate total allocations don't exceed payment amount
    const totalAllocated = payment.paymentAllocations.reduce(
      (sum, a) => sum + a.amount,
      0,
    );

    if (totalAllocated + dto.amount > payment.amount) {
      throw new ConflictException(
        `Total allocations (${totalAllocated + dto.amount}) exceed payment amount (${payment.amount})`,
      );
    }

    // 5. Check for duplicate allocation
    const existing = await this.prisma.paymentAllocation.findFirst({
      where: {
        tenantId,
        paymentId: dto.paymentId,
        chargeId: dto.chargeId,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Allocation already exists for this payment/charge pair`,
      );
    }

    // 6. Create allocation
    const allocation = await this.prisma.paymentAllocation.create({
      data: {
        tenantId,
        paymentId: dto.paymentId,
        chargeId: dto.chargeId,
        amount: dto.amount,
      },
    });

    // 7. Recalculate charge status based on allocations
    await this.recalculateChargeStatus(dto.chargeId);

    return allocation;
  }

  /**
   * Delete a payment allocation
   *
   * Security:
   * - Admin/Operator only
   */
  async deleteAllocation(
    tenantId: string,
    buildingId: string,
    allocationId: string,
    userRoles: string[],
  ) {
    // 1. Permission check
    if (!this.validators.canAllocate(userRoles)) {
      this.validators.throwForbidden('allocations', 'delete');
    }

    // 2. Validate allocation
    const allocation = await this.prisma.paymentAllocation.findFirst({
      where: { id: allocationId, tenantId },
    });

    if (!allocation) {
      throw new NotFoundException(
        `Allocation not found or does not belong to this tenant`,
      );
    }

    // 3. Verify payment belongs to building
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: allocation.paymentId,
        tenantId,
        buildingId,
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Associated payment does not belong to this building`,
      );
    }

    // 4. Get charge ID before deletion
    const chargeId = allocation.chargeId;

    // 5. Delete allocation
    await this.prisma.paymentAllocation.delete({
      where: { id: allocationId },
    });

    // 6. Recalculate charge status
    await this.recalculateChargeStatus(chargeId);
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Recalculate charge status based on payment allocations sum
   *
   * Rules:
   * - allocations_sum == 0 → PENDING
   * - 0 < allocations_sum < amount → PARTIAL
   * - allocations_sum >= amount → PAID
   */
  private async recalculateChargeStatus(chargeId: string): Promise<void> {
    const charge = await this.prisma.charge.findUnique({
      where: { id: chargeId },
      include: {
        paymentAllocations: true,
      },
    });

    if (!charge) return;

    const allocationsSum = charge.paymentAllocations.reduce(
      (sum, a) => sum + a.amount,
      0,
    );

    let newStatus: ChargeStatus;
    if (allocationsSum === 0) {
      newStatus = ChargeStatus.PENDING;
    } else if (allocationsSum < charge.amount) {
      newStatus = ChargeStatus.PARTIAL;
    } else {
      newStatus = ChargeStatus.PAID;
    }

    if (newStatus !== charge.status) {
      await this.prisma.charge.update({
        where: { id: chargeId },
        data: {
          status: newStatus,
          updatedAt: new Date(),
        },
      });
    }
  }

  // ============================================================================
  // SUMMARY & DELINQUENCY OPERATIONS
  // ============================================================================

  /**
   * Get financial summary for a building
   *
   * Returns:
   * - totalCharges: Sum of all active charges (not canceled)
   * - totalPaid: Sum of approved payments allocated
   * - totalOutstanding: totalCharges - totalPaid
   * - delinquentUnitsCount: Units with PENDING/PARTIAL charges past due date
   * - topDelinquentUnits: List of most delinquent units
   */
  async getBuildingFinancialSummary(
    tenantId: string,
    buildingId: string,
    period?: string,
  ) {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // Build filters
    const where: any = {
      tenantId,
      buildingId,
      canceledAt: null, // Exclude canceled charges
    };

    if (period) {
      where.period = period;
    }

    // 2. Get all charges and allocations
    const charges = await this.prisma.charge.findMany({
      where,
      include: {
        paymentAllocations: {
          include: {
            payment: true,
          },
        },
      },
    });

    // 3. Calculate totals (only from APPROVED payments)
    const totalCharges = charges.reduce((sum, c) => sum + c.amount, 0);

    const totalPaid = charges.reduce((sum, c) => {
      const allocated = c.paymentAllocations.reduce((asum, a) => {
        // Only count allocations from APPROVED payments
        return asum + (a.payment && a.payment.status === PaymentStatus.APPROVED ? a.amount : 0);
      }, 0);
      return sum + allocated;
    }, 0);

    const totalOutstanding = totalCharges - totalPaid;

    // 4. Find delinquent units (past due with outstanding)
    const now = new Date();
    const delinquentCharges = charges.filter(
      (c) =>
        (c.status === ChargeStatus.PENDING || c.status === ChargeStatus.PARTIAL) &&
        c.dueDate < now,
    );

    const delinquentByUnit = new Map<string, number>();
    for (const charge of delinquentCharges) {
      const allocated = charge.paymentAllocations.reduce((sum, a) => {
        return sum + (a.payment ? a.amount : 0);
      }, 0);
      const outstanding = charge.amount - allocated;
      delinquentByUnit.set(
        charge.unitId,
        (delinquentByUnit.get(charge.unitId) || 0) + outstanding,
      );
    }

    const delinquentUnitsCount = delinquentByUnit.size;
    const topDelinquentUnits = Array.from(delinquentByUnit.entries())
      .map(([unitId, outstanding]) => ({ unitId, outstanding }))
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10); // Top 10

    return {
      totalCharges,
      totalPaid,
      totalOutstanding,
      delinquentUnitsCount,
      topDelinquentUnits,
      currency: 'ARS', // Default, could be per-charge
    };
  }

  /**
   * Get unit ledger (charges + payments + balance)
   *
   * Shows transaction history for a unit
   */
  async getUnitLedger(
    tenantId: string,
    unitId: string,
    periodFrom?: string,
    periodTo?: string,
    userRoles?: string[],
    userId?: string,
  ) {
    // 1. Validate unit belongs to tenant
    const unit = await this.prisma.unit.findFirst({
      where: {
        id: unitId,
        building: { tenantId },
      },
      include: {
        building: true,
      },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this tenant`,
      );
    }

    // 2. For RESIDENT: validate unit access
    if (userRoles && userId && this.validators.isResidentOrOwner(userRoles)) {
      await this.validators.validateResidentUnitAccess(tenantId, userId, unitId);
    }

    // 3. Build charge filters
    const chargeWhere: any = {
      tenantId,
      unitId,
      canceledAt: null,
    };

    if (periodFrom || periodTo) {
      chargeWhere.period = {};
      if (periodFrom) chargeWhere.period.gte = periodFrom;
      if (periodTo) chargeWhere.period.lte = periodTo;
    }

    // 4. Get charges with allocations
    const charges = await this.prisma.charge.findMany({
      where: chargeWhere,
      include: {
        paymentAllocations: {
          include: {
            payment: true,
          },
        },
      },
      orderBy: { dueDate: 'desc' },
    });

    // 5. Get payments for this unit
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        unitId,
      },
      include: {
        paymentAllocations: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 6. Calculate balance
    const totalCharges = charges.reduce((sum, c) => sum + c.amount, 0);
    const totalAllocated = charges.reduce((sum, c) => {
      return sum + c.paymentAllocations.reduce((asum, a) => asum + a.amount, 0);
    }, 0);
    const balance = totalCharges - totalAllocated;

    return {
      unitId,
      unitLabel: unit.label,
      buildingId: unit.buildingId,
      buildingName: unit.building.name,
      charges: charges.map((c) => ({
        id: c.id,
        period: c.period,
        concept: c.concept,
        amount: c.amount,
        type: c.type,
        status: c.status,
        dueDate: c.dueDate,
        allocated: c.paymentAllocations.reduce((sum, a) => sum + a.amount, 0),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        createdAt: p.createdAt,
        allocated: p.paymentAllocations.reduce((sum, a) => sum + a.amount, 0),
      })),
      totals: {
        totalCharges,
        totalAllocated,
        balance,
        currency: 'ARS',
      },
    };
  }

  /**
   * Get allocations for a payment
   */
  async getPaymentAllocations(
    tenantId: string,
    buildingId: string,
    paymentId: string,
  ) {
    // 1. Validate payment
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
        buildingId,
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    // 2. Get allocations
    return this.prisma.paymentAllocation.findMany({
      where: {
        tenantId,
        paymentId,
      },
      include: {
        charge: {
          select: {
            id: true,
            concept: true,
            amount: true,
            status: true,
            period: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update payment status based on allocation state
   * If all charges for a payment are PAID, mark payment as RECONCILED
   */
  private async tryReconcilePayment(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        paymentAllocations: {
          include: {
            charge: true,
          },
        },
      },
    });

    if (!payment || payment.status !== PaymentStatus.APPROVED) {
      return;
    }

    // Check if all allocated charges are fully paid
    const allPaid = payment.paymentAllocations.every(
      (alloc) => alloc.charge.status === ChargeStatus.PAID,
    );

    if (allPaid && payment.paymentAllocations.length > 0) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.RECONCILED,
          updatedAt: new Date(),
        },
      });
    }
  }
}
