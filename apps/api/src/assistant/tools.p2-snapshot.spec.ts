import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AssistantToolsService } from './tools.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProcessSearchService } from '../process/process-search.service';
import { CrossQueryService } from './cross-query.service';
import { ASSISTANT_RESPONSE_SCHEMA_VERSION_V2, ASSISTANT_RESPONSE_SCHEMA_VERSION } from './tools.types';

describe('P2 Snapshot Tools', () => {
  let service: AssistantToolsService;
  let prisma: PrismaService;

  const mockPrisma = {
    unitBalanceMonthlySnapshot: {
      findMany: jest.fn().mockResolvedValue([
        { period: '2026-03', chargedMinor: 100000, collectedMinor: 80000, outstandingMinor: 20000, overdueMinor: 10000, collectionRateBp: 8000, asOf: new Date('2026-03-31') },
        { period: '2026-02', chargedMinor: 100000, collectedMinor: 70000, outstandingMinor: 30000, overdueMinor: 15000, collectionRateBp: 7000, asOf: new Date('2026-02-28') },
      ]),
    },
    buildingBalanceMonthlySnapshot: {
      findMany: jest.fn().mockResolvedValue([
        { period: '2026-03', chargedMinor: 500000, collectedMinor: 400000, outstandingMinor: 100000, overdueMinor: 50000, collectionRateBp: 8000, asOf: new Date('2026-03-31') },
        { period: '2026-02', chargedMinor: 450000, collectedMinor: 350000, outstandingMinor: 100000, overdueMinor: 45000, collectionRateBp: 7777, asOf: new Date('2026-02-28') },
      ]),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ id: 'm-1', roles: [{ role: 'SUPER_ADMIN' }] }),
    },
  };

  const mockAudit = {
    createLog: jest.fn().mockResolvedValue({}),
  };

  const mockProcessSearch = {
    searchProcesses: jest.fn().mockResolvedValue({ procesos: [], pagination: { total: 0 } }),
    getProcessSummary: jest.fn().mockResolvedValue({ groups: [] }),
    searchClaims: jest.fn().mockResolvedValue({ procesos: [], pagination: { total: 0 } }),
  };
  const mockCrossQuery = {
    execute: jest.fn().mockResolvedValue({ responseType: 'list', templateName: 'test' }),
  };

  beforeEach(async () => {
    process.env.ASSISTANT_READONLY_API_KEYS = 'test-key';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantToolsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: ProcessSearchService, useValue: mockProcessSearch },
        { provide: CrossQueryService, useValue: mockCrossQuery },
      ],
    }).compile();

    service = module.get<AssistantToolsService>(AssistantToolsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    delete process.env.ASSISTANT_READONLY_API_KEYS;
  });

  describe('getUnitDebtTrend', () => {
    it('returns series with answerSource=snapshot', async () => {
      const result = await (service as any).getUnitDebtTrend(
        'tenant-1',
        'test',
        { unitId: 'u1', months: 6, metric: 'outstanding' },
        ASSISTANT_RESPONSE_SCHEMA_VERSION_V2,
      );

      expect(result.responseType).toBe('list');
      expect(result.answerSource).toBe('snapshot');
      expect(result.metadata).toHaveProperty('series');
    });

    it('clamps months > 24 to 24', async () => {
      await (service as any).getUnitDebtTrend(
        'tenant-1',
        'test',
        { unitId: 'u1', months: 50 },
        ASSISTANT_RESPONSE_SCHEMA_VERSION_V2,
      );

      expect(mockPrisma.unitBalanceMonthlySnapshot.findMany).toHaveBeenCalled();
    });

    it('returns no_data when no snapshots', async () => {
      mockPrisma.unitBalanceMonthlySnapshot.findMany.mockResolvedValueOnce([]);
      const result = await (service as any).getUnitDebtTrend(
        'tenant-1',
        'test',
        { unitId: 'u-no-data', months: 6 },
        ASSISTANT_RESPONSE_SCHEMA_VERSION_V2,
      );

      expect(result.responseType).toBe('no_data');
    });

    it('rejects v1 contract', async () => {
      await expect(
        (service as any).getUnitDebtTrend(
          'tenant-1',
          'test',
          { unitId: 'u1', months: 6 },
          ASSISTANT_RESPONSE_SCHEMA_VERSION,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getBuildingDebtTrend', () => {
    it('returns snapshot answerSource', async () => {
      const result = await (service as any).getBuildingDebtTrend(
        'tenant-1',
        { buildingId: 'b1', months: 6 },
        ASSISTANT_RESPONSE_SCHEMA_VERSION_V2,
      );

      expect(result.answerSource).toBe('snapshot');
    });
  });

  describe('getCollectionsTrend', () => {
    it('returns snapshot answerSource with series', async () => {
      const result = await (service as any).getCollectionsTrend(
        'tenant-1',
        { months: 6 },
        ASSISTANT_RESPONSE_SCHEMA_VERSION_V2,
      );

      expect(result.answerSource).toBe('snapshot');
      expect(result.metadata).toHaveProperty('series');
    });
  });
});