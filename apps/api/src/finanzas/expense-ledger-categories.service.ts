import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateExpenseLedgerCategoryDto,
  ExpenseLedgerCategoryCatalogScope,
  ExpenseLedgerCategoryResponseDto,
  UpdateExpenseLedgerCategoryDto,
} from './expense-ledger.dto';
import { FinanzasValidators } from './finanzas.validators';

type ExpenseLedgerCategoryMovementType = 'EXPENSE' | 'INCOME';

interface MembershipRecord {
  id: string;
  tenantId: string;
  roles: Array<{
    role: string;
    scopeType: 'TENANT' | 'BUILDING' | 'UNIT';
  }>;
}

interface ExpenseLedgerCategoryRecord {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  description: string | null;
  movementType: ExpenseLedgerCategoryMovementType;
  catalogScope: 'BUILDING' | 'CONDOMINIUM_COMMON';
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CategoryMutationTx {
  membership: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
      select?: { id: boolean; tenantId?: boolean; roles?: boolean };
    }) => Promise<MembershipRecord | null>;
  };
  expenseLedgerCategory: {
    findMany: (args: {
      where: Record<string, unknown>;
      orderBy?: Array<Record<string, unknown>>;
    }) => Promise<ExpenseLedgerCategoryRecord[]>;
    findFirst: (args: { where: Record<string, unknown> }) => Promise<ExpenseLedgerCategoryRecord | null>;
    create: (args: {
      data: Record<string, unknown>;
    }) => Promise<ExpenseLedgerCategoryRecord>;
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
    deleteMany: (args: {
      where: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  expense: {
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
  };
  auditLog?: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
}

@Injectable()
export class ExpenseLedgerCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
  ) {}

  async listCategories(
    tenantId: string,
    membershipId: string,
    movementType?: 'EXPENSE' | 'INCOME',
    catalogScope?: 'BUILDING' | 'CONDOMINIUM_COMMON',
  ): Promise<ExpenseLedgerCategoryResponseDto[]> {
    await this.resolveAuthorizedMembership(this.prisma, tenantId, membershipId);

    const categories = await this.prisma.expenseLedgerCategory.findMany({
      where: {
        tenantId,
        ...(movementType && { movementType }),
        ...(catalogScope && { catalogScope }),
      },
      orderBy: [
        { isActive: 'desc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });

    return categories.map((category) => this.toDto(category));
  }

  async getCategory(
    tenantId: string,
    categoryId: string,
    membershipId: string,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    await this.resolveAuthorizedMembership(this.prisma, tenantId, membershipId);

    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: categoryId, tenantId },
    });

    if (!category) {
      throw new NotFoundException(`Rubro de gasto no encontrado: ${categoryId}`);
    }

    return this.toDto(category);
  }

  async createCategory(
    tenantId: string,
    membershipId: string,
    dto: CreateExpenseLedgerCategoryDto,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const membership = await this.resolveAuthorizedMembership(tx, tenantId, membershipId);

      const existing = await tx.expenseLedgerCategory.findFirst({
        where: { tenantId, name: dto.name },
      });

      if (existing) {
        throw new ConflictException(`Ya existe un rubro con el nombre "${dto.name}"`);
      }

      const movementType = dto.movementType ?? 'EXPENSE';
      const catalogScope = dto.catalogScope ?? 'BUILDING';
      let code = this.generateCode(dto.name, movementType);
      let category: ExpenseLedgerCategoryRecord | null = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          category = await tx.expenseLedgerCategory.create({
            data: {
              tenantId,
              code,
              name: dto.name,
              description: dto.description ?? null,
              movementType,
              catalogScope,
            },
          });
          break;
        } catch (error: unknown) {
          if (!this.isP2002Error(error)) {
            throw error;
          }

          const target = this.getUniqueTarget(error);
          if (this.isUniqueField(target, 'code') && attempt === 0) {
            code = this.generateCode(dto.name, movementType);
            continue;
          }

          this.handleCategoryMutationError(error, dto);
        }
      }

      if (!category) {
        throw new ConflictException('No se pudo crear el rubro de gasto');
      }

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membership.id,
          action: 'EXPENSE_LEDGER_CATEGORY_CREATE',
          entityType: 'ExpenseLedgerCategory',
          entityId: category.id,
          metadata: { name: dto.name, movementType, catalogScope, code },
        },
        tx,
      );

      return this.toDto(category);
    });
  }

  async updateCategory(
    tenantId: string,
    categoryId: string,
    membershipId: string,
    dto: UpdateExpenseLedgerCategoryDto,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const membership = await this.resolveAuthorizedMembership(tx, tenantId, membershipId);

      const current = await tx.expenseLedgerCategory.findFirst({
        where: { id: categoryId, tenantId },
      });

      if (!current) {
        throw new NotFoundException(`Rubro de gasto no encontrado: ${categoryId}`);
      }

      if (dto.name && dto.name !== current.name) {
        const conflict = await tx.expenseLedgerCategory.findFirst({
          where: { tenantId, name: dto.name, id: { not: categoryId } },
        });
        if (conflict) {
          throw new ConflictException(`Ya existe un rubro con el nombre "${dto.name}"`);
        }
      }

      const mutationResult = await tx.expenseLedgerCategory.updateMany({
        where: { id: categoryId, tenantId },
        data: {
          name: dto.name ?? current.name,
          description: dto.description !== undefined ? dto.description : current.description,
          isActive: dto.isActive !== undefined ? dto.isActive : current.isActive,
          catalogScope: dto.catalogScope ?? current.catalogScope,
        },
      });

      if (mutationResult.count === 0) {
        throw new NotFoundException(`Rubro de gasto no encontrado: ${categoryId}`);
      }

      if (mutationResult.count > 1) {
        throw new ConflictException('Mutación ambigua al actualizar el rubro');
      }

      const updated = await tx.expenseLedgerCategory.findFirst({
        where: { id: categoryId, tenantId },
      });

      if (!updated) {
        throw new NotFoundException(`Rubro de gasto no encontrado: ${categoryId}`);
      }

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membership.id,
          action: 'EXPENSE_LEDGER_CATEGORY_UPDATE',
          entityType: 'ExpenseLedgerCategory',
          entityId: categoryId,
          metadata: {
            ...dto,
            catalogScope: dto.catalogScope ?? current.catalogScope,
          },
        },
        tx,
      );

      return this.toDto(updated);
    }).catch((error: unknown) => this.handleCategoryMutationError(error, dto));
  }

  async deleteCategory(
    tenantId: string,
    categoryId: string,
    membershipId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const membership = await this.resolveAuthorizedMembership(tx, tenantId, membershipId);

      const current = await tx.expenseLedgerCategory.findFirst({
        where: { id: categoryId, tenantId },
      });

      if (!current) {
        throw new NotFoundException(`Rubro de gasto no encontrado: ${categoryId}`);
      }

      const usageCount = await tx.expense.count({
        where: { categoryId, tenantId },
      });

      if (usageCount > 0) {
        const mutationResult = await tx.expenseLedgerCategory.updateMany({
          where: { id: categoryId, tenantId, isActive: true },
          data: { isActive: false },
        });

        if (mutationResult.count === 0) {
          throw new NotFoundException(`Rubro de gasto no encontrado: ${categoryId}`);
        }

        if (mutationResult.count > 1) {
          throw new ConflictException('Mutación ambigua al eliminar el rubro');
        }
      } else {
        const mutationResult = await tx.expenseLedgerCategory.deleteMany({
          where: { id: categoryId, tenantId },
        });

        if (mutationResult.count === 0) {
          throw new NotFoundException(`Rubro de gasto no encontrado: ${categoryId}`);
        }

        if (mutationResult.count > 1) {
          throw new ConflictException('Mutación ambigua al eliminar el rubro');
        }
      }

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membership.id,
          action: 'EXPENSE_LEDGER_CATEGORY_DELETE',
          entityType: 'ExpenseLedgerCategory',
          entityId: categoryId,
          metadata: { name: current.name, hadExpenses: usageCount > 0 },
        },
        tx,
      );
    });
  }

  private async resolveAuthorizedMembership(
    tx: CategoryMutationTx | PrismaService | Prisma.TransactionClient,
    tenantId: string,
    membershipId: string,
  ): Promise<{ id: string; tenantId: string; roles: string[] }> {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: { id: true, tenantId: true, roles: true },
    });

    if (!membership) {
      throw new NotFoundException('No se encontró una membresía válida para el tenant');
    }

    const membershipRoles = membership.roles
      .filter((role) => role.scopeType === 'TENANT')
      .map((role) => role.role);

    if (!this.validators.isAdminOrOperator(membershipRoles)) {
      throw new ForbiddenException('Solo administradores pueden gestionar rubros');
    }

    return { id: membership.id, tenantId: membership.tenantId, roles: membershipRoles };
  }

  private handleCategoryMutationError<T>(
    error: unknown,
    dto: T,
  ): never {
    if (this.isP2002Error(error)) {
      const target = this.getUniqueTarget(error);

      if (this.isUniqueField(target, 'name')) {
        const name = (dto as { name?: string }).name;
        throw new ConflictException(
          name ? `Ya existe un rubro con el nombre "${name}"` : 'Ya existe un rubro con ese nombre',
        );
      }

      throw new ConflictException('Conflicto de unicidad al actualizar el rubro');
    }

    throw error as never;
  }

  private isP2002Error(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private getUniqueTarget(error: Prisma.PrismaClientKnownRequestError): string[] {
    const meta = error.meta as { target?: unknown } | undefined;
    if (!Array.isArray(meta?.target)) {
      return [];
    }

    return meta.target.filter((value): value is string => typeof value === 'string');
  }

  private isUniqueField(target: string[], field: string): boolean {
    return target.includes(field);
  }

  private toDto(category: ExpenseLedgerCategoryRecord): ExpenseLedgerCategoryResponseDto {
    return {
      id: category.id,
      tenantId: category.tenantId,
      code: category.code,
      name: category.name,
      description: category.description,
      movementType: category.movementType,
      catalogScope: category.catalogScope,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }

  private generateCode(name: string, movementType: ExpenseLedgerCategoryMovementType): string {
    const prefix = movementType === 'EXPENSE' ? 'EXP' : 'INC';
    const slug = name
      .toUpperCase()
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9_]/g, '');

    return `${prefix}_${slug}_${randomUUID().slice(0, 8).toUpperCase()}`;
  }
}
