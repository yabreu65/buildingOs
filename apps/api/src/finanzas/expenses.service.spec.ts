import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';
import { CreateExpenseDto } from './expense-ledger.dto';

const makeExpense = (overrides: Record<string, unknown> = {}) => ({
  id: 'expense-1',
  tenantId: 'tenant-1',
  buildingId: 'building-1',
  period: '2026-05',
  liquidationPeriod: '2026-05',
  categoryId: 'cat-1',
  vendorId: 'vendor-1',
  amountMinor: 1000,
  currencyCode: 'ARS',
  invoiceDate: new Date('2026-05-01T00:00:00.000Z'),
  description: null,
  attachmentFileKey: null,
  status: 'DRAFT',
  scopeType: 'BUILDING',
  unitGroupId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  category: { name: 'Maintenance' },
  vendor: { name: 'Vendor' },
  ...overrides,
});

const defaultCreateDto: CreateExpenseDto = {
  buildingId: 'building-1',
  period: '2026-05',
  categoryId: 'cat-1',
  vendorId: 'vendor-1',
  amountMinor: 1000,
  currencyCode: 'ARS',
  invoiceDate: '2026-05-01',
};

describe('ExpensesService', () => {
  let service: ExpensesService;
  let prisma: PrismaService;
  let validators: FinanzasValidators;
  let movementAllocation: MovementAllocationService;
  let audit: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        {
          provide: PrismaService,
          useValue: {
            expense: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
            },
            liquidation: { findFirst: jest.fn() },
            expenseLedgerCategory: { findFirst: jest.fn() },
            vendor: { findFirst: jest.fn() },
            unitGroup: { findFirst: jest.fn() },
            adjustment: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
          },
        },
        { provide: AuditService, useValue: { createLog: jest.fn() } },
        {
          provide: FinanzasValidators,
          useValue: {
            isAdminOrOperator: jest.fn().mockReturnValue(true),
            validateBuildingBelongsToTenant: jest.fn(),
          },
        },
        {
          provide: MovementAllocationService,
          useValue: { createForExpense: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
    prisma = module.get<PrismaService>(PrismaService);
    validators = module.get<FinanzasValidators>(FinanzasValidators);
    movementAllocation = module.get<MovementAllocationService>(MovementAllocationService);
    audit = module.get<AuditService>(AuditService);
  });

  // ── CREATE EXPENSE ─────────────────────────────────────────────────────

  describe('createExpense', () => {
    it('creates a BUILDING expense successfully', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Maintenance', catalogScope: 'BUILDING',
      } as any);
      jest.spyOn(prisma.vendor, 'findFirst').mockResolvedValue({ id: 'vendor-1' } as any);
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.expense, 'create').mockResolvedValue(makeExpense() as any);

      const result = await service.createExpense(
        'tenant-1', 'member-1', ['TENANT_ADMIN'],
        { ...defaultCreateDto, scopeType: 'BUILDING' },
      );

      expect(result).toMatchObject({
        id: 'expense-1',
        amountMinor: 1000,
        status: 'DRAFT',
        categoryName: 'Maintenance',
      });
      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buildingId: 'building-1',
            scopeType: 'BUILDING',
            createdByMembershipId: 'member-1',
          }),
        }),
      );
      expect(audit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'EXPENSE_CREATE',
          entityType: 'Expense',
          entityId: 'expense-1',
        }),
      );
    });

    it('defaults to BUILDING scope when scopeType is omitted', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Maintenance', catalogScope: 'BUILDING',
      } as any);
      jest.spyOn(prisma.vendor, 'findFirst').mockResolvedValue({ id: 'vendor-1' } as any);
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.expense, 'create').mockResolvedValue(makeExpense() as any);

      await service.createExpense(
        'tenant-1', 'member-1', ['TENANT_ADMIN'], defaultCreateDto,
      );

      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ scopeType: 'BUILDING' }),
        }),
      );
    });

    it('creates a TENANT_SHARED expense with allocations', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Common Services', catalogScope: 'CONDOMINIUM_COMMON',
      } as any);
      jest.spyOn(prisma.vendor, 'findFirst').mockResolvedValue({ id: 'vendor-1' } as any);
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.expense, 'create').mockResolvedValue(
        makeExpense({ buildingId: null, scopeType: 'TENANT_SHARED', category: { name: 'Common Services' } }) as any,
      );

      const allocations = [
        { buildingId: 'building-1', percentage: 60, currencyCode: 'ARS' },
        { buildingId: 'building-2', percentage: 40, currencyCode: 'ARS' },
      ];

      await service.createExpense(
        'tenant-1', 'member-1', ['TENANT_ADMIN'],
        {
          ...defaultCreateDto,
          buildingId: undefined,
          scopeType: 'TENANT_SHARED',
          allocations,
        },
      );

      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buildingId: null,
            scopeType: 'TENANT_SHARED',
          }),
        }),
      );
      expect(movementAllocation.createForExpense).toHaveBeenCalledWith(
        'tenant-1', 'expense-1', 1000, 'ARS', allocations, 'member-1',
      );
    });

    it('creates a UNIT_GROUP expense with group and allocations', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Group Expense', catalogScope: 'BUILDING',
      } as any);
      jest.spyOn(prisma.vendor, 'findFirst').mockResolvedValue({ id: 'vendor-1' } as any);
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue({
        id: 'ug-1', tenantId: 'tenant-1',
      } as any);
      jest.spyOn(prisma.expense, 'create').mockResolvedValue(
        makeExpense({
          scopeType: 'UNIT_GROUP', unitGroupId: 'ug-1',
          category: { name: 'Group Expense' },
        }) as any,
      );

      const allocations = [
        { buildingId: 'building-1', percentage: 100, currencyCode: 'ARS' },
      ];

      await service.createExpense(
        'tenant-1', 'member-1', ['TENANT_ADMIN'],
        {
          ...defaultCreateDto,
          buildingId: undefined,
          scopeType: 'UNIT_GROUP',
          unitGroupId: 'ug-1',
          allocations,
        },
      );

      expect(prisma.unitGroup.findFirst).toHaveBeenCalledWith({
        where: { id: 'ug-1', tenantId: 'tenant-1' },
      });
      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scopeType: 'UNIT_GROUP', unitGroupId: 'ug-1',
          }),
        }),
      );
    });

    it('rejects non-admin/operator roles', async () => {
      jest.spyOn(validators, 'isAdminOrOperator').mockReturnValue(false);

      await expect(
        service.createExpense('tenant-1', 'member-1', ['RESIDENT'], defaultCreateDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects BUILDING expense without buildingId', async () => {
      jest.spyOn(validators, 'isAdminOrOperator').mockReturnValue(true);

      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], {
          ...defaultCreateDto,
          buildingId: undefined as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when building does not belong to tenant', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Maintenance', catalogScope: 'BUILDING',
      } as any);
      jest.spyOn(validators, 'validateBuildingBelongsToTenant').mockRejectedValue(
        new BadRequestException('building no encontrado'),
      );

      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], defaultCreateDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when category is not found', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue(null);

      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], defaultCreateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when category scope mismatches BUILDING', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Common', catalogScope: 'CONDOMINIUM_COMMON',
      } as any);
      jest.spyOn(prisma.vendor, 'findFirst').mockResolvedValue({ id: 'vendor-1' } as any);
      jest.spyOn(validators, 'validateBuildingBelongsToTenant').mockResolvedValue(undefined);

      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], defaultCreateDto),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects when category scope mismatches TENANT_SHARED', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Building-only', catalogScope: 'BUILDING',
      } as any);

      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], {
          ...defaultCreateDto,
          buildingId: undefined,
          scopeType: 'TENANT_SHARED',
          allocations: [{ buildingId: 'building-1', percentage: 100 }],
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects TENANT_SHARED without allocations', async () => {
      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], {
          ...defaultCreateDto,
          buildingId: undefined,
          scopeType: 'TENANT_SHARED',
          allocations: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects UNIT_GROUP without unitGroupId', async () => {
      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], {
          ...defaultCreateDto,
          buildingId: undefined,
          scopeType: 'UNIT_GROUP',
          allocations: [{ buildingId: 'building-1', percentage: 100 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects UNIT_GROUP when unitGroup not found', async () => {
      jest.spyOn(prisma.unitGroup, 'findFirst').mockResolvedValue(null);

      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], {
          ...defaultCreateDto,
          buildingId: undefined,
          scopeType: 'UNIT_GROUP',
          unitGroupId: 'ug-ghost',
          allocations: [{ buildingId: 'building-1', percentage: 100 }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when vendor does not belong to tenant', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Maintenance', catalogScope: 'BUILDING',
      } as any);
      jest.spyOn(prisma.vendor, 'findFirst').mockResolvedValue(null); // not found

      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], defaultCreateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the liquidation period is already published', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Maintenance', catalogScope: 'BUILDING',
      } as any);
      jest.spyOn(prisma.vendor, 'findFirst').mockResolvedValue({ id: 'vendor-1' } as any);
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue({
        id: 'liq-1', period: '2026-05', status: 'PUBLISHED',
      } as any);

      await expect(
        service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], defaultCreateDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns PERIOD_PUBLISHED error with adjustment metadata', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
        id: 'cat-1', name: 'Maintenance', catalogScope: 'BUILDING',
      } as any);
      jest.spyOn(prisma.vendor, 'findFirst').mockResolvedValue({ id: 'vendor-1' } as any);
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue({
        id: 'liq-1', period: '2026-05', status: 'PUBLISHED',
      } as any);

      try {
        await service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], defaultCreateDto);
        fail('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({
          code: 'PERIOD_PUBLISHED',
          publishedPeriod: '2026-05',
          canCreateAdjustment: true,
        });
        expect(response.suggestedTargetPeriod).toBeDefined();
      }
    });
  });

  // ── UPDATE EXPENSE ─────────────────────────────────────────────────────

  describe('updateExpense', () => {
    it('updates a DRAFT expense successfully', async () => {
      const existing = makeExpense() as any;
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue(existing);
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.expense, 'update').mockResolvedValue(
        makeExpense({ description: 'Updated description' }) as any,
      );

      const result = await service.updateExpense(
        'tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN'],
        { description: 'Updated description' },
      );

      expect(result.description).toBe('Updated description');
      expect(prisma.expense.update).toHaveBeenCalled();
    });

    it('rejects updating a non-DRAFT expense', async () => {
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue(
        makeExpense({ status: 'VALIDATED' }) as any,
      );

      await expect(
        service.updateExpense('tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN'], {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-admin/operator roles', async () => {
      jest.spyOn(validators, 'isAdminOrOperator').mockReturnValue(false);

      await expect(
        service.updateExpense('tenant-1', 'expense-1', 'member-1', ['RESIDENT'], {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── VALIDATE EXPENSE ───────────────────────────────────────────────────

  describe('validateExpense', () => {
    it('validates a DRAFT expense setting validatedBy and validatedAt', async () => {
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue(
        makeExpense({ vendorId: 'vendor-1' }) as any,
      );
      jest.spyOn(prisma.expense, 'update').mockResolvedValue(
        makeExpense({
          status: 'VALIDATED',
          validatedByMembershipId: 'member-1',
          validatedAt: new Date(),
        }) as any,
      );

      const result = await service.validateExpense(
        'tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN'],
      );

      expect(result.status).toBe('VALIDATED');
      expect(prisma.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'VALIDATED',
            validatedByMembershipId: 'member-1',
          }),
        }),
      );
    });

    it('rejects validating a non-DRAFT expense', async () => {
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue(
        makeExpense({ status: 'VALIDATED' }) as any,
      );

      await expect(
        service.validateExpense('tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN']),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects validating an expense without vendor', async () => {
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue(
        makeExpense({ vendorId: null }) as any,
      );

      await expect(
        service.validateExpense('tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN']),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── VOID EXPENSE ───────────────────────────────────────────────────────

  describe('voidExpense', () => {
    it('voids a DRAFT expense successfully', async () => {
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue(makeExpense() as any);
      jest.spyOn(prisma.expense, 'update').mockResolvedValue(
        makeExpense({
          status: 'VOID',
          voidedByMembershipId: 'member-1',
          voidedAt: new Date(),
        }) as any,
      );

      const result = await service.voidExpense(
        'tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN'],
      );

      expect(result.status).toBe('VOID');
    });

    it('rejects voiding an already VOID expense', async () => {
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue(
        makeExpense({ status: 'VOID' }) as any,
      );

      await expect(
        service.voidExpense('tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN']),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects voiding a non-existent expense', async () => {
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue(null);

      await expect(
        service.voidExpense('tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN']),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── LIST EXPENSES ──────────────────────────────────────────────────────

  describe('listExpenses', () => {
    it('lists expenses filtered by accounting period', async () => {
      jest.spyOn(prisma.expense, 'findMany').mockResolvedValue([] as any);

      await service.listExpenses('tenant-1', ['TENANT_ADMIN'], {
        buildingId: 'building-1',
        period: '2026-05',
      });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            buildingId: 'building-1',
            scopeType: 'BUILDING',
            OR: [
              { liquidationPeriod: '2026-05' },
              { liquidationPeriod: null, period: '2026-05' },
            ],
          }),
        }),
      );
    });
  });

  // ── BULK VALIDATION ────────────────────────────────────────────────────

  describe('validateExpenseFromBulk', () => {
    it('rejects bulk validation when expense has no vendor', async () => {
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue({
        ...makeExpense({ vendorId: null }),
      } as any);

      await expect(
        service.validateExpenseFromBulk('tenant-1', 'expense-1', 'member-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates a DRAFT expense from bulk without audit', async () => {
      jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue(
        makeExpense({ vendorId: 'vendor-1' }) as any,
      );
      jest.spyOn(prisma.expense, 'update').mockResolvedValue(
        makeExpense({ status: 'VALIDATED' }) as any,
      );

      const result = await service.validateExpenseFromBulk('tenant-1', 'expense-1', 'member-1');

      expect(result.status).toBe('VALIDATED');
      expect(prisma.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'VALIDATED' }),
        }),
      );
    });
  });
});
