import { ForbiddenException } from '@nestjs/common';
import { RecurringExpenseController } from './recurring-expense.controller';
import { TenantRecurringExpenseController } from './tenant-recurring-expense.controller';
import type { AuthenticatedRequest } from '../common/types/request.types';

const stubReq = (
  roles: string[],
  tenantId = 'tenant-1',
): AuthenticatedRequest =>
  ({
    tenantId,
    user: {
      id: 'user-1',
      email: 'admin@test.com',
      membershipId: 'member-1',
      roles,
    },
  }) as AuthenticatedRequest;

describe('RecurringExpenseController — role access', () => {
  let controller: RecurringExpenseController;
  let service: {
    createRecurringExpense: jest.Mock;
    listRecurringExpenses: jest.Mock;
    updateRecurringExpense: jest.Mock;
  };

  beforeEach(() => {
    service = {
      createRecurringExpense: jest.fn().mockResolvedValue({ id: 're-1' }),
      listRecurringExpenses: jest.fn().mockResolvedValue([]),
      updateRecurringExpense: jest.fn().mockResolvedValue({ id: 're-1' }),
    };
    controller = new RecurringExpenseController(service as never);
  });

  it('fails closed for residents, empty roles and unknown roles on create/update', async () => {
    const baseDto = {
      categoryId: 'cat-1',
      amount: 5000,
      currency: 'ARS',
      concept: 'Test',
      frequency: 'MONTHLY',
    };

    for (const roles of [[], ['RESIDENT'], ['UNKNOWN_ROLE']]) {
      await expect(
        controller.createRecurringExpense('b-1', baseDto, stubReq(roles)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.updateRecurringExpense('b-1', 're-1', { amount: 1 }, stubReq(roles)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(service.createRecurringExpense).not.toHaveBeenCalled();
    expect(service.updateRecurringExpense).not.toHaveBeenCalled();
  });

  it('allows TENANT_ADMIN and passes BUILDING scope context with buildingId to the service', async () => {
    const admin = stubReq(['TENANT_ADMIN']);
    const baseDto = {
      categoryId: 'cat-1',
      amount: 5000,
      currency: 'ARS',
      concept: 'Test',
      frequency: 'MONTHLY',
    };

    await controller.createRecurringExpense('b-1', baseDto, admin);
    expect(service.createRecurringExpense).toHaveBeenCalledWith(
      'tenant-1',
      baseDto,
      'b-1',
    );

    await controller.updateRecurringExpense('b-1', 're-1', { amount: 1 }, admin);
    expect(service.updateRecurringExpense).toHaveBeenCalledWith(
      'tenant-1',
      're-1',
      { amount: 1 },
      { scopeType: 'BUILDING', buildingId: 'b-1' },
    );
  });
});

describe('TenantRecurringExpenseController — role access', () => {
  let controller: TenantRecurringExpenseController;
  let service: {
    createRecurringExpense: jest.Mock;
    listRecurringExpenses: jest.Mock;
    updateRecurringExpense: jest.Mock;
  };

  beforeEach(() => {
    service = {
      createRecurringExpense: jest.fn().mockResolvedValue({ id: 're-1' }),
      listRecurringExpenses: jest.fn().mockResolvedValue([]),
      updateRecurringExpense: jest.fn().mockResolvedValue({ id: 're-1' }),
    };
    controller = new TenantRecurringExpenseController(service as never);
  });

  it('fails closed for residents, empty roles and unknown roles on create/update', async () => {
    const baseDto = {
      categoryId: 'cat-1',
      amount: 5000,
      currency: 'ARS',
      concept: 'Test',
      frequency: 'MONTHLY',
    };

    for (const roles of [[], ['RESIDENT'], ['UNKNOWN_ROLE']]) {
      await expect(
        controller.createRecurringExpense('tenant-1', baseDto, stubReq(roles)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.updateRecurringExpense('tenant-1', 're-1', { amount: 1 }, stubReq(roles)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(service.createRecurringExpense).not.toHaveBeenCalled();
    expect(service.updateRecurringExpense).not.toHaveBeenCalled();
  });

  it('allows TENANT_OWNER and passes TENANT_SHARED scope context with buildingId null to the service', async () => {
    const owner = stubReq(['TENANT_OWNER']);
    const baseDto = {
      categoryId: 'cat-1',
      amount: 5000,
      currency: 'ARS',
      concept: 'Test',
      frequency: 'MONTHLY',
    };

    await controller.createRecurringExpense('tenant-1', baseDto, owner);
    expect(service.createRecurringExpense).toHaveBeenCalledWith(
      'tenant-1',
      baseDto,
    );

    await controller.updateRecurringExpense('tenant-1', 're-1', { amount: 1 }, owner);
    expect(service.updateRecurringExpense).toHaveBeenCalledWith(
      'tenant-1',
      're-1',
      { amount: 1 },
      { scopeType: 'TENANT_SHARED', buildingId: null },
    );
  });
});
