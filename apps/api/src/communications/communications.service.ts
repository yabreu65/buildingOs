/**
 * CommunicationsService: CRUD operations for Communications with scope validation
 *
 * All methods validate that resources belong to the tenant.
 * No cross-tenant access is possible, even with guessed IDs.
 */

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommunicationChannel,
  CommunicationStatus,
  CommunicationTargetType,
  CommunicationPriority,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationsValidators } from './communications.validators';
import { ADMIN_ROLES } from './admin-role.guard';
import { ConfigService } from '../config/config.service';
import type { CommunicationScopeType } from '@buildingos/contracts';
import type { ResidentCommunicationListResponse } from '@buildingos/contracts';

/** Include spec shared by all queries that return full communication details */
const COMMUNICATION_INCLUDE = {
  targets: true,
  receipts: {
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
  createdByMembership: {
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
} as const;

export type CommunicationWithDetails = Prisma.CommunicationGetPayload<{
  include: typeof COMMUNICATION_INCLUDE;
}>;

export interface FindAllFilters {
  buildingId?: string;
  status?: CommunicationStatus;
  channel?: CommunicationChannel;
  search?: string;
  sortBy?: 'createdAt' | 'sentAt' | 'scheduledAt';
  sortOrder?: 'asc' | 'desc';
}

export interface FindForUserFilters {
  buildingId?: string;
  readOnly?: boolean;
  status?: CommunicationStatus;
  channel?: CommunicationChannel;
  search?: string;
  sortBy?: 'createdAt' | 'sentAt' | 'scheduledAt';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateCommunicationInput {
  title: string;
  body: string;
  channel: CommunicationChannel;
  buildingId?: string; // Optional: null for cross-building
  targets: Array<{
    targetType: CommunicationTargetType;
    targetId?: string;
  }>;
}

export interface UpdateCommunicationInput {
  title?: string;
  body?: string;
  channel?: CommunicationChannel;
}

export interface ScheduleCommunicationInput {
  scheduledAt: Date;
}

export interface CreateCommunicationV2Input {
  title: string;
  body: string;
  status: 'DRAFT' | 'PUBLISHED';
  priority: CommunicationPriority;
  scopeType: CommunicationScopeType;
  buildingId?: string;
  buildingIds?: string[];
}

export interface PublishV2Options {
  sendWebPush: boolean;
}

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: CommunicationsValidators,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new communication (DRAFT status)
   *
   * Validates:
   * - Building (if provided) belongs to tenant
   * - All targets are valid for tenant
   *
   * Creates:
   * - Communication with DRAFT status
   * - CommunicationTarget entries
   * - CommunicationReceipt entries (one per recipient)
   *
   * @throws NotFoundException if building/target doesn't belong to tenant
   * @throws BadRequestException if input is invalid
   */
  async create(
    tenantId: string,
    userId: string,
    input: CreateCommunicationInput,
  ): Promise<CommunicationWithDetails> {
    // Get the user's membership for this tenant
    const membership = await this.prisma.membership.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });

    if (!membership) {
      throw new BadRequestException(
        'User does not have a membership in this tenant',
      );
    }

    const createdByMembershipId = membership.id;
    // 1. Validate building if provided
    if (input.buildingId) {
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        input.buildingId,
      );
    }

    // 2. Validate all targets
    if (!input.targets || input.targets.length === 0) {
      throw new BadRequestException('Communication must have at least one target');
    }

    for (const target of input.targets) {
      await this.validators.validateTarget(
        tenantId,
        target.targetType,
        target.targetId || null,
      );
    }

    // 3. Create communication in transaction
    const communication = await this.prisma.communication.create({
      data: {
        tenantId,
        buildingId: input.buildingId || null,
        title: input.title,
        body: input.body,
        channel: input.channel,
        status: 'DRAFT',
        createdByMembershipId,

        // Create targets
        targets: {
          createMany: {
            data: input.targets.map((t) => ({
              tenantId,
              targetType: t.targetType,
              targetId: t.targetId || null,
            })),
          },
        },
      },
      include: {
        targets: true,
      },
    });

    // 4. Resolve recipients and create receipts
    const recipientIds = await this.validators.resolveRecipients(
      tenantId,
      communication.id,
    );

    if (recipientIds.length > 0) {
      await this.prisma.communicationReceipt.createMany({
        data: recipientIds.map((recipientUserId) => ({
          tenantId,
          communicationId: communication.id,
          userId: recipientUserId,
        })),
        skipDuplicates: true, // If user is in multiple targets
      });
    }

    return this.findOne(tenantId, communication.id);
  }

  /**
   * Get all communications in a tenant (or building if filtered)
   *
   * @throws NotFoundException if building doesn't belong to tenant
   */
  async findAll(
    tenantId: string,
    filters?: FindAllFilters,
  ): Promise<CommunicationWithDetails[]> {
    // Validate building if filtering
    if (filters?.buildingId) {
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        filters.buildingId,
      );
    }

    const whereBase: Prisma.CommunicationWhereInput = {
      tenantId,
      deletedAt: null,
      ...(filters?.buildingId ? { buildingId: filters.buildingId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.channel ? { channel: filters.channel } : {}),
      ...(filters?.search ? {
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { body: { contains: filters.search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const sortField = filters?.sortBy ?? 'createdAt';
    const sortOrder = filters?.sortOrder ?? 'desc';

    return await this.prisma.communication.findMany({
      where: whereBase,
      include: COMMUNICATION_INCLUDE,
      orderBy: { [sortField]: sortOrder },
    });
  }

  /**
   * Get a single communication with all details
   *
   * @throws NotFoundException if communication doesn't belong to tenant
   */
  async findOne(tenantId: string, communicationId: string): Promise<CommunicationWithDetails> {
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      include: COMMUNICATION_INCLUDE,
    });

    if (!communication) {
      throw new NotFoundException(`Communication not found`);
    }

    return communication;
  }

  /**
   * Update a communication (only DRAFT status)
   *
   * @throws NotFoundException if communication doesn't belong to tenant
   * @throws BadRequestException if communication is not DRAFT
   */
  async update(
    tenantId: string,
    communicationId: string,
    input: UpdateCommunicationInput,
  ): Promise<CommunicationWithDetails> {
    // Validate scope
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    // Fetch and check status
    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      select: { status: true },
    });

    if (!communication) {
      throw new NotFoundException(`Communication not found`);
    }
    if (communication.status !== 'DRAFT') {
      throw new BadRequestException(
        `Can only update DRAFT communications. Current status: ${communication.status}`,
      );
    }

    return await this.prisma.communication.update({
      where: { id: communicationId },
      data: {
        title: input.title,
        body: input.body,
        channel: input.channel,
        updatedAt: new Date(),
      },
      include: COMMUNICATION_INCLUDE,
    });
  }

  /**
   * Schedule a communication (DRAFT → SCHEDULED)
   *
   * @throws NotFoundException if communication doesn't belong to tenant
   * @throws BadRequestException if communication is not DRAFT
   */
  async schedule(
    tenantId: string,
    communicationId: string,
    input: ScheduleCommunicationInput,
  ): Promise<CommunicationWithDetails> {
    // Validate scope
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    // Fetch and check status
    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      select: { status: true },
    });

    if (!communication) {
      throw new NotFoundException(`Communication not found`);
    }
    if (communication.status !== 'DRAFT') {
      throw new BadRequestException(
        `Can only schedule DRAFT communications. Current status: ${communication.status}`,
      );
    }

    // Validate scheduledAt is in the future
    if (input.scheduledAt <= new Date()) {
      throw new BadRequestException(
        `scheduledAt must be in the future`,
      );
    }

    return await this.prisma.communication.update({
      where: { id: communicationId },
      data: {
        status: 'SCHEDULED',
        scheduledAt: input.scheduledAt,
        updatedAt: new Date(),
      },
      include: COMMUNICATION_INCLUDE,
    });
  }

  /**
   * Send a communication (any status → SENT)
   *
   * In production, this would integrate with notification channels
   * For MVP, just updates the status and sentAt timestamp
   *
    * @throws NotFoundException if communication doesn't belong to tenant
    */
  async send(tenantId: string, communicationId: string): Promise<CommunicationWithDetails> {
    // Validate scope
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    return await this.prisma.communication.update({
      where: { id: communicationId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        updatedAt: new Date(),
      },
      include: COMMUNICATION_INCLUDE,
    });
  }

  /**
   * Publish a communication with optional web push
   *
   * Anti-spam rule:
   * - If sendWebPush=true and feature flag enforceUrgentForWebPush is enabled,
   *   only allows priority=URGENT
   *
   * @throws NotFoundException if communication doesn't belong to tenant
   * @throws BadRequestException if sendWebPush=true but priority!=URGENT (when flag enabled)
   */
  async publish(
    tenantId: string,
    communicationId: string,
    sendWebPush: boolean,
  ): Promise<CommunicationWithDetails> {
    // Validate scope
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    // Fetch communication to check priority
    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      select: { priority: true, status: true },
    });

    if (!communication) {
      throw new NotFoundException('Communication not found');
    }

    // Anti-spam: check if web push requires urgent priority
    const enforceUrgent = this.configService.isFeatureEnabled('enforceUrgentForWebPush');
    if (sendWebPush && enforceUrgent && communication.priority !== 'URGENT') {
      throw new BadRequestException({
        code: 'WEB_PUSH_REQUIRES_URGENT',
        message: 'Web push can only be sent for URGENT communications',
      });
    }

    // Mark as published (SENT in current schema)
    const published = await this.prisma.communication.update({
      where: { id: communicationId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        updatedAt: new Date(),
      },
      include: COMMUNICATION_INCLUDE,
    });

    // TODO: Send web push to subscribed users (best-effort, non-blocking)
    // This would integrate with push subscriptions when implemented

    return published;
  }

  /**
   * Delete a communication (only DRAFT status)
   *
   * Cascade delete: targets + receipts deleted automatically
   *
   * @throws NotFoundException if communication doesn't belong to tenant
   * @throws BadRequestException if communication is not DRAFT
   */
  async delete(tenantId: string, communicationId: string): Promise<CommunicationWithDetails> {
    // Validate scope
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    // Fetch and check status
    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      select: { status: true },
    });

    if (!communication) {
      throw new NotFoundException(`Communication not found`);
    }
    if (communication.status !== 'DRAFT') {
      throw new BadRequestException(
        `Can only delete DRAFT communications. Current status: ${communication.status}`,
      );
    }

    // Soft delete: preserve record and receipt history
    return await this.prisma.communication.update({
      where: { id: communicationId },
      data: { deletedAt: new Date() },
      include: COMMUNICATION_INCLUDE,
    });
  }

  /**
   * Get communications for a user (respecting their receipt status)
   *
   * RESIDENT users can only see communications they received
   * Admin users can see all communications
   *
   * @param userRoles Roles of the user making the request
   */
  async findForUser(
    tenantId: string,
    userId: string,
    userRoles: string[],
    filters?: FindForUserFilters,
  ): Promise<CommunicationWithDetails[]> {
    // Validate building if filtering
    if (filters?.buildingId) {
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        filters.buildingId,
      );
    }

    const isAdmin = userRoles.some((r) => ADMIN_ROLES.includes(r as typeof ADMIN_ROLES[number]));

    if (isAdmin) {
      // Admin sees all communications
      return this.findAll(tenantId, {
        buildingId: filters?.buildingId,
        status: filters?.status,
        channel: filters?.channel,
        search: filters?.search,
        sortBy: filters?.sortBy,
        sortOrder: filters?.sortOrder,
      });
    } else {
      // RESIDENT sees only communications they received
      const whereBase: Prisma.CommunicationWhereInput = {
        tenantId,
        deletedAt: null,
        receipts: {
          some: {
            userId,
            ...(filters?.readOnly ? { readAt: { not: null } } : {}),
          },
        },
        ...(filters?.buildingId ? { buildingId: filters.buildingId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.channel ? { channel: filters.channel } : {}),
        ...(filters?.search ? {
          OR: [
            { title: { contains: filters.search, mode: 'insensitive' } },
            { body: { contains: filters.search, mode: 'insensitive' } },
          ],
        } : {}),
      };

      const sortField = filters?.sortBy ?? 'createdAt';
      const sortOrder = filters?.sortOrder ?? 'desc';

      return await this.prisma.communication.findMany({
        where: whereBase,
        include: {
          ...COMMUNICATION_INCLUDE,
          receipts: {
            where: { userId },
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: { [sortField]: sortOrder },
      });
    }
  }

  /**
   * Mark a communication as read by a user
   *
   * Returns { count: 0 } silently if no matching receipt found
   */
  async markAsRead(
    tenantId: string,
    userId: string,
    communicationId: string,
  ): Promise<{ count: number }> {
    return await this.prisma.communicationReceipt.updateMany({
      where: {
        communicationId,
        userId,
        tenantId,
      },
      data: {
        readAt: new Date(),
      },
    });
  }

  /**
   * Mark a communication as delivered to a user
   *
   * Returns { count: 0 } silently if no matching receipt found
   */
  async markAsDelivered(
    tenantId: string,
    userId: string,
    communicationId: string,
  ): Promise<{ count: number }> {
    return await this.prisma.communicationReceipt.updateMany({
      where: {
        communicationId,
        userId,
        tenantId,
      },
      data: {
        deliveredAt: new Date(),
      },
    });
  }

  /**
   * Resident communication list item (for cursor pagination)
   */
  async findForResident(
    tenantId: string,
    userId: string,
    limit: number = 20,
    cursor?: string,
  ): Promise<{
    items: Array<{
      id: string;
      title: string;
      body: string;
      priority: string;
      scopeType: string;
      buildingIds: string[];
      createdAt: Date;
      publishedAt: Date | null;
      deliveryStatus: 'UNREAD' | 'READ';
      readAt: Date | null;
    }>;
    nextCursor?: string;
  }> {
    // Decode cursor if provided
    let cursorDate: Date | undefined;
    let cursorId: string | undefined;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
        cursorDate = decoded.publishedAt ? new Date(decoded.publishedAt) : undefined;
        cursorId = decoded.id;
      } catch {
        // Invalid cursor, ignore
      }
    }

    // Build where clause for cursor pagination
    const baseWhere: Prisma.CommunicationReceiptWhereInput = {
      tenantId,
      userId,
      communication: {
        status: 'SENT',
        sentAt: { not: null },
      },
    };

    // Apply cursor if provided
    let receipts;
    if (cursorDate && cursorId) {
      receipts = await this.prisma.communicationReceipt.findMany({
        where: {
          ...baseWhere,
          OR: [
            { communication: { sentAt: { lt: cursorDate } } },
            { AND: [
              { communication: { sentAt: cursorDate } },
              { communication: { id: { lt: cursorId } } },
            ]},
          ],
        },
        include: {
          communication: {
            include: {
              targets: { select: { targetId: true, targetType: true } },
            },
          },
        },
        orderBy: [
          { communication: { sentAt: 'desc' } },
          { communication: { id: 'desc' } },
        ],
        take: limit + 1,
      });
    } else {
      receipts = await this.prisma.communicationReceipt.findMany({
        where: baseWhere,
        include: {
          communication: {
            include: {
              targets: { select: { targetId: true, targetType: true } },
            },
          },
        },
        orderBy: [
          { communication: { sentAt: 'desc' } },
          { communication: { id: 'desc' } },
        ],
        take: limit + 1,
      });
    }

    const hasMore = receipts.length > limit;
    const items = receipts.slice(0, limit);

    // Map to response format
    const mappedItems = items.map((receipt) => {
      const comm = receipt.communication;
      const buildingIds = comm.targets
        .filter((t) => t.targetType === 'BUILDING' && t.targetId)
        .map((t) => t.targetId!);
      const scopeType: string =
        buildingIds.length === 0
          ? 'TENANT_ALL'
          : buildingIds.length === 1
            ? 'BUILDING'
            : 'MULTI_BUILDING';

      return {
        id: comm.id,
        title: comm.title,
        body: comm.body,
        priority: (comm.priority || 'NORMAL') as 'NORMAL' | 'URGENT',
        scopeType: scopeType as 'BUILDING' | 'MULTI_BUILDING' | 'TENANT_ALL',
        buildingIds,
        createdAt: comm.createdAt.toISOString(),
        publishedAt: comm.sentAt?.toISOString() ?? undefined,
        deliveryStatus: (receipt.readAt ? 'READ' : 'UNREAD') as 'UNREAD' | 'READ',
        readAt: receipt.readAt?.toISOString() ?? undefined,
      };
    });

    // Generate next cursor
    let nextCursor: string | undefined;
    if (hasMore && mappedItems.length > 0) {
      const lastItem = mappedItems[mappedItems.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          publishedAt: lastItem.publishedAt,
          id: lastItem.id,
        }),
      ).toString('base64');
    }

    return { items: mappedItems as unknown as Array<{id: string; title: string; body: string; priority: string; scopeType: string; buildingIds: string[]; createdAt: Date; publishedAt: Date | null; deliveryStatus: 'UNREAD' | 'READ'; readAt: Date | null}>, nextCursor };
  }

  /**
   * Mark as read idempotently for resident
   * Returns current read status
   */
  async markAsReadForResident(
    tenantId: string,
    userId: string,
    communicationId: string,
  ): Promise<{ readAt: Date | null }> {
    // First check if there's a receipt
    const receipt = await this.prisma.communicationReceipt.findUnique({
      where: {
        communicationId_userId: {
          communicationId,
          userId,
        },
      },
      select: { readAt: true },
    });

    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }

    // If already read, return current status
    if (receipt.readAt) {
      return { readAt: receipt.readAt };
    }

    // Mark as read
    await this.prisma.communicationReceipt.update({
      where: {
        communicationId_userId: {
          communicationId,
          userId,
        },
      },
      data: { readAt: new Date() },
    });

    return { readAt: new Date() };
  }

  /**
   * Create a new communication V2 (with scopeType pattern)
   *
   * If status=PUBLISHED:
   * - Sets publishedAt=now() (mapped to sentAt internally)
   * - Creates communication_deliveries with UNREAD status
   * - sendWebPush defaults to false (no push from this endpoint)
   *
   * @throws NotFoundException if building/target doesn't belong to tenant
   * @throws BadRequestException if input is invalid
   */
  async createV2(
    tenantId: string,
    userId: string,
    input: CreateCommunicationV2Input,
    sendWebPush: boolean = false,
  ): Promise<CommunicationWithDetails> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });

    if (!membership) {
      throw new BadRequestException(
        'User does not have a membership in this tenant',
      );
    }

    const createdByMembershipId = membership.id;

    let targets: Array<{ targetType: CommunicationTargetType; targetId?: string }> = [];

    switch (input.scopeType) {
      case 'TENANT_ALL':
        targets = [{ targetType: 'ALL_TENANT' }];
        break;
      case 'BUILDING':
        if (!input.buildingId) {
          throw new BadRequestException('BUILDING scopeType requires buildingId');
        }
        await this.validators.validateBuildingBelongsToTenant(tenantId, input.buildingId);
        targets = [{ targetType: 'BUILDING', targetId: input.buildingId }];
        break;
      case 'MULTI_BUILDING':
        if (!input.buildingIds || input.buildingIds.length === 0) {
          throw new BadRequestException('MULTI_BUILDING scopeType requires buildingIds array');
        }
        for (const buildingId of input.buildingIds) {
          await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);
        }
        targets = input.buildingIds.map((buildingId) => ({
          targetType: 'BUILDING' as CommunicationTargetType,
          targetId: buildingId,
        }));
        break;
    }

    const shouldPublish = input.status === 'PUBLISHED';

    const communication = await this.prisma.communication.create({
      data: {
        tenantId,
        buildingId: input.scopeType === 'BUILDING' ? input.buildingId || null : null,
        title: input.title,
        body: input.body,
        channel: 'IN_APP',
        status: shouldPublish ? 'SENT' as const : 'DRAFT' as const,
        priority: input.priority || 'NORMAL',
        sentAt: shouldPublish ? new Date() : null,
        createdByMembershipId,
        targets: {
          createMany: {
            data: targets.map((t) => ({
              tenantId,
              targetType: t.targetType,
              targetId: t.targetId || null,
            })),
          },
        },
      },
      include: {
        targets: true,
      },
    });

    const recipientIds = await this.validators.resolveRecipients(
      tenantId,
      communication.id,
    );

    if (recipientIds.length > 0) {
      await this.prisma.communicationReceipt.createMany({
        data: recipientIds.map((recipientUserId) => ({
          tenantId,
          communicationId: communication.id,
          userId: recipientUserId,
        })),
        skipDuplicates: true,
      });
    }

    return this.findOne(tenantId, communication.id);
  }

  /**
   * Publish a communication V2 with optional web push
   *
   * Anti-spam rule:
   * - If sendWebPush=true and feature flag enforceUrgentForWebPush is enabled (default true),
   *   only allows priority=URGENT
   * - Returns 422 with code WEB_PUSH_REQUIRES_URGENT if violated
   *
   * If sendWebPush=true:
   * - Sends WEB_PUSH only to users with active PushSubscription
   * - If no subscriptions, does NOT fail (silent no-op)
   *
   * @throws NotFoundException if communication doesn't belong to tenant
   * @throws UnprocessableEntityException if sendWebPush=true but priority!=URGENT (when flag enabled)
   */
  async publishV2(
    tenantId: string,
    communicationId: string,
    sendWebPush: boolean,
  ): Promise<CommunicationWithDetails> {
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      select: { priority: true, status: true },
    });

    if (!communication) {
      throw new NotFoundException('Communication not found');
    }

    const enforceUrgent = this.configService.isFeatureEnabled('enforceUrgentForWebPush');
    if (sendWebPush && enforceUrgent && communication.priority !== 'URGENT') {
      throw new UnprocessableEntityException({
        code: 'WEB_PUSH_REQUIRES_URGENT',
        message: 'Web push can only be sent for URGENT communications',
      });
    }

    const published = await this.prisma.communication.update({
      where: { id: communicationId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        updatedAt: new Date(),
      },
      include: COMMUNICATION_INCLUDE,
    });

    if (sendWebPush) {
      await this.sendWebPushIfApplicable(tenantId, communicationId);
    }

    return published;
  }

  /**
   * Send web push to users with active subscriptions
   * Best-effort: does NOT fail if no subscriptions exist
   */
  private async sendWebPushIfApplicable(
    tenantId: string,
    communicationId: string,
  ): Promise<void> {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: {
        tenantId,
        revokedAt: null,
      },
      select: {
        userId: true,
        endpoint: true,
        p256dh: true,
        auth: true,
      },
    });

    if (subscriptions.length === 0) {
      return;
    }

    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      select: { title: true, body: true },
    });

    if (!communication) {
      return;
    }

    // TODO: Integrate with actual push notification service (FCM, WebPush, etc.)
    // For now, this is a placeholder that logs what would be sent
    console.log(`[Push] Would send push to ${subscriptions.length} users:`, {
      title: communication.title,
      body: communication.body,
      subscriptions: subscriptions.map((s) => s.endpoint),
    });
  }

  /**
   * Find communications for resident with cursor pagination V2
   *
   * Ordering: publishedAt DESC, id DESC (mapped to sentAt DESC, id DESC internally)
   *
   * @returns ResidentCommunicationListResponse with typed items
   */
  async findForResidentV2(
    tenantId: string,
    userId: string,
    limit: number = 20,
    cursor?: string,
  ): Promise<ResidentCommunicationListResponse> {
    let cursorDate: Date | undefined;
    let cursorId: string | undefined;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
        cursorDate = decoded.publishedAt ? new Date(decoded.publishedAt) : undefined;
        cursorId = decoded.id;
      } catch {
        // Invalid cursor, ignore
      }
    }

    const baseWhere: Prisma.CommunicationReceiptWhereInput = {
      tenantId,
      userId,
      communication: {
        status: 'SENT',
        sentAt: { not: null },
      },
    };

    let receipts;
    if (cursorDate && cursorId) {
      receipts = await this.prisma.communicationReceipt.findMany({
        where: {
          ...baseWhere,
          OR: [
            { communication: { sentAt: { lt: cursorDate } } },
            {
              AND: [
                { communication: { sentAt: cursorDate } },
                { communication: { id: { lt: cursorId } } },
              ],
            },
          ],
        },
        include: {
          communication: {
            include: {
              targets: { select: { targetId: true, targetType: true } },
            },
          },
        },
        orderBy: [
          { communication: { sentAt: 'desc' } },
          { communication: { id: 'desc' } },
        ],
        take: limit + 1,
      });
    } else {
      receipts = await this.prisma.communicationReceipt.findMany({
        where: baseWhere,
        include: {
          communication: {
            include: {
              targets: { select: { targetId: true, targetType: true } },
            },
          },
        },
        orderBy: [
          { communication: { sentAt: 'desc' } },
          { communication: { id: 'desc' } },
        ],
        take: limit + 1,
      });
    }

    const hasMore = receipts.length > limit;
    const items = receipts.slice(0, limit);

    const mappedItems = items.map((receipt): {
      id: string;
      title: string;
      body: string;
      priority: 'NORMAL' | 'URGENT';
      scopeType: 'BUILDING' | 'MULTI_BUILDING' | 'TENANT_ALL';
      buildingIds: string[];
      createdAt: string;
      publishedAt: string | null;
      deliveryStatus: 'UNREAD' | 'READ';
      readAt: string | null;
    } => {
      const comm = receipt.communication;
      const buildingIds = comm.targets
        .filter((t) => t.targetType === 'BUILDING' && t.targetId)
        .map((t) => t.targetId!);
      const scopeType: 'BUILDING' | 'MULTI_BUILDING' | 'TENANT_ALL' =
        buildingIds.length === 0
          ? 'TENANT_ALL'
          : buildingIds.length === 1
            ? 'BUILDING'
            : 'MULTI_BUILDING';

      return {
        id: comm.id,
        title: comm.title,
        body: comm.body,
        priority: (comm.priority || 'NORMAL') as 'NORMAL' | 'URGENT',
        scopeType,
        buildingIds,
        createdAt: comm.createdAt.toISOString(),
        publishedAt: comm.sentAt?.toISOString() ?? null,
        deliveryStatus: receipt.readAt ? 'READ' : 'UNREAD',
        readAt: receipt.readAt?.toISOString() ?? null,
      };
    });

    let nextCursor: string | undefined;
    if (hasMore && mappedItems.length > 0) {
      const lastItem = mappedItems[mappedItems.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          publishedAt: lastItem.publishedAt,
          id: lastItem.id,
        }),
      ).toString('base64');
    }

    return { items: mappedItems, nextCursor };
  }

  /**
   * [PHASE 2] Dispatch all scheduled communications that are ready to send
   * Called every 5 minutes by CronJobsService
   *
   * - Finds all communications with status=SCHEDULED and scheduledAt <= now
   * - Calls send() for each one (which updates status to SENT)
   * - Returns count of dispatched communications
   * - Fire-and-forget: logs errors but never throws
   */
  async dispatchScheduledCommunications(): Promise<number> {
    try {
      const scheduled = await this.prisma.communication.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: {
            lte: new Date(), // scheduledAt <= now
          },
        },
        select: { id: true, tenantId: true },
      });

      let dispatchedCount = 0;
      for (const comm of scheduled) {
        try {
          await this.send(comm.tenantId, comm.id);
          dispatchedCount++;
        } catch (error) {
          // Fire-and-forget: log but continue with next
          console.error(
            `Failed to dispatch scheduled communication ${comm.id}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return dispatchedCount;
    } catch (error) {
      console.error(
        'Error in dispatchScheduledCommunications:',
        error instanceof Error ? error.message : String(error),
      );
      return 0;
    }
  }
}
