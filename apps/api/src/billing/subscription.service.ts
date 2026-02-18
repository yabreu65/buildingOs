import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  SubscriptionStatus,
  PaymentVerificationStatus,
  AuditAction,
} from '@prisma/client';

@Injectable()
export class SubscriptionService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  /**
   * Get tenant subscription with plan details
   */
  async getSubscription(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: {
        plan: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    return subscription;
  }

  /**
   * Transition subscription: TRIAL → ACTIVE
   * Called when payment is approved by admin
   */
  async transitionTrialToActive(
    tenantId: string,
    paymentVerificationId: string,
    adminUserId: string,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.status !== SubscriptionStatus.TRIAL) {
      throw new BadRequestException(
        `Cannot transition from ${subscription.status} to ACTIVE`,
      );
    }

    // Update subscription status
    await this.prisma.subscription.update({
      where: { tenantId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    // Create audit log
    void this.auditService.createLog({
      tenantId,
      actorUserId: adminUserId,
      action: AuditAction.PAYMENT_APPROVE,
      entityType: 'Subscription',
      entityId: subscription.id,
      metadata: {
        paymentVerificationId,
        newStatus: SubscriptionStatus.ACTIVE,
      },
    });
  }

  /**
   * Transition subscription: PAST_DUE → ACTIVE
   * Called when past due payment is approved by admin
   */
  async transitionPastDueToActive(
    tenantId: string,
    paymentVerificationId: string,
    adminUserId: string,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.status !== SubscriptionStatus.PAST_DUE) {
      throw new BadRequestException(
        `Cannot transition from ${subscription.status} to ACTIVE`,
      );
    }

    // Update subscription status
    await this.prisma.subscription.update({
      where: { tenantId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    // Create audit log
    void this.auditService.createLog({
      tenantId,
      actorUserId: adminUserId,
      action: AuditAction.PAYMENT_APPROVE,
      entityType: 'Subscription',
      entityId: subscription.id,
      metadata: {
        paymentVerificationId,
        transitionFrom: SubscriptionStatus.PAST_DUE,
        newStatus: SubscriptionStatus.ACTIVE,
      },
    });
  }

  /**
   * Mark subscription as PAST_DUE
   * Called by scheduler when trial/active period expires without payment
   */
  async markPastDue(tenantId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      return; // No subscription, nothing to do
    }

    if (
      subscription.status === SubscriptionStatus.PAST_DUE ||
      subscription.status === SubscriptionStatus.CANCELED
    ) {
      return; // Already marked or canceled
    }

    await this.prisma.subscription.update({
      where: { tenantId },
      data: {
        status: SubscriptionStatus.PAST_DUE,
      },
    });

    // Audit log (no actor, it's automatic)
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.SUBSCRIPTION_PAST_DUE,
      entityType: 'Subscription',
      entityId: subscription.id,
      metadata: {
        previousStatus: subscription.status,
        reason: 'Payment not received within grace period',
      },
    });
  }

  /**
   * Cancel subscription
   * Called by scheduler or admin
   */
  async cancelSubscription(
    tenantId: string,
    reason: string,
    adminUserId?: string,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    await this.prisma.subscription.update({
      where: { tenantId },
      data: {
        status: SubscriptionStatus.CANCELED,
        currentPeriodEnd: new Date(),
      },
    });

    // Audit log
    void this.auditService.createLog({
      tenantId,
      actorUserId: adminUserId,
      action: AuditAction.SUBSCRIPTION_CANCEL,
      entityType: 'Subscription',
      entityId: subscription.id,
      metadata: {
        previousStatus: subscription.status,
        reason,
        canceledBy: adminUserId ? 'ADMIN' : 'AUTOMATIC',
      },
    });
  }
}
