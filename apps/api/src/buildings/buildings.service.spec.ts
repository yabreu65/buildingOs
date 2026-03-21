import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { AuditAction } from '@prisma/client';

describe('BuildingsService', () => {
  let service: BuildingsService;
  let prismaService: PrismaService;
  let auditService: AuditService;
  let planEntitlementsService: PlanEntitlementsService;

  // ========== SETUP ==========
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildingsService,
        {
          provide: PrismaService,
          useValue: {
            building: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: AuditService,
          useValue: {
            createLog: jest.fn(),
          },
        },
        {
          provide: PlanEntitlementsService,
          useValue: {
            assertLimit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BuildingsService>(BuildingsService);
    prismaService = module.get<PrismaService>(PrismaService);
    auditService = module.get<AuditService>(AuditService);
    planEntitlementsService = module.get<PlanEntitlementsService>(
      PlanEntitlementsService,
    );
  });

  // ========== CLEANUP ==========
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========== TESTS: CREATE ==========
  describe('create', () => {
    it('should create a building successfully', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const userId = 'user-123';
      const dto: CreateBuildingDto = {
        name: 'Building A',
        address: '123 Main St',
      };
      const expectedBuilding = {
        id: 'building-123',
        tenantId,
        name: 'Building A',
        address: '123 Main St',
        createdAt: new Date('2026-03-21'),
        updatedAt: new Date('2026-03-21'),
      };

      jest.spyOn(planEntitlementsService, 'assertLimit').mockResolvedValue(undefined);
      jest.spyOn(prismaService.building, 'create').mockResolvedValue(expectedBuilding as any);
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.create(tenantId, dto, userId);

      // ASSERT
      expect(result).toEqual(expectedBuilding);
      expect(planEntitlementsService.assertLimit).toHaveBeenCalledWith(tenantId, 'buildings');
      expect(prismaService.building.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          name: 'Building A',
          address: '123 Main St',
        },
      });
      expect(auditService.createLog).toHaveBeenCalledWith({
        tenantId,
        actorUserId: userId,
        action: AuditAction.BUILDING_CREATE,
        entityType: 'Building',
        entityId: 'building-123',
        metadata: {
          name: 'Building A',
          address: '123 Main St',
        },
      });
    });

    it('should create building without userId (no audit)', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const dto: CreateBuildingDto = {
        name: 'Building B',
        address: '456 Oak Ave',
      };
      const expectedBuilding = {
        id: 'building-456',
        tenantId,
        name: 'Building B',
        address: '456 Oak Ave',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(planEntitlementsService, 'assertLimit').mockResolvedValue(undefined);
      jest.spyOn(prismaService.building, 'create').mockResolvedValue(expectedBuilding as any);

      // ACT
      const result = await service.create(tenantId, dto);

      // ASSERT
      expect(result).toEqual(expectedBuilding);
      expect(auditService.createLog).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when building name already exists', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const dto: CreateBuildingDto = {
        name: 'Duplicate Building',
        address: '789 Elm St',
      };
      const error = {
        code: 'P2002',
        meta: { target: ['name'] },
      };

      jest.spyOn(planEntitlementsService, 'assertLimit').mockResolvedValue(undefined);
      jest.spyOn(prismaService.building, 'create').mockRejectedValue(error);

      // ACT & ASSERT
      await expect(service.create(tenantId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(tenantId, dto)).rejects.toThrow(
        'Building name "Duplicate Building" already exists in this tenant',
      );
    });

    it('should throw error when plan limit exceeded', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const dto: CreateBuildingDto = {
        name: 'Another Building',
        address: '999 Pine St',
      };
      const limitError = new BadRequestException('Building limit exceeded');

      jest.spyOn(planEntitlementsService, 'assertLimit').mockRejectedValue(limitError);

      // ACT & ASSERT
      await expect(service.create(tenantId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should re-throw unexpected database errors', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const dto: CreateBuildingDto = {
        name: 'Building C',
        address: '321 Birch Ln',
      };
      const unexpectedError = new Error('Database connection failed');

      jest.spyOn(planEntitlementsService, 'assertLimit').mockResolvedValue(undefined);
      jest.spyOn(prismaService.building, 'create').mockRejectedValue(unexpectedError);

      // ACT & ASSERT
      await expect(service.create(tenantId, dto)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  // ========== TESTS: FIND ALL ==========
  describe('findAll', () => {
    it('should return all buildings for a tenant', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const expectedBuildings = [
        {
          id: 'building-1',
          tenantId,
          name: 'Building A',
          address: '123 Main St',
          createdAt: new Date(),
          updatedAt: new Date(),
          units: [],
        },
        {
          id: 'building-2',
          tenantId,
          name: 'Building B',
          address: '456 Oak Ave',
          createdAt: new Date(),
          updatedAt: new Date(),
          units: [],
        },
      ];

      jest.spyOn(prismaService.building, 'findMany').mockResolvedValue(expectedBuildings as any);

      // ACT
      const result = await service.findAll(tenantId);

      // ASSERT
      expect(result).toEqual(expectedBuildings);
      expect(prismaService.building.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        include: { units: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when tenant has no buildings', async () => {
      // ARRANGE
      const tenantId = 'tenant-empty';
      jest.spyOn(prismaService.building, 'findMany').mockResolvedValue([]);

      // ACT
      const result = await service.findAll(tenantId);

      // ASSERT
      expect(result).toEqual([]);
    });

    it('should return buildings ordered by creation date descending', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const date1 = new Date('2026-01-01');
      const date2 = new Date('2026-02-01');
      const date3 = new Date('2026-03-01');
      const buildings = [
        {
          id: 'building-3',
          tenantId,
          name: 'Building C',
          address: '789 Elm St',
          createdAt: date3,
          updatedAt: date3,
          units: [],
        },
        {
          id: 'building-2',
          tenantId,
          name: 'Building B',
          address: '456 Oak Ave',
          createdAt: date2,
          updatedAt: date2,
          units: [],
        },
        {
          id: 'building-1',
          tenantId,
          name: 'Building A',
          address: '123 Main St',
          createdAt: date1,
          updatedAt: date1,
          units: [],
        },
      ];

      jest.spyOn(prismaService.building, 'findMany').mockResolvedValue(buildings as any);

      // ACT
      const result = await service.findAll(tenantId);

      // ASSERT
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('building-3');
      expect(result[1].id).toBe('building-2');
      expect(result[2].id).toBe('building-1');
    });
  });

  // ========== TESTS: FIND ONE ==========
  describe('findOne', () => {
    it('should return a single building with units and occupants', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const expectedBuilding = {
        id: buildingId,
        tenantId,
        name: 'Building A',
        address: '123 Main St',
        createdAt: new Date(),
        updatedAt: new Date(),
        units: [
          {
            id: 'unit-1',
            buildingId,
            label: 'Unit 1A',
            unitCode: 'A01',
            unitType: 'APARTMENT',
            occupancyStatus: 'OCCUPIED',
            createdAt: new Date(),
            updatedAt: new Date(),
            unitOccupants: [
              {
                id: 'occ-1',
                unitId: 'unit-1',
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
          },
        ],
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(expectedBuilding as any);

      // ACT
      const result = await service.findOne(tenantId, buildingId);

      // ASSERT
      expect(result).toEqual(expectedBuilding);
      expect(prismaService.building.findFirst).toHaveBeenCalledWith({
        where: { id: buildingId, tenantId },
        include: {
          units: {
            include: {
              unitOccupants: {
                include: { user: true },
              },
            },
          },
        },
      });
    });

    it('should throw NotFoundException when building not found', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'nonexistent-building';

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.findOne(tenantId, buildingId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(tenantId, buildingId)).rejects.toThrow(
        'Building not found or does not belong to this tenant',
      );
    });

    it('should throw NotFoundException when building belongs to different tenant', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const otherTenantId = 'tenant-456';
      const buildingId = 'building-123';

      // Building exists but for different tenant
      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.findOne(tenantId, buildingId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ========== TESTS: UPDATE ==========
  describe('update', () => {
    it('should update a building successfully', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const userId = 'user-123';
      const dto: UpdateBuildingDto = {
        name: 'Updated Building',
        address: 'Updated Address',
      };
      const existingBuilding = {
        id: buildingId,
        tenantId,
        name: 'Old Name',
        address: 'Old Address',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updatedBuilding = {
        ...existingBuilding,
        name: 'Updated Building',
        address: 'Updated Address',
        units: [],
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(existingBuilding as any);
      jest.spyOn(prismaService.building, 'update').mockResolvedValue(updatedBuilding as any);
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.update(tenantId, buildingId, dto, userId);

      // ASSERT
      expect(result).toEqual(updatedBuilding);
      expect(prismaService.building.update).toHaveBeenCalledWith({
        where: { id: buildingId },
        data: {
          name: 'Updated Building',
          address: 'Updated Address',
        },
        include: { units: true },
      });
      expect(auditService.createLog).toHaveBeenCalledWith({
        tenantId,
        actorUserId: userId,
        action: AuditAction.BUILDING_UPDATE,
        entityType: 'Building',
        entityId: buildingId,
        metadata: {
          name: 'Updated Building',
          address: 'Updated Address',
        },
      });
    });

    it('should throw NotFoundException when building does not exist', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'nonexistent';
      const dto: UpdateBuildingDto = {
        name: 'Updated',
        address: 'Updated',
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.update(tenantId, buildingId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException on duplicate name', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const dto: UpdateBuildingDto = {
        name: 'Existing Name',
        address: 'Address',
      };
      const existingBuilding = {
        id: buildingId,
        tenantId,
        name: 'Old Name',
        address: 'Old Address',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const error = {
        code: 'P2002',
        meta: { target: ['name'] },
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(existingBuilding as any);
      jest.spyOn(prismaService.building, 'update').mockRejectedValue(error);

      // ACT & ASSERT
      await expect(service.update(tenantId, buildingId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update building without userId (no audit)', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const dto: UpdateBuildingDto = {
        name: 'Updated',
        address: 'Updated Address',
      };
      const existingBuilding = {
        id: buildingId,
        tenantId,
        name: 'Old',
        address: 'Old',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updatedBuilding = {
        ...existingBuilding,
        name: 'Updated',
        address: 'Updated Address',
        units: [],
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(existingBuilding as any);
      jest.spyOn(prismaService.building, 'update').mockResolvedValue(updatedBuilding as any);

      // ACT
      const result = await service.update(tenantId, buildingId, dto);

      // ASSERT
      expect(result).toEqual(updatedBuilding);
      expect(auditService.createLog).not.toHaveBeenCalled();
    });
  });

  // ========== TESTS: REMOVE ==========
  describe('remove', () => {
    it('should delete a building successfully', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const userId = 'user-123';
      const existingBuilding = {
        id: buildingId,
        tenantId,
        name: 'Building to Delete',
        address: 'Address',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(existingBuilding as any);
      jest.spyOn(prismaService.building, 'delete').mockResolvedValue(existingBuilding as any);
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.remove(tenantId, buildingId, userId);

      // ASSERT
      expect(result).toEqual(existingBuilding);
      expect(prismaService.building.delete).toHaveBeenCalledWith({
        where: { id: buildingId },
      });
      expect(auditService.createLog).toHaveBeenCalledWith({
        tenantId,
        actorUserId: userId,
        action: AuditAction.BUILDING_DELETE,
        entityType: 'Building',
        entityId: buildingId,
        metadata: {
          name: 'Building to Delete',
        },
      });
    });

    it('should throw NotFoundException when building does not exist', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'nonexistent';

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.remove(tenantId, buildingId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete building without userId (no audit)', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const existingBuilding = {
        id: buildingId,
        tenantId,
        name: 'Building',
        address: 'Address',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(existingBuilding as any);
      jest.spyOn(prismaService.building, 'delete').mockResolvedValue(existingBuilding as any);

      // ACT
      const result = await service.remove(tenantId, buildingId);

      // ASSERT
      expect(result).toEqual(existingBuilding);
      expect(auditService.createLog).not.toHaveBeenCalled();
    });
  });
});
