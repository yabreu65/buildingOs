import { Injectable, ConflictException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Charge, Payment, PaymentAllocation, Prisma, ChargeStatus, PaymentStatus, AuditAction, PaymentAuditAction, RejectionReason, ReceiptStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FinanzasValidators } from './finanzas.validators';
import { PaymentReceiptService } from '../receipts/payment-receipt.service';
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
  ListPendingPaymentsQueryDto,
  FinancialSummaryDto,
  PaymentMetricsQueryDto,
  PaymentMetricsDto,
  PaymentAuditLogDto,
  PaymentDuplicateCheckResultDto,
  UnitLedgerDto,
  MonthlyTrendDto,
} from './finanzas.dto';

@Injectable()
export class FinanzasService {
  private readonly logger = new Logger(FinanzasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: FinanzasValidators,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly receiptService: PaymentReceiptService,
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
  ): Promise<(Charge & { paymentAllocations: PaymentAllocation[] })[]> {
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
        unit: {
          select: { id: true, label: true },
        },
        building: {
          select: { id: true, name: true },
        },
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
  ): Promise<Charge & { paymentAllocations: PaymentAllocation[] }> {
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

    // 2. Validate and fetch charge
    await this.validators.validateChargeBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      chargeId,
    );

    const charge = await this.prisma.charge.findUnique({
      where: { id: chargeId },
    });

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
        unitId: charge?.unitId,
        amount: charge?.amount,
        concept: charge?.concept,
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

    // 5. Duplicate detection: check for similar payments in last 48 hours
    const duplicateWindow = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const duplicatePayment = await this.prisma.payment.findFirst({
      where: {
        tenantId,
        buildingId,
        amount: dto.amount,
        reference: dto.reference,
        createdAt: { gte: duplicateWindow },
        status: { in: [PaymentStatus.SUBMITTED, PaymentStatus.APPROVED] },
      },
    });

    if (duplicatePayment) {
      throw new ConflictException(
        `Posible pago duplicado detectado: Ya existe un pago con el mismo monto y referencia en las últimas 48 horas (ID: ${duplicatePayment.id}). Por favor verificá antes de continuar.`,
      );
    }

    // 7. Validate: TRANSFER method requires proofFileId
    if (dto.method === 'TRANSFER' && !dto.proofFileId) {
      throw new BadRequestException(
        'Los pagos por transferencia requieren subir el comprobante de pago',
      );
    }

