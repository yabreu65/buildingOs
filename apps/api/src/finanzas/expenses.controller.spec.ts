import { BadRequestException } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import type { AuthenticatedRequest } from '../common/types/request.types';
import type {
  ExpenseResponseDto,
  CreateExpenseDto,
  UpdateExpenseDto,
} from './expense-ledger.dto';

const stubReq = (
  overrides: Record<string, unknown> = {},
): AuthenticatedRequest => ({
  tenantId: 'tenant-1',
  user: {
    id: 'user-1',
    email: 'admin@test.com',
    membershipId: 'member-1',
    roles: ['TENANT_ADMIN'],
  },
  ...overrides,
} as AuthenticatedRequest);

describe('ExpensesController', () => {
  let controller: ExpensesController;
  let service: jest.Mocked<ExpensesService>;

  beforeEach(() => {
    service = {
      createExpense: jest.fn(),
      listExpenses: jest.fn(),
      getExpense: jest.fn(),
      updateExpense: jest.fn(),
      validateExpense: jest.fn(),
      voidExpense: jest.fn(),
      importExpensesFromExcel: jest.fn(),
    } as unknown as jest.Mocked<ExpensesService>;

    controller = new ExpensesController(service);
  });

  describe('createExpense', () => {
    it('delegates to service with tenantId, membershipId, roles and dto', async () => {
      const dto: CreateExpenseDto = {
        buildingId: 'building-1',
        period: '2026-05',
        categoryId: 'cat-1',
        amountMinor: 1000,
        currencyCode: 'ARS',
        invoiceDate: '2026-05-01',
      };
      const expected: ExpenseResponseDto = {
        id: 'expense-1',
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        period: '2026-05',
        categoryId: 'cat-1',
        categoryName: 'Luz',
        vendorId: null,
        vendorName: null,
        amountMinor: 1000,
        currencyCode: 'ARS',
        invoiceDate: new Date('2026-05-01'),
        description: null,
        attachmentFileKey: null,
        status: 'DRAFT',
        scopeType: 'BUILDING',
        unitGroupId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      service.createExpense.mockResolvedValue(expected);

      const result = await controller.createExpense(dto, stubReq());

      expect(result).toBe(expected);
      expect(service.createExpense).toHaveBeenCalledWith(
        'tenant-1', 'member-1', ['TENANT_ADMIN'], dto,
      );
    });
  });

  describe('listExpenses', () => {
    it('delegates to service with query params', async () => {
      service.listExpenses.mockResolvedValue([]);

      await controller.listExpenses(
        { buildingId: 'building-1', period: '2026-05', limit: 10, offset: 1 },
        stubReq(),
      );

      expect(service.listExpenses).toHaveBeenCalledWith(
        'tenant-1',
        ['TENANT_ADMIN'],
        { buildingId: 'building-1', period: '2026-05', status: undefined, categoryId: undefined, scopeType: undefined, limit: 10, offset: 1 },
      );
    });

    it('converts limit and offset strings to numbers', async () => {
      service.listExpenses.mockResolvedValue([]);

      await controller.listExpenses(
        { limit: '20', offset: '5' },
        stubReq(),
      );

      expect(service.listExpenses).toHaveBeenCalledWith(
        'tenant-1', ['TENANT_ADMIN'],
        expect.objectContaining({ limit: 20, offset: 5 }),
      );
    });
  });

  describe('getExpense', () => {
    it('delegates to service with expenseId', async () => {
      const expected: ExpenseResponseDto = {
        id: 'expense-1', tenantId: 'tenant-1', buildingId: 'building-1',
        period: '2026-05', categoryId: 'cat-1', categoryName: 'Luz',
        vendorId: null, vendorName: null, amountMinor: 1000, currencyCode: 'ARS',
        invoiceDate: new Date(), description: null, attachmentFileKey: null,
        status: 'DRAFT', scopeType: 'BUILDING', unitGroupId: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      service.getExpense.mockResolvedValue(expected);

      const result = await controller.getExpense('expense-1', stubReq());

      expect(result).toBe(expected);
      expect(service.getExpense).toHaveBeenCalledWith(
        'tenant-1', 'expense-1', ['TENANT_ADMIN'],
      );
    });
  });

  describe('updateExpense', () => {
    it('delegates to service with expenseId and dto', async () => {
      const dto: UpdateExpenseDto = { description: 'Updated' };
      const expected: ExpenseResponseDto = {
        id: 'expense-1', tenantId: 'tenant-1', buildingId: 'building-1',
        period: '2026-05', categoryId: 'cat-1', categoryName: 'Luz',
        vendorId: null, vendorName: null, amountMinor: 1000, currencyCode: 'ARS',
        invoiceDate: new Date(), description: 'Updated', attachmentFileKey: null,
        status: 'DRAFT', scopeType: 'BUILDING', unitGroupId: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      service.updateExpense.mockResolvedValue(expected);

      const result = await controller.updateExpense('expense-1', dto, stubReq());

      expect(result).toBe(expected);
      expect(service.updateExpense).toHaveBeenCalledWith(
        'tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN'], dto,
      );
    });
  });

  describe('validateExpense', () => {
    it('delegates to service with expenseId', async () => {
      const expected: ExpenseResponseDto = {
        id: 'expense-1', tenantId: 'tenant-1', buildingId: 'building-1',
        period: '2026-05', categoryId: 'cat-1', categoryName: 'Luz',
        vendorId: null, vendorName: null, amountMinor: 1000, currencyCode: 'ARS',
        invoiceDate: new Date(), description: null, attachmentFileKey: null,
        status: 'VALIDATED', scopeType: 'BUILDING', unitGroupId: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      service.validateExpense.mockResolvedValue(expected);

      const result = await controller.validateExpense('expense-1', stubReq());

      expect(result).toBe(expected);
      expect(service.validateExpense).toHaveBeenCalledWith(
        'tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN'],
      );
    });
  });

  describe('voidExpense', () => {
    it('delegates to service with expenseId', async () => {
      const expected: ExpenseResponseDto = {
        id: 'expense-1', tenantId: 'tenant-1', buildingId: 'building-1',
        period: '2026-05', categoryId: 'cat-1', categoryName: 'Luz',
        vendorId: null, vendorName: null, amountMinor: 1000, currencyCode: 'ARS',
        invoiceDate: new Date(), description: null, attachmentFileKey: null,
        status: 'VOID', scopeType: 'BUILDING', unitGroupId: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      service.voidExpense.mockResolvedValue(expected);

      const result = await controller.voidExpense('expense-1', stubReq());

      expect(result).toBe(expected);
      expect(service.voidExpense).toHaveBeenCalledWith(
        'tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN'],
      );
    });
  });

  describe('importFromExcel', () => {
    it('validates period and rows are required', async () => {
      await expect(
        controller.importFromExcel({} as any, stubReq()),
      ).rejects.toThrow(BadRequestException);
    });

    it('delegates to service with parsed body', async () => {
      service.importExpensesFromExcel.mockResolvedValue({
        successCount: 2,
        failureCount: 0,
        errors: [],
      });

      const body = {
        period: '2026-05',
        rows: [
          { fecha: '01/05/2026', descripcion: 'Luz', monto: 100, moneda: 'ARS', edificio: 'Edificio A', categoria: 'Servicios' },
          { fecha: '02/05/2026', descripcion: 'Agua', monto: 50, moneda: 'ARS', edificio: 'Edificio B', categoria: 'Servicios' },
        ],
      };

      const result = await controller.importFromExcel(body as any, stubReq());

      expect(result.totalRows).toBe(2);
      expect(result.successCount).toBe(2);
      expect(service.importExpensesFromExcel).toHaveBeenCalledWith(
        'tenant-1', 'member-1', ['TENANT_ADMIN'], '2026-05', body.rows,
      );
    });
  });
});
