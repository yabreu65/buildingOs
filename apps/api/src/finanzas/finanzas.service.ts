import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Charge, Payment, PaymentAllocation, Prisma, ChargeStatus, PaymentStatus, AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
  FinancialSummaryDto,
} from './finanzas.dto';

@Injectable()
export class FinanzasService {
  constructor(
    private prisma: PrismaService,
    private validators: FinanzasValidators,
    private auditService: AuditService,
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
  ): Promise<Charge> {
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
    const charge = await this.prisma.charge.create({
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

    // Audit: CHARGE_CREATE
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.CHARGE_CREATE,
      entityType: 'Charge',
      entityId: charge.id,
      metadata: {
        unitId: dto.unitId,
        amount: dto.amount,
        type: dto.type,
        concept: dto.concept,
        period: charge.period,
      },
    });

    return charge;
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
  ): Promise<(Charge & { paymentAllocations: unknown[] })[]> {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 2. Build where clause
    const where: Prisma.ChargeWhereInput = {
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
  ): Promise<Charge & { paymentAllocations: unknown[] }> {
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
  ): Promise<Charge> {
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
    userId: string,
    dto: CancelChargeDto,
  ): Promise<Charge> {
    // 1. Permission check
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('charges', 'cancel');
    }

    // 2. Validate charge
    const charge = await this.validators.validateChargeBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      chargeId,
    );

    // 3. Cancel
    const canceledCharge = await this.prisma.charge.update({
      where: { id: chargeId },
      data: {
        canceledAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Audit: CHARGE_CANCEL
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.CHARGE_CANCEL,
      entityType: 'Charge',
      entityId: chargeId,
      metadata: {
        unitId: charge.unitId,
        amount: charge.amount,
        concept: charge.concept,
        reason: dto.reason || 'No reason provided',
      },
    });

    return canceledCharge;
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
  ): Promise<Payment> {
    // 1. Permission check
    if (!this.validators.canSubmitPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'submit');
    }

