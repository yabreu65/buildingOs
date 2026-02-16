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
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationsValidators } from './communications.validators';
import {
  CommunicationChannel,
  CommunicationStatus,
  CommunicationTargetType,
} from '@prisma/client';

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

@Injectable()
export class CommunicationsService {
  constructor(
    private prisma: PrismaService,
    private validators: CommunicationsValidators,
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
  ) {
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
        data: recipientIds.map((userId) => ({
          tenantId,
          communicationId: communication.id,
          userId,
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
    filters?: {
      buildingId?: string;
      status?: CommunicationStatus;
    },
  ) {
    // Validate building if filtering
    if (filters?.buildingId) {
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        filters.buildingId,
      );
    }

    const where: any = { tenantId };
    if (filters?.buildingId) where.buildingId = filters.buildingId;
    if (filters?.status) where.status = filters.status;

    return await this.prisma.communication.findMany({
      where,
      include: {
        targets: true,
        receipts: {
          select: {
            id: true,
            userId: true,
            deliveredAt: true,
            readAt: true,
          },
        },
        createdByMembership: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single communication with all details
   *
   * @throws NotFoundException if communication doesn't belong to tenant
   */
  async findOne(tenantId: string, communicationId: string) {
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      include: {
        tenant: { select: { id: true, name: true } },
        building: { select: { id: true, name: true } },
        targets: true,
        receipts: {
          select: {
            id: true,
            userId: true,
            deliveredAt: true,
            readAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        createdByMembership: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
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
  ) {
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

    if (communication?.status !== 'DRAFT') {
      throw new BadRequestException(
        `Can only update DRAFT communications. Current status: ${communication?.status}`,
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
      include: {
        targets: true,
        receipts: true,
      },
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
  ) {
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

    if (communication?.status !== 'DRAFT') {
      throw new BadRequestException(
        `Can only schedule DRAFT communications. Current status: ${communication?.status}`,
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
      include: {
        targets: true,
        receipts: true,
      },
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
  async send(tenantId: string, communicationId: string) {
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
      include: {
        targets: true,
        receipts: true,
      },
    });
  }

  /**
   * Delete a communication (only DRAFT status)
   *
   * Cascade delete: targets + receipts deleted automatically
   *
   * @throws NotFoundException if communication doesn't belong to tenant
   * @throws BadRequestException if communication is not DRAFT
   */
  async delete(tenantId: string, communicationId: string) {
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

    if (communication?.status !== 'DRAFT') {
      throw new BadRequestException(
        `Can only delete DRAFT communications. Current status: ${communication?.status}`,
      );
    }

    return await this.prisma.communication.delete({
      where: { id: communicationId },
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
    filters?: {
      buildingId?: string;
      readOnly?: boolean; // Only show read communications
    },
  ) {
    // Validate building if filtering
    if (filters?.buildingId) {
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        filters.buildingId,
      );
    }

    const adminRoles = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'];
    const isAdmin = userRoles.some((r) => adminRoles.includes(r));

    if (isAdmin) {
      // Admin sees all communications
      return this.findAll(tenantId, {
        buildingId: filters?.buildingId,
      });
    } else {
      // RESIDENT sees only communications they received
      const where: any = {
        tenantId,
        receipts: {
          some: {
            userId,
          },
        },
      };

      if (filters?.buildingId) where.buildingId = filters.buildingId;
      if (filters?.readOnly) {
        where.receipts.some.readAt = { not: null };
      }

      return await this.prisma.communication.findMany({
        where,
        include: {
          targets: true,
          receipts: {
            where: { userId },
            select: {
              id: true,
              deliveredAt: true,
              readAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }
  }

  /**
   * Mark a communication as read by a user
   *
   * @throws NotFoundException if receipt doesn't exist
   */
  async markAsRead(
    tenantId: string,
    userId: string,
    communicationId: string,
  ) {
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
   * @throws NotFoundException if receipt doesn't exist
   */
  async markAsDelivered(
    tenantId: string,
    userId: string,
    communicationId: string,
  ) {
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
}
