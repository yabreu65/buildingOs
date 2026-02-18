import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionService } from './subscription.service';
import {
  PaymentVerificationStatus,
  SubscriptionStatus,
  AuditAction,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export interface CreatePaymentVerificationDto {
  amount: number;
  currency: string;
  reference?: string;
  bankDetails?: string;
  metadata?: Record<string, any>;
}

export interface ApprovePaymentDto {
  approvedByUserId: string;
}

export interface RejectPaymentDto {
  approvedByUserId: string;
  reason: string;
}

@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private subscriptionService: SubscriptionService,
  ) {}

  /**
   * Create a payment verification request
   * Tenant has transferred money, admin must verify
   */
  async createPaymentVerification(
    tenantId: string,
    dto: CreatePaymentVerificationDto,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    // Only TRIAL or PAST_DUE can request payment verification
    if (
      subscription.status !== SubscriptionStatus.TRIAL &&
      subscription.status !== SubscriptionStatus.PAST_DUE
    ) {
      throw new BadRequestException(
        `Cannot request payment verification for subscription in ${subscription.status} status`,
      );
    }

    // Create payment verification record
    const paymentVerification = await this.prisma.paymentVerification.create({
      data: {
        tenantId,
        subscriptionId: subscription.id,
        amount: new Decimal(dto.amount),
        currency: dto.currency,
        reference: dto.reference,
        bankDetails: dto.bankDetails,
        status: PaymentVerificationStatus.PENDING,
        metadata: dto.metadata || {},
      },
    });

    // Audit log
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.PAYMENT_SUBMIT,
      entityType: 'PaymentVerification',
      entityId: paymentVerification.id,
      metadata: {
        amount: dto.amount,
        currency: dto.currency,
        reference: dto.reference,
      },
    });

    return paymentVerification;
  }

  /**
   * List pending payment verifications (for admin dashboard)
   */
  async listPendingPayments(filter?: {
    tenantId?: string;
    status?: PaymentVerificationStatus;
  }) {
    return this.prisma.paymentVerification.findMany({
      where: {
        tenantId: filter?.tenantId,
        status: filter?.status || PaymentVerificationStatus.PENDING,
      },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
          },
        },
        subscription: {
          include: {
            plan: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve payment verification by admin
   * Transitions subscription to ACTIVE
   */
  async approvePayment(
    paymentVerificationId: string,
    dto: ApprovePaymentDto,
  ) {
    const payment = await this.prisma.paymentVerification.findUnique({
      where: { id: paymentVerificationId },
      include: { subscription: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment verification not found');
    }

    if (payment.status !== PaymentVerificationStatus.PENDING) {
      throw new BadRequestException(
        `Cannot approve payment with status ${payment.status}`,
      );
    }

    // Update payment verification
    const updated = await this.prisma.paymentVerification.update({
      where: { id: paymentVerificationId },
      data: {
        status: PaymentVerificationStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: dto.approvedByUserId,
      },
    });

    // Transition subscription based on current status
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: payment.subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.status === SubscriptionStatus.TRIAL) {
      await this.subscriptionService.transitionTrialToActive(
        payment.tenantId,
        paymentVerificationId,
        dto.approvedByUserId,
      );
    } else if (subscription.status === SubscriptionStatus.PAST_DUE) {
      await this.subscriptionService.transitionPastDueToActive(
        payment.tenantId,
        paymentVerificationId,
        dto.approvedByUserId,
      );
    }

    return updated;
  }

  /**
   * Reject payment verification by admin
   */
  async rejectPayment(
    paymentVerificationId: string,
    dto: RejectPaymentDto,
  ) {
    const payment = await this.prisma.paymentVerification.findUnique({
      where: { id: paymentVerificationId },
    });

    if (!payment) {
      throw new NotFoundException('Payment verification not found');
    }

    if (payment.status !== PaymentVerificationStatus.PENDING) {
      throw new BadRequestException(
        `Cannot reject payment with status ${payment.status}`,
      );
    }

    // Update payment verification
    const updated = await this.prisma.paymentVerification.update({
      where: { id: paymentVerificationId },
      data: {
        status: PaymentVerificationStatus.REJECTED,
        rejectedAt: new Date(),
        approvedByUserId: dto.approvedByUserId,
        rejectionReason: dto.reason,
      },
    });

    // Audit log
    void this.auditService.createLog({
      tenantId: payment.tenantId,
      actorUserId: dto.approvedByUserId,
      action: AuditAction.PAYMENT_REJECT,
      entityType: 'PaymentVerification',
      entityId: paymentVerificationId,
      metadata: {
        reason: dto.reason,
        amount: payment.amount.toString(),
      },
    });

    return updated;
  }

  /**
   * Get payment verification details
   */
  async getPaymentVerification(paymentVerificationId: string) {
    const payment = await this.prisma.paymentVerification.findUnique({
      where: { id: paymentVerificationId },
      include: {
        tenant: true,
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment verification not found');
    }

    return payment;
  }
}
