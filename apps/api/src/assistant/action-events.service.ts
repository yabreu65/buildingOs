import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';

export interface CreateActionEventDto {
  actionType: string; // VIEW_TICKETS | CREATE_TICKET | VIEW_PAYMENTS | etc.
  source: string; // "CHAT" | "TEMPLATE" | "TEMPLATE_INSERT"
  page: string;
  buildingId?: string;
  unitId?: string;
  interactionId?: string;
}

@Injectable()
export class AiActionEventsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /**
   * Track a click on a suggested action (fire-and-forget)
   * Never fails the main operation
   */
  async trackClick(
    tenantId: string,
    membershipId: string,
    dto: CreateActionEventDto,
  ): Promise<void> {
    try {
      // Create the AiActionEvent
      await this.prisma.aiActionEvent.create({
        data: {
          tenantId,
          membershipId,
          actionType: dto.actionType,
          source: dto.source,
          page: dto.page,
          buildingId: dto.buildingId,
          unitId: dto.unitId,
          interactionId: dto.interactionId,
        },
      });

      // Audit log (fire-and-forget)
      this.audit
        .createLog({
          tenantId,
          actorMembershipId: membershipId,
          action: AuditAction.AI_ACTION_CLICKED,
          entityType: 'AiActionEvent',
          entityId: `${tenantId}:${dto.actionType}`,
          metadata: {
            actionType: dto.actionType,
            source: dto.source,
            page: dto.page,
            buildingId: dto.buildingId,
            unitId: dto.unitId,
          },
        })
        .catch(() => {
          // Fire-and-forget: ignore errors
        });
    } catch (error) {
      // Fire-and-forget: log but don't fail
      console.error('Failed to track AI action event:', error);
    }
  }
}
