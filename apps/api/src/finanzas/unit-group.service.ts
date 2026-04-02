import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';

@Injectable()
export class UnitGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
  ) {}

  async createUnitGroup(
    tenantId: string,
    buildingId: string,
    name: string,
    description: string | undefined,
    unitIds: string[],
    membershipId: string,
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden crear grupos de unidades',
      );
    }

    // Validar building
    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    // Validar nombre único
    const existing = await this.prisma.unitGroup.findFirst({
      where: { tenantId, buildingId, name },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe un grupo con el nombre "${name}" en este edificio`,
      );
    }

    // Validar que las unidades existan y pertenezcan al building
    const units = await this.prisma.unit.findMany({
      where: {
        id: { in: unitIds },
        buildingId,
      },
    });
    if (units.length !== unitIds.length) {
      throw new BadRequestException(
        'Algunas unidades no existen o no pertenecen al edificio',
      );
    }

    // Crear grupo
    const group = await this.prisma.unitGroup.create({
      data: {
        tenantId,
        buildingId,
        name,
        description: description || null,
      },
    });

    // Agregar miembros
    if (unitIds.length > 0) {
      await this.prisma.unitGroupMember.createMany({
        data: unitIds.map((unitId) => ({
          unitGroupId: group.id,
          unitId,
        })),
      });
    }

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'UNIT_GROUP_CREATE',
      entityType: 'UnitGroup',
      entityId: group.id,
      metadata: { name, unitCount: unitIds.length },
    });

    return this.toDto(group, unitIds.length);
  }

  async getUnitGroup(
    tenantId: string,
    groupId: string,
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden ver grupos',
      );
    }

    const group = await this.prisma.unitGroup.findFirst({
      where: { id: groupId, tenantId },
      include: { members: { include: { unit: true } } },
    });

    if (!group) {
      throw new NotFoundException(`Grupo no encontrado: ${groupId}`);
    }

    return {
      id: group.id,
      tenantId: group.tenantId,
      buildingId: group.buildingId,
      name: group.name,
      description: group.description,
      memberCount: group.members.length,
      members: group.members.map((m) => ({
        unitId: m.unit.id,
        unitCode: m.unit.code,
        unitLabel: m.unit.label,
        areaM2: m.unit.m2,
      })),
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  async listUnitGroups(
    tenantId: string,
    buildingId?: string,
    userRoles?: string[],
  ) {
    if (userRoles && !this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden listar grupos',
      );
    }

    const groups = await this.prisma.unitGroup.findMany({
      where: {
        tenantId,
        ...(buildingId && { buildingId }),
      },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((g) => this.toDto(g, g._count.members));
  }

  async addMember(
    tenantId: string,
    groupId: string,
    unitId: string,
    membershipId: string,
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden modificar grupos',
      );
    }

    const group = await this.prisma.unitGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) {
      throw new NotFoundException(`Grupo no encontrado: ${groupId}`);
    }

    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, buildingId: group.buildingId },
    });
    if (!unit) {
      throw new BadRequestException(
        'La unidad no existe o no pertenece al edificio del grupo',
      );
    }

    // Verificar que no exista ya
    const existing = await this.prisma.unitGroupMember.findFirst({
      where: { unitGroupId: groupId, unitId },
    });
    if (existing) {
      throw new ConflictException('La unidad ya pertenece a este grupo');
    }

    await this.prisma.unitGroupMember.create({
      data: { unitGroupId: groupId, unitId },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'UNIT_GROUP_MEMBER_ADD',
      entityType: 'UnitGroup',
      entityId: groupId,
      metadata: { unitId, unitCode: unit.code },
    });
  }

  async removeMember(
    tenantId: string,
    groupId: string,
    unitId: string,
    membershipId: string,
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden modificar grupos',
      );
    }

    const group = await this.prisma.unitGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) {
      throw new NotFoundException(`Grupo no encontrado: ${groupId}`);
    }

    const member = await this.prisma.unitGroupMember.findFirst({
      where: { unitGroupId: groupId, unitId },
      include: { unit: true },
    });
    if (!member) {
      throw new NotFoundException(
        'La unidad no está en este grupo',
      );
    }

    await this.prisma.unitGroupMember.delete({
      where: { id: member.id },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'UNIT_GROUP_MEMBER_REMOVE',
      entityType: 'UnitGroup',
      entityId: groupId,
      metadata: { unitId, unitCode: member.unit.code },
    });
  }

  async deleteUnitGroup(
    tenantId: string,
    groupId: string,
    membershipId: string,
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden eliminar grupos',
      );
    }

    const group = await this.prisma.unitGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) {
      throw new NotFoundException(`Grupo no encontrado: ${groupId}`);
    }

    // Verificar si está en uso por movimientos
    const expenseCount = await this.prisma.expense.count({
      where: { unitGroupId: groupId },
    });
    const incomeCount = await this.prisma.income.count({
      where: { unitGroupId: groupId },
    });

    if (expenseCount > 0 || incomeCount > 0) {
      throw new BadRequestException(
        'No se puede eliminar un grupo que está siendo usado en movimientos',
      );
    }

    await this.prisma.unitGroup.delete({
      where: { id: groupId },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'UNIT_GROUP_DELETE',
      entityType: 'UnitGroup',
      entityId: groupId,
      metadata: { name: group.name },
    });
  }

  private toDto(group: any, memberCount: number) {
    return {
      id: group.id,
      tenantId: group.tenantId,
      buildingId: group.buildingId,
      name: group.name,
      description: group.description,
      memberCount,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }
}
