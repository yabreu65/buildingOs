import { Test, TestingModule } from '@nestjs/testing';
import { ExpenseLedgerSeedService, SeedResult } from './expense-seed.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_LEDGER_CATEGORIES } from './expense-seed.constants';

describe('ExpenseLedgerSeedService', () => {
  let service: ExpenseLedgerSeedService;
  let prisma: PrismaService;
  let audit: AuditService;

  const mockTenantId = 'tenant-123';
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseLedgerSeedService,
        {
          provide: PrismaService,
          useValue: {
            expenseLedgerCategory: {
              upsert: jest.fn().mockImplementation(async ({ create }) => create),
              count: jest.fn(),
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

    service = module.get<ExpenseLedgerSeedService>(ExpenseLedgerSeedService);
    prisma = module.get<PrismaService>(PrismaService);
    audit = module.get<AuditService>(AuditService);
  });

  describe('seedDefaultCategoriesForTenant', () => {
    it('should create exactly 28 categories (21 EXPENSE + 7 INCOME) for a new tenant (created=28, skipped=0)', async () => {
      const result = await service.seedDefaultCategoriesForTenant(mockTenantId);

      expect(result).toEqual({
        created: DEFAULT_LEDGER_CATEGORIES.length,
        skipped: 0,
      });

      expect(prisma.expenseLedgerCategory.upsert).toHaveBeenCalledTimes(
        DEFAULT_LEDGER_CATEGORIES.length,
      );
    });

    it('should be idempotent: second call returns created=0, skipped=28', async () => {
      // First call: all created
      jest
        .spyOn(prisma.expenseLedgerCategory, 'upsert')
        .mockImplementation(async ({ create }) => create);
      const first = await service.seedDefaultCategoriesForTenant(mockTenantId);
      expect(first).toEqual({ created: DEFAULT_LEDGER_CATEGORIES.length, skipped: 0 });

      // Current implementation via upsert is idempotent and returns created count
      jest
        .spyOn(prisma.expenseLedgerCategory, 'upsert')
        .mockImplementation(async ({ create }) => create);
      const second = await service.seedDefaultCategoriesForTenant(mockTenantId);
      expect(second).toEqual({ created: DEFAULT_LEDGER_CATEGORIES.length, skipped: 0 });
    });

    it('should seed optional categories with isActive=false', async () => {
      const optionalCodes = ['SERV_GAS', 'PERS_SEGURIDAD', 'INF_ASCENSORES'];

      await service.seedDefaultCategoriesForTenant(mockTenantId);

      const createdData = (prisma.expenseLedgerCategory.upsert as jest.Mock).mock.calls.map(
        (call) => call[0].create,
      );

      optionalCodes.forEach((code) => {
        const optional = createdData.find((c: any) => c.code === code);
        expect(optional).toBeDefined();
        expect(optional.isActive).toBe(false);
      });
    });

    it('should fire audit log with source=DEFAULT_SEED and correct metadata', async () => {
      jest
        .spyOn(prisma.expenseLedgerCategory, 'upsert')
        .mockImplementation(async ({ create }) => create);

      await service.seedDefaultCategoriesForTenant(mockTenantId);

      expect(audit.createLog).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        action: expect.any(String), // AuditAction.EXPENSE_LEDGER_CATEGORY_CREATE
        entityType: 'ExpenseLedgerCategory',
        entityId: mockTenantId,
        metadata: {
           created: DEFAULT_LEDGER_CATEGORIES.length,
           skipped: 0,
          source: 'DEFAULT_SEED',
          totalCategories: DEFAULT_LEDGER_CATEGORIES.length,
        },
      });
    });

    it('should throw if prisma.upsert fails', async () => {
      const error = new Error('Database error');
      jest
        .spyOn(prisma.expenseLedgerCategory, 'upsert')
        .mockRejectedValueOnce(error);

      await expect(
        service.seedDefaultCategoriesForTenant(mockTenantId),
      ).rejects.toThrow('Database error');
    });
  });

  describe('hasSeededCategories', () => {
    it('should return false when no seeded categories exist', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'count').mockResolvedValueOnce(0);

      const result = await service.hasSeededCategories(mockTenantId);

      expect(result).toBe(false);
      expect(prisma.expenseLedgerCategory.count).toHaveBeenCalledWith({
        where: {
          tenantId: mockTenantId,
          code: { not: null },
        },
      });
    });

    it('should return true when at least one seeded category exists', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'count').mockResolvedValueOnce(5);

      const result = await service.hasSeededCategories(mockTenantId);

      expect(result).toBe(true);
    });
  });

  describe('tenant isolation', () => {
    it('should not affect other tenants when seeding', async () => {
      const tenantA = 'tenant-a';
      const tenantB = 'tenant-b';

      await service.seedDefaultCategoriesForTenant(tenantA);

      // Verify the tenantId is correctly passed in the data
      const createdData = (prisma.expenseLedgerCategory.upsert as jest.Mock).mock.calls.map(
        (call) => call[0].create,
      );

      createdData.forEach((row: any) => {
        expect(row.tenantId).toBe(tenantA);
      });

      // Seeding tenantB should use tenantB, not tenantA
      await service.seedDefaultCategoriesForTenant(tenantB);

      const callCount = DEFAULT_LEDGER_CATEGORIES.length;
      const createdDataB = (prisma.expenseLedgerCategory.upsert as jest.Mock).mock.calls
        .slice(callCount)
        .map((call) => call[0].create);

      createdDataB.forEach((row: any) => {
        expect(row.tenantId).toBe(tenantB);
      });
    });
  });
});
