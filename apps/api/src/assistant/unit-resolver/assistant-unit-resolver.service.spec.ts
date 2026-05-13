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
              findMany: jest.fn(),
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
        unitType: 'APARTAMENTO',
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

    it('should resolve block-style input A1-123 when DB code is 0123', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: 'A1-123', buildingAlias: 'A' };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue({
        id: 'building-a',
        name: 'Torre A',
        alias: 'A',
      } as any);

      const findFirstSpy = jest.spyOn(prismaService.unit, 'findFirst');
      findFirstSpy
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'unit-123',
          code: '0123',
          label: 'Departamento 0123',
          unitType: 'APARTAMENTO',
        } as any);

      const result = await service.resolve(tenantId, token);

      expect(result.errorResponse).toBeNull();
      expect(result.resolved).not.toBeNull();
      expect(result.resolved!.unit.code).toBe('0123');
      expect(findFirstSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: expect.objectContaining({
          code: 'A1-123',
        }),
      }));
      expect(findFirstSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: expect.objectContaining({
          code: { in: expect.arrayContaining(['0123']) },
        }),
      }));
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
        unitType: 'APARTAMENTO',
      } as any);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).not.toBeNull();
      expect(result.resolved!.displayCode).toBe('A-0101');
    });
  });

  describe('resolve without explicit building', () => {
    it('A: should resolve when there is a single tenant match for A-0123', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: 'A-0123' };

      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([
        {
          id: 'unit-1',
          code: 'A-0123',
          label: null,
          unitType: 'APARTAMENTO',
          buildingId: 'building-a',
          building: { id: 'building-a', name: 'Edificio A', alias: 'A' },
        },
      ] as any);

      const result = await service.resolve(tenantId, token);

      expect(result.errorResponse).toBeNull();
      expect(result.resolved).not.toBeNull();
      expect(result.resolved!.unit.code).toBe('A-0123');
      expect(result.resolved!.building.name).toBe('Edificio A');
      expect(prismaService.unit.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          code: 'A-0123',
        }),
      }));
    });

    it('B: should request clarification when there are multiple tenant matches', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: 'A-0123' };

      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([
        {
          id: 'unit-1',
          code: 'A-0123',
          label: null,
          unitType: 'APARTAMENTO',
          buildingId: 'building-a',
          building: { id: 'building-a', name: 'Edificio A', alias: 'A' },
        },
        {
          id: 'unit-2',
          code: 'A-0123',
          label: null,
          unitType: 'APARTAMENTO',
          buildingId: 'building-b',
          building: { id: 'building-b', name: 'Edificio B', alias: 'B' },
        },
      ] as any);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).toBeNull();
      expect(result.errorResponse).not.toBeNull();
      expect(result.errorResponse!.answer).toContain('Encontré más de una unidad A-0123');
      expect(result.errorResponse!.answer).toContain('1. Edificio A — Unidad A-0123');
      expect(result.errorResponse!.answer).toContain('2. Edificio B — Unidad A-0123');
      expect(result.errorResponse!.answer).not.toContain('A-A-0123');
      expect(result.errorResponse!.answer).not.toContain('B-A-0123');
    });

    it('C: should preserve full opaque code on not found', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: 'A-0123' };

      const findManySpy = jest.spyOn(prismaService.unit, 'findMany');
      findManySpy.mockResolvedValueOnce([] as any); // exact
      findManySpy.mockResolvedValueOnce([] as any); // candidates
      findManySpy.mockResolvedValueOnce([] as any); // similar

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).toBeNull();
      expect(result.errorResponse!.answer).toContain('No encontré la unidad A-0123');
      expect(result.errorResponse!.answer).not.toContain('0123 en Torre A');
    });

    it('F: should not split A-0123 as tower A + 0123 automatically', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: 'A-0123' };

      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([
        {
          id: 'unit-1',
          code: 'A-0123',
          label: null,
          unitType: 'APARTAMENTO',
          buildingId: 'building-a',
          building: { id: 'building-a', name: 'Edificio A', alias: 'A' },
        },
      ] as any);

      await service.resolve(tenantId, token);

      expect(prismaService.building.findFirst).not.toHaveBeenCalled();
      expect(prismaService.unit.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ code: 'A-0123' }),
      }));
    });

    it('should resolve numeric legacy code from A-0123 candidate when exact code does not exist', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: 'A-0123' };

      const findManySpy = jest.spyOn(prismaService.unit, 'findMany');
      findManySpy.mockResolvedValueOnce([] as any); // exact miss
      findManySpy.mockResolvedValueOnce([
        {
          id: 'unit-legacy',
          code: '0123',
          label: null,
          unitType: 'APARTAMENTO',
          buildingId: 'building-a',
          building: { id: 'building-a', name: 'Edificio A', alias: 'A' },
        },
      ] as any);

      const result = await service.resolve(tenantId, token);

      expect(result.errorResponse).toBeNull();
      expect(result.resolved?.unit.code).toBe('0123');
    });
  });

  describe('resolve with explicit building', () => {
    it('D: should filter by explicit building and unit code', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: 'A-0123', buildingAlias: 'B' };

      jest.spyOn(prismaService.building, 'findFirst').mockResolvedValue({
        id: 'building-b',
        name: 'Edificio B',
        alias: 'B',
      } as any);

      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue({
        id: 'unit-123-b',
        code: 'A-0123',
        label: null,
        unitType: 'APARTAMENTO',
      } as any);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).not.toBeNull();
      expect(result.resolved!.building.id).toBe('building-b');
      expect(result.resolved!.unit.code).toBe('A-0123');
      expect(prismaService.unit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          buildingId: 'building-b',
          code: 'A-0123',
        }),
      }));
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
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([]);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).toBeNull();
      expect(result.errorResponse!.answer).toContain('No encontré la unidad 9999');
    });

    it('should keep full opaque code in not-found response', async () => {
      const tenantId = 'tenant-1';
      const token = { unitCode: 'A-0123' };

      const findManySpy = jest.spyOn(prismaService.unit, 'findMany');
      findManySpy.mockResolvedValueOnce([] as any);
      findManySpy.mockResolvedValueOnce([] as any);
      findManySpy.mockResolvedValueOnce([] as any);

      const result = await service.resolve(tenantId, token);

      expect(result.resolved).toBeNull();
      expect(result.errorResponse!.answer).toContain('No encontré la unidad A-0123');
      expect(result.errorResponse!.answer).not.toContain('No encontré 0123 en Torre A');
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

  it('E: should never force composite key suggestions like A-A-0123/B-A-0123 by default', async () => {
    const tenantId = 'tenant-1';
    const token = { unitCode: 'A-0123' };

    const findManySpy = jest.spyOn(prismaService.unit, 'findMany');
    findManySpy.mockResolvedValueOnce([] as any);
    findManySpy.mockResolvedValueOnce([] as any);
    findManySpy.mockResolvedValueOnce([] as any);

    const result = await service.resolve(tenantId, token);
    expect(result.resolved).toBeNull();
    expect(result.errorResponse!.answer).not.toContain('A-A-0123');
    expect(result.errorResponse!.answer).not.toContain('B-A-0123');
  });
});