    // 2. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 3. If RESIDENT/OWNER, unitId is REQUIRED
    if (this.validators.isResidentOrOwner(userRoles)) {
      if (!dto.unitId) {
        throw new BadRequestException(
          'RESIDENT must specify unitId when submitting a payment',
        );
      }
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
  ): Promise<Payment[]> {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 2. Build where clause
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      buildingId,
      canceledAt: null, // Exclude soft-deleted payments
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
  ): Promise<Payment> {
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

    // 3. Approve + FIFO allocation in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 3a. Update to APPROVED
      const approvedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.APPROVED,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          reviewedByMembershipId: membershipId,
          updatedAt: new Date(),
        },
      });

      // 3b. FIFO allocation: if unitId exists, auto-allocate to oldest charges
      if (payment.unitId) {
        const pendingCharges = await tx.charge.findMany({
          where: {
            tenantId,
            buildingId,
            unitId: payment.unitId,
            status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] },
            canceledAt: null,
          },
          include: { paymentAllocations: true },
          orderBy: { dueDate: 'asc' }, // FIFO: oldest first
        });

        let remainingAmount = payment.amount;

        for (const charge of pendingCharges) {
          if (remainingAmount <= 0) break;

          const alreadyAllocated = charge.paymentAllocations.reduce(
            (sum, a) => sum + a.amount,
            0,
          );
          const outstanding = charge.amount - alreadyAllocated;
          const toAllocate = Math.min(remainingAmount, outstanding);

          if (toAllocate <= 0) continue;

          // Verify no existing allocation for this pair
          const existingAllocation = await tx.paymentAllocation.findFirst({
            where: { tenantId, paymentId, chargeId: charge.id },
          });
          if (existingAllocation) continue;

          await tx.paymentAllocation.create({
            data: {
              tenantId,
              paymentId,
              chargeId: charge.id,
              amount: toAllocate,
            },
          });

          await this.recalculateChargeStatus(charge.id, tx);
          remainingAmount -= toAllocate;
        }
      }

      // 3c. Try to reconcile if all charges are paid
      await this.tryReconcilePayment(paymentId, tx);

      return approvedPayment;
    });

    // Audit: PAYMENT_APPROVE
    void this.auditService.createLog({
      tenantId,
      actorUserId: membershipId,
      action: AuditAction.PAYMENT_APPROVE,
      entityType: 'Payment',
      entityId: paymentId,
      metadata: {
        amount: payment.amount,
        paidAt: result.paidAt,
        fifoAllocated: payment.unitId ? true : false,
      },
    });

    return result;
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
  ): Promise<Payment> {
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
    const result = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.REJECTED,
        reviewedByMembershipId: membershipId,
        updatedAt: new Date(),
      },
    });

    // Audit: PAYMENT_REJECT
    void this.auditService.createLog({
      tenantId,
      actorUserId: membershipId,
      action: AuditAction.PAYMENT_REJECT,
      entityType: 'Payment',
      entityId: paymentId,
      metadata: {
        reason: dto.reason,
      },
    });

    return result;
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
   * - Uses transaction for atomicity
   * - Recalculates charge status and attempts payment reconciliation
   */
  async createAllocation(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    membershipId: string,
    dto: CreateAllocationDto,
  ): Promise<PaymentAllocation> {
    // 1. Permission check
    if (!this.validators.canAllocate(userRoles)) {
      this.validators.throwForbidden('allocations', 'create');
    }

    // 2. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 3. Validate payment and charge (outside transaction for initial validation)
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

    // 5. Validate allocation amount doesn't exceed charge amount
    if (dto.amount > charge.amount) {
      throw new ConflictException(
        `Allocation amount (${dto.amount}) cannot exceed charge amount (${charge.amount})`,
      );
    }

    // 6. Check for duplicate allocation
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

    // 7. Create allocation + recalculate status within transaction
    return this.prisma.$transaction(async (tx) => {
      const allocation = await tx.paymentAllocation.create({
        data: {
          tenantId,
          paymentId: dto.paymentId,
          chargeId: dto.chargeId,
          amount: dto.amount,
        },
      });

      // Recalculate charge status within transaction
      await this.recalculateChargeStatus(dto.chargeId, tx);

      // Attempt to reconcile payment if all charges are PAID
      await this.tryReconcilePayment(dto.paymentId, tx);

      // Audit: PAYMENT_ALLOCATE
      void this.auditService.createLog({
        tenantId,
        actorUserId: membershipId,
        action: AuditAction.PAYMENT_ALLOCATE,
        entityType: 'PaymentAllocation',
        entityId: allocation.id,
        metadata: {
          paymentId: dto.paymentId,
          chargeId: dto.chargeId,
          amount: dto.amount,
        },
      });

      return allocation;
    });
  }

  /**
   * Delete a payment allocation
   *
   * Security:
   * - Admin/Operator only
   * - Uses transaction for atomicity
   * - Recalculates charge status and attempts payment reconciliation
   */
  async deleteAllocation(
    tenantId: string,
    buildingId: string,
    allocationId: string,
    userRoles: string[],
    membershipId: string,
  ): Promise<void> {
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

    // 4. Delete allocation + recalculate status within transaction
    return this.prisma.$transaction(async (tx) => {
      // Audit: ALLOCATION_DELETE (before deletion)
      void this.auditService.createLog({
        tenantId,
        actorUserId: membershipId,
        action: AuditAction.ALLOCATION_DELETE,
        entityType: 'PaymentAllocation',
        entityId: allocationId,
        metadata: {
          paymentId: allocation.paymentId,
          chargeId: allocation.chargeId,
          amount: allocation.amount,
        },
      });

      // Delete allocation
      await tx.paymentAllocation.delete({
        where: { id: allocationId },
      });

      // Recalculate charge status within transaction
      await this.recalculateChargeStatus(allocation.chargeId, tx);

      // Attempt to reconcile payment if all charges are PAID
      await this.tryReconcilePayment(allocation.paymentId, tx);
    });
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
   *
   * @param chargeId - ID of charge to recalculate
   * @param tx - Optional Prisma transaction client (for use within transactions)
   */
  private async recalculateChargeStatus(
    chargeId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;

    const charge = await client.charge.findUnique({
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
      await client.charge.update({
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
  ): Promise<FinancialSummaryDto> {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // Build filters
    const where: Prisma.ChargeWhereInput = {
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
  ): Promise<Record<string, unknown>> {
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
    const chargeWhere: Prisma.ChargeWhereInput = {
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
        canceledAt: null, // Exclude soft-deleted payments
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
  ): Promise<(PaymentAllocation & { charge: unknown })[]> {
    // 1. Validate payment
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
        buildingId,
        canceledAt: null, // Exclude soft-deleted payments
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
   * Revive a rejected payment (REJECTED → SUBMITTED)
   *
   * Security:
   * - Admin/Operator only
   */
  async revivePayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
  ): Promise<Payment> {
    // 1. Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'revive');
    }

    // 2. Validate payment
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, buildingId },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    // 3. Validate status is REJECTED
    if (payment.status !== PaymentStatus.REJECTED) {
      throw new ConflictException(`Only REJECTED payments can be revived`);
    }

    // 4. Update to SUBMITTED
    const result = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.SUBMITTED,
        reviewedByMembershipId: null,
        updatedAt: new Date(),
      },
    });

    // Audit
    void this.auditService.createLog({
      tenantId,
      actorUserId: membershipId,
      action: AuditAction.PAYMENT_SUBMIT,
      entityType: 'Payment',
      entityId: paymentId,
      metadata: { action: 'REVIVED', previousStatus: 'REJECTED' },
    });

    return result;
  }

  /**
   * Get a single payment with allocations
   *
   * Security:
   * - RESIDENT: can view only their own unit's payments
   * - Admin/Operator: can view any payment
   */
  async getPayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    userId: string,
  ): Promise<Payment & { paymentAllocations: PaymentAllocation[] }> {
    // 1. Find payment
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, buildingId },
      include: {
        paymentAllocations: {
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
        },
        createdByUser: { select: { id: true, name: true, email: true } },
        reviewedByMembership: {
          select: { id: true, user: { select: { name: true } } },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    // 2. RESIDENT: validate unit ownership
    if (this.validators.isResidentOrOwner(userRoles) && payment.unitId) {
      await this.validators.validateResidentUnitAccess(
        tenantId,
        userId,
        payment.unitId,
      );
    }

    return payment as Payment & { paymentAllocations: PaymentAllocation[] };
  }

  /**
   * Cancel a payment (soft delete via canceledAt)
   *
   * Security:
   * - Admin/Operator only
   * - Cannot cancel if has allocations
   */
  async cancelPayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    reason?: string,
  ): Promise<Payment> {
    // 1. Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'cancel');
    }

    // 2. Validate payment (only active payments)
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, buildingId, canceledAt: null },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    // 3. Cannot cancel if has allocations
    const allocationCount = await this.prisma.paymentAllocation.count({
      where: { tenantId, paymentId },
    });

    if (allocationCount > 0) {
      throw new ConflictException(
        `Cannot cancel payment with existing allocations. Remove allocations first.`,
      );
    }

    // 4. Update canceledAt
    const result = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { canceledAt: new Date(), updatedAt: new Date() },
    });

    // Audit
    void this.auditService.createLog({
      tenantId,
      actorUserId: membershipId,
      action: AuditAction.PAYMENT_REJECT,
      entityType: 'Payment',
      entityId: paymentId,
      metadata: { action: 'CANCELED', reason: reason || 'No reason provided' },
    });

    return result;
  }

  /**
   * Get aggregated financial summary for entire tenant (all buildings)
   *
   * Security:
   * - No additional validation needed (tenant scope is automatic via req.tenantId)
   */
  async getTenantFinancialSummary(
    tenantId: string,
    period?: string,
  ): Promise<FinancialSummaryDto> {
    // 1. Build where clause: ALL charges for this tenant (no buildingId filter)
    const chargeWhere: Prisma.ChargeWhereInput = {
      tenantId,
      canceledAt: null,
    };
    if (period) {
      chargeWhere.period = period;
    }

    // 2. Get all charges (aggregate by status, sum amounts)
    const charges = await this.prisma.charge.findMany({
      where: chargeWhere,
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
      currency: 'ARS',
    };
  }

  /**
   * Get financial trend for building or tenant over N months
   * Returns array of MonthlyTrendDto with collectionRate calculated
   */
  async getFinanceTrend(
    tenantId: string,
    buildingId?: string | null,
    months: number = 6,
  ): Promise<{ period: string; totalCharges: number; totalPaid: number; totalOutstanding: number; collectionRate: number }[]> {
    // Validate months
    const validMonths = Math.min(Math.max(months, 1), 12);

    // Generate array of periods (current month backwards N months)
    const now = new Date();
    const periods: string[] = [];
    for (let i = validMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      periods.push(`${year}-${month}`);
    }

    // For each period, get summary
    const trend: { period: string; totalCharges: number; totalPaid: number; totalOutstanding: number; collectionRate: number }[] = [];
    for (const period of periods) {
      let summary;
      if (buildingId) {
        summary = await this.getBuildingFinancialSummary(tenantId, buildingId, period);
      } else {
        summary = await this.getTenantFinancialSummary(tenantId, period);
      }

      const collectionRate = summary.totalCharges > 0
        ? (summary.totalPaid / summary.totalCharges) * 100
        : 0;

      trend.push({
        period,
        totalCharges: summary.totalCharges,
        totalPaid: summary.totalPaid,
        totalOutstanding: summary.totalOutstanding,
        collectionRate: Math.round(collectionRate * 10) / 10, // 1 decimal
      });
    }

    return trend;
  }

  /**
   * Update payment status based on allocation state
   * If all charges for a payment are PAID, mark payment as RECONCILED
   *
   * @param paymentId - ID of payment to reconcile
   * @param tx - Optional Prisma transaction client (for use within transactions)
   */
  private async tryReconcilePayment(
    paymentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;

    const payment = await client.payment.findUnique({
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
      await client.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.RECONCILED,
          updatedAt: new Date(),
        },
      });
    }
  }
}
