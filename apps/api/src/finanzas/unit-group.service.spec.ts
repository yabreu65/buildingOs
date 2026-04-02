import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { UnitGroupService } from './unit-group.service';

describe('UnitGroupService', () => {
  let service: UnitGroupService;
  let prisma: PrismaService;
  let auditService: AuditService;
  let validators: FinanzasValidators;

  const tenantId = 'tenant-123';
  const buildingId = 'building-456';
  const membershipId = 'member-789';
  const adminRoles = ['TENANT_ADMIN'];
  const residentRoles = ['RESIDENT'];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnitGroupService,
        {
          provide: PrismaService,
          useValue: {
            unitGroup: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            unit: { findMany: jest.fn() },
            unitGroupMember: {
              findFirst: jest.fn(),
              createMany: jest.fn(),
              create: jest.fn(),
              delete: jest.fn(),
            },
            expense: { count: jest.fn() },
            income: { count: jest.fn() },
          },
        },
        {
          provide: AuditService,
          useValue: { createLog: jest.fn() },
        },
        {
          provide: FinanzasValidators,
          useValue: {
            isAdminOrOperator: jest.fn().mockReturnValue(true),
            validateBuildingBelongsToTenant: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<UnitGroupService>(UnitGroupService);
    prisma = module.get<PrismaService>(PrismaService);
    auditService = module.get<AuditService>(AuditService);
    validators = module.get<FinanzasValidators>(FinanzasValidators);
  });

  describe('createUnitGroup', () => {
    it('debería crear grupo de unidades', async () => {
      const units = [
        { id: 'unit-1', code: 'A-101' },
        { id: 'unit-2', code: 'A-102' },
      ];

      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue(units as any);
      jest.spyOn(prisma.unitGroup, 'create').mockResolvedValue({
        id: 'group-1',
        tenantId,
        buildingId,
        name: 'Ala Norte',
        description: 'Departamentos lado norte',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.createUnitGroup(
        tenantId,
        buildingId,
        'Ala Norte',
        'Departamentos lado norte',
        ['unit-1', 'unit-2'],
        membershipId,
        adminRoles,
      );

      expect(result.id).toBe('group-1');
      expect(result.name).toBe('Ala Norte');
      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UNIT_GROUP_CREATE',
        }),
      );
    });

    it('debería lanzar error si nombre duplicado en mismo building', async () => {
      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue({
        id: 'group-1',
        name: 'Ala Norte',
      } as any);

      await expect(
        service.createUnitGroup(
          tenantId,
          buildingId,
          'Ala Norte', // nombre duplicado
          undefined,
          ['unit-1'],
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('debería lanzar error si algunas unidades no existen', async () => {
      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue([
        { id: 'unit-1', code: 'A-101' },
      ] as any);

      await expect(
        service.createUnitGroup(
          tenantId,
          buildingId,
          'Ala Norte',
          undefined,
          ['unit-1', 'unit-not-found'], // unit-not-found no existe
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería prevenir acceso no-admin', async () => {
      jest
        .spyOn(validators, 'isAdminOrOperator')
        .mockReturnValue(false);

      await expect(
        service.createUnitGroup(
          tenantId,
          buildingId,
          'Ala Norte',
          undefined,
          ['unit-1'],
          membershipId,
          residentRoles,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getUnitGroup', () => {
    it('debería obtener grupo con miembros', async () => {
      const members = [
        {
          id: 'member-1',
          unit: { id: 'unit-1', code: 'A-101', label: '101', m2: 100 },
        },
      ];

      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue({
        id: 'group-1',
        tenantId,
        buildingId,
        name: 'Ala Norte',
        members,
      } as any);

      const result = await service.getUnitGroup(tenantId, 'group-1', adminRoles);

      expect(result.id).toBe('group-1');
      expect(result.members.length).toBe(1);
    });

    it('debería lanzar error si grupo no existe', async () => {
      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue(null);

      await expect(
        service.getUnitGroup(tenantId, 'group-not-found', adminRoles),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listUnitGroups', () => {
    it('debería listar grupos para tenant', async () => {
      const groups = [
        {
          id: 'group-1',
          name: 'Ala Norte',
          _count: { members: 5 },
        },
        {
          id: 'group-2',
          name: 'Ala Sur',
          _count: { members: 3 },
        },
      ];

      jest.spyOn(prisma.unitGroup, 'findMany').mockResolvedValue(groups as any);

      const result = await service.listUnitGroups(tenantId, undefined, adminRoles);

      expect(result.length).toBe(2);
      expect(result[0].memberCount).toBe(5);
    });

    it('debería filtrar por buildingId', async () => {
      jest.spyOn(prisma.unitGroup, 'findMany').mockResolvedValue([]);

      await service.listUnitGroups(tenantId, buildingId, adminRoles);

      expect(prisma.unitGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            buildingId,
          }),
        }),
      );
    });
  });

  describe('addMember', () => {
    it('debería agregar unidad al grupo', async () => {
      const group = { id: 'group-1', buildingId };
      const unit = { id: 'unit-1', code: 'A-101', buildingId };

      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue(group as any);
      jest.spyOn(prisma.unit, 'findFirst').mockResolvedValue(unit as any);
      jest.spyOn(prisma.unitGroupMember, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.unitGroupMember, 'create').mockResolvedValue({
        id: 'member-1',
        unitGroupId: 'group-1',
        unitId: 'unit-1',
      } as any);

      await service.addMember(
        tenantId,
        'group-1',
        'unit-1',
        membershipId,
        adminRoles,
      );

      expect(prisma.unitGroupMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            unitGroupId: 'group-1',
            unitId: 'unit-1',
          },
        }),
      );
      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UNIT_GROUP_MEMBER_ADD',
        }),
      );
    });

    it('debería lanzar error si unidad ya está en grupo', async () => {
      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue({
        id: 'group-1',
        buildingId,
      } as any);
      jest.spyOn(prisma.unit, 'findFirst').mockResolvedValue({
        id: 'unit-1',
        buildingId,
      } as any);
      jest.spyOn(prisma.unitGroupMember, 'findFirst').mockResolvedValue({
        id: 'member-1',
      } as any);

      await expect(
        service.addMember(
          tenantId,
          'group-1',
          'unit-1',
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeMember', () => {
    it('debería remover unidad del grupo', async () => {
      const group = { id: 'group-1', buildingId };
      const member = {
        id: 'member-1',
        unit: { code: 'A-101' },
      };

      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue(group as any);
      jest
        .spyOn(prisma.unitGroupMember, 'findFirst')
        .mockResolvedValue(member as any);
      jest.spyOn(prisma.unitGroupMember, 'delete').mockResolvedValue(
        member as any,
      );

      await service.removeMember(
        tenantId,
        'group-1',
        'unit-1',
        membershipId,
        adminRoles,
      );

      expect(prisma.unitGroupMember.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'member-1' },
        }),
      );
      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UNIT_GROUP_MEMBER_REMOVE',
        }),
      );
    });
  });

  describe('deleteUnitGroup', () => {
    it('debería eliminar grupo si no está en uso', async () => {
      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue({
        id: 'group-1',
        name: 'Ala Norte',
      } as any);
      jest.spyOn(prisma.expense, 'count').mockResolvedValue(0);
      jest.spyOn(prisma.income, 'count').mockResolvedValue(0);
      jest.spyOn(prisma.unitGroup, 'delete').mockResolvedValue({
        id: 'group-1',
      } as any);

      await service.deleteUnitGroup(
        tenantId,
        'group-1',
        membershipId,
        adminRoles,
      );

      expect(prisma.unitGroup.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'group-1' },
        }),
      );
      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UNIT_GROUP_DELETE',
        }),
      );
    });

    it('debería lanzar error si grupo está en uso en expenses', async () => {
      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue({
        id: 'group-1',
        name: 'Ala Norte',
      } as any);
      jest.spyOn(prisma.expense, 'count').mockResolvedValue(3);

      await expect(
        service.deleteUnitGroup(
          tenantId,
          'group-1',
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar error si grupo está en uso en incomes', async () => {
      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue({
        id: 'group-1',
        name: 'Ala Norte',
      } as any);
      jest.spyOn(prisma.expense, 'count').mockResolvedValue(0);
      jest.spyOn(prisma.income, 'count').mockResolvedValue(2);

      await expect(
        service.deleteUnitGroup(
          tenantId,
          'group-1',
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
