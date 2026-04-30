import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssistantHandoffStatus } from '@prisma/client';
import { HitlQueueService } from '../../assistant/hitl-queue.service';
import { HitlRepository } from './hitl.repository';
import { HitlActorContext, HitlListQuery } from './hitl.types';

const OPS_ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR']);

@Injectable()
export class HitlService {
  private readonly logger = new Logger(HitlService.name);

  constructor(
    private readonly repository: HitlRepository,
    private readonly queue: HitlQueueService,
  ) {}

  private assertOpsRole(actor: HitlActorContext): void {
    if (actor.isSuperAdmin) {
      return;
    }

    const allowed = actor.roles.some((role) => OPS_ALLOWED_ROLES.has(role));
    if (!allowed) {
      throw new ForbiddenException('Role not allowed for HITL workqueue');
    }
  }

  private resolveTenantScope(actor: HitlActorContext, requestedTenantId?: string): string | undefined {
    if (actor.isSuperAdmin) {
      return requestedTenantId;
    }

    if (!actor.tenantId) {
      throw new BadRequestException('Tenant context required');
    }

    if (requestedTenantId && requestedTenantId !== actor.tenantId) {
      throw new ForbiddenException('Tenant mismatch');
    }

    return actor.tenantId;
  }

  private mapStatusFilter(status?: string): AssistantHandoffStatus[] | undefined {
    if (!status) {
      return undefined;
    }

    const normalized = status.trim().toLowerCase();

    switch (normalized) {
      case 'open':
        return ['OPEN', 'PENDING', 'NOTIFIED', 'FAILED'];
      case 'in_progress':
      case 'in-progress':
        return ['IN_PROGRESS'];
      case 'resolved':
        return ['RESOLVED'];
      case 'dismissed':
        return ['DISMISSED'];
      default: {
        const asEnum = status.trim().toUpperCase() as AssistantHandoffStatus;
        const validStatuses: AssistantHandoffStatus[] = [
          'OPEN',
          'IN_PROGRESS',
          'PENDING',
          'NOTIFIED',
          'FAILED',
          'RESOLVED',
          'DISMISSED',
        ];
        if (!validStatuses.includes(asEnum)) {
          throw new BadRequestException('Invalid status filter');
        }
        return [asEnum];
      }
    }
  }

  private clampLimit(limit?: number): number {
    if (!limit || Number.isNaN(limit)) {
      return 20;
    }

    return Math.max(1, Math.min(100, limit));
  }

