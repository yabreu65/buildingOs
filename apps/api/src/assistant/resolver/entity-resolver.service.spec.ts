import { EntityResolverService } from './entity-resolver.service';

// Mock PrismaService
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();

const mockPrismaService = {
  building: {
    findFirst: mockFindFirst,
    findMany: mockFindMany,
  },
  unit: {
    findFirst: mockFindFirst,
    findMany: mockFindMany,
  },
  unitOccupant: {
    findMany: mockFindMany,
  },
} as any;

describe('EntityResolverService', () => {
  let service: EntityResolverService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EntityResolverService(mockPrismaService);
  });

  describe('resolveBuilding', () => {
    it('resolves building by exact alias match', async () => {
      const mockBuilding = {
        id: 'building-1',
        name: 'Torre A',
        alias: 'A',
      };

      mockFindFirst.mockResolvedValue(mockBuilding);

      const result = await service.resolveBuilding('A', 'tenant-1');

      expect(result).toBeDefined();
      expect(result!.building!.id).toBe('building-1');
      expect(result!.building!.alias).toBe('A');
      expect(result!.alternatives).toHaveLength(0);
    });

    it('resolves building by name contains (case-insensitive)', async () => {
      const mockBuilding = {
        id: 'building-1',
        name: 'Torre Norte',
        alias: 'TORRE',
      };

      mockFindFirst.mockResolvedValue(mockBuilding);

      const result = await service.resolveBuilding('torre norte', 'tenant-1');

      expect(result).toBeDefined();
      expect(result!.building!.id).toBe('building-1');
    });

    it('returns null when no building found', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await service.resolveBuilding('NonExistent', 'tenant-1');

      expect(result).toBeNull();
    });

    it('filters by tenantId for multi-tenant isolation', async () => {
      mockFindFirst.mockResolvedValue(null);

      await service.resolveBuilding('A', 'tenant-1');

      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
          }),
        }),
      );
    });
  });

  describe('resolveUnit', () => {
    it('resolves unit by exact code within building', async () => {
      const mockUnit = {
        id: 'unit-1',
        code: '0101',
        label: 'Apartamento 101',
        buildingId: 'building-1',
      };

      mockFindFirst.mockResolvedValue(mockUnit);

      const result = await service.resolveUnit('0101', 'building-1', 'tenant-1');

      expect(result).toBeDefined();
      expect(result!.unit!.id).toBe('unit-1');
      expect(result!.unit!.code).toBe('0101');
      expect(result!.alternatives).toHaveLength(0);
    });

    it('returns null when no unit found', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await service.resolveUnit('9999', 'building-1', 'tenant-1');

      expect(result).toBeNull();
    });

    it('scopes query by buildingId and tenantId', async () => {
      mockFindFirst.mockResolvedValue(null);

      await service.resolveUnit('0101', 'building-1', 'tenant-1');

      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            buildingId: 'building-1',
          }),
        }),
      );
    });
  });

  describe('resolvePerson', () => {
    it('resolves person by name search', async () => {
      const mockOccupants = [
        {
          id: 'occupant-1',
          member: { id: 'member-1', name: 'Juan Perez' },
          unit: { id: 'unit-1', code: '0101' },
        },
      ];

      mockFindMany.mockResolvedValue(mockOccupants);

      const result = await service.resolvePerson('Juan Perez', 'tenant-1');

      expect(result).toBeDefined();
      expect(result!.person!.name).toBe('Juan Perez');
      expect(result!.person!.unitId).toBe('unit-1');
    });

    it('returns alternatives when multiple persons match', async () => {
      const mockOccupants = [
        {
          id: 'occupant-1',
          member: { id: 'member-1', name: 'Juan Perez' },
          unit: { id: 'unit-1', code: '0101' },
        },
        {
          id: 'occupant-2',
          member: { id: 'member-2', name: 'Juan Rodriguez' },
          unit: { id: 'unit-2', code: '0201' },
        },
      ];

      mockFindMany.mockResolvedValue(mockOccupants);

      const result = await service.resolvePerson('Juan', 'tenant-1');

      expect(result).toBeDefined();
      expect(result!.alternatives.length).toBeGreaterThan(0);
    });

    it('returns null when no person found', async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await service.resolvePerson('NonExistent', 'tenant-1');

      expect(result).toBeNull();
    });

    it('filters by tenantId for multi-tenant isolation', async () => {
      mockFindMany.mockResolvedValue([]);

      await service.resolvePerson('Juan', 'tenant-1');

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
          }),
        }),
      );
    });
  });
});
