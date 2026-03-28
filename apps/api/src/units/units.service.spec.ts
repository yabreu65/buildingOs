import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { UnitsService } from './units.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizeService } from '../rbac/authorize.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { AuditAction } from '@prisma/client';

describe('UnitsService', () => {
  let service: UnitsService;
  let prismaService: PrismaService;
  let planEntitlementsService: PlanEntitlementsService;
  let auditService: AuditService;
  let authorizeService: AuthorizeService;

  // ========== SETUP ==========
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnitsService,
        {
          provide: PrismaService,
          useValue: {
            building: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
            },
            unit: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            charge: {
              count: jest.fn(),
            },
            payment: {
              count: jest.fn(),
            },
            unitOccupant: {
              count: jest.fn(),
            },
          },
        },
        {
          provide: PlanEntitlementsService,
          useValue: {
            assertLimit: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            createLog: jest.fn(),
          },
        },
        {
          provide: AuthorizeService,
          useValue: {
            authorize: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<UnitsService>(UnitsService);
    prismaService = module.get<PrismaService>(PrismaService);
    planEntitlementsService = module.get<PlanEntitlementsService>(
      PlanEntitlementsService,
    );
    auditService = module.get<AuditService>(AuditService);
    authorizeService = module.get<AuthorizeService>(AuthorizeService);
  });

  // ========== CLEANUP ==========
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========== TESTS: CREATE ==========
  describe('create', () => {
    it('should create a unit successfully', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const dto: CreateUnitDto = {
        code: 'A01',
        label: 'Unit 1A',
        unitType: 'APARTMENT',
        occupancyStatus: 'VACANT',
      };
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const expectedUnit = {
        id: 'unit-123',
        buildingId,
        code: 'A01',
        label: 'Unit 1A',
        unitType: 'APARTMENT',
        occupancyStatus: 'VACANT',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(planEntitlementsService, 'assertLimit').mockResolvedValue(undefined);
      jest.spyOn(prismaService.unit, 'create').mockResolvedValue(expectedUnit as any);
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.create(tenantId, buildingId, 'user-123', dto);

      // ASSERT
      expect(result).toEqual(expectedUnit);
      expect(prismaService.building.findFirst).toHaveBeenCalledWith({
        where: { id: buildingId, tenantId },
      });
      expect(planEntitlementsService.assertLimit).toHaveBeenCalledWith(tenantId, 'units');
      expect(prismaService.unit.create).toHaveBeenCalled();
      expect(auditService.createLog).toHaveBeenCalled();
    });

    it('should use default unitType and occupancyStatus', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const dto: CreateUnitDto = {
        code: 'B02',
        label: 'Unit 2B',
      };
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const expectedUnit = {
        id: 'unit-456',
        buildingId,
        code: 'B02',
        label: 'Unit 2B',
        unitType: 'APARTMENT',
        occupancyStatus: 'UNKNOWN',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(planEntitlementsService, 'assertLimit').mockResolvedValue(undefined);
      jest.spyOn(prismaService.unit, 'create').mockResolvedValue(expectedUnit as any);

      // ACT
      const result = await service.create(tenantId, buildingId, 'user-123', dto);

      // ASSERT
      expect(result).toEqual(expectedUnit);
      expect(prismaService.unit.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException when building not found', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'nonexistent';
      const dto: CreateUnitDto = {
        code: 'C03',
        label: 'Unit 3C',
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.create(tenantId, buildingId, 'user-123', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when unit code already exists', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const dto: CreateUnitDto = {
        code: 'A01',
        label: 'Duplicate',
      };
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const error = {
        code: 'P2002',
        meta: { target: ['code'] },
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(planEntitlementsService, 'assertLimit').mockResolvedValue(undefined);
      jest.spyOn(prismaService.unit, 'create').mockRejectedValue(error);

      // ACT & ASSERT
      await expect(service.create(tenantId, buildingId, 'user-123', dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(tenantId, buildingId, 'user-123', dto)).rejects.toThrow(
        'Unit code "A01" already exists in this building',
      );
    });

    it('should throw error when plan limit exceeded', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const dto: CreateUnitDto = {
        code: 'D04',
        label: 'Unit 4D',
      };
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const limitError = new BadRequestException('Unit limit exceeded');

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(planEntitlementsService, 'assertLimit').mockRejectedValue(limitError);

      // ACT & ASSERT
      await expect(service.create(tenantId, buildingId, 'user-123', dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ========== TESTS: FIND ALL BY TENANT ==========
  describe('findAllByTenant', () => {
    it('should return all units for a tenant', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const expectedUnits = [
        {
          id: 'unit-1',
          buildingId: 'building-1',
          code: 'A01',
          label: 'Unit 1A',
          unitType: 'APARTMENT',
          occupancyStatus: 'OCCUPIED',
          createdAt: new Date(),
          updatedAt: new Date(),
          building: { id: 'building-1', name: 'Building A' },
          unitOccupants: [],
        },
        {
          id: 'unit-2',
          buildingId: 'building-1',
          code: 'A02',
          label: 'Unit 2A',
          unitType: 'APARTMENT',
          occupancyStatus: 'VACANT',
          createdAt: new Date(),
          updatedAt: new Date(),
          building: { id: 'building-1', name: 'Building A' },
          unitOccupants: [],
        },
      ];

      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue(expectedUnits as any);

      // ACT
      const result = await service.findAllByTenant(tenantId);

      // ASSERT
      expect(result).toEqual(expectedUnits);
      expect(prismaService.unit.findMany).toHaveBeenCalled();
    });

    it('should return units filtered by buildingId', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-1';
      const expectedUnits = [
        {
          id: 'unit-1',
          buildingId,
          code: 'A01',
          label: 'Unit 1A',
          unitType: 'APARTMENT',
          occupancyStatus: 'OCCUPIED',
          createdAt: new Date(),
          updatedAt: new Date(),
          building: { id: buildingId, name: 'Building A' },
          unitOccupants: [],
        },
      ];

      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue(expectedUnits as any);

      // ACT
      const result = await service.findAllByTenant(tenantId, buildingId);

      // ASSERT
      expect(result).toEqual(expectedUnits);
      expect(prismaService.unit.findMany).toHaveBeenCalled();
    });

    it('should return empty array when tenant has no units', async () => {
      // ARRANGE
      const tenantId = 'tenant-empty';
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([]);

      // ACT
      const result = await service.findAllByTenant(tenantId);

      // ASSERT
      expect(result).toEqual([]);
    });
  });

  // ========== TESTS: FIND ALL ==========
  describe('findAll', () => {
    it('should return all units in a building', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const expectedUnits = [
        {
          id: 'unit-1',
          buildingId,
          code: 'A01',
          label: 'Unit 1A',
          unitType: 'APARTMENT',
          occupancyStatus: 'OCCUPIED',
          createdAt: new Date(),
          updatedAt: new Date(),
          unitOccupants: [],
        },
      ];

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue(expectedUnits as any);

      // ACT
      const result = await service.findAll(tenantId, buildingId);

      // ASSERT
      expect(result).toEqual(expectedUnits);
      expect(prismaService.unit.findMany).toHaveBeenCalled();
    });

    it('should throw NotFoundException when building not found', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'nonexistent';

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.findAll(tenantId, buildingId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ========== TESTS: FIND ONE ==========
  describe('findOne', () => {
    it('should return a single unit with occupants', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const unitId = 'unit-123';
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const expectedUnit = {
        id: unitId,
        buildingId,
        code: 'A01',
        label: 'Unit 1A',
        unitType: 'APARTMENT',
        occupancyStatus: 'OCCUPIED',
        createdAt: new Date(),
        updatedAt: new Date(),
        unitOccupants: [
          {
            id: 'occ-1',
            unitId,
            userId: 'user-123',
            isPrimary: true,
            startAt: new Date(),
            endAt: null,
            user: {
              id: 'user-123',
              email: 'resident@example.com',
              fullName: 'John Doe',
              phone: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              tenantId,
            },
          },
        ],
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue(expectedUnit as any);

      // ACT
      const result = await service.findOne(tenantId, buildingId, unitId);

      // ASSERT
      expect(result).toEqual(expectedUnit);
      expect(prismaService.building.findFirst).toHaveBeenCalledWith({
        where: { id: buildingId, tenantId },
      });
      expect(prismaService.unit.findFirst).toHaveBeenCalled();
    });

    it('should throw NotFoundException when building not found', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'nonexistent';
      const unitId = 'unit-123';

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.findOne(tenantId, buildingId, unitId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when unit not found', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const unitId = 'nonexistent-unit';
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.findOne(tenantId, buildingId, unitId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ========== TESTS: UPDATE ==========
  describe('update', () => {
    it('should update a unit successfully', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const unitId = 'unit-123';
      const dto: UpdateUnitDto = {
        code: 'A01-NEW',
        label: 'Updated Unit',
        unitType: 'PENTHOUSE',
        occupancyStatus: 'OCCUPIED',
      };
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const existingUnit = {
        id: unitId,
        buildingId,
        code: 'A01',
        label: 'Unit 1A',
        unitType: 'APARTMENT',
        occupancyStatus: 'VACANT',
        createdAt: new Date(),
        updatedAt: new Date(),
        unitOccupants: [],
      };
      const updatedUnit = {
        ...existingUnit,
        code: 'A01-NEW',
        label: 'Updated Unit',
        unitType: 'PENTHOUSE',
        occupancyStatus: 'OCCUPIED',
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue(existingUnit as any);
      jest.spyOn(prismaService.unit, 'update').mockResolvedValue(updatedUnit as any);
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.update(tenantId, buildingId, unitId, 'user-123', dto);

      // ASSERT
      expect(result).toEqual(updatedUnit);
      expect(prismaService.unit.update).toHaveBeenCalled();
      expect(auditService.createLog).toHaveBeenCalled();
    });

    it('should throw BadRequestException on duplicate code', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const unitId = 'unit-123';
      const dto: UpdateUnitDto = {
        code: 'A02',
        label: 'Unit 1A',
        unitType: 'APARTMENT',
        occupancyStatus: 'VACANT',
      };
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const existingUnit = {
        id: unitId,
        buildingId,
        code: 'A01',
        label: 'Unit 1A',
        unitType: 'APARTMENT',
        occupancyStatus: 'VACANT',
        createdAt: new Date(),
        updatedAt: new Date(),
        unitOccupants: [],
      };
      const error = {
        code: 'P2002',
        meta: { target: ['code'] },
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue(existingUnit as any);
      jest.spyOn(prismaService.unit, 'update').mockRejectedValue(error);

      // ACT & ASSERT
      await expect(service.update(tenantId, buildingId, unitId, 'user-123', dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ========== TESTS: REMOVE ==========
  describe('remove', () => {
    it('should delete a unit successfully', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const unitId = 'unit-123';
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const existingUnit = {
        id: unitId,
        buildingId,
        code: 'A01',
        label: 'Unit 1A',
        unitType: 'APARTMENT',
        occupancyStatus: 'VACANT',
        createdAt: new Date(),
        updatedAt: new Date(),
        unitOccupants: [],
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue(existingUnit as any);
      jest.spyOn(prismaService.unit, 'delete').mockResolvedValue(existingUnit as any);
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.remove(tenantId, buildingId, unitId, 'user-123');

      // ASSERT
      expect(result).toEqual(existingUnit);
      expect(prismaService.unit.delete).toHaveBeenCalledWith({
        where: { id: unitId },
      });
      expect(auditService.createLog).toHaveBeenCalledWith({
        tenantId,
        actorUserId: 'user-123',
        action: AuditAction.UNIT_DELETE,
        entityType: 'Unit',
        entityId: unitId,
        metadata: {
          buildingId,
          code: 'A01',
          label: 'Unit 1A',
        },
      });
    });

    it('should throw NotFoundException when unit not found', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const unitId = 'nonexistent';
      const building = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: 'Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(building as any);
      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.remove(tenantId, buildingId, unitId, 'user-123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
