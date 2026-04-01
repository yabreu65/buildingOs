import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateExpenseLedgerCategoryDto,
  UpdateExpenseLedgerCategoryDto,
  ExpenseLedgerCategoryResponseDto,
} from './expense-ledger.dto';
import { FinanzasValidators } from './finanzas.validators';

@Injectable()
export class ExpenseLedgerCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
  ) {}

  async listCategories(
    tenantId: string,
    userRoles: string[],
  ): Promise<ExpenseLedgerCategoryResponseDto[]> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden gestionar rubros de gastos',
      );
    }

    const categories = await this.prisma.expenseLedgerCategory.findMany({
      where: { tenantId },
      orderBy: [
        { active: 'desc' },
        { sortOrder: 'asc' }, // nulls last (PostgreSQL default)
        { name: 'asc' },
      ],
    });

    return categories.map(this.toDto);
  }

  async getCategory(
    tenantId: string,
    categoryId: string,
    userRoles: string[],
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden gestionar rubros de gastos',
      );
    }

    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: categoryId, tenantId },
    });

    if (!category) {
      throw new NotFoundException(
        `Rubro de gasto no encontrado: ${categoryId}`,
      );
    }

    return this.toDto(category);
  }

  async createCategory(
    tenantId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateExpenseLedgerCategoryDto,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden gestionar rubros de gastos',
      );
    }

    const existing = await this.prisma.expenseLedgerCategory.findFirst({
      where: { tenantId, name: dto.name },
    });

    if (existing) {
      throw new ConflictException(
        `Ya existe un rubro con el nombre "${dto.name}"`,
      );
    }

    const category = await this.prisma.expenseLedgerCategory.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_LEDGER_CATEGORY_CREATE',
      entityType: 'ExpenseLedgerCategory',
      entityId: category.id,
      metadata: { name: dto.name },
    });

    return this.toDto(category);
  }

  async updateCategory(
    tenantId: string,
    categoryId: string,
    membershipId: string,
    userRoles: string[],
    dto: UpdateExpenseLedgerCategoryDto,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden gestionar rubros de gastos',
      );
    }

    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: categoryId, tenantId },
    });

    if (!category) {
      throw new NotFoundException(
        `Rubro de gasto no encontrado: ${categoryId}`,
      );
    }

    if (dto.name && dto.name !== category.name) {
      const conflict = await this.prisma.expenseLedgerCategory.findFirst({
        where: { tenantId, name: dto.name, id: { not: categoryId } },
      });
      if (conflict) {
        throw new ConflictException(
          `Ya existe un rubro con el nombre "${dto.name}"`,
        );
      }
    }

    const updated = await this.prisma.expenseLedgerCategory.update({
      where: { id: categoryId },
      data: {
        name: dto.name ?? category.name,
        description: dto.description !== undefined ? dto.description : category.description,
        active: dto.active !== undefined ? dto.active : category.active,
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_LEDGER_CATEGORY_UPDATE',
      entityType: 'ExpenseLedgerCategory',
      entityId: categoryId,
      metadata: dto,
    });

    return this.toDto(updated);
  }

  async deleteCategory(
    tenantId: string,
    categoryId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<void> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden gestionar rubros de gastos',
      );
    }

    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: categoryId, tenantId },
    });

    if (!category) {
      throw new NotFoundException(
        `Rubro de gasto no encontrado: ${categoryId}`,
      );
    }

    const usageCount = await this.prisma.expense.count({
      where: { categoryId, tenantId },
    });

    if (usageCount > 0) {
      // Soft delete: marcar inactivo en vez de borrar (hay gastos usando este rubro)
      await this.prisma.expenseLedgerCategory.update({
        where: { id: categoryId },
        data: { active: false },
      });
    } else {
      await this.prisma.expenseLedgerCategory.delete({
        where: { id: categoryId },
      });
    }

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_LEDGER_CATEGORY_DELETE',
      entityType: 'ExpenseLedgerCategory',
      entityId: categoryId,
      metadata: { name: category.name, hadExpenses: usageCount > 0 },
    });
  }

  private toDto(category: {
    id: string;
    tenantId: string;
    code?: string | null;
    name: string;
    description: string | null;
    sortOrder?: number;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ExpenseLedgerCategoryResponseDto {
    return {
      id: category.id,
      tenantId: category.tenantId,
      code: category.code ?? null,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder ?? 0,
      active: category.active,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