  private parseCsvEnv(value?: string): string[] {
    if (!value || value.trim().length === 0) {
      return [];
    }
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private isExternalNotifyEnabledForTenant(tenantId: string): boolean {
    const enabled = (process.env.HITL_RESPOND_ENABLED || 'false') === 'true';
    if (!enabled) {
      return false;
    }

    const canaryTenants = this.parseCsvEnv(process.env.HITL_RESPOND_CANARY_TENANTS);
    if (canaryTenants.length === 0) {
      return true;
    }

    return canaryTenants.includes('*') || canaryTenants.includes(tenantId);
  }

  private resolveExternalChannel(): 'EMAIL' | 'WHATSAPP' | 'PUSH' | null {
    const configured = (process.env.HITL_RESPOND_DEFAULT_CHANNEL || 'EMAIL').trim().toUpperCase();
    if (configured === 'EMAIL' || configured === 'WHATSAPP' || configured === 'PUSH') {
      return configured;
    }
    return null;
  }

  private async getAuthorizedHandoff(id: string, actor: HitlActorContext) {
    const handoff = await this.repository.findById(id);

    if (!handoff) {
      throw new NotFoundException('Handoff not found');
    }

    if (!actor.isSuperAdmin && handoff.tenantId !== actor.tenantId) {
      throw new ForbiddenException('Tenant mismatch');
    }

    return handoff;
  }

  async list(actor: HitlActorContext, query: HitlListQuery) {
    this.assertOpsRole(actor);

    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const statuses = this.mapStatusFilter(query.status);
    const limit = this.clampLimit(query.limit);

    return this.repository.list({
      tenantId,
      statuses,
      fallbackPath: query.fallbackPath,
      cursor: query.cursor,
      limit,
    });
  }

  async getById(actor: HitlActorContext, id: string) {
    this.assertOpsRole(actor);
    return this.getAuthorizedHandoff(id, actor);
  }

  async assign(actor: HitlActorContext, id: string) {
    this.assertOpsRole(actor);

    const handoff = await this.getAuthorizedHandoff(id, actor);

    if (handoff.status === 'RESOLVED' || handoff.status === 'DISMISSED') {
      throw new BadRequestException('Cannot assign a closed handoff');
    }

    const updated = await this.repository.assign({
      id,
      assignedToUserId: actor.userId,
    });

    await this.repository.createAudit({
      handoffId: updated.id,
      actorUserId: actor.userId,
      action: 'handoff.assign',
    });

    return updated;
  }

  async resolve(
    actor: HitlActorContext,
    id: string,
    resolutionNote: string,
    options?: { notifyUser?: boolean },
  ) {
    this.assertOpsRole(actor);

    const note = resolutionNote?.trim();
    if (!note) {
      throw new BadRequestException('resolutionNote is required');
    }

    const handoff = await this.getAuthorizedHandoff(id, actor);
    if (handoff.status === 'RESOLVED' || handoff.status === 'DISMISSED') {
      throw new BadRequestException('Handoff already closed');
    }

    const updated = await this.repository.resolve({
      id,
      resolutionNote: note,
      actorUserId: actor.userId,
    });

    await this.repository.createAudit({
      handoffId: updated.id,
      actorUserId: actor.userId,
      action: 'handoff.resolve',
    });

    const inAppMessage = await this.repository.createMessage({
      tenantId: updated.tenantId,
      userId: updated.userId,
      handoffId: updated.id,
      traceId: updated.traceId,
      content: note,
      createdByUserId: actor.userId,
      channel: 'IN_APP',
      deliveryStatus: 'DELIVERED',
    });

    let notifyEnqueued = false;
    if (options?.notifyUser && this.isExternalNotifyEnabledForTenant(updated.tenantId)) {
      const externalChannel = this.resolveExternalChannel();
      if (externalChannel) {
        const externalMessage = await this.repository.createMessage({
          tenantId: updated.tenantId,
          userId: updated.userId,
          handoffId: updated.id,
          traceId: updated.traceId,
          content: note,
          createdByUserId: actor.userId,
          channel: externalChannel,
          deliveryStatus: 'QUEUED',
        });

        await this.queue.enqueueRespond({
          messageId: externalMessage.id,
          tenantId: externalMessage.tenantId,
          userId: externalMessage.userId,
          handoffId: externalMessage.handoffId,
          traceId: externalMessage.traceId,
        });
        notifyEnqueued = true;
      } else {
        this.logger.warn({
          msg: '[HITL] notifyUser requested but HITL_RESPOND_DEFAULT_CHANNEL is invalid',
          handoffId: updated.id,
          configuredChannel: process.env.HITL_RESPOND_DEFAULT_CHANNEL,
        });
      }
    }

    return {
      ...updated,
      responseRegistered: true,
      messageId: inAppMessage.id,
      notifyEnqueued,
    };
  }

  async dismiss(actor: HitlActorContext, id: string) {
    this.assertOpsRole(actor);

    const handoff = await this.getAuthorizedHandoff(id, actor);
    if (handoff.status === 'RESOLVED' || handoff.status === 'DISMISSED') {
      throw new BadRequestException('Handoff already closed');
    }

    const updated = await this.repository.dismiss(id);

    await this.repository.createAudit({
      handoffId: updated.id,
      actorUserId: actor.userId,
      action: 'handoff.dismiss',
    });

    return updated;
  }
}
