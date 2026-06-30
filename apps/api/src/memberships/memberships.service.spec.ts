import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MembershipsService } from './memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AddRoleDto, ScopeTypeDto } from './dto/add-role.dto';

describe('MembershipsService', () => {
  let service: MembershipsService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        {
          provide: PrismaService,
          useValue: {
            membership: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
            membershipRole: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
            },
            building: {
              findUnique: jest.fn(),
            },
            unit: {
              findFirst: jest.fn(),
            },
          },
        },
        {
          provide: AuditService,
          useValue: {
            createLog: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MembershipsService>(MembershipsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAssignableTicketMembers', () => {
    it('filters out resident-only memberships and keeps operational members', async () => {
      jest.spyOn(prismaService.membership, 'findMany').mockResolvedValue([
        {
          id: 'membership-resident',
          userId: 'user-resident',
          user: { id: 'user-resident', name: 'Resident User', email: 'resident@demo.local' },
          roles: [{ role: 'RESIDENT' }],
        },
        {
          id: 'membership-operator',
          userId: 'user-operator',
          user: { id: 'user-operator', name: 'Operator User', email: 'operator@demo.local' },
          roles: [{ role: 'OPERATOR' }],
        },
        {
          id: 'membership-admin',
          userId: 'user-admin',
          user: { id: 'user-admin', name: 'Admin User', email: 'admin@demo.local' },
          roles: [{ role: 'TENANT_ADMIN' }],
        },
      ] as any);

      const result = await service.getAssignableTicketMembers('tenant-123');

      expect(prismaService.membership.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-123',
          roles: {
            some: {
              role: { in: ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] },
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          roles: {
            select: {
              role: true,
            },
          },
        },
      });

      expect(result).toEqual([
        {
          id: 'user-admin',
          membershipId: 'membership-admin',
          name: 'Admin User',
          email: 'admin@demo.local',
          roles: ['TENANT_ADMIN'],
        },
        {
          id: 'user-operator',
          membershipId: 'membership-operator',
          name: 'Operator User',
          email: 'operator@demo.local',
          roles: ['OPERATOR'],
        },
      ]);
    });
  });

  describe('addRole', () => {
    it('rejects UNIT scope when scopeBuildingId is provided', async () => {
      jest.spyOn(prismaService.membership, 'findUnique').mockResolvedValue({
        id: 'membership-target',
        tenantId: 'tenant-123',
        userId: 'user-target',
        user: { name: 'Target User' },
      } as any);
      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue({
        id: 'unit-123',
        buildingId: 'building-123',
      } as any);

      await expect(
        service.addRole('tenant-123', 'membership-target', 'actor-1', {
          role: 'OPERATOR',
          scopeType: ScopeTypeDto.UNIT,
          scopeUnitId: 'unit-123',
          scopeBuildingId: 'building-123',
        } as AddRoleDto),
      ).rejects.toThrow(BadRequestException);
      expect(prismaService.membershipRole.create).not.toHaveBeenCalled();
    });

    it('creates UNIT scope roles without a buildingId override', async () => {
      jest.spyOn(prismaService.membership, 'findUnique').mockResolvedValue({
        id: 'membership-target',
        tenantId: 'tenant-123',
        userId: 'user-target',
        user: { name: 'Target User' },
      } as any);
      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue({
        id: 'unit-123',
        buildingId: 'building-123',
      } as any);
      jest.spyOn(prismaService.membershipRole, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prismaService.membershipRole, 'create').mockResolvedValue({
        id: 'role-1',
        role: 'OPERATOR',
        scopeType: 'UNIT',
        scopeBuildingId: null,
        scopeUnitId: 'unit-123',
      } as any);

      const result = await service.addRole('tenant-123', 'membership-target', 'actor-1', {
        role: 'OPERATOR',
        scopeType: ScopeTypeDto.UNIT,
        scopeUnitId: 'unit-123',
      } as AddRoleDto);

      expect(result).toEqual({
        id: 'role-1',
        role: 'OPERATOR',
        scopeType: 'UNIT',
        scopeBuildingId: null,
        scopeUnitId: 'unit-123',
      });
      expect(prismaService.membershipRole.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-123',
          membershipId: 'membership-target',
          role: 'OPERATOR',
          scopeType: ScopeTypeDto.UNIT,
          scopeBuildingId: null,
          scopeUnitId: 'unit-123',
        },
        select: {
          id: true,
          role: true,
          scopeType: true,
          scopeBuildingId: true,
          scopeUnitId: true,
        },
      });
    });
  });
});
