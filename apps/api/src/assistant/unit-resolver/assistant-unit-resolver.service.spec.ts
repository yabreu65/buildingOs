import { Test, TestingModule } from '@nestjs/testing';
import { AssistantUnitResolverService } from './assistant-unit-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AssistantUnitResolverService', () => {
  let service: AssistantUnitResolverService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantUnitResolverService,
        {
          provide: PrismaService,
          useValue: {
            building: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
            },
            unit: {
              findFirst: jest.fn(),
            },
            unitAssociation: {
              findFirst: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AssistantUnitResolverService>(AssistantUnitResolverService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolve with buildingAlias', () => {
    it('should resolve A-0101 when alias A exists', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: '0101', buildingAlias: 'A' };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue({
        id: 'building-a',
        name: 'Torre A',
        alias: 'A',
      } as any);

      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue({
        id: 'unit-1',
        code: '0101',
        label: 'Departamento 0101',
      } as any);

      const result = await service.resolve(tenantId, token);

      expect(result.errorResponse).toBeNull();
      expect(result.resolved).not.toBeNull();
      expect(result.resolved!.displayCode).toBe('A-0101');
      expect(result.resolved!.building.alias).toBe('A');
      expect(result.resolved!.unit.code).toBe('0101');
      expect(prismaService.unit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          buildingId: 'building-a',
          code: '0101',
        }),
      }));
    });

    it('should return error when alias does not exist', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: '0101', buildingAlias: 'Z' };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(null);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).toBeNull();
      expect(result.errorResponse).not.toBeNull();
      expect(result.errorResponse!.answer).toContain('No encontré el edificio Z');
    });


    it('should scope parking association lookup by tenant and building', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: 'P001', buildingAlias: 'A' };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue({
        id: 'building-a',
        name: 'Torre A',
        alias: 'A',
      } as any);

      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue({
        id: 'parking-1',
        code: 'P001',
        label: null,
        unitType: 'ESTACIONAMIENTO',
      } as any);
      jest.spyOn((prismaService as any).unitAssociation, 'findFirst').mockResolvedValue(null);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).not.toBeNull();
      expect((prismaService as any).unitAssociation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          tenantId,
          buildingId: 'building-a',
          parkingId: 'parking-1',
        },
      }));
    });
  });

  describe('resolve with buildingName', () => {
    it('should resolve by building name', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: '0101', buildingName: 'Torre A' };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue({
        id: 'building-a',
        name: 'Torre A',
        alias: 'A',
      } as any);

      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue({
        id: 'unit-1',
        code: '0101',
        label: null,
      } as any);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).not.toBeNull();
      expect(result.resolved!.displayCode).toBe('A-0101');
    });
  });

  describe('resolve without building (auto-inference)', () => {
    it('should auto-resolve when tenant has exactly 1 building', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: '0101' };

      jest.spyOn(prismaService.building, 'findMany').mockResolvedValue([
        { id: 'building-a', name: 'Torre A', alias: 'A' },
      ] as any);

      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue({
        id: 'unit-1',
        code: '0101',
        label: null,
      } as any);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).not.toBeNull();
      expect(result.resolved!.displayCode).toBe('A-0101');
    });

    it('should return ambiguity error when tenant has 2+ buildings', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: '0101' };

      jest.spyOn(prismaService.building, 'findMany').mockResolvedValue([
        { id: 'building-a', name: 'Torre A', alias: 'A' },
        { id: 'building-b', name: 'Torre B', alias: 'B' },
      ] as any);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).toBeNull();
      expect(result.errorResponse).not.toBeNull();
      expect(result.errorResponse!.answer).toContain('Necesito que me indiques el edificio');
      expect(result.errorResponse!.answer).toContain('A-0101');
      expect(result.errorResponse!.answer).toContain('B-0101');
    });

    it('should return error when tenant has no buildings', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: '0101' };

      jest.spyOn(prismaService.building, 'findMany').mockResolvedValue([]);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).toBeNull();
      expect(result.errorResponse!.answer).toContain('todavía no tiene edificios configurados');
    });
  });

  describe('resolve unit not found', () => {
    it('should return error when unit does not exist in building', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: '9999', buildingAlias: 'A' };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue({
        id: 'building-a',
        name: 'Torre A',
        alias: 'A',
      } as any);

      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue(null);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).toBeNull();
      expect(result.errorResponse!.answer).toContain('No encontré el departamento A-9999');
    });
  });

  describe('multi-tenant isolation', () => {
    it('should not resolve unit from another tenant', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: '0101', buildingAlias: 'A' };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue(null);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).toBeNull();
      expect(result.errorResponse!.answer).toContain('No encontré el edificio A');
    });
  });
});
