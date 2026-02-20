import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, BillingPlanId } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanChangeRequestDto } from './dto/create-plan-change-request.dto';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  private isSuperAdmin(user: any): boolean {
    return user.memberships?.some((membership) =>
      membership.roles?.includes('SUPER_ADMIN'),
    );
  }

  private assertTenantAdmin(user: any, tenantId: string) {
    const membership = user.memberships?.find((m) => m.tenantId === tenantId);

    if (!membership) {
      throw new ForbiddenException('No tienes acceso al tenant indicado');
    }

    const hasAdminRole = membership.roles?.some((role) =>
      ['TENANT_OWNER', 'TENANT_ADMIN'].includes(role),
    );

    if (!hasAdminRole) {
      throw new ForbiddenException(
        'Se requiere rol TENANT_OWNER o TENANT_ADMIN para solicitar upgrades',
      );
    }

    return membership;
  }

  async createPlanChangeRequest(user: any, dto: CreatePlanChangeRequestDto) {
    const membership = this.assertTenantAdmin(user, dto.tenantId);

    const requestedPlan = await this.prisma.billingPlan.findUnique({
      where: { id: dto.requestedPlanId },
    });

    if (!requestedPlan) {
      throw new BadRequestException('El plan solicitado no existe');
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: dto.tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new NotFoundException('No existe suscripción para el tenant');
    }

    if (this.getPlanRank(subscription.plan.planId) >= this.getPlanRank(requestedPlan.planId)) {
      throw new BadRequestException(
        'En MVP solo se permiten upgrades a planes superiores',
      );
    }

    const pendingRequest = await this.prisma.planChangeRequest.findFirst({
      where: {
        tenantId: dto.tenantId,
        status: 'PENDING',
      },
    });

    if (pendingRequest) {
      throw new ConflictException(
        'Ya existe una solicitud pendiente para este tenant',
      );
    }

    const request = await this.prisma.planChangeRequest.create({
      data: {
        tenantId: dto.tenantId,
        requestedPlanId: dto.requestedPlanId,
        status: 'PENDING',
        requestedByMembershipId: membership.id,
        note: dto.note,
      },
      include: {
        requestedPlan: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: dto.tenantId,
        actorUserId: user.id,
        actorMembershipId: membership.id,
        action: AuditAction.PLAN_CHANGE_REQUESTED,
        entity: 'PlanChangeRequest',
        entityId: request.id,
        metadata: {
          requestedPlanId: dto.requestedPlanId,
          note: dto.note ?? null,
          subscriptionStatus: subscription.status,
          requiresPaymentConfirmation: ['PAST_DUE', 'CANCELED'].includes(
            subscription.status,
          ),
        },
      },
    });

    return {
      ...request,
      requiresPaymentConfirmation: ['PAST_DUE', 'CANCELED'].includes(
        subscription.status,
      ),
    };
  }

  async listTenantPlanChangeRequests(user: any, tenantId: string) {
    this.assertTenantAdmin(user, tenantId);

    return this.prisma.planChangeRequest.findMany({
      where: { tenantId },
      include: {
        requestedPlan: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelPlanChangeRequest(user: any, tenantId: string, requestId: string) {
    const membership = this.assertTenantAdmin(user, tenantId);

    const request = await this.prisma.planChangeRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.tenantId !== tenantId) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    if (request.status !== 'PENDING') {
      throw new ConflictException('Solo se pueden cancelar solicitudes en PENDING');
    }

    const updated = await this.prisma.planChangeRequest.update({
      where: { id: requestId },
      data: {
        status: 'CANCELED',
        reviewedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId: user.id,
        actorMembershipId: membership.id,
        action: AuditAction.PLAN_CHANGE_REQUEST_CANCELED,
        entity: 'PlanChangeRequest',
        entityId: requestId,
      },
    });

    return updated;
  }

  async listSuperAdminPlanChangeRequests(
    user: any,
    status?: string,
  ) {
    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException('Acceso sólo para SUPER_ADMIN');
    }

    return this.prisma.planChangeRequest.findMany({
      where: {
        status: status ?? undefined,
      },
      include: {
        tenant: true,
        requestedPlan: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approvePlanChangeRequest(user: any, requestId: string) {
    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException('Acceso sólo para SUPER_ADMIN');
    }

    const request = await this.prisma.planChangeRequest.findUnique({
      where: { id: requestId },
      include: {
        requestedPlan: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    if (request.status !== 'PENDING') {
      throw new ConflictException('La solicitud ya fue procesada');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { tenantId: request.tenantId },
      });

      if (!subscription) {
        throw new NotFoundException('No existe suscripción para este tenant');
      }

      const currentPlan = await tx.billingPlan.findUnique({
        where: { id: subscription.planId },
      });

      if (!currentPlan) {
        throw new NotFoundException('No existe el plan actual de la suscripción');
      }

      if (
        this.getPlanRank(currentPlan.planId) >=
        this.getPlanRank(request.requestedPlan.planId)
      ) {
        throw new BadRequestException('No se puede aprobar un no-upgrade en MVP');
      }

      const updatedSubscription = await tx.subscription.update({
        where: { id: subscription.id },
        data: { planId: request.requestedPlanId },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          eventType: 'PLAN_CHANGED_MANUAL',
          prevPlanId: currentPlan.id,
          newPlanId: request.requestedPlanId,
          metadata: {
            createdByUserId: user.id,
          },
        },
      });

      const updatedRequest = await tx.planChangeRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedByUserId: user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: request.tenantId,
          actorUserId: user.id,
          actorMembershipId: null,
          action: AuditAction.PLAN_CHANGE_APPROVED,
          entity: 'PlanChangeRequest',
          entityId: request.id,
          metadata: {
            fromPlanId: currentPlan.id,
            toPlanId: request.requestedPlanId,
          },
        },
      });

      return {
        request: updatedRequest,
        subscription: updatedSubscription,
      };
    });

    return result;
  }

  async rejectPlanChangeRequest(user: any, requestId: string, reason: string) {
    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException('Acceso sólo para SUPER_ADMIN');
    }

    const request = await this.prisma.planChangeRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    if (request.status !== 'PENDING') {
      throw new ConflictException('La solicitud ya fue procesada');
    }

    const updatedRequest = await this.prisma.planChangeRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        reviewReason: reason,
        reviewedAt: new Date(),
        reviewedByUserId: user.id,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: request.tenantId,
        actorUserId: user.id,
        action: AuditAction.PLAN_CHANGE_REJECTED,
        entity: 'PlanChangeRequest',
        entityId: request.id,
        metadata: {
          reason,
        },
      },
    });

    return updatedRequest;
  }

  private getPlanRank(planId: BillingPlanId): number {
    switch (planId) {
      case BillingPlanId.FREE:
        return 0;
      case BillingPlanId.BASIC:
        return 1;
      case BillingPlanId.PRO:
        return 2;
      case BillingPlanId.ENTERPRISE:
        return 3;
      default:
        return 0;
    }
  }
}
