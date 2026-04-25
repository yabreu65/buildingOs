import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SnapshotGenerationService } from './snapshot-generation.service';

describe('SnapshotGenerationService', () => {
  let service: SnapshotGenerationService;
  let prisma: PrismaService;

  const mockPrisma = {
    building: {
      findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Building 1' }]),
    },
    unit: {
      findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]),
    },
    charge: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'c1', amount: 10000 },
        { id: 'c2', amount: 20000 },
      ]),
    },
    paymentAllocation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 15000 } }),
    },
    unitBalanceMonthlySnapshot: {
      upsert: jest.fn().mockImplementation((args) => Promise.resolve(args.create)),
    },
    buildingBalanceMonthlySnapshot: {
      upsert: jest.fn().mockImplementation((args) => Promise.resolve(args.create)),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }]),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SnapshotGenerationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SnapshotGenerationService>(SnapshotGenerationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getPreviousPeriod', () => {
    it('should return previous month in YYYY-MM format', () => {
      const result = service.getPreviousPeriod(new Date('2026-04-15'));
      expect(result).toBe('2026-03');
    });

    it('should handle year boundary', () => {
      const result = service.getPreviousPeriod(new Date('2026-01-15'));
      expect(result).toBe('2025-12');
    });
  });

  describe('generateSnapshots', () => {
    it('should generate unit and building snapshots', async () => {
      const result = await service.generateSnapshots({
        tenantId: 'tenant-1',
        period: '2026-03',
      });

      expect(result.period).toBe('2026-03');
      expect(result.unitSnapshotsCreated).toBeGreaterThan(0);
      expect(result.buildingSnapshotsCreated).toBeGreaterThan(0);
    });

    it('should be idempotent: calling twice produces same count', async () => {
      const result1 = await service.generateSnapshots({
        tenantId: 'tenant-1',
        period: '2026-03',
      });

      const result2 = await service.generateSnapshots({
        tenantId: 'tenant-1',
        period: '2026-03',
      });

      expect(result1.unitSnapshotsCreated).toBe(result2.unitSnapshotsCreated);
      expect(result1.buildingSnapshotsCreated).toBe(result2.buildingSnapshotsCreated);
    });
  });

  describe('backfillRange', () => {
    it('should process multiple periods', async () => {
      const result = await service.backfillRange({
        tenantId: 'tenant-1',
        fromPeriod: '2026-01',
        toPeriod: '2026-03',
      });

      expect(result.periodsProcessed).toBe(3);
      expect(result.totalUnitSnapshots).toBeGreaterThan(0);
    });
  });

  describe('tenant isolation', () => {
    it('should only process specified tenant', async () => {
      await service.generateSnapshots({
        tenantId: 'tenant-1',
        period: '2026-03',
      });

      expect(mockPrisma.building.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1' }),
        }),
      );
    });
  });
});