    // 8. Create payment with SUBMITTED status
    const payment = await this.prisma.payment.create({
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

    // 9. Notify admins about new payment submitted
    void this.notifyAdminsOfPaymentSubmitted(tenantId, payment);

    return payment;
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

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        unit: {
          select: { id: true, label: true },
        },
        building: {
          select: { id: true, name: true },
        },
        paymentAllocations: true,
        createdByUser: {
          select: { id: true, name: true, email: true },
        },
        reviewedByMembership: {
          select: { id: true, user: { select: { name: true } } },
        },
        proofFile: {
          select: { id: true },
        },
      },
    });

    // Resolve proofDocumentId for each payment
    const paymentsWithProofDoc = payments.map((p) => ({
      ...p,
      proofDocumentId: p.proofFile?.id
        ? this.prisma.document.findUnique({
            where: { fileId: p.proofFile.id },
            select: { id: true },
          }).then((d) => d?.id)
        : null,
    }));

    const resolvedPayments = await Promise.all(
      paymentsWithProofDoc.map(async (p) => ({
        ...p,
        proofDocumentId: await p.proofDocumentId,
      }))
    );

    return resolvedPayments as Payment[];
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

    // Validate payment is in SUBMITTED status (can only approve submitted payments)
    if (payment.status !== PaymentStatus.SUBMITTED) {
      throw new ConflictException(
        `Cannot approve payment in status ${payment.status}. Only SUBMITTED payments can be approved.`,
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
      // Include all charges except PAID and CANCELED (some may be incorrectly marked PAID without allocations)
      if (payment.unitId) {
        const pendingCharges = await tx.charge.findMany({
          where: {
            tenantId,
            buildingId,
            unitId: payment.unitId,
            status: { notIn: [ChargeStatus.PAID, ChargeStatus.CANCELED] },
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

    // [PHASE 2 QUICK #3] Send PAYMENT_RECEIVED notification
    void this.sendPaymentReceivedNotification(tenantId, payment);

    // Generate receipt for approved payment (async, non-blocking)
    void this.receiptService.ensureReceiptForPayment(paymentId).catch((err) => {
      this.logger.error(`Failed to generate receipt for payment ${paymentId}: ${err.message}`);
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

    // [PHASE 2 QUICK #4] Send PAYMENT_REJECTED notification
    void this.sendPaymentRejectedNotification(tenantId, payment, dto.reason);

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

    // 3.5. Validate payment is in valid status for allocation
    if (
      payment.status !== PaymentStatus.APPROVED &&
      payment.status !== PaymentStatus.RECONCILED
    ) {
      throw new ConflictException(
        `Cannot allocate payment in status ${payment.status}. Payment must be APPROVED or RECONCILED.`,
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
        paymentAllocations: {
          include: {
            payment: true,
          },
        },
      },
    });

    if (!charge) return;

    const allocationsSum = charge.paymentAllocations.reduce(
      (sum, a) => {
        const status = a.payment?.status;
        if (
          status === PaymentStatus.APPROVED ||
          status === PaymentStatus.RECONCILED
        ) {
          return sum + a.amount;
        }
        return sum;
      },
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

    // Load tenant to get currency
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    });

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

    // 3. Calculate totals by REAL outstanding using approved/reconciled payments
    const chargesWithOutstanding = charges
      .map((c) => {
        const allocated = c.paymentAllocations.reduce((asum, a) => {
          return asum +
            (a.payment &&
            (a.payment.status === PaymentStatus.APPROVED ||
              a.payment.status === PaymentStatus.RECONCILED)
              ? a.amount
              : 0);
        }, 0);

        return {
          charge: c,
          allocated,
          outstanding: Math.max(0, c.amount - allocated),
        };
      })
      .filter((item) => item.outstanding > 0);

    const totalCharges = chargesWithOutstanding.reduce(
      (sum, item) => sum + item.charge.amount,
      0,
    );

    const totalPaid = chargesWithOutstanding.reduce(
      (sum, item) => sum + item.allocated,
      0,
    );

    const totalOutstanding = chargesWithOutstanding.reduce(
      (sum, item) => sum + item.outstanding,
      0,
    );

    // 4. Find delinquent units by real outstanding
    const delinquentCharges = chargesWithOutstanding;

    const delinquentByUnit = new Map<string, number>();
    for (const item of delinquentCharges) {
      const charge = item.charge;
      const outstanding = item.outstanding;
      delinquentByUnit.set(
        charge.unitId,
        (delinquentByUnit.get(charge.unitId) || 0) + outstanding,
      );
    }

    // Get unit info for delinquent units
    const unitIds = Array.from(delinquentByUnit.keys());
    const units = await this.prisma.unit.findMany({
      where: { id: { in: unitIds } },
      include: { building: true },
    });
    const unitInfoMap = new Map(units.map(u => [u.id, { label: u.label, buildingId: u.buildingId, buildingName: u.building.name }]));

    const delinquentUnitsCount = delinquentByUnit.size;
    const topDelinquentUnits = Array.from(delinquentByUnit.entries())
      .map(([unitId, outstanding]) => {
        const info = unitInfoMap.get(unitId);
        return {
          unitId,
          unitLabel: info?.label || unitId,
          buildingId: info?.buildingId || '',
          buildingName: info?.buildingName || '',
          outstanding,
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10); // Top 10

    return {
      totalCharges,
      totalPaid,
      totalOutstanding,
      delinquentUnitsCount,
      topDelinquentUnits,
      currency: tenant.currency,
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
  ): Promise<UnitLedgerDto> {
    // Load tenant to get currency
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    });

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
    // IMPORTANT: debt must be calculated from approved/reconciled allocations,
    // not from Charge.status alone (status can be stale/inconsistent).
    // Therefore, we fetch all active (non-canceled) charges for the unit.
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

    // 6. Calculate balance based on approved/reconciled allocations only
    // and only for charges with real outstanding > 0.
    const chargesWithApprovedAllocated = charges.map((charge) => {
      const approvedAllocated = charge.paymentAllocations.reduce((sum, allocation) => {
        const status = allocation.payment?.status;
        if (status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) {
          return sum + allocation.amount;
        }
        return sum;
      }, 0);

      return {
        charge,
        approvedAllocated,
        outstanding: Math.max(0, charge.amount - approvedAllocated),
      };
    });

    const chargesWithOutstanding = chargesWithApprovedAllocated.filter(
      (item) => item.outstanding > 0,
    );

    const totalCharges = chargesWithOutstanding.reduce(
      (sum, item) => sum + item.charge.amount,
      0,
    );
    const totalAllocated = chargesWithOutstanding.reduce(
      (sum, item) => sum + item.approvedAllocated,
      0,
    );
    const balance = totalCharges - totalAllocated;

    return {
      unitId,
      unitLabel: unit.label ?? '',
      buildingId: unit.buildingId,
      buildingName: unit.building.name,
      charges: chargesWithApprovedAllocated.map(({ charge, approvedAllocated }) => ({
        id: charge.id,
        period: charge.period,
        concept: charge.concept,
        amount: charge.amount,
        currency: charge.currency,
        type: charge.type,
        status: charge.status,
        dueDate: charge.dueDate,
        allocated: approvedAllocated,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        method: p.method,
        status: p.status,
        createdAt: p.createdAt,
        allocated: p.paymentAllocations.reduce((sum, a) => sum + a.amount, 0),
      })),
      totals: {
        totalCharges,
        totalAllocated,
        balance,
        currency: tenant.currency,
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
  ): Promise<(PaymentAllocation & { charge: { id: string; concept: string; amount: number; status: ChargeStatus; period: string } })[]> {
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
      action: AuditAction.PAYMENT_CANCEL,
      entityType: 'Payment',
      entityId: paymentId,
      metadata: { reason: reason || 'No reason provided' },
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
    // Load tenant to get currency
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    });

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

    // 3. Calculate totals by REAL outstanding using approved/reconciled payments
    const chargesWithOutstanding = charges
      .map((c) => {
        const allocated = c.paymentAllocations.reduce((asum, a) => {
          return asum +
            (a.payment &&
            (a.payment.status === PaymentStatus.APPROVED ||
              a.payment.status === PaymentStatus.RECONCILED)
              ? a.amount
              : 0);
        }, 0);

        return {
          charge: c,
          allocated,
          outstanding: Math.max(0, c.amount - allocated),
        };
      })
      .filter((item) => item.outstanding > 0);

    const totalCharges = chargesWithOutstanding.reduce(
      (sum, item) => sum + item.charge.amount,
      0,
    );

    const totalPaid = chargesWithOutstanding.reduce(
      (sum, item) => sum + item.allocated,
      0,
    );

    const totalOutstanding = chargesWithOutstanding.reduce(
      (sum, item) => sum + item.outstanding,
      0,
    );

    // 4. Find delinquent units by real outstanding
    const delinquentCharges = chargesWithOutstanding;

    const delinquentByUnit = new Map<string, number>();
    for (const item of delinquentCharges) {
      const charge = item.charge;
      const outstanding = item.outstanding;
      delinquentByUnit.set(
        charge.unitId,
        (delinquentByUnit.get(charge.unitId) || 0) + outstanding,
      );
    }

    // Get unit and building info for delinquent units
    const unitIds = Array.from(delinquentByUnit.keys());
    const units = await this.prisma.unit.findMany({
      where: { id: { in: unitIds } },
      include: { building: true },
    });
    const unitInfoMap = new Map(units.map(u => [u.id, { label: u.label, buildingId: u.buildingId, buildingName: u.building.name }]));

    const delinquentUnitsCount = delinquentByUnit.size;
    const topDelinquentUnits = Array.from(delinquentByUnit.entries())
      .map(([unitId, outstanding]) => {
        const info = unitInfoMap.get(unitId);
        return {
          unitId,
          unitLabel: info?.label || unitId,
          buildingId: info?.buildingId || '',
          buildingName: info?.buildingName || '',
          outstanding,
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10); // Top 10

    return {
      totalCharges,
      totalPaid,
      totalOutstanding,
      delinquentUnitsCount,
      topDelinquentUnits,
      currency: tenant.currency,
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
  ): Promise<MonthlyTrendDto[]> {
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

  // ============================================================================
  // TENANT-LEVEL PAYMENT REVIEW OPERATIONS
  // ============================================================================

  /**
   * List pending payments across all buildings for a tenant
   * Supports filtering by building, unit, date range, status
   */
  async listPendingPayments(
    tenantId: string,
    userRoles: string[],
    userId: string,
    query: ListPendingPaymentsQueryDto,
  ): Promise<Payment[]> {
    // Build where clause
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      canceledAt: null,
    };

    // Apply filters
    if (query.status) {
      where.status = query.status;
    } else {
      // Default to SUBMITTED if no status specified
      where.status = PaymentStatus.SUBMITTED;
    }

    if (query.buildingId) {
      where.buildingId = query.buildingId;
    }

    if (query.unitId) {
      where.unitId = query.unitId;
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) {
        where.createdAt.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        where.createdAt.lte = new Date(query.dateTo);
      }
    }

    // For RESIDENT/OWNER: filter to their units or their submissions
    if (this.validators.isResidentOrOwner(userRoles)) {
      const userUnitIds = await this.validators.getUserUnitIds(tenantId, userId);
      if (userUnitIds.length === 0) {
        return [];
      }
      where.OR = [
        { unitId: { in: userUnitIds } },
        { createdByUserId: userId },
      ];
    }

    // Execute query
    const limit = Math.min(query.limit || 50, 100);
    const offset = query.offset || 0;

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'asc' }, // Oldest first for review priority
      take: limit,
      skip: offset,
      include: {
        building: {
          select: { id: true, name: true },
        },
        unit: {
          select: { id: true, label: true },
        },
        createdByUser: {
          select: { id: true, name: true, email: true },
        },
        reviewedByMembership: {
          select: { id: true, user: { select: { name: true } } },
        },
        proofFile: {
          select: { id: true },
        },
      },
    });

    // Map payments to include proofDocumentId (for download endpoint)
    const paymentsWithProofDoc = payments.map((p) => ({
      ...p,
      proofDocumentId: p.proofFile?.id
        ? this.prisma.document.findUnique({
            where: { fileId: p.proofFile.id },
            select: { id: true },
          }).then((d) => d?.id)
        : null,
    }));

    // Resolve all proofDocumentIds
    const resolvedPayments = await Promise.all(
      paymentsWithProofDoc.map(async (p) => ({
        ...p,
        proofDocumentId: await p.proofDocumentId,
      }))
    );

    return resolvedPayments as Payment[];
  }

  /**
   * Approve a payment at tenant level (any building)
   */
  async approvePaymentTenant(
    tenantId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    dto: ApprovePaymentDto,
  ): Promise<Payment> {
    // Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'approve');
    }

    // Find payment - tenant level (any building)
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
      },
      include: {
        paymentAllocations: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Validate current status
    if (payment.status !== PaymentStatus.SUBMITTED) {
      throw new BadRequestException(
        `Cannot approve payment in status ${payment.status}. Only SUBMITTED payments can be approved.`,
      );
    }

    if (payment.canceledAt) {
      throw new BadRequestException('Cannot approve a canceled payment');
    }

    // Execute approval with auto-allocation
    let approvedPaymentResult: Payment | null = null;
    
    await this.prisma.$transaction(async (tx) => {
      // Update payment status
      const approvedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.APPROVED,
          reviewedByMembershipId: membershipId,
          reviewedAt: new Date(),
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          updatedAt: new Date(),
        },
      });
      
      approvedPaymentResult = approvedPayment;

      // Auto-allocation: find pending charges for the unit and allocate
      if (payment.unitId) {
        const pendingCharges = await tx.charge.findMany({
          where: {
            tenantId,
            buildingId: payment.buildingId,
            unitId: payment.unitId,
            status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] },
            canceledAt: null,
          },
          orderBy: { dueDate: 'asc' }, // FIFO by due date
        });

        let remainingAmount = payment.amount;

        for (const charge of pendingCharges) {
          if (remainingAmount <= 0) break;

          const allocatedAmount = Math.min(remainingAmount, charge.amount);
          const existingAllocations = await tx.paymentAllocation.aggregate({
            where: { chargeId: charge.id },
            _sum: { amount: true },
          });
          const alreadyAllocated = existingAllocations._sum.amount || 0;
          const chargeRemaining = charge.amount - alreadyAllocated;

          const allocationAmount = Math.min(allocatedAmount, chargeRemaining);

          if (allocationAmount > 0) {
            await tx.paymentAllocation.create({
              data: {
                tenantId,
                paymentId: payment.id,
                chargeId: charge.id,
                amount: allocationAmount,
              },
            });

            // Update charge status
            const newChargeAllocated = alreadyAllocated + allocationAmount;
            const newChargeStatus =
              newChargeAllocated >= charge.amount ? ChargeStatus.PAID : ChargeStatus.PARTIAL;

            await tx.charge.update({
              where: { id: charge.id },
              data: { status: newChargeStatus, updatedAt: new Date() },
            });

            remainingAmount -= allocationAmount;
          }
        }
      }

      // Registrar auditoría de aprobación
      await tx.paymentAuditLog.create({
        data: {
          tenantId,
          paymentId,
          action: PaymentAuditAction.APPROVED,
          membershipId,
          reason: null,
          comment: null,
          metadata: {
            amount: payment.amount,
            currency: payment.currency,
            method: payment.method,
            reference: payment.reference,
          },
        },
      });

      return approvedPayment;
    });

    // Send notification to resident about approval (outside transaction, using returned payment)
    if (approvedPaymentResult) {
      void this.sendPaymentReceivedNotification(tenantId, approvedPaymentResult);
      
      // Generate receipt for approved payment (async, non-blocking)
      void this.receiptService.ensureReceiptForPayment(paymentId).catch((err) => {
        this.logger.error(`Failed to generate receipt for payment ${paymentId}: ${err.message}`);
      });
    }

    return approvedPaymentResult!;
  }

  /**
   * Reject a payment at tenant level (any building)
   */
  async rejectPaymentTenant(
    tenantId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    dto: RejectPaymentDto,
  ): Promise<Payment> {
    // Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'reject');
    }

    // Validate reason
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    // Find payment - tenant level (any building)
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Validate current status
    if (payment.status !== PaymentStatus.SUBMITTED) {
      throw new BadRequestException(
        `Cannot reject payment in status ${payment.status}. Only SUBMITTED payments can be rejected.`,
      );
    }

    if (payment.canceledAt) {
      throw new BadRequestException('Cannot reject a canceled payment');
    }

    // Update payment status with full audit trail
    const rejectedPayment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.REJECTED,
        reviewedByMembershipId: membershipId,
        rejectionReason: dto.reason as RejectionReason,
        rejectionComment: dto.comment || null,
        reviewedAt: new Date(),
        notes: dto.notes || null,
        updatedAt: new Date(),
      },
    });

    // Registrar auditoría
    await this.prisma.paymentAuditLog.create({
      data: {
        tenantId,
        paymentId,
        action: PaymentAuditAction.REJECTED,
        membershipId,
        reason: dto.reason,
        comment: dto.comment || null,
        metadata: {
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          reference: payment.reference,
        },
      },
    });

    // Send notification to resident
    void this.sendPaymentRejectedNotification(tenantId, payment, dto.reason);

    return rejectedPayment;
  }

  // ============================================================================
  // PAYMENT METRICS
  // ============================================================================

  /**
   * Get operational metrics for payment review
   */
  async getPaymentMetrics(
    tenantId: string,
    query: PaymentMetricsQueryDto,
  ): Promise<PaymentMetricsDto> {
    // Date range for metrics
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date();

    // Build where clause for pending (SUBMITTED)
    const pendingWhere: Prisma.PaymentWhereInput = {
      tenantId,
      status: PaymentStatus.SUBMITTED,
      canceledAt: null,
    };
    if (query.buildingId) {
      pendingWhere.buildingId = query.buildingId;
    }

    // Get pending payments
    const pendingPayments = await this.prisma.payment.findMany({
      where: pendingWhere,
      select: { amount: true, createdAt: true, buildingId: true },
    });

    // Calculate backlog
    const backlogCount = pendingPayments.length;
    const backlogAmount = pendingPayments.reduce((sum, p) => sum + p.amount, 0);

    // Calculate aging
    const now = new Date();
    const ages = pendingPayments.map(p => {
      const created = new Date(p.createdAt);
      return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    });
    ages.sort((a, b) => a - b);
    const agingMedianDays = ages.length > 0 ? ages[Math.floor(ages.length / 2)] : 0;
    const agingP95Days = ages.length > 0 ? ages[Math.floor(ages.length * 0.95)] : 0;

    // Get reviewed payments (APPROVED + REJECTED) in date range
    const reviewedWhere: Prisma.PaymentWhereInput = {
      tenantId,
      status: { in: [PaymentStatus.APPROVED, PaymentStatus.REJECTED] },
      updatedAt: { gte: dateFrom, lte: dateTo },
      canceledAt: null,
    };
    if (query.buildingId) {
      reviewedWhere.buildingId = query.buildingId;
    }

    const reviewedPayments = await this.prisma.payment.findMany({
      where: reviewedWhere,
      select: { status: true, reference: true },
    });

    const totalReviewed = reviewedPayments.length;
    const approvedCount = reviewedPayments.filter(p => p.status === PaymentStatus.APPROVED).length;
    const rejectedCount = reviewedPayments.filter(p => p.status === PaymentStatus.REJECTED).length;

    const approvalRate = totalReviewed > 0 ? (approvedCount / totalReviewed) * 100 : 0;
    const rejectionRate = totalReviewed > 0 ? (rejectedCount / totalReviewed) * 100 : 0;

    // Rejection reasons (from reference field)
    const reasonCounts = new Map<string, number>();
    reviewedPayments
      .filter(p => p.status === PaymentStatus.REJECTED && p.reference)
      .forEach(p => {
        const reason = p.reference || 'OTRO';
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      });
    const rejectionReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // By building
    const buildings = await this.prisma.building.findMany({
      where: { tenantId, ...(query.buildingId ? { id: query.buildingId } : {}) },
      select: { id: true, name: true },
    });

    const buildingIds = buildings.map(b => b.id);
    const paymentsByBuilding = await this.prisma.payment.groupBy({
      by: ['buildingId', 'status'],
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        canceledAt: null,
      },
      _count: true,
      _sum: { amount: true },
    });

    const byBuilding = buildings.map(b => {
      const pending = paymentsByBuilding.find(pb => pb.buildingId === b.id && pb.status === PaymentStatus.SUBMITTED);
      const approved = paymentsByBuilding.find(pb => pb.buildingId === b.id && pb.status === PaymentStatus.APPROVED);
      const rejected = paymentsByBuilding.find(pb => pb.buildingId === b.id && pb.status === PaymentStatus.REJECTED);
      return {
        buildingId: b.id,
        buildingName: b.name,
        pending: pending?._count || 0,
        pendingAmount: pending?._sum?.amount || 0,
        approved: approved?._count || 0,
        rejected: rejected?._count || 0,
      };
    });

    return {
      backlogCount,
      backlogAmount,
      agingMedianDays: agingMedianDays || 0,
      agingP95Days: agingP95Days || 0,
      totalReviewed,
      approvalRate,
      rejectionRate,
      rejectionReasons,
      byBuilding,
    };
  }

  // ============================================================================
  // PAYMENT AUDIT LOG
  // ============================================================================

  /**
   * Get audit history for a specific payment
   */
  async getPaymentAuditLog(
    tenantId: string,
    paymentId: string,
    query: { limit?: number },
  ): Promise<PaymentAuditLogDto[]> {
    // Validate payment belongs to tenant
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const logs = await this.prisma.paymentAuditLog.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
      take: query.limit || 20,
      include: {
        membership: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
      },
    });

    return logs.map(log => ({
      id: log.id,
      tenantId: log.tenantId,
      paymentId: log.paymentId,
      action: log.action,
      membershipId: log.membershipId || undefined,
      reason: log.reason || undefined,
      comment: log.comment || undefined,
      metadata: log.metadata as Record<string, unknown> | undefined,
      createdAt: log.createdAt,
      userName: log.membership?.user.name || undefined,
      userEmail: log.membership?.user.email || undefined,
    }));
  }

  /**
   * Check for potential duplicates (for admin review)
   */
  async checkPaymentDuplicate(
    tenantId: string,
    paymentId: string,
  ): Promise<PaymentDuplicateCheckResultDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Look for similar payments in last 48 hours
    const duplicateWindow = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const duplicate = await this.prisma.payment.findFirst({
      where: {
        tenantId,
        id: { not: paymentId }, // Exclude self
        amount: payment.amount,
        reference: payment.reference,
        createdAt: { gte: duplicateWindow },
        status: { in: [PaymentStatus.SUBMITTED, PaymentStatus.APPROVED] },
      },
    });

    return {
      hasDuplicate: !!duplicate,
      duplicatePaymentId: duplicate?.id,
      duplicateAmount: duplicate?.amount,
      duplicateReference: duplicate?.reference || undefined,
      duplicateCreatedAt: duplicate?.createdAt,
    };
  }

  /**
   * [PHASE 2 QUICK #3] Send PAYMENT_RECEIVED notification
   * Fire-and-forget: logs errors but never throws
   */
  private async sendPaymentReceivedNotification(tenantId: string, payment: Payment): Promise<void> {
    try {
      // Load unit occupants if this payment is unit-scoped
      if (!payment.unitId) return;

      const unit = await this.prisma.unit.findUnique({
        where: { id: payment.unitId },
        include: {
          unitOccupants: {
            where: { endDate: null }, // Active only
            include: {
              member: { select: { id: true, user: { select: { id: true } } } },
            },
          },
        },
      });

      if (!unit) return;

      // Send to all active residents
      for (const occupant of unit.unitOccupants) {
        if (occupant.member?.user?.id) {
          const amount = (payment.amount / 100).toFixed(2);
          await this.notificationsService.createNotification({
            tenantId,
            userId: occupant.member.user.id,
            type: 'PAYMENT_RECEIVED',
            title: 'Pago aprobado',
            body: `Tu pago de ${amount} ${payment.currency} ha sido aprobado y procesado correctamente.`,
            data: {
              paymentId: payment.id,
              paymentAmount: payment.amount / 100,
              paymentCurrency: payment.currency,
              reference: payment.reference || 'N/A',
              paidAt: payment.paidAt?.toISOString(),
            },
            deliveryMethods: ['IN_APP', 'EMAIL'],
          });
        }
      }
    } catch (error) {
      // Fire-and-forget: log but never fail
      console.error(
        `[FinanzasService] Failed to send payment received notification for payment ${payment.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * [PHASE 2 QUICK #4] Send PAYMENT_REJECTED notification
   * Fire-and-forget: logs errors but never throws
   */
  private async sendPaymentRejectedNotification(
    tenantId: string,
    payment: Payment,
    reason?: string,
  ): Promise<void> {
    try {
      // Load unit occupants if this payment is unit-scoped
      if (!payment.unitId) return;

      const unit = await this.prisma.unit.findUnique({
        where: { id: payment.unitId },
        include: {
          unitOccupants: {
            where: { endDate: null }, // Active only
            include: {
              member: { select: { id: true, user: { select: { id: true } } } },
            },
          },
        },
      });

      if (!unit) return;

      // Send to all active residents
      for (const occupant of unit.unitOccupants) {
        if (occupant.member?.user?.id) {
          const amount = (payment.amount / 100).toFixed(2);
          await this.notificationsService.createNotification({
            tenantId,
            userId: occupant.member.user.id,
            type: 'PAYMENT_REJECTED',
            title: 'Pago rechazado',
            body: `Tu pago de ${amount} ${payment.currency} ha sido rechazado. Motivo: ${reason || 'No especificado'}. Por favor intenta nuevamente.`,
            data: {
              paymentId: payment.id,
              paymentAmount: payment.amount / 100,
              paymentCurrency: payment.currency,
              rejectionReason: reason || 'No especificado',
            },
            deliveryMethods: ['IN_APP', 'EMAIL'],
          });
        }
      }
    } catch (error) {
      // Fire-and-forget: log but never fail
      console.error(
        `[FinanzasService] Failed to send payment rejected notification for payment ${payment.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Notify admins when a new payment is submitted by a resident
   * Fire-and-forget: logs errors but never throws
   */
  private async notifyAdminsOfPaymentSubmitted(tenantId: string, payment: Payment): Promise<void> {
    try {
      // Get all admin/operator memberships for this tenant via MembershipRole
      const adminMemberships = await this.prisma.membership.findMany({
        where: {
          tenantId,
          roles: {
            some: {
              role: { in: ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] },
            },
          },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      // Also check TenantMember for admins (fallback if MembershipRole is empty)
      const adminTenantMembers = await this.prisma.tenantMember.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          role: { in: ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      // Merge unique users from both sources
      const adminUserIds = new Set<string>();
      const adminsToNotify: Array<{ id: string; name: string | null; email: string | null }> = [];

      for (const m of adminMemberships) {
        if (m.user && !adminUserIds.has(m.user.id)) {
          adminUserIds.add(m.user.id);
          adminsToNotify.push({ id: m.user.id, name: m.user.name, email: m.user.email });
        }
      }

      for (const tm of adminTenantMembers) {
        if (tm.user && !adminUserIds.has(tm.user.id)) {
          adminUserIds.add(tm.user.id);
          adminsToNotify.push({ id: tm.user.id, name: tm.user.name, email: tm.user.email });
        }
      }

      if (adminsToNotify.length === 0) {
        console.log(`[FinanzasService] No admins found for tenant ${tenantId}, skipping notification`);
        return;
      }

      // Get the resident who submitted the payment
      const submittedByUser = await this.prisma.user.findUnique({
        where: { id: payment.createdByUserId },
        select: { name: true, email: true },
      });

      const unitLabel = payment.unitId 
        ? (await this.prisma.unit.findUnique({ where: { id: payment.unitId }, select: { label: true } }))?.label 
        : null;
      const buildingName = payment.buildingId 
        ? (await this.prisma.building.findUnique({ where: { id: payment.buildingId }, select: { name: true } }))?.name 
        : null;
      const amount = (payment.amount / 100).toFixed(2);

      console.log(`[FinanzasService] Notifying ${adminsToNotify.length} admins about payment ${payment.id}`);

      for (const admin of adminsToNotify) {
        await this.notificationsService.createNotification({
          tenantId,
          userId: admin.id,
          type: 'BUILDING_ALERT',
          title: '💰 Nuevo pago pendiente de revisión',
          body: `El residente ${submittedByUser?.name || submittedByUser?.email || 'unknown'} envió un pago de ${amount} ${payment.currency} para la unidad ${unitLabel || payment.unitId || 'N/A'}${buildingName ? ` en ${buildingName}` : ''}. Método: ${payment.method}. ${payment.proofFileId ? '✅ Tiene comprobante.' : '⚠️ Sin comprobante.'}`,
          data: {
            event: 'PAYMENT_SUBMITTED',
            paymentId: payment.id,
            paymentAmount: payment.amount / 100,
            paymentCurrency: payment.currency,
            paymentMethod: payment.method,
            unitLabel: unitLabel || payment.unitId,
            buildingName: buildingName,
            hasProof: !!payment.proofFileId,
            submittedBy: submittedByUser?.name || submittedByUser?.email,
          },
          deliveryMethods: ['IN_APP', 'EMAIL'],
        });
      }
    } catch (error) {
      // Fire-and-forget: log but never fail
      console.error(
        `[FinanzasService] Failed to notify admins of payment submitted ${payment.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * [PHASE 3 MEDIUM #8] Detect and notify overdue charges
   * Runs daily at 9am - marks charges as overdue and notifies residents
   */
  async detectAndNotifyOverdueCharges(): Promise<{ count: number }> {
    const now = new Date();
    const overdue = await this.prisma.charge.findMany({
      where: {
        status: { in: ['PENDING', 'PARTIAL'] },
        dueDate: { lt: now },
        overdueSince: null, // Only process once
        canceledAt: null,
      },
      include: {
        unit: {
          include: {
            unitOccupants: {
              where: { endDate: null },
              include: { member: { select: { user: { select: { id: true } } } } },
            },
            building: { select: { id: true, name: true, tenantId: true } },
          },
        },
      },
    });

    let notifiedCount = 0;

    for (const charge of overdue) {
      // Mark as overdue
      await this.prisma.charge.update({
        where: { id: charge.id },
        data: { overdueSince: now },
      });

      // Notify residents
      const daysOverdue = Math.floor((now.getTime() - charge.dueDate.getTime()) / (1000 * 60 * 60 * 24));
      for (const occupant of charge.unit.unitOccupants) {
        if (occupant.member?.user?.id) {
          const amount = (charge.amount / 100).toFixed(2);
          await this.notificationsService.createNotification({
            tenantId: charge.tenantId,
            userId: occupant.member.user.id,
            type: 'PAYMENT_OVERDUE',
            title: `Pago vencido - ${charge.unit.building.name}`,
            body: `El pago de ${amount} ${charge.currency} en la unidad ${charge.unit.label} vence hace ${daysOverdue} días. Por favor realiza el pago inmediatamente.`,
            data: {
              chargeAmount: charge.amount / 100,
              chargeCurrency: charge.currency,
              unitLabel: charge.unit.label,
              buildingName: charge.unit.building.name,
              daysOverdue,
            },
            deliveryMethods: ['IN_APP', 'EMAIL'],
          });
          notifiedCount++;
        }
      }
    }

    return { count: notifiedCount };
  }

  /**
   * [PHASE 3 MEDIUM #9] Auto-create monthly expense periods
   * Runs on 1st of each month at 8am - creates next month's period for buildings
   */
  async autoCreateMonthlyExpensePeriods(): Promise<{ created: number }> {
    const now = new Date();
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1);
    const year = nextMonthDate.getFullYear();
    const month = nextMonthDate.getMonth() + 1;

    // Find all buildings with expensePeriods
    const buildings = await this.prisma.building.findMany({
      include: {
        expensePeriods: {
          where: { year, month },
          take: 1,
        },
      },
    });

    let createdCount = 0;

    for (const building of buildings) {
      // Skip if period already exists for next month
      if (building.expensePeriods.length > 0) {
        continue;
      }

      // Get last period's total as baseline
      const lastPeriod = await this.prisma.expensePeriod.findFirst({
        where: { buildingId: building.id },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });

      const defaultTotalBigInt = lastPeriod?.totalToAllocate || 0n;
      const defaultTotal = typeof defaultTotalBigInt === 'bigint' ? Number(defaultTotalBigInt) : defaultTotalBigInt;

      // Create new period (due 15th of next month)
      const dueDate = new Date(year, month - 1, 15);

      const period = await this.prisma.expensePeriod.create({
        data: {
          tenantId: building.tenantId,
          buildingId: building.id,
          year,
          month,
          totalToAllocate: defaultTotal,
          dueDate,
          status: 'DRAFT',
          concept: `Expensas Comunes - ${String(month).padStart(2, '0')}/${year}`,
          currency: 'ARS',
        },
      });

      // Notify tenants (no specific admin contact in Building model, skip for now)
      // TODO: Could query Memberships with TENANT_ADMIN role if needed

      createdCount++;
    }

    return { created: createdCount };
  }

  /**
   * [PHASE 3 MEDIUM #10] Send payment reminders for charges due in 3 days
   * Runs daily at 10am - notifies residents of upcoming due dates
   */
  async sendPaymentReminders(): Promise<{ count: number }> {
    const now = new Date();
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const startOfDay = new Date(inThreeDays.getFullYear(), inThreeDays.getMonth(), inThreeDays.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    // Find charges due in exactly 3 days
    const remindableCharges = await this.prisma.charge.findMany({
      where: {
        status: { in: ['PENDING', 'PARTIAL'] },
        dueDate: {
          gte: startOfDay,
          lt: endOfDay,
        },
        reminderSentAt: null, // Only once per charge
        canceledAt: null,
      },
      include: {
        unit: {
          include: {
            unitOccupants: {
              where: { endDate: null },
              include: { member: { select: { user: { select: { id: true } } } } },
            },
            building: { select: { name: true } },
          },
        },
      },
    });

    let reminderCount = 0;

    for (const charge of remindableCharges) {
      // Mark reminder as sent
      await this.prisma.charge.update({
        where: { id: charge.id },
        data: { reminderSentAt: now },
      });

      // Notify residents
      const dueStr = charge.dueDate.toLocaleDateString('es-AR');
      const amount = (charge.amount / 100).toFixed(2);
      for (const occupant of charge.unit.unitOccupants) {
        if (occupant.member?.user?.id) {
          await this.notificationsService.createNotification({
            tenantId: charge.tenantId,
            userId: occupant.member.user.id,
            type: 'PAYMENT_REMINDER',
            title: 'Recordatorio: Pago vence en 3 días',
            body: `Recordatorio: Tu pago de ${amount} ${charge.currency} para ${charge.unit.label} vence el ${dueStr}. Realiza el pago ahora para evitar demoras.`,
            data: {
              chargeAmount: charge.amount / 100,
              chargeCurrency: charge.currency,
              unitLabel: charge.unit.label,
              dueDate: charge.dueDate.toISOString(),
            },
            deliveryMethods: ['IN_APP', 'EMAIL'],
          });
          reminderCount++;
        }
      }
    }

    return { count: reminderCount };
  }

  /**
   * [PHASE 3 MEDIUM #11] Bulk validate all DRAFT expenses for a building
   * Allows admins to validate multiple expenses in a single API call
   * Useful when importing batches of expenses or after review period
   */
  async bulkValidateExpenses(
    tenantId: string,
    buildingId: string,
    periodId?: string,
  ): Promise<{ validatedCount: number; errorCount: number }> {
    // Build query for DRAFT expenses
    const where: any = {
      tenantId,
      buildingId,
      status: 'DRAFT',
    };

    if (periodId) {
      where.period = periodId;
    }

    // Find all DRAFT expenses
    const draftExpenses = await this.prisma.expense.findMany({
      where,
      select: { id: true },
    });

    let validatedCount = 0;
    let errorCount = 0;

    // Validate all in parallel using Promise.allSettled
    const updatePromises = draftExpenses.map((exp) =>
      this.prisma.expense.update({
        where: { id: exp.id },
        data: { status: 'VALIDATED' },
      }),
    );

    const results = await Promise.allSettled(updatePromises);

    // Count successes and failures
    for (const result of results) {
      if (result.status === 'fulfilled') {
        validatedCount++;
      } else {
        errorCount++;
        this.logger.error(
          'Failed to validate expense during bulk operation',
          result.reason instanceof Error ? result.reason.stack : String(result.reason),
        );
      }
    }

    // Audit the bulk operation (fire-and-forget)
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.EXPENSE_VALIDATE,
      entityType: 'EXPENSE',
      entityId: buildingId,
      metadata: {
        validatedCount,
        errorCount,
        period: periodId || 'ALL',
        bulkOperation: true,
      },
    });

    return { validatedCount, errorCount };
  }

  /**
   * Retry generating receipt for an approved payment (if previous attempt failed)
   */
  async retryReceiptGeneration(
    tenantId: string,
    paymentId: string,
    userRoles: string[],
  ): Promise<{ success: boolean; receiptNumber?: string; error?: string }> {
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'retry receipt');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.APPROVED) {
      throw new BadRequestException('Can only retry receipt generation for approved payments');
    }

    // Only retry if failed or no receipt exists
    if (payment.receiptStatus !== ReceiptStatus.FAILED && payment.receiptNumber) {
      return {
        success: true,
        receiptNumber: payment.receiptNumber,
      };
    }

    // Reset to PENDING before retry
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        receiptStatus: ReceiptStatus.PENDING,
        receiptError: null,
      },
    });

    // Try to generate receipt
    const result = await this.receiptService.ensureReceiptForPayment(paymentId);

    if (result) {
      return {
        success: true,
        receiptNumber: result.receiptNumber,
      };
    }

    // Check for error
    const updatedPayment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { receiptError: true },
    });

    return {
      success: false,
      error: updatedPayment?.receiptError || 'Unknown error during receipt generation',
    };
  }
}
