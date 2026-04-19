import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UnitOccupant, AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { AuthorizeService } from '../rbac/authorize.service';
import { CreateOccupantDto } from './dto/create-occupant.dto';

@Injectable()
export class OccupantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly planEntitlements: PlanEntitlementsService,
    private readonly authorizeService: AuthorizeService,
  ) {}

  /**
   * Assign a tenant member as an occupant of a unit
   */
  async assignOccupant(
    tenantId: string,
    buildingId: string,
    unitId: string,
    dto: CreateOccupantDto,
    actorUserId: string,
  ): Promise<UnitOccupant> {
    // RBAC: check permission to manage members/occupants
    const hasAccess = await this.authorizeService.authorize({
      userId: actorUserId,
      tenantId,
      permission: 'members.manage',
      buildingId,
      unitId,
    });
    if (!hasAccess) {
      throw new ForbiddenException('No tiene permiso para gestionar ocupantes');
    }

    // Verify unit exists and belongs to building/tenant
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, building: { id: buildingId, tenantId } },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building/tenant`,
      );
    }

    // Verify member exists in the same tenant
    const memberInTenant = await this.prisma.tenantMember.findFirst({
      where: { id: dto.memberId, tenantId },
    });

    if (!memberInTenant) {
      throw new BadRequestException(
        `Member not found in this tenant`,
      );
    }

    // Check plan limit: maxOccupants
    await this.planEntitlements.assertLimit(tenantId, 'occupants');

    try {
      const occupant = await this.prisma.unitOccupant.create({
        data: {
          tenantId,
          unitId,
          memberId: dto.memberId,
          role: dto.role,
        },
        include: { member: true, unit: true },
      });

      // Audit: OCCUPANT_ASSIGN
      if (actorUserId) {
        void this.auditService.createLog({
          tenantId,
          actorUserId,
          action: AuditAction.OCCUPANT_ASSIGN,
          entityType: 'UnitOccupant',
          entityId: occupant.id,
          metadata: {
            unitId,
            memberId: dto.memberId,
            role: dto.role,
          },
        });
      }

      // [PHASE 2 QUICK #5] Send OCCUPANT_ASSIGNED notification
      void this.sendOccupantAssignedNotification(tenantId, occupant, unit);

      return occupant;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `This member is already assigned to this unit with role ${dto.role}`,
        );
      }
      throw error;
    }
  }

  /**
   * List all occupants for a unit
   */
  async findOccupants(tenantId: string, buildingId: string, unitId: string): Promise<UnitOccupant[]> {
    // Verify unit exists and belongs to building/tenant
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, building: { id: buildingId, tenantId } },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building/tenant`,
      );
    }

    return await this.prisma.unitOccupant.findMany({
      where: { unitId },
      include: { 
        member: {
          include: { user: true }
        } 
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Remove an occupant from a unit
   */
  async removeOccupant(
    tenantId: string,
    buildingId: string,
    unitId: string,
    occupantId: string,
    actorUserId: string,
  ): Promise<UnitOccupant> {
    // RBAC: check permission to manage members/occupants
    const hasAccess = await this.authorizeService.authorize({
      userId: actorUserId,
      tenantId,
      permission: 'members.manage',
      buildingId,
      unitId,
    });
    if (!hasAccess) {
      throw new ForbiddenException('No tiene permiso para gestionar ocupantes');
    }

    // Verify unit exists and belongs to building/tenant
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, building: { id: buildingId, tenantId } },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building/tenant`,
      );
    }

    // Verify occupant exists and belongs to this unit
    const occupant = await this.prisma.unitOccupant.findFirst({
      where: { id: occupantId, unitId },
    });

    if (!occupant) {
      throw new NotFoundException(
        `Occupant not found or does not belong to this unit`,
      );
    }

    const deleted = await this.prisma.unitOccupant.delete({
      where: { id: occupantId },
    });

    // Audit: OCCUPANT_REMOVE
    if (actorUserId) {
      void this.auditService.createLog({
        tenantId,
        actorUserId,
        action: AuditAction.OCCUPANT_REMOVE,
        entityType: 'UnitOccupant',
        entityId: occupantId,
        metadata: {
          unitId,
          memberId: occupant.memberId,
          role: occupant.role,
        },
      });
    }

    return deleted;
  }

  /**
   * [PHASE 2 QUICK #5] Send OCCUPANT_ASSIGNED notification
   * Fire-and-forget: logs errors but never throws
   */
  private async sendOccupantAssignedNotification(
    tenantId: string,
    occupant: UnitOccupant & { member?: any; unit?: any },
    unit: any,
  ): Promise<void> {
    try {
      // Load fresh member data to get user ID
      const member = await this.prisma.tenantMember.findUnique({
        where: { id: occupant.memberId },
        include: { user: { select: { id: true } } },
      });

      if (!member?.user?.id) return;

      const buildingName = unit?.building?.name || 'tu edificio';
      const roleLabel = occupant.role === 'OWNER' ? 'Propietario' : 'Residente';

      await this.notificationsService.createNotification({
        tenantId,
        userId: member.user.id,
        type: 'OCCUPANT_ASSIGNED',
        title: 'Has sido asignado a una unidad',
        body: `Has sido asignado como ${roleLabel} a la unidad ${unit?.label} en ${buildingName}. Ahora puedes ver cargos y realizar pagos desde la app.`,
        data: {
          occupantId: occupant.id,
          unitId: unit?.id,
          unitLabel: unit?.label,
          buildingId: unit?.buildingId,
          buildingName: buildingName,
          role: occupant.role,
        },
        deliveryMethods: ['IN_APP', 'EMAIL'],
      });
    } catch (error) {
      // Fire-and-forget: log but never fail
      console.error(
        `[OccupantsService] Failed to send occupant assigned notification for occupant ${occupant.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
