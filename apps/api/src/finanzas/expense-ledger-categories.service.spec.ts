import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpenseLedgerCategoriesService } from './expense-ledger-categories.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { ExpenseLedgerCategoryMovementType } from './expense-ledger.dto';

const baseCategory = {
  id: 'cat-1',
  tenantId: 'tenant-1',
  code: 'EXP_ELECTRICIDAD_0001',
  name: 'Electricidad',
  description: 'Energy',
  movementType: 'EXPENSE' as ExpenseLedgerCategoryMovementType,
  catalogScope: 'BUILDING' as const,
  sortOrder: 0,
  isActive: true,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
};

describe('ExpenseLedgerCategoriesService', () => {
  let service: ExpenseLedgerCategoriesService;
  let prisma: {
    membership: {
      findFirst: jest.Mock;
    };
    expenseLedgerCategory: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
      delete: jest.Mock;
    };
    expense: {
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: {
    membership: {
      findFirst: jest.Mock;
    };
    expenseLedgerCategory: {
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
      delete: jest.Mock;
      findFirst: jest.Mock;
    };
    expense: {
      count: jest.Mock;
    };
  };
  let auditService: {
    createLog: jest.Mock;
    createLogRequired: jest.Mock;
  };
  let validators: { isAdminOrOperator: jest.Mock };
  let currentMembershipRoles: Array<{
    role: string;
    scopeType: 'TENANT' | 'BUILDING' | 'UNIT';
  }>;
  let membershipFindFirst: jest.Mock;

  beforeEach(async () => {
    currentMembershipRoles = [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }];
    membershipFindFirst = jest.fn().mockImplementation(async ({ where }: { where?: { id?: string; tenantId?: string } }) => {
      if (where?.id === 'member-missing' || where?.tenantId === 'tenant-other') {
        return null;
      }

      if (where?.id === 'member-tenant-b') {
        return where?.tenantId === 'tenant-2'
          ? {
              id: 'member-tenant-b',
              userId: 'user-2',
              roles: [{ role: 'TENANT_OWNER', scopeType: 'TENANT' }],
            }
          : null;
      }

      return {
        id: 'member-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        roles: currentMembershipRoles,
      };
    });

    tx = {
      membership: {
        findFirst: membershipFindFirst,
      },
      expenseLedgerCategory: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...baseCategory,
          ...data,
          id: 'cat-created',
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...baseCategory,
          ...data,
          id: 'cat-1',
        })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue(undefined),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      expense: { count: jest.fn().mockResolvedValue(0) },
    };

    prisma = {
      membership: {
        findFirst: membershipFindFirst,
      },
      expenseLedgerCategory: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
        delete: jest.fn(),
      },
      expense: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    auditService = {
      createLog: jest.fn(),
      createLogRequired: jest.fn().mockResolvedValue(undefined),
    };
    validators = {
      isAdminOrOperator: jest.fn().mockImplementation((roles: string[]) =>
        roles.some((role) => role !== 'RESIDENT'),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseLedgerCategoriesService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AuditService,
          useValue: auditService,
        },
        {
          provide: FinanzasValidators,
          useValue: validators,
        },
      ],
    }).compile();

    service = module.get(ExpenseLedgerCategoriesService);
  });

  it('lists categories using the validated membership from the same tenant', async () => {
    prisma.expenseLedgerCategory.findMany.mockResolvedValueOnce([baseCategory]);

    const result = await service.listCategories(
      'tenant-1',
      'member-1',
      'EXPENSE',
      'BUILDING',
    );

    expect(result).toEqual([expect.objectContaining({ id: 'cat-1', tenantId: 'tenant-1' })]);
    expect(prisma.expenseLedgerCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          movementType: 'EXPENSE',
          catalogScope: 'BUILDING',
        }),
      }),
    );
  });

  it('rejects a membership from another tenant before listing categories', async () => {
    await expect(
      service.listCategories('tenant-1', 'member-tenant-b'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.expenseLedgerCategory.findMany).not.toHaveBeenCalled();
  });

  it('rejects a missing membership before listing categories', async () => {
    await expect(
      service.listCategories('tenant-1', 'member-missing'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.expenseLedgerCategory.findMany).not.toHaveBeenCalled();
  });

  it('rejects a resident membership even if caller roles claim admin when listing categories', async () => {
    currentMembershipRoles = [{ role: 'RESIDENT', scopeType: 'TENANT' }];

    await expect(
      service.listCategories('tenant-1', 'member-1'),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.expenseLedgerCategory.findMany).not.toHaveBeenCalled();
  });

  it.each(['BUILDING', 'UNIT'] as const)(
    'rejects an admin role limited to %s scope',
    async (scopeType) => {
      currentMembershipRoles = [{ role: 'TENANT_ADMIN', scopeType }];

      await expect(service.listCategories('tenant-1', 'member-1')).rejects.toThrow(
        ForbiddenException,
      );

      expect(prisma.expenseLedgerCategory.findMany).not.toHaveBeenCalled();
    },
  );

  it('does not reveal a missing category before authorizing the actor', async () => {
    await expect(
      service.getCategory('tenant-1', 'cat-missing', 'member-tenant-b'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.expenseLedgerCategory.findFirst).not.toHaveBeenCalled();
  });

  it('returns a category for an authorized membership in the same tenant', async () => {
    prisma.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);

    const result = await service.getCategory('tenant-1', 'cat-1', 'member-1');

    expect(result).toEqual(expect.objectContaining({ id: 'cat-1', tenantId: 'tenant-1' }));
    expect(prisma.expenseLedgerCategory.findFirst).toHaveBeenCalledWith({
      where: { id: 'cat-1', tenantId: 'tenant-1' },
    });
  });

  it('checks for duplicate category names only after authorizing the actor', async () => {
    membershipFindFirst.mockImplementationOnce(async ({ where }: { where?: { id?: string; tenantId?: string } }) => {
      expect(where).toEqual({ id: 'member-1', tenantId: 'tenant-1' });
      expect(tx.expenseLedgerCategory.findFirst).not.toHaveBeenCalled();
      return {
        id: 'member-1',
        userId: 'user-1',
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
      };
    });
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(null);

    await service.createCategory('tenant-1', 'member-1', {
      name: 'Agua',
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.expenseLedgerCategory.findFirst).toHaveBeenCalledTimes(1);
  });

  it('checks for the current category only after authorizing the actor on update', async () => {
    membershipFindFirst.mockImplementationOnce(async ({ where }: { where?: { id?: string; tenantId?: string } }) => {
      expect(where).toEqual({ id: 'member-1', tenantId: 'tenant-1' });
      expect(tx.expenseLedgerCategory.findFirst).not.toHaveBeenCalled();
      return {
        id: 'member-1',
        userId: 'user-1',
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
      };
    });
    tx.expenseLedgerCategory.findFirst
      .mockResolvedValueOnce(baseCategory)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseCategory,
        name: 'Electricidad general',
      });

    await service.updateCategory('tenant-1', 'cat-1', 'member-1', {
      name: 'Electricidad general',
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.expenseLedgerCategory.findFirst).toHaveBeenCalledTimes(3);
    expect(tx.expenseLedgerCategory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cat-1', tenantId: 'tenant-1' },
      }),
    );
    expect(tx.expenseLedgerCategory.findFirst).toHaveBeenLastCalledWith({
      where: { id: 'cat-1', tenantId: 'tenant-1' },
    });
  });

  it('rejects a resident membership before loading the current category on update', async () => {
    currentMembershipRoles = [{ role: 'RESIDENT', scopeType: 'TENANT' }];

    await expect(
      service.updateCategory('tenant-1', 'cat-1', 'member-1', {
        name: 'Electricidad general',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.expenseLedgerCategory.findFirst).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('persists BUILDING explicitly when catalogScope is omitted on create', async () => {
    const result = await service.createCategory('tenant-1', 'member-1', {
      name: 'Electricidad',
      description: 'Energy',
    });

    expect(result.catalogScope).toBe('BUILDING');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          catalogScope: 'BUILDING',
        }),
      }),
      expect.any(Object),
    );
  });

  it('persists CONDOMINIUM_COMMON explicitly when catalogScope is provided on create', async () => {
    const result = await service.createCategory('tenant-1', 'member-1', {
      name: 'Amenities',
      description: 'Common services',
      catalogScope: 'CONDOMINIUM_COMMON',
    });

    expect(result.catalogScope).toBe('CONDOMINIUM_COMMON');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          catalogScope: 'CONDOMINIUM_COMMON',
        }),
      }),
      expect.any(Object),
    );
  });

  it('updates catalogScope when changing from BUILDING to CONDOMINIUM_COMMON', async () => {
    tx.expenseLedgerCategory.findFirst
      .mockResolvedValueOnce(baseCategory)
      .mockResolvedValueOnce({
        ...baseCategory,
        catalogScope: 'CONDOMINIUM_COMMON',
      });

    const result = await service.updateCategory('tenant-1', 'cat-1', 'member-1', {
      catalogScope: 'CONDOMINIUM_COMMON',
    });

    expect(result.catalogScope).toBe('CONDOMINIUM_COMMON');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          catalogScope: 'CONDOMINIUM_COMMON',
        }),
      }),
      expect.any(Object),
    );
  });

  it('preserves catalogScope when update omits the field', async () => {
    tx.expenseLedgerCategory.findFirst
      .mockResolvedValueOnce({
        ...baseCategory,
        catalogScope: 'CONDOMINIUM_COMMON',
      })
      .mockResolvedValueOnce({
        ...baseCategory,
        catalogScope: 'CONDOMINIUM_COMMON',
      });

    const result = await service.updateCategory('tenant-1', 'cat-1', 'member-1', {
      description: 'Updated description',
    });

    expect(result.catalogScope).toBe('CONDOMINIUM_COMMON');
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          catalogScope: 'CONDOMINIUM_COMMON',
        }),
      }),
      expect.any(Object),
    );
  });

  it('rolls back category creation when required audit logging fails', async () => {
    auditService.createLogRequired.mockRejectedValueOnce(new Error('audit failed'));

    await expect(
      service.createCategory('tenant-1', 'member-1', {
        name: 'Emergencia',
        catalogScope: 'CONDOMINIUM_COMMON',
      }),
    ).rejects.toThrow('audit failed');

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('soft-deletes categories and audits the deletion in the same transaction', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);
    tx.expense.count.mockResolvedValueOnce(2);

    await service.deleteCategory('tenant-1', 'cat-1', 'member-1');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.expenseLedgerCategory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cat-1', tenantId: 'tenant-1', isActive: true },
      }),
    );
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          hadExpenses: true,
        }),
      }),
      expect.any(Object),
    );
  });

  it('hard-deletes tenant-scoped categories when there are no expenses', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);
    tx.expense.count.mockResolvedValueOnce(0);

    await service.deleteCategory('tenant-1', 'cat-1', 'member-1');

    expect(tx.expenseLedgerCategory.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cat-1', tenantId: 'tenant-1' },
      }),
    );
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          hadExpenses: false,
        }),
      }),
      expect.any(Object),
    );
  });

  it('rejects missing categories on update', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.updateCategory('tenant-1', 'cat-missing', 'member-1', {
        catalogScope: 'BUILDING',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects duplicate names on create', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);

    await expect(
      service.createCategory('tenant-1', 'member-1', {
        name: 'Electricidad',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects a membership from another tenant before mutating a category', async () => {
    await expect(
      service.createCategory('tenant-1', 'member-tenant-b', {
        name: 'Mantenimiento',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.expenseLedgerCategory.findFirst).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('rejects updates when the tenant-scoped write does not affect a row', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);
    tx.expenseLedgerCategory.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.updateCategory('tenant-1', 'cat-1', 'member-1', {
        name: 'Electricidad general',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('rejects soft deletes when the tenant-scoped write does not affect a row', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);
    tx.expense.count.mockResolvedValueOnce(3);
    tx.expenseLedgerCategory.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.deleteCategory('tenant-1', 'cat-1', 'member-1'),
    ).rejects.toThrow(NotFoundException);

    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('rejects hard deletes when the tenant-scoped write does not affect a row', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);
    tx.expense.count.mockResolvedValueOnce(0);
    tx.expenseLedgerCategory.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.deleteCategory('tenant-1', 'cat-1', 'member-1'),
    ).rejects.toThrow(NotFoundException);

    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('rejects a missing membership before mutating a category', async () => {
    await expect(
      service.createCategory('tenant-1', 'member-missing', {
        name: 'Mantenimiento',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.expenseLedgerCategory.findFirst).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized role derived from the real membership even if caller roles claim admin', async () => {
    currentMembershipRoles = [{ role: 'RESIDENT', scopeType: 'TENANT' }];

    await expect(
      service.createCategory('tenant-1', 'member-1', {
        name: 'Mantenimiento',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.expenseLedgerCategory.findFirst).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('uses the validated membership for audit logging', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(null);

    await service.createCategory('tenant-1', 'member-1', {
      name: 'Conserjería',
    });

    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMembershipId: 'member-1',
      }),
      expect.any(Object),
    );
  });

  it('translates P2002 on create into a domain conflict', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(null);
    const uniqueError = new Error('Unique constraint failed');
    Object.assign(uniqueError, { code: 'P2002', meta: { target: ['tenantId', 'name'] } });
    Object.setPrototypeOf(uniqueError, Prisma.PrismaClientKnownRequestError.prototype);
    tx.expenseLedgerCategory.create.mockRejectedValueOnce(uniqueError);

    await expect(
      service.createCategory('tenant-1', 'member-1', {
        name: 'Duplicado',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('retries code collisions on create and only retries the code field', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValue(null);
    const uniqueError = new Error('Unique constraint failed');
    Object.assign(uniqueError, { code: 'P2002', meta: { target: ['tenantId', 'code'] } });
    Object.setPrototypeOf(uniqueError, Prisma.PrismaClientKnownRequestError.prototype);
    tx.expenseLedgerCategory.create
      .mockRejectedValueOnce(uniqueError)
      .mockResolvedValueOnce({
        ...baseCategory,
        id: 'cat-retried',
        code: 'EXP_DUPLICATED_2',
      });
    {
      const result = await service.createCategory('tenant-1', 'member-1', {
        name: 'Duplicado',
        movementType: 'EXPENSE',
      });

      expect(result.id).toBe('cat-retried');
      expect(tx.expenseLedgerCategory.create).toHaveBeenCalledTimes(2);
      const firstCode = tx.expenseLedgerCategory.create.mock.calls[0]?.[0]?.data?.code as string | undefined;
      const secondCode = tx.expenseLedgerCategory.create.mock.calls[1]?.[0]?.data?.code as string | undefined;

      expect(firstCode).toMatch(/^EXP_DUPLICADO_[A-F0-9]{8}$/);
      expect(secondCode).toMatch(/^EXP_DUPLICADO_[A-F0-9]{8}$/);
      expect(secondCode).not.toBe(firstCode);
      expect(tx.expenseLedgerCategory.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          code: expect.stringMatching(/^EXP_DUPLICADO_[A-F0-9]{8}$/),
          name: 'Duplicado',
          description: null,
          movementType: 'EXPENSE',
          catalogScope: 'BUILDING',
        }),
      });
      expect(tx.expenseLedgerCategory.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          code: expect.stringMatching(/^EXP_DUPLICADO_[A-F0-9]{8}$/),
          name: 'Duplicado',
          description: null,
          movementType: 'EXPENSE',
          catalogScope: 'BUILDING',
        }),
      });
    }
  });

  it('translates P2002 on update into a domain conflict', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);
    const uniqueError = new Error('Unique constraint failed');
    Object.assign(uniqueError, { code: 'P2002', meta: { target: ['tenantId', 'name'] } });
    Object.setPrototypeOf(uniqueError, Prisma.PrismaClientKnownRequestError.prototype);
    tx.expenseLedgerCategory.updateMany.mockRejectedValueOnce(uniqueError);

    await expect(
      service.updateCategory('tenant-1', 'cat-1', 'member-1', {
        name: 'Duplicado',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('distinguishes code conflicts from name conflicts on update', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);
    const uniqueError = new Error('Unique constraint failed');
    Object.assign(uniqueError, { code: 'P2002', meta: { target: ['tenantId', 'code'] } });
    Object.setPrototypeOf(uniqueError, Prisma.PrismaClientKnownRequestError.prototype);
    tx.expenseLedgerCategory.updateMany.mockRejectedValueOnce(uniqueError);

    await expect(
      service.updateCategory('tenant-1', 'cat-1', 'member-1', {
        catalogScope: 'CONDOMINIUM_COMMON',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('propagates non-P2002 errors from update', async () => {
    tx.expenseLedgerCategory.findFirst.mockResolvedValueOnce(baseCategory);
    tx.expenseLedgerCategory.updateMany.mockRejectedValueOnce(new Error('boom'));

    await expect(
      service.updateCategory('tenant-1', 'cat-1', 'member-1', {
        name: 'Nuevo nombre',
      }),
    ).rejects.toThrow('boom');
  });
});
