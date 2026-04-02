import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateExpenseDto,
  UpdateExpenseDto,
  ExpenseResponseDto,
} from './expense-ledger.dto';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
    private readonly movementAllocationService: MovementAllocationService,
  ) {}

  async listExpenses(
    tenantId: string,
    userRoles: string[],
    query: {
      buildingId?: string;
      period?: string;
      status?: string;
      categoryId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<ExpenseResponseDto[]> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden ver gastos',
      );
    }

    const expenses = await this.prisma.expense.findMany({
      where: {
        tenantId,
        buildingId: query.buildingId,
        period: query.period,
        status: query.status as 'DRAFT' | 'VALIDATED' | 'VOID' | undefined,
        categoryId: query.categoryId,
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
      orderBy: { invoiceDate: 'desc' },
      take: query.limit ?? 100,
      skip: query.offset ?? 0,
    });

    return expenses.map(this.toDto);
  }

  async getExpense(
    tenantId: string,
    expenseId: string,
    userRoles: string[],
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, tenantId },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    if (!expense) {
      throw new NotFoundException(`Gasto no encontrado: ${expenseId}`);
    }

    return this.toDto(expense);
  }

  async createExpense(
    tenantId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden registrar gastos',
      );
    }

    const scopeType = dto.scopeType ?? 'BUILDING';

    // Validar scope-specific requirements
    if (scopeType === 'BUILDING') {
      if (!dto.buildingId) {
        throw new BadRequestException(
          'buildingId es requerido para scope BUILDING',
        );
      }
      await this.validators.validateBuildingBelongsToTenant(tenantId, dto.buildingId);
    } else if (scopeType === 'TENANT_SHARED') {
      if (!dto.allocations || dto.allocations.length === 0) {
        throw new BadRequestException(
          'allocations es requerido para scope TENANT_SHARED',
        );
      }
    } else if (scopeType === 'UNIT_GROUP') {
      if (!dto.unitGroupId) {
        throw new BadRequestException(
          'unitGroupId es requerido para scope UNIT_GROUP',
        );
      }
      if (!dto.allocations || dto.allocations.length === 0) {
        throw new BadRequestException(
          'allocations es requerido para scope UNIT_GROUP',
        );
      }
      // Validar que unitGroup exista y pertenezca al tenant
      const unitGroup = await this.prisma.unitGroup.findFirst({
        where: { id: dto.unitGroupId, tenantId },
      });
      if (!unitGroup) {
        throw new NotFoundException(`Grupo de unidades no encontrado: ${dto.unitGroupId}`);
      }
    }

    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: dto.categoryId, tenantId, isActive: true },
    });
    if (!category) {
      throw new NotFoundException(`Rubro de gasto no encontrado: ${dto.categoryId}`);
    }

    if (dto.vendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: dto.vendorId, tenantId },
      });
      if (!vendor) {
        throw new NotFoundException(`Proveedor no encontrado: ${dto.vendorId}`);
      }
    }

    const expense = await this.prisma.expense.create({
      data: {
        tenantId,
        buildingId: dto.buildingId ?? null,
        period: dto.period,
        categoryId: dto.categoryId,
        vendorId: dto.vendorId ?? null,
        amountMinor: dto.amountMinor,
        currencyCode: dto.currencyCode,
        invoiceDate: new Date(dto.invoiceDate),
        description: dto.description ?? null,
        attachmentFileKey: dto.attachmentFileKey ?? null,
        scopeType,
        unitGroupId: dto.unitGroupId ?? null,
        createdByMembershipId: membershipId,
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    // Crear allocations si es TENANT_SHARED o UNIT_GROUP
    if ((scopeType === 'TENANT_SHARED' || scopeType === 'UNIT_GROUP') && dto.allocations) {
      await this.movementAllocationService.createForExpense(
        tenantId,
        expense.id,
        dto.amountMinor,
        dto.currencyCode,
        dto.allocations,
        membershipId,
      );
    }

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_CREATE',
      entityType: 'Expense',
      entityId: expense.id,
      metadata: {
        period: dto.period,
        buildingId: dto.buildingId ?? null,
        scopeType,
        amountMinor: dto.amountMinor,
        currencyCode: dto.currencyCode,
      },
    });

    return this.toDto(expense);
  }

  async updateExpense(
    tenantId: string,
    expenseId: string,
    membershipId: string,
    userRoles: string[],
    dto: UpdateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, tenantId },
    });

    if (!expense) {
      throw new NotFoundException(`Gasto no encontrado: ${expenseId}`);
    }

    if (expense.status !== 'DRAFT') {
      throw new BadRequestException(
        `Solo se pueden editar gastos en DRAFT. Estado actual: ${expense.status}`,
      );
    }

    if (dto.categoryId && dto.categoryId !== expense.categoryId) {
      const category = await this.prisma.expenseLedgerCategory.findFirst({
        where: { id: dto.categoryId, tenantId, isActive: true },
      });
      if (!category) {
        throw new NotFoundException(`Rubro de gasto no encontrado: ${dto.categoryId}`);
      }
    }

    if (dto.vendorId !== undefined && dto.vendorId !== null) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: dto.vendorId, tenantId },
      });
      if (!vendor) {
        throw new NotFoundException(`Proveedor no encontrado: ${dto.vendorId}`);
      }
    }

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        amountMinor: dto.amountMinor ?? expense.amountMinor,
        currencyCode: dto.currencyCode ?? expense.currencyCode,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : expense.invoiceDate,
        categoryId: dto.categoryId ?? expense.categoryId,
        vendorId: dto.vendorId !== undefined ? dto.vendorId : expense.vendorId,
        description: dto.description !== undefined ? dto.description : expense.description,
        attachmentFileKey:
          dto.attachmentFileKey !== undefined
            ? dto.attachmentFileKey
            : expense.attachmentFileKey,
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_UPDATE',
      entityType: 'Expense',
      entityId: expenseId,
      metadata: dto,
    });

    return this.toDto(updated);
  }

  async validateExpense(
    tenantId: string,
    expenseId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, tenantId },
    });

    if (!expense) {
      throw new NotFoundException(`Gasto no encontrado: ${expenseId}`);
    }

    if (expense.status !== 'DRAFT') {
      throw new BadRequestException(
        `Solo se pueden validar gastos en DRAFT. Estado actual: ${expense.status}`,
      );
    }

    // Verificar campos requeridos para VALIDATED
    if (!expense.amountMinor || !expense.currencyCode || !expense.categoryId || !expense.period || !expense.invoiceDate) {
      throw new BadRequestException(
        'Para validar un gasto se requiere: amountMinor, currencyCode, categoryId, period, invoiceDate',
      );
    }

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        status: 'VALIDATED',
        validatedByMembershipId: membershipId,
        validatedAt: new Date(),
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_VALIDATE',
      entityType: 'Expense',
      entityId: expenseId,
      metadata: {
        period: expense.period,
        amountMinor: expense.amountMinor,
        currencyCode: expense.currencyCode,
      },
    });

    return this.toDto(updated);
  }

  async voidExpense(
    tenantId: string,
    expenseId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, tenantId },
    });

    if (!expense) {
      throw new NotFoundException(`Gasto no encontrado: ${expenseId}`);
    }

    if (expense.status === 'VOID') {
      throw new BadRequestException('El gasto ya está anulado');
    }

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        status: 'VOID',
        voidedByMembershipId: membershipId,
        voidedAt: new Date(),
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_VOID',
      entityType: 'Expense',
      entityId: expenseId,
      metadata: { period: expense.period, reason: 'void requested by admin' },
    });

    return this.toDto(updated);
  }

  private toDto(
    expense: {
      id: string;
      tenantId: string;
      buildingId: string | null;
      period: string;
      categoryId: string;
      vendorId: string | null;
      amountMinor: number;
      currencyCode: string;
      invoiceDate: Date;
      description: string | null;
      attachmentFileKey: string | null;
      status: 'DRAFT' | 'VALIDATED' | 'VOID';
      scopeType: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
      unitGroupId: string | null;
      createdAt: Date;
      updatedAt: Date;
      category: { name: string };
      vendor: { name: string } | null;
    },
  ): ExpenseResponseDto {
    return {
      id: expense.id,
      tenantId: expense.tenantId,
      buildingId: expense.buildingId,
      period: expense.period,
      categoryId: expense.categoryId,
      categoryName: expense.category.name,
      vendorId: expense.vendorId,
      vendorName: expense.vendor?.name ?? null,
      amountMinor: expense.amountMinor,
      currencyCode: expense.currencyCode,
      invoiceDate: expense.invoiceDate,
      description: expense.description,
      attachmentFileKey: expense.attachmentFileKey,
      status: expense.status,
      scopeType: expense.scopeType,
      unitGroupId: expense.unitGroupId,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
    };
  }
}
