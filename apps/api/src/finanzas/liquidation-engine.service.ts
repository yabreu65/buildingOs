import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';

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
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden crear liquidaciones',
      );
    }

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
      where: { buildingId, isBillable: true },
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
    const liquidation = await this.prisma.liquidation.create({
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
        generatedByMembershipId: membershipId,
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'LIQUIDATION_DRAFT',
      entityType: 'Liquidation',
      entityId: liquidation.id,
      metadata: {
        period,
        buildingId,
        expenseCount: allExpenses.length,
        buildingExpenseCount: buildingExpenses.length,
        sharedExpenseCount: sharedExpenses.length,
        totalAmountMinor,
      },
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
    expenses: any[],
    units: any[],
    totalAmountMinor: number,
  ): ChargeAllocation[] {
    // Por ahora: prorrateo simple por m2 para BUILDING scope
    // TODO: soporte para TENANT_SHARED y UNIT_GROUP scopes

    const totalM2 = units.reduce((sum, u) => sum + u.m2, 0);
    if (totalM2 === 0) {
      throw new BadRequestException(
        'Las unidades no tienen área m2 registrada para prorrateo',
      );
    }

    return units.map((unit) => {
      const unitPercentage = unit.m2 / totalM2;
      const unitAmountMinor = Math.round(totalAmountMinor * unitPercentage);

      return {
        unitId: unit.id,
        unitCode: unit.code,
        unitLabel: unit.label,
        areaM2: unit.m2,
        amountMinor: unitAmountMinor,
      };
    });
  }

  /**
   * Publish a draft liquidation → status REVIEWED
   * This locks the liquidation for review before final publication
   */
  async reviewLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden revisar liquidaciones');
    }

    const liquidation = await this.prisma.liquidation.findFirst({
      where: { id: liquidationId, tenantId },
    });

    if (!liquidation) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    if (liquidation.status !== 'DRAFT') {
      throw new BadRequestException(
        `La liquidación debe estar en DRAFT. Estado actual: ${liquidation.status}`,
      );
    }

    const updated = await this.prisma.liquidation.update({
      where: { id: liquidationId },
      data: {
        status: 'REVIEWED',
        reviewedAt: new Date(),
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'LIQUIDATION_REVIEW',
      entityType: 'Liquidation',
      entityId: liquidationId,
      metadata: { period: liquidation.period, previousStatus: 'DRAFT' },
    });

    return updated;
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
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden publicar liquidaciones');
    }

    const liquidation = await this.prisma.liquidation.findFirst({
      where: { id: liquidationId, tenantId },
      include: { building: { select: { id: true } } },
    });

    if (!liquidation) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    if (liquidation.status !== 'REVIEWED') {
      throw new BadRequestException(
        `La liquidación debe estar en REVIEWED. Estado actual: ${liquidation.status}`,
      );
    }

    // Recalcular charges para crear registros de Charge
    const buildingExpenses = await this.prisma.expense.findMany({
      where: {
        tenantId,
        buildingId: liquidation.buildingId,
        period: liquidation.period,
        status: 'VALIDATED',
      },
    });

    const sharedExpenses = await this.prisma.expense.findMany({
      where: {
        tenantId,
        period: liquidation.period,
        status: 'VALIDATED',
        scopeType: 'TENANT_SHARED',
        allocations: { some: { buildingId: liquidation.buildingId } },
      },
      include: { allocations: { where: { buildingId: liquidation.buildingId } } },
    });

    const units = await this.prisma.unit.findMany({
      where: { buildingId: liquidation.buildingId, isBillable: true },
      select: { id: true, code: true, label: true, m2: true },
    });

    const buildingTotal = buildingExpenses.reduce((s, e) => s + e.amountMinor, 0);
    const sharedTotal = sharedExpenses.reduce((s, e) => {
      const alloc = e.allocations[0];
      if (!alloc) return s;
      return s + (alloc.amountMinor ?? Math.floor(e.amountMinor * (alloc.percentage ?? 0) / 100));
    }, 0);
    const totalAmountMinor = buildingTotal + sharedTotal;

    const allExpenses = [...buildingExpenses, ...sharedExpenses];
    const charges = this.calculateCharges(allExpenses, units, totalAmountMinor);

    // Crear charges para cada unidad
    const chargeRecords = await this.prisma.charge.createMany({
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

    // Actualizar liquidación a PUBLISHED
    const updated = await this.prisma.liquidation.update({
      where: { id: liquidationId },
      data: {
        status: 'PUBLISHED',
        publishedByMembershipId: membershipId,
        publishedAt: new Date(),
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'LIQUIDATION_PUBLISH',
      entityType: 'Liquidation',
      entityId: liquidationId,
      metadata: {
        period: liquidation.period,
        chargeCount: chargeRecords.count,
        totalAmountMinor,
        dueDate: dueDate.toISOString(),
      },
    });

    return updated;
  }

  /**
   * Cancel a liquidation (DRAFT, REVIEWED, or PUBLISHED)
   * Deletes associated charges if PUBLISHED
   */
  async cancelLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden cancelar liquidaciones');
    }

    const liquidation = await this.prisma.liquidation.findFirst({
      where: { id: liquidationId, tenantId },
    });

    if (!liquidation) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    // Si PUBLISHED, eliminar charges asociadas
    if (liquidation.status === 'PUBLISHED') {
      await this.prisma.charge.deleteMany({ where: { tenantId, liquidationId } });
    }

    // Hard delete: el historial queda en AuditLog
    await this.prisma.liquidation.delete({ where: { id: liquidationId } });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'LIQUIDATION_CANCEL',
      entityType: 'Liquidation',
      entityId: liquidationId,
      metadata: {
        period: liquidation.period,
        previousStatus: liquidation.status,
      },
    });

    return liquidation;
  }

  /**
   * Get liquidation detail with expenses and charges preview
   */
  async getLiquidationDetail(
    tenantId: string,
    liquidationId: string,
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden ver liquidaciones');
    }

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
}
