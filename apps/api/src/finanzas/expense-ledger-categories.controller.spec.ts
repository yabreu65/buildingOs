import { Test } from '@nestjs/testing';
import { ExpenseLedgerCategoriesController } from './expense-ledger-categories.controller';
import { ExpenseLedgerCategoriesService } from './expense-ledger-categories.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import type {
  CreateExpenseLedgerCategoryDto,
  ExpenseLedgerCategoryQueryDto,
  ExpenseLedgerCategoryParamDto,
  ExpenseLedgerCategoryResponseDto,
  UpdateExpenseLedgerCategoryDto,
} from './expense-ledger.dto';

const stubReq = (
  overrides: Record<string, unknown> = {},
): AuthenticatedRequest =>
  ({
    tenantId: 'tenant-1',
    user: {
      id: 'user-1',
      email: 'admin@test.com',
      membershipId: 'member-legacy',
      tenantId: 'tenant-1',
      effectiveMembership: {
        id: 'member-effective',
        tenantId: 'tenant-1',
        roles: ['TENANT_ADMIN'],
      },
      roles: ['TENANT_ADMIN'],
    },
    ...overrides,
  }) as AuthenticatedRequest;

describe('ExpenseLedgerCategoriesController', () => {
  let controller: ExpenseLedgerCategoriesController;
  let service: {
    listCategories: jest.Mock;
    getCategory: jest.Mock;
    createCategory: jest.Mock;
    updateCategory: jest.Mock;
    deleteCategory: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listCategories: jest.fn(),
      getCategory: jest.fn(),
      createCategory: jest.fn(),
      updateCategory: jest.fn(),
      deleteCategory: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [ExpenseLedgerCategoriesController],
      providers: [
        {
          provide: ExpenseLedgerCategoriesService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .overrideGuard(TenantAccessGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get(ExpenseLedgerCategoriesController);
  });

  it('uses the effective membership for read operations', async () => {
    service.listCategories.mockResolvedValue([]);

    const query: ExpenseLedgerCategoryQueryDto = {
      movementType: 'EXPENSE',
      catalogScope: 'BUILDING',
    };
    const params: ExpenseLedgerCategoryParamDto = {
      categoryId: 'c123456789012345678901234',
    };

    await controller.listCategories(query, stubReq());
    await controller.getCategory(params, stubReq());

    expect(service.listCategories).toHaveBeenCalledWith(
      'tenant-1',
      'member-effective',
      'EXPENSE',
      'BUILDING',
    );
    expect(service.getCategory).toHaveBeenCalledWith(
      'tenant-1',
      'c123456789012345678901234',
      'member-effective',
    );
  });

  it('uses the effective membership for write operations', async () => {
    const expected: ExpenseLedgerCategoryResponseDto = {
      id: 'cat-1',
      tenantId: 'tenant-1',
      code: 'EXP_ELECTRICIDAD_1234',
      name: 'Electricidad',
      description: null,
      movementType: 'EXPENSE',
      catalogScope: 'BUILDING',
      sortOrder: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    service.createCategory.mockResolvedValue(expected);
    service.getCategory.mockResolvedValue(expected);
    service.updateCategory.mockResolvedValue(expected);
    service.deleteCategory.mockResolvedValue(undefined);

    const createDto: CreateExpenseLedgerCategoryDto = { name: 'Electricidad' };
    const updateDto: UpdateExpenseLedgerCategoryDto = { isActive: false };
    const params: ExpenseLedgerCategoryParamDto = {
      categoryId: 'c123456789012345678901234',
    };

    await controller.createCategory(createDto, stubReq());
    await controller.getCategory(params, stubReq());
    await controller.updateCategory(params, updateDto, stubReq());
    await controller.deleteCategory(params, stubReq());

    expect(service.createCategory).toHaveBeenCalledWith(
      'tenant-1',
      'member-effective',
      createDto,
    );
    expect(service.getCategory).toHaveBeenCalledWith(
      'tenant-1',
      'c123456789012345678901234',
      'member-effective',
    );
    expect(service.updateCategory).toHaveBeenCalledWith(
      'tenant-1',
      'c123456789012345678901234',
      'member-effective',
      updateDto,
    );
    expect(service.deleteCategory).toHaveBeenCalledWith(
      'tenant-1',
      'c123456789012345678901234',
      'member-effective',
    );
  });
});
