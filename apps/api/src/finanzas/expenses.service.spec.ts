import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let prisma: PrismaService;

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
  });

  it('lists expenses by accounting period across legacy and derived fields', async () => {
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

  it('uses invoiceDate as the accounting period when creating expenses', async () => {
    jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue({
      id: 'cat-1',
      name: 'Maintenance',
      catalogScope: 'BUILDING',
    } as any);
    jest.spyOn(prisma.vendor, 'findFirst').mockResolvedValue({ id: 'vendor-1' } as any);
    jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue(null);
    jest.spyOn(prisma.expense, 'create').mockResolvedValue({
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
    } as any);

    await service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], {
      buildingId: 'building-1',
      period: '2026-04',
      categoryId: 'cat-1',
      vendorId: 'vendor-1',
      amountMinor: 1000,
      currencyCode: 'ARS',
      invoiceDate: '2026-05-01',
    });

    expect(prisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          period: '2026-05',
          liquidationPeriod: '2026-05',
        }),
      }),
    );
  });

  it('updates period and liquidationPeriod when invoiceDate changes', async () => {
    jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue({
      id: 'expense-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-04',
      liquidationPeriod: '2026-04',
      categoryId: 'cat-1',
      vendorId: 'vendor-1',
      amountMinor: 1000,
      currencyCode: 'ARS',
      invoiceDate: new Date('2026-04-10T00:00:00.000Z'),
      description: null,
      attachmentFileKey: null,
      status: 'DRAFT',
      scopeType: 'BUILDING',
    } as any);
    jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue(null);
    jest.spyOn(prisma.expense, 'update').mockResolvedValue({
      id: 'expense-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-06',
      liquidationPeriod: '2026-06',
      categoryId: 'cat-1',
      vendorId: 'vendor-1',
      amountMinor: 1000,
      currencyCode: 'ARS',
      invoiceDate: new Date('2026-06-01T00:00:00.000Z'),
      description: null,
      attachmentFileKey: null,
      status: 'DRAFT',
      scopeType: 'BUILDING',
      unitGroupId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      category: { name: 'Maintenance' },
      vendor: { name: 'Vendor' },
    } as any);

    await service.updateExpense('tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN'], {
      invoiceDate: '2026-06-01T12:00:00.000Z',
    });

    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          period: '2026-06',
          liquidationPeriod: '2026-06',
        }),
      }),
    );
  });

  it('applies single-validation business rules in bulk validation helper', async () => {
    jest.spyOn(prisma.expense, 'findFirst').mockResolvedValue({
      id: 'expense-1',
      status: 'DRAFT',
      amountMinor: 1000,
      currencyCode: 'ARS',
      categoryId: 'cat-1',
      period: '2026-05',
      liquidationPeriod: '2026-05',
      invoiceDate: new Date('2026-05-20T00:00:00.000Z'),
      vendorId: null,
    } as any);

    await expect(
      service.validateExpenseFromBulk('tenant-1', 'expense-1', 'member-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });
});
