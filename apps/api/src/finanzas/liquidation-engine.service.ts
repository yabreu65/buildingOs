import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  buildLiquidationPublicationSnapshot,
  distributeLiquidationAmountByLargestRemainder,
} from './liquidation-publication-snapshot';

export interface LiquidationCalculationInput {
  buildingId: string;
  period: string; // YYYY-MM
  baseCurrency: string;
}

export interface ChargeAllocation {
  unitId: string;
  unitCode: string;
  unitLabel: string | null;
  areaM2: number;
  amountMinor: number; // prorrateo o monto fijo
}

type LiquidationExpense = Prisma.ExpenseGetPayload<{
  include: {
    category: {
      select: {
        name: true;
      };
    };
    vendor: {
      select: {
        name: true;
      };
    };
    allocations: true;
  };
}>;

type LiquidationUnit = Prisma.UnitGetPayload<{
  select: {
    id: true;
    code: true;
    label: true;
    m2: true;
  };
}>;

@Injectable()
export class LiquidationEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
  ) {}

  /**
   * Create a draft liquidation for a building/period
   * Aggregates all VALIDATED expenses, allocates to units using prorrateo or allocation rules
   */
  async createLiquidationDraft(
    tenantId: string,
    buildingId: string,
    period: string,
    baseCurrency: string,
    membershipId: string,
  ) {
    const membership = await this.requireFinanceMembership(
      this.prisma,
      tenantId,
      membershipId,
    );

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    // Verificar que no exista liquidación en DRAFT/PUBLISHED para este período
    const existing = await this.prisma.liquidation.findFirst({
      where: {
        tenantId,
        buildingId,
        period,
        status: { not: 'CANCELED' },
      },
    });

    if (existing) {
      throw new BadRequestException(
        `Ya existe una liquidación en estado ${existing.status} para ${period}`,
      );
    }

    // 1. Gastos propios del edificio (scopeType BUILDING)
    const buildingExpenses = await this.prisma.expense.findMany({
      where: { tenantId, buildingId, period, status: 'VALIDATED' },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
        allocations: true,
      },
    });

    // 2. Gastos de condominio (TENANT_SHARED) con allocation para este edificio
    const sharedExpenses = await this.prisma.expense.findMany({
      where: {
        tenantId,
        period,
        status: 'VALIDATED',
        scopeType: 'TENANT_SHARED',
        allocations: { some: { buildingId } },
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
        allocations: { where: { buildingId } },
      },
    });

    const allExpenses = [...buildingExpenses, ...sharedExpenses];

    if (allExpenses.length === 0) {
      throw new BadRequestException(
        `No hay gastos validados para ${period} en este edificio`,
      );
    }

    // Calcular totales: BUILDING usa monto completo, TENANT_SHARED usa la porción de este edificio
    const buildingTotal = buildingExpenses.reduce((s, e) => s + e.amountMinor, 0);
    const sharedTotal = sharedExpenses.reduce((s, e) => {
      const alloc = e.allocations[0];
      if (!alloc) return s;
      const amount = alloc.amountMinor ?? Math.floor(e.amountMinor * (alloc.percentage ?? 0) / 100);
      return s + amount;
    }, 0);
    const totalAmountMinor = buildingTotal + sharedTotal;

    const totalsByCurrency: Record<string, number> = {};
    buildingExpenses.forEach((exp) => {
      totalsByCurrency[exp.currencyCode] =
        (totalsByCurrency[exp.currencyCode] ?? 0) + exp.amountMinor;
    });
    sharedExpenses.forEach((exp) => {
      const alloc = exp.allocations[0];
      if (!alloc) return;
      const amount = alloc.amountMinor ?? Math.floor(exp.amountMinor * (alloc.percentage ?? 0) / 100);
      totalsByCurrency[exp.currencyCode] = (totalsByCurrency[exp.currencyCode] ?? 0) + amount;
    });

    // Obtener unidades del building (solo billables)
    const units = await this.prisma.unit.findMany({
      where: { tenantId, buildingId, isBillable: true },
      select: { id: true, code: true, label: true, m2: true },
    });

    if (units.length === 0) {
      throw new BadRequestException(
        'El edificio no tiene unidades billables registradas',
      );
    }

    // Calcular allocations: prorrateo por m2 del total combinado
    const chargesPreview = this.calculateCharges(
      allExpenses,
      units,
      totalAmountMinor,
    );

    // Crear liquidación en DRAFT
    const liquidation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.liquidation.create({
        data: {
        tenantId,
        buildingId,
        period,
        status: 'DRAFT',
        baseCurrency,
        totalAmountMinor,
        totalsByCurrency,
        expenseSnapshot: allExpenses.map((e) => {
          const isShared = e.scopeType === 'TENANT_SHARED';
          const alloc = isShared ? e.allocations[0] : null;
          const amount = isShared && alloc
            ? (alloc.amountMinor ?? Math.floor(e.amountMinor * (alloc.percentage ?? 0) / 100))
            : e.amountMinor;
          return {
            expenseId: e.id,
            amountMinor: amount,
            currencyCode: e.currencyCode,
            scopeType: e.scopeType,
          };
        }),
        unitCount: units.length,
        generatedByMembershipId: membership.id,
        },
      });

      await this.auditService.createLogRequired({
        tenantId,
        actorMembershipId: membership.id,
        action: 'LIQUIDATION_DRAFT',
        entityType: 'Liquidation',
        entityId: created.id,
        metadata: {
          period,
          buildingId,
          expenseCount: allExpenses.length,
          buildingExpenseCount: buildingExpenses.length,
          sharedExpenseCount: sharedExpenses.length,
          totalAmountMinor,
        },
      }, tx);

      return created;
    });

    return {
      liquidation,
      expenses: allExpenses.map((e) => {
        const isShared = e.scopeType === 'TENANT_SHARED';
        const alloc = isShared ? e.allocations[0] : null;
        const amount = isShared && alloc
          ? (alloc.amountMinor ?? Math.floor(e.amountMinor * (alloc.percentage ?? 0) / 100))
          : e.amountMinor;
        return {
          id: e.id,
          categoryName: e.category.name,
          vendorName: e.vendor?.name ?? null,
          amountMinor: amount,
          currencyCode: e.currencyCode,
          invoiceDate: e.invoiceDate,
          description: e.description,
          scopeType: e.scopeType,
        };
      }),
      chargesPreview,
    };
  }

  /**
   * Calculate charge allocations for units
   * Rules:
   * - BUILDING scope: prorrateo por m2
   * - TENANT_SHARED scope: usar MovementAllocation % o amounts
   * - UNIT_GROUP scope: prorrateo solo dentro del grupo
   */
  private calculateCharges(
    _expenses: ReadonlyArray<unknown>,
    units: LiquidationUnit[],
    totalAmountMinor: number,
  ): ChargeAllocation[] {
    // Por ahora: prorrateo simple por m2 para BUILDING scope
    // TODO: soporte para TENANT_SHARED y UNIT_GROUP scopes

    return distributeLiquidationAmountByLargestRemainder(
      units.map((unit) => ({
        id: unit.id,
        code: unit.code,
        label: unit.label,
        areaM2: unit.m2 ?? 0,
      })),
      totalAmountMinor,
    );
  }

  /**
   * Publish a draft liquidation → status REVIEWED
   * This locks the liquidation for review before final publication
   */
  async reviewLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const membership = await this.requireFinanceMembership(tx, tenantId, membershipId);
      const liquidation = await tx.liquidation.findFirst({
        where: { id: liquidationId, tenantId },
        select: {
          id: true,
          status: true,
          period: true,
        },
      });

      if (!liquidation) {
        throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
      }

      if (liquidation.status !== 'DRAFT') {
        throw new BadRequestException(
          `La liquidación debe estar en DRAFT. Estado actual: ${liquidation.status}`,
        );
      }

      const reviewedAt = new Date();
      const updateResult = await tx.liquidation.updateMany({
        where: { id: liquidationId, tenantId, status: 'DRAFT' },
        data: {
          status: 'REVIEWED',
          reviewedAt,
          reviewedByMembershipId: membership.id,
          updatedAt: reviewedAt,
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException(
          'No fue posible revisar la liquidación porque cambió de estado',
        );
      }

      const updated = await tx.liquidation.findFirst({
        where: { id: liquidationId, tenantId },
      });

      if (!updated) {
        throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
      }

      await this.auditService.createLogRequired({
        tenantId,
        actorMembershipId: membership.id,
        action: 'LIQUIDATION_REVIEW',
        entityType: 'Liquidation',
        entityId: liquidationId,
        metadata: { period: liquidation.period, previousStatus: 'DRAFT' },
      }, tx);

      return updated;
    });
  }

  /**
   * Publish a reviewed liquidation → status PUBLISHED
   * Creates charges for all units based on calculated allocations
   */
  async publishLiquidation(
    tenantId: string,
    liquidationId: string,
    dueDate: Date,
    membershipId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const membership = await this.requireFinanceMembership(tx, tenantId, membershipId);
      const liquidation = await tx.liquidation.findFirst({
        where: { id: liquidationId, tenantId },
      });

      if (!liquidation) {
        throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
      }

      if (liquidation.status !== 'REVIEWED') {
        throw new BadRequestException(
          `La liquidación debe estar en REVIEWED. Estado actual: ${liquidation.status}`,
        );
      }

      const buildingExpenses = await tx.expense.findMany({
        where: {
          tenantId,
          buildingId: liquidation.buildingId,
          period: liquidation.period,
          status: 'VALIDATED',
        },
        include: {
          category: { select: { name: true } },
          vendor: { select: { name: true } },
          allocations: true,
        },
      });

      const sharedExpenses = await tx.expense.findMany({
        where: {
          tenantId,
          period: liquidation.period,
          status: 'VALIDATED',
          scopeType: 'TENANT_SHARED',
          allocations: { some: { buildingId: liquidation.buildingId } },
        },
        include: {
          category: { select: { name: true } },
          vendor: { select: { name: true } },
          allocations: { where: { buildingId: liquidation.buildingId } },
        },
      });

      const units = await tx.unit.findMany({
        where: { tenantId, buildingId: liquidation.buildingId, isBillable: true },
        select: { id: true, code: true, label: true, m2: true },
      });

      const buildingTotal = buildingExpenses.reduce(
        (sum, expense) => sum + expense.amountMinor,
        0,
      );
      const sharedTotal = sharedExpenses.reduce((sum, expense) => {
        const allocation = expense.allocations[0];
        if (!allocation) {
          return sum;
        }

        return sum + (
          allocation.amountMinor
          ?? Math.floor(expense.amountMinor * (allocation.percentage ?? 0) / 100)
        );
      }, 0);
      const totalAmountMinor = buildingTotal + sharedTotal;
      const allExpenses = [...buildingExpenses, ...sharedExpenses];
      const charges = this.calculateCharges(allExpenses, units, totalAmountMinor);
      const totalsByCurrency: Record<string, number> = {};
      const publicationExpenses = allExpenses.map((expense) => {
        const allocation = expense.scopeType === 'TENANT_SHARED'
          ? expense.allocations[0]
          : undefined;
        const amountMinor = allocation
          ? (
            allocation.amountMinor
            ?? Math.floor(expense.amountMinor * (allocation.percentage ?? 0) / 100)
          )
          : expense.amountMinor;

        totalsByCurrency[expense.currencyCode] =
          (totalsByCurrency[expense.currencyCode] ?? 0) + amountMinor;

        return {
          expenseId: expense.id,
          categoryName: expense.category.name,
          vendorName: expense.vendor?.name ?? null,
          amountMinor,
          currencyCode: expense.currencyCode,
          invoiceDate: expense.invoiceDate.toISOString(),
          description: expense.description,
          type: 'EXPENSE' as const,
        };
      });
      const publishedAt = new Date();
      const publicationSnapshot = buildLiquidationPublicationSnapshot({
        liquidationId: liquidation.id,
        tenantId,
        buildingId: liquidation.buildingId,
        period: liquidation.period,
        baseCurrency: liquidation.baseCurrency,
        totalAmountMinor,
        totalsByCurrency,
        expenses: publicationExpenses,
        allocations: charges.map((charge) => ({
          unitId: charge.unitId,
          unitCode: charge.unitCode,
          unitLabel: charge.unitLabel,
          amountMinor: charge.amountMinor,
        })),
        dueDate,
        publishedAt,
      });

      const chargeRecords = await tx.charge.createMany({
        data: charges.map((charge) => ({
        tenantId,
        buildingId: liquidation.buildingId,
        unitId: charge.unitId,
        period: liquidation.period,
        concept: `Expensas Comunes - ${liquidation.period}`,
        amount: charge.amountMinor,
        currency: liquidation.baseCurrency,
        dueDate,
        status: 'PENDING',
        liquidationId: liquidation.id,
        })),
      });

      const updated = await tx.liquidation.update({
        where: { id: liquidationId },
        data: {
          status: 'PUBLISHED',
          publicationSnapshot,
          publishedByMembershipId: membership.id,
          publishedAt,
        },
      });

      await this.auditService.createLogRequired({
        tenantId,
        actorMembershipId: membership.id,
        action: 'LIQUIDATION_PUBLISH',
        entityType: 'Liquidation',
        entityId: liquidationId,
        metadata: {
          period: liquidation.period,
          chargeCount: chargeRecords.count,
          totalAmountMinor,
          dueDate: dueDate.toISOString(),
        },
      }, tx);

      return updated;
    });
  }

  /**
   * Cancel a liquidation (DRAFT or REVIEWED)
   * Publishes a terminal CANCELED state without deleting financial history
   */
  async cancelLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const membership = await this.requireFinanceMembership(tx, tenantId, membershipId);
      const liquidation = await tx.liquidation.findFirst({
        where: { id: liquidationId, tenantId },
        select: {
          id: true,
          status: true,
          period: true,
        },
      });

      if (!liquidation) {
        throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
      }

      if (liquidation.status === 'PUBLISHED') {
        throw new BadRequestException('La liquidación publicada no se puede cancelar directamente');
      }

      if (liquidation.status === 'CANCELED') {
        throw new BadRequestException('La liquidación ya está cancelada');
      }

      const canceledAt = new Date();
      const updateResult = await tx.liquidation.updateMany({
        where: {
          id: liquidationId,
          tenantId,
          status: { in: ['DRAFT', 'REVIEWED'] },
        },
        data: {
          status: 'CANCELED',
          canceledAt,
          canceledByMembershipId: membership.id,
          updatedAt: canceledAt,
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException(
          'No fue posible cancelar la liquidación porque cambió de estado',
        );
      }

      const canceled = await tx.liquidation.findFirst({
        where: { id: liquidationId, tenantId },
      });

      if (!canceled) {
        throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
      }

      await this.auditService.createLogRequired({
        tenantId,
        actorMembershipId: membership.id,
        action: 'LIQUIDATION_CANCEL',
        entityType: 'Liquidation',
        entityId: liquidationId,
        metadata: {
          period: liquidation.period,
          previousStatus: liquidation.status,
          canceledAt: canceledAt.toISOString(),
        },
      }, tx);

      return canceled;
    });
  }

  /**
   * Get liquidation detail with expenses and charges preview
   */
  async getLiquidationDetail(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
  ) {
    await this.requireFinanceMembership(this.prisma, tenantId, membershipId);

    const liquidation = await this.prisma.liquidation.findFirst({
      where: { id: liquidationId, tenantId },
    });

    if (!liquidation) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    const expenses = await this.prisma.expense.findMany({
      where: {
        tenantId,
        buildingId: liquidation.buildingId,
        period: liquidation.period,
        status: 'VALIDATED',
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    // Obtener charges si PUBLISHED
    const charges =
      liquidation.status === 'PUBLISHED'
        ? await this.prisma.charge.findMany({
            where: {
              tenantId,
              liquidationId,
            },
            include: {
              unit: { select: { code: true, label: true, m2: true } },
            },
          })
        : [];

    return {
      ...liquidation,
      expenses: expenses.map((e) => ({
        id: e.id,
        categoryName: e.category.name,
        vendorName: e.vendor?.name ?? null,
        amountMinor: e.amountMinor,
        currencyCode: e.currencyCode,
        invoiceDate: e.invoiceDate,
        description: e.description,
      })),
      chargesPreview: charges.map((c) => ({
        unitId: c.unitId,
        unitCode: c.unit.code,
        unitLabel: c.unit.label,
        areaM2: c.unit.m2,
        amountMinor: c.amount,
      })),
    };
  }

  private async requireFinanceMembership(
    client: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    membershipId: string,
  ): Promise<{ id: string; tenantId: string; roles: string[] }> {
    const membership = await client.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: {
        id: true,
        tenantId: true,
        roles: {
          select: {
            role: true,
            scopeType: true,
          },
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('No se encontró una membresía válida para el tenant');
    }

    const tenantRoles = membership.roles
      .filter((role) => role.scopeType === 'TENANT')
      .map((role) => role.role);

    if (!this.validators.isAdminOrOperator(tenantRoles)) {
      throw new ForbiddenException('Solo administradores pueden gestionar liquidaciones');
    }

    return {
      id: membership.id,
      tenantId: membership.tenantId,
      roles: tenantRoles,
    };
  }
}